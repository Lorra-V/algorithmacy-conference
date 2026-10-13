function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function dayKey(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function dayLabel(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone, weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(iso));
}

function timeLabel(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone, hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

function zoneLabel(iso, timeZone) {
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, timeZoneName: 'short' }).formatToParts(new Date(iso));
  var name = parts.filter(function (p) { return p.type === 'timeZoneName'; })[0];
  return name ? name.value : timeZone;
}

function zoneNote(iso, timeZone) {
  var local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  var text = 'Times are ' + zoneLabel(iso, timeZone) + ' (' + timeZone.replace(/_/g, ' ') + ').';
  if (local && local !== timeZone) {
    text += ' In your time zone, ' + timeLabel(iso, timeZone) + ' ' + zoneLabel(iso, timeZone) + ' is ' + timeLabel(iso, local) + ' ' + zoneLabel(iso, local) + '.';
  }
  return text;
}

var CLOSED = 'The calendar is not open yet. Use the form, or write to topanga@algorithmacy.org.';

function readJson(res) {
  return res.text().then(function (text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { data = { error: CLOSED }; }
    return { ok: res.ok && data.error !== CLOSED, data: data };
  });
}

async function post(body) {
  const res = await fetch('/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await readJson(res);
  if (!result.ok) throw new Error(result.data.error || 'Something went wrong.');
  return result.data;
}

function group(slots, timeZone) {
  var days = [];
  var map = {};
  slots.forEach(function (slot) {
    var key = dayKey(slot.start, timeZone);
    if (!map[key]) {
      map[key] = { key: key, label: dayLabel(slot.start, timeZone), slots: [] };
      days.push(map[key]);
    }
    map[key].slots.push(slot);
  });
  return days;
}

function mountBook(root) {
  root.classList.add('book-panel');
  root.innerHTML = '<p class="book-note">Loading the open times.</p>';
  fetch('/api/book?type=discovery')
    .then(readJson)
    .then(function (result) {
      if (!result.ok) throw new Error(result.data.error || 'The calendar is not open yet.');
      draw(root, result.data);
    })
    .catch(function (err) {
      root.innerHTML = '<p class="book-error">' + esc(err.message || 'The calendar is not open yet. Use the form, or write to topanga@algorithmacy.org.') + '</p>';
    });
}

function draw(root, data) {
  var days = group(data.slots || [], data.timeZone);
  if (!days.length) {
    root.innerHTML = '<p class="book-note">No open times in the next two weeks. Write to topanga@algorithmacy.org.</p>';
    return;
  }
  var pickedDay = days[0].key;
  var picked = null;
  var hold = null;

  function render() {
    var day = days.filter(function (d) { return d.key === pickedDay; })[0] || days[0];
    root.innerHTML =
      '<p class="book-note">Pick a day, then a time. ' + esc(zoneNote((picked || day.slots[0]).start, data.timeZone)) + '</p>' +
      '<div class="book-days" role="group" aria-label="Days"></div>' +
      '<div class="book-times" role="group" aria-label="Times"></div>' +
      '<div class="book-form-slot"></div>';
    var dayBox = root.querySelector('.book-days');
    days.forEach(function (d) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'book-slot' + (d.key === day.key ? ' is-on' : '');
      btn.setAttribute('aria-pressed', d.key === day.key ? 'true' : 'false');
      btn.textContent = d.label;
      btn.addEventListener('click', function () {
        pickedDay = d.key;
        picked = null;
        hold = null;
        render();
      });
      dayBox.appendChild(btn);
    });
    var timeBox = root.querySelector('.book-times');
    day.slots.forEach(function (slot) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'book-slot' + (picked && picked.start === slot.start ? ' is-on' : '');
      btn.setAttribute('aria-pressed', picked && picked.start === slot.start ? 'true' : 'false');
      btn.textContent = timeLabel(slot.start, data.timeZone);
      btn.addEventListener('click', function () {
        picked = slot;
        hold = null;
        render();
        post({ action: 'hold', type: 'discovery', start: slot.start })
          .then(function (body) { hold = body.holdToken; })
          .catch(function () { hold = null; });
      });
      timeBox.appendChild(btn);
    });
    var formSlot = root.querySelector('.book-form-slot');
    if (!picked) {
      formSlot.innerHTML = '<p class="book-note">The call is 20 minutes.</p>';
      return;
    }
    formSlot.innerHTML =
      '<form class="book-form">' +
      '<label>Your name<input name="name" autocomplete="name" required></label>' +
      '<label>Email<input name="email" type="email" autocomplete="email" required></label>' +
      '<label class="wide">The business<input name="business" autocomplete="organization" required></label>' +
      '<label class="wide">What you want to talk about<input name="note" placeholder="Intake, follow-ups, chasing documents"></label>' +
      '<p class="book-hp" aria-hidden="true"><label>Leave empty<input name="website" tabindex="-1" autocomplete="off"></label></p>' +
      '<p class="book-error" hidden></p>' +
      '<button type="submit">Book ' + esc(dayLabel(picked.start, data.timeZone)) + ' at ' + esc(timeLabel(picked.start, data.timeZone)) + ' ' + esc(zoneLabel(picked.start, data.timeZone)) + '</button>' +
      '</form>';
    var form = formSlot.querySelector('form');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var err = form.querySelector('.book-error');
      err.hidden = true;
      var button = form.querySelector('button');
      button.disabled = true;
      var fd = new FormData(form);
      post({
        type: 'discovery',
        start: picked.start,
        holdToken: hold || '',
        name: fd.get('name'),
        email: fd.get('email'),
        business: fd.get('business'),
        note: fd.get('note'),
        website: fd.get('website') || '',
      }).then(function (body) {
        var when = body.meeting && body.meeting.when ? body.meeting.when : 'the time you picked';
        var manage = body.meeting && body.meeting.manageUrl ? body.meeting.manageUrl : '/book/';
        root.innerHTML =
          '<div class="book-confirm"><h3>Booked.</h3>' +
          '<p>' + esc(when) + '. A confirmation is on its way, with a calendar file.</p>' +
          '<p>This call is not an account. If the work fits, an invite to the portal arrives at this email after the call. Until then, sign-in will not find you.</p>' +
          (body.meeting && body.meeting.video ? '<p>Link: ' + esc(body.meeting.video) + '</p>' : '') +
          '<p><a href="' + esc(manage) + '">Change or cancel</a></p></div>';
      }).catch(function (error) {
        button.disabled = false;
        err.hidden = false;
        err.textContent = error.message;
      });
    });
  }
  render();
}

function mountManage(root) {
  var token = new URLSearchParams(location.search).get('t') || '';
  root.classList.add('book-panel');
  if (!token) {
    root.innerHTML = '<p class="book-error">That link is missing a token. Use the link in the confirmation email.</p>';
    return;
  }
  root.innerHTML = '<p class="book-note">Loading the call.</p>';
  fetch('/api/book?t=' + encodeURIComponent(token))
    .then(readJson)
    .then(function (result) {
      if (!result.ok) throw new Error(result.data.error || 'That link is not valid.');
      show(root, token, result.data.meeting);
    })
    .catch(function (err) {
      root.innerHTML = '<p class="book-error">' + esc(err.message) + '</p>';
    });
}

function show(root, token, meeting) {
  var status = meeting.status === 'cancelled' ? 'Cancelled. ' : '';
  root.innerHTML =
    '<div class="book-confirm"><h3>' + esc(meeting.business || 'Your call') + '</h3>' +
    '<p>' + esc(status + meeting.when) + '</p>' +
    (meeting.status === 'booked' ? '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="book-text-btn" id="book-cancel">Cancel</button><button type="button" class="book-text-btn" id="book-move">Pick another time</button></div><p class="book-error" id="book-manage-error" hidden></p><div id="book-move-slot"></div>' : '<p><a href="/book/">Book another</a></p>') +
    '</div>';
  var cancel = document.getElementById('book-cancel');
  if (cancel) cancel.addEventListener('click', function () {
    cancel.disabled = true;
    post({ action: 'cancel', token: token }).then(function () {
      meeting.status = 'cancelled';
      show(root, token, meeting);
    }).catch(function (err) {
      cancel.disabled = false;
      var el = document.getElementById('book-manage-error');
      el.hidden = false;
      el.textContent = err.message;
    });
  });
  var move = document.getElementById('book-move');
  if (move) move.addEventListener('click', function () {
    var slot = document.getElementById('book-move-slot');
    slot.innerHTML = '<p class="book-note">Loading times.</p>';
    post({ action: 'slots', token: token }).then(function (data) {
      var days = group(data.slots || [], data.timeZone);
      if (!days.length) { slot.innerHTML = '<p class="book-note">No other open times in the next two weeks.</p>'; return; }
      slot.innerHTML = '<p class="book-note">' + esc(zoneNote(days[0].slots[0].start, data.timeZone)) + '</p><div class="book-times"></div>';
      var box = slot.querySelector('.book-times');
      days.forEach(function (day) {
        day.slots.forEach(function (s) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'book-slot';
          btn.textContent = day.label + ' ' + timeLabel(s.start, data.timeZone);
          btn.addEventListener('click', function () {
            btn.disabled = true;
            post({ action: 'reschedule', token: token, start: s.start }).then(function (body) {
              show(root, token, body.meeting);
            }).catch(function (err) {
              btn.disabled = false;
              var el = document.getElementById('book-manage-error');
              el.hidden = false;
              el.textContent = err.message;
            });
          });
          box.appendChild(btn);
        });
      });
    }).catch(function (err) {
      slot.innerHTML = '<p class="book-error">' + esc(err.message) + '</p>';
    });
  });
}

var bookRoot = document.getElementById('book-root');
if (bookRoot) mountBook(bookRoot);
var manageRoot = document.getElementById('book-manage');
if (manageRoot) mountManage(manageRoot);
