/**
 * build-standalone.mjs
 * ------------------------------------------------------------------
 * Après `vite build`, fabrique une version « un seul fichier » du jeu :
 *   dist-standalone/boxing-arena.html  → s'ouvre par double-clic, hors ligne
 *   dist-standalone/artifact.html      → même contenu sans <html>/<head>/<body>
 *                                         (pour l'héberger comme page intégrée)
 * Le JavaScript et le CSS sont insérés directement dans la page.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'dist-standalone');
mkdirSync(out, { recursive: true });

let html = readFileSync(join(dist, 'index.html'), 'utf8');

const scripts = [];
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>\s*/g, (_, src) => {
  const code = readFileSync(join(dist, src.replace(/^\.\//, '')), 'utf8')
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
  scripts.push(code);
  return '';
});
html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
const styles = [];
html = html.replace(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>\s*/g, (_, href) => {
  styles.push(readFileSync(join(dist, href.replace(/^\.\//, '')), 'utf8'));
  return '';
});

const styleTag = `<style>\n${styles.join('\n')}\n</style>`;
const scriptTag = `<script type="module">\n${scripts.join('\n')}\n</script>`;

// 1. Document complet
const full = html.replace('</head>', `${styleTag}\n</head>`).replace('</body>', `${scriptTag}\n</body>`);
writeFileSync(join(out, 'boxing-arena.html'), full);

// 2. Fragment : titre, polices, styles, contenu, script
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const fontLinks = (head.match(/<link rel="(?:preconnect|stylesheet)"[^>]*>/g) || []).join('\n');
const fragment = `${title}\n${fontLinks}\n${styleTag}\n${body.trim()}\n${scriptTag}\n`;
writeFileSync(join(out, 'artifact.html'), fragment);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} Ko`;
console.log(`boxing-arena.html : ${kb(full)}`);
console.log(`artifact.html     : ${kb(fragment)}`);
