const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function pageFile() {
  const candidates = [
    path.join(ROOT, 'studio/index.html'),
    path.join(process.cwd(), 'studio/index.html'),
  ];
  return candidates.find((file) => fs.existsSync(file)) || candidates[0];
}

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function readPage(html) {
  if (typeof html === 'string') return html;
  try {
    return fs.readFileSync(pageFile(), 'utf8');
  } catch {
    return '';
  }
}

function photoFile(src) {
  if (!/^\/images\/speakers\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/i.test(src)) return '';
  const relative = src.replace(/^\//, '');
  const candidates = [
    path.join(ROOT, relative),
    path.join(process.cwd(), relative),
  ];
  return candidates.find((file) => fs.existsSync(file)) || '';
}

function publishedEngineers(html) {
  const source = readPage(html);
  const start = source.indexOf('id="engineer"');
  if (start === -1) return [];
  const rest = source.slice(start);
  const next = rest.indexOf('<section', 1);
  const section = next === -1 ? rest : rest.slice(0, next);
  const people = [];
  for (const block of section.split('<div class="person">').slice(1)) {
    const img = block.match(/<img\b[^>]*\ssrc="([^"]+)"/i);
    const heading = block.match(/<h3>([^<]+)<\/h3>/i);
    const bio = block.match(/<h3>[^<]+<\/h3>\s*<p>([\s\S]*?)<\/p>/i);
    if (!img || !heading || !bio) continue;
    if (!photoFile(img[1])) continue;
    const text = bio[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 40) continue;
    people.push({ name: heading[1].trim(), photo: img[1] });
  }
  return people;
}

function publishedEngineer(name, html) {
  const want = normalizeName(name);
  if (!want) return null;
  return publishedEngineers(html).find((person) => normalizeName(person.name) === want) || null;
}

module.exports = { normalizeName, publishedEngineers, publishedEngineer };
