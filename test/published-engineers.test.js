const test = require('node:test');
const assert = require('node:assert/strict');
const { publishedEngineer, publishedEngineers } = require('../lib/portal/published-engineers');

test('the merged Studio page lists the engineers who have a photo and a profile', () => {
  const people = publishedEngineers();
  assert.deepEqual(people.map((person) => person.name), ['Roger Hunt', 'Joseph Singh', 'Lorraine Villaroel']);
  assert.equal(publishedEngineer('roger hunt').photo, '/images/speakers/roger-hunt.jpg');
  assert.equal(publishedEngineer('Joseph Example'), null);
});

test('a profile without a photo file is not merged', () => {
  const html = `
    <section id="engineer">
      <div class="person">
        <img src="/images/speakers/does-not-exist.jpg" alt="">
        <div><h3>Ada Missing</h3><p>Ada writes two sentences a client could read on the Studio page before anyone invites her.</p></div>
      </div>
    </section>`;
  assert.equal(publishedEngineer('Ada Missing', html), null);
});
