// Turns the single-file build into a page fragment that can be published as a claude.ai artifact,
// which supplies its own <html>, <head> and <body>.
// Run after: npm run build:single -w @slack-tide/client
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../apps/client/dist-single/index.html', import.meta.url), 'utf8');
const all = (re) => [...src.matchAll(re)].map((m) => m[0]);
const title = src.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Slack Tide</title>';
const styles = all(/<style[\s\S]*?<\/style>/g);
const scripts = all(/<script[\s\S]*?<\/script>/g);
let body = src.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? '';
for (const s of scripts) body = body.replace(s, '');
if (!styles.length || !scripts.length || !body.includes('id="view"')) throw new Error('Unexpected build output');

const out = [title, '<meta name="claude:viewport-fit-sides" content="cover">', ...styles, body.trim(), ...scripts].join('\n');
const dest = new URL('../apps/client/dist-single/artifact.html', import.meta.url);
writeFileSync(dest, out + '\n');
console.log(`Wrote ${dest.pathname} (${(out.length / 1024).toFixed(0)} kB)`);
