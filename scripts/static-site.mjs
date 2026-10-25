import fs from 'node:fs';
import path from 'node:path';

// Directories the conference and Studio marketing site already serve as static files.
export const COPY_DIRS = [
  'assets',
  'images',
  'design-system',
  'data',
  'book',
  'submit',
  'studio',
  'research',
  'logistics',
  'conduct',
  'privacy',
  'terms',
  'cookies',
  '.well-known',
];

export const COPY_FILES = [
  'index.html',
  'robots.txt',
  'sitemap.xml',
  'favicon.svg',
  'favicon.ico',
  'favicon-32.png',
  'apple-touch-icon.png',
  'llms.txt',
  'llms-full.txt',
  'prompts.json',
];

// Clean URLs for every static index.html, excluding the portal and OAuth app routes.
export function htmlRewrites(root) {
  const rewrites = [{ source: '/', destination: '/index.html' }];
  const dirs = ['book', 'submit', 'studio', 'research', 'logistics', 'conduct', 'privacy', 'terms', 'cookies'];

  function visit(rel) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.existsSync(path.join(abs, 'index.html'))) {
      const url = '/' + rel.split(path.sep).join('/');
      rewrites.push({ source: url, destination: url + '/index.html' });
      rewrites.push({ source: url + '/', destination: url + '/index.html' });
    }
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(path.join(rel, entry.name));
    }
  }

  for (const dir of dirs) visit(dir);
  return rewrites;
}
