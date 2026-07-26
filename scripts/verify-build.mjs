import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8'));
const contentScript = manifest.content_scripts?.[0]?.js?.[0];

if (!contentScript) {
  throw new Error('manifest.json does not declare a content script');
}

const contentPath = resolve(root, 'dist', contentScript);
await access(contentPath);

const content = await readFile(contentPath, 'utf8');
if (/^\s*import(?:\s|\{|\()/m.test(content)) {
  throw new Error(`${contentScript} contains an ES module import and cannot run as a Chrome content script`);
}

console.log(`Verified classic content script: ${contentScript}`);
