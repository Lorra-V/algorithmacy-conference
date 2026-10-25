(function () {
  var copyBtn = document.getElementById("copy-studio-prompt");
  var copyStatus = document.getElementById("copy-studio-status");
  var copiedLabel = "Copied. Paste it into Claude, ChatGPT, Grok, Gemini, or any local model.";
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var previous = copyBtn.textContent;
      copyBtn.disabled = true;
      loadHarness().then(function (text) {
        return writeClipboard(text);
      }).then(function () {
        copyBtn.classList.add("is-copied");
        copyBtn.textContent = copiedLabel;
        if (copyStatus) copyStatus.textContent = copiedLabel;
      }).catch(function () {
        copyBtn.textContent = previous;
        copyBtn.classList.remove("is-copied");
        if (copyStatus) copyStatus.textContent = "The copy did not go through. Open the raw prompt and copy it from that page.";
      }).then(function () {
        copyBtn.disabled = false;
      });
    });
  }

  function loadHarness() {
    return fetch("/studio/llm-harness.md", { headers: { Accept: "text/markdown, text/plain, */*" } }).then(function (res) {
      if (!res.ok) throw new Error("missing");
      return res.text();
    });
  }

  function writeClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).catch(function () {
        return writeClipboardFallback(text);
      });
    }
    return writeClipboardFallback(text);
  }

  function writeClipboardFallback(text) {
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.width = "1px";
      area.style.height = "1px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      try {
        var ok = document.execCommand("copy");
        document.body.removeChild(area);
        if (ok) resolve();
        else reject(new Error("copy failed"));
      } catch (err) {
        document.body.removeChild(area);
        reject(err);
      }
    });
  }

  var form = document.getElementById("desk-form");
  var line = document.getElementById("desk-line");
  var messageInput = document.getElementById("desk-message");
  var messageLabel = document.getElementById("desk-message-label");
  var offices = document.getElementById("desk-offices");
  var status = document.getElementById("desk-status");
  var done = document.getElementById("desk-done");
  var send = document.getElementById("desk-send");
  var terms = document.getElementById("desk-terms");
  var started = document.getElementById("desk-started");
  if (!form || !line || !messageInput) return;

  if (started) started.value = String(Date.now());

  function intent() {
    var picked = form.querySelector('input[name="intent"]:checked');
    return picked ? picked.value : "office";
  }

  function office() {
    var picked = form.querySelector('input[name="office"]:checked');
    return picked ? picked.value : "dental practice or clinic";
  }

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function article(kind) {
    return /^[aeiou]/i.test(kind) ? "an " : "a ";
  }

  function officeLabel() {
    var kind = article(office()) + office();
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }

  function preview(text) {
    var clean = text.replace(/\s+/g, " ").trim();
    if (clean.length > 140) return clean.slice(0, 137) + "…";
    return clean;
  }

  function writeLine() {
    var message = preview(messageInput.value);
    if (intent() === "other") {
      line.textContent = message
        ? "Other work: " + message + ". No price is listed on this page."
        : "Other work. No price is listed on this page.";
      return;
    }
    line.textContent =
      officeLabel() +
      (message ? ". Work: " + message + "." : ".") +
      " The first 10 home and office installs: free labor to install and maintain. Equipment not included. Continued endorsement and testimonial. Restrictions apply. After that, $5,000 to set up, then $1,000 a month.";
  }

  function applyIntent() {
    var other = intent() === "other";
    if (offices) offices.disabled = other;
    if (messageLabel) messageLabel.textContent = "The chore or message";
    messageInput.placeholder = other ? "What you want designed or built" : "New patient replies, missing records, household files";
    writeLine();
  }

  document.querySelectorAll("[data-intent]").forEach(function (el) {
    el.addEventListener("click", function () {
      var value = el.getAttribute("data-intent");
      var input = form.querySelector('input[name="intent"][value="' + value + '"]');
      if (!input) return;
      input.checked = true;
      applyIntent();
      window.setTimeout(function () {
        var name = document.getElementById("desk-name");
        if (name) name.focus({ preventScroll: true });
      }, 350);
    });
  });

  form.addEventListener("input", writeLine);
  form.addEventListener("change", applyIntent);

  function showError(message) {
    if (send) send.disabled = false;
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (terms) terms.setCustomValidity("");
    if (terms && !terms.checked) {
      terms.setCustomValidity("Please agree to the Terms of Service and Privacy Policy.");
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      if (terms) terms.setCustomValidity("");
      return;
    }
    if (terms) terms.setCustomValidity("");
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }
    if (send) {
      send.disabled = true;
      send.textContent = "Sending…";
    }

    var payload = {
      intent: intent(),
      name: fieldValue("desk-name"),
      business: fieldValue("desk-business"),
      email: fieldValue("desk-email"),
      phone: fieldValue("desk-phone"),
      message: messageInput.value.trim(),
      terms: !!(terms && terms.checked),
      started: started ? Number(started.value) : 0,
      hp_field: (form.querySelector('[name="hp_field"]') || {}).value || ""
    };
    if (payload.intent === "office") payload.office = office();

    fetch("/api/studio", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, data: data };
      });
    }).then(function (result) {
      if (!result.ok || !result.data || !result.data.ok) {
        throw new Error((result.data && result.data.error) || "We could not send that. Email topanga@algorithmacy.org and we will reply.");
      }
      form.hidden = true;
      if (done) {
        done.hidden = false;
        var title = document.getElementById("desk-done-title");
        if (title) title.focus();
      }
    }).catch(function (err) {
      if (send) send.textContent = "Send";
      showError(err && err.message ? err.message : "We could not send that. Email topanga@algorithmacy.org and we will reply.");
    });
  });

  applyIntent();

  var roi = document.getElementById("roi");
  var roiOut = document.getElementById("roi-out");
  function money(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function writeRoi() {
    if (!roi || !roiOut) return;
    function read(id) {
      var raw = document.getElementById(id).value.trim();
      return raw === "" ? NaN : Number(raw);
    }
    var people = read("roi-people");
    var hours = read("roi-hours");
    var rate = read("roi-rate");
    if (![people, hours, rate].every(function (n) { return Number.isFinite(n) && n >= 0; }) || people < 1) {
      roiOut.textContent = "Enter the people, the hours, and the value of an hour.";
      return;
    }
    var month = people * hours * rate * 52 / 12;
    var line = "The chores are about " + money(month) + " a month of staff time. After the first 10, Studio is $1,000 a month after the $5,000 setup. The first 10: free labor to install and maintain, equipment not included, for your continued endorsement and testimonial. Restrictions apply.";
    if (month < 1000) {
      line += " That is under the monthly fee, so the reason to look at this is the time, not a cash saving.";
    }
    line += " It is an estimate, not a promise that you will save that amount.";
    roiOut.textContent = line;
  }
  if (roi) {
    roi.addEventListener("input", writeRoi);
    writeRoi();
  }
})();
