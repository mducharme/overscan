#!/usr/bin/env node
/**
 * Regenerate docs/EXAMPLES.html from docs/EXAMPLES.md (uses npx marked).
 * Run from repo root: node scripts/build-examples-html.mjs
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const MD = join(ROOT, 'docs', 'EXAMPLES.md')
const OUT = join(ROOT, 'docs', 'EXAMPLES.html')
const FRAG = join(ROOT, 'docs', '_examples_fragment.html')

const npx = spawnSync(
  'npx',
  ['--yes', 'marked', '-i', MD, '--gfm'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, shell: true },
)
if (npx.status !== 0) {
  console.error(npx.stderr || 'marked failed')
  process.exit(npx.status ?? 1)
}
const body = npx.stdout

const css = `
:root {
  color-scheme: dark;
  --bg: #0c0e14;
  --surface: #12151f;
  --border: #252a38;
  --text: #e4e9f5;
  --muted: #8b93a8;
  --link: #6ec8ff;
  --link-hover: #9fdcff;
  --code-bg: #1a1e2a;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: system-ui, 'Segoe UI', Roboto, Ubuntu, Cantarell, sans-serif;
  font-size: 1rem;
  line-height: 1.55;
  color: var(--text);
  background: var(--bg);
}
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 1rem; top: 1rem; z-index: 99; padding: .5rem 1rem; background: var(--surface); }
header.doc-head {
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  padding: 1rem 1.25rem;
  position: sticky;
  top: 0;
  z-index: 10;
}
header.doc-head h1 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
header.doc-head p {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: var(--muted);
}
header.doc-head a { color: var(--link); }
header.doc-head a:hover { color: var(--link-hover); }
main {
  max-width: 52rem;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
}
main h1 { font-size: 1.75rem; margin-top: 0; color: #fff; }
main h2 {
  font-size: 1.35rem;
  margin-top: 2.25rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--border);
  color: #fff;
}
main h3 { font-size: 1.1rem; margin-top: 1.75rem; color: #c8d0e0; }
a { color: var(--link); text-decoration: none; }
a:hover { color: var(--link-hover); text-decoration: underline; }
a code { color: inherit; }
code, pre {
  font-family: ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, monospace;
  font-size: 0.88em;
}
code {
  background: var(--code-bg);
  padding: 0.12em 0.35em;
  border-radius: 4px;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.1rem;
  overflow-x: auto;
  line-height: 1.45;
}
pre code { background: none; padding: 0; font-size: 0.9rem; }
table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
  font-size: 0.92rem;
}
th, td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.65rem;
  vertical-align: top;
}
th { background: var(--surface); text-align: left; color: #cbd5e1; }
tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
td img {
  max-width: min(100%, 220px);
  height: auto;
  display: block;
  margin: 0 auto;
  border-radius: 4px;
  border: 1px solid var(--border);
}
hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 2rem 0;
}
ul { padding-left: 1.35rem; }
li { margin: 0.25rem 0; }
strong { color: #fff; }
`

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overscan — Examples gallery</title>
<meta name="description" content="Generator and advanced scene examples with terminal and WebGL GIF previews.">
<style>${css}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="doc-head">
  <h1>Overscan — Examples gallery</h1>
  <p>HTML export of <a href="EXAMPLES.md">EXAMPLES.md</a> · GIFs under <code>docs/examples/</code> · Regenerate: <code>node scripts/build-examples-html.mjs</code></p>
</header>
<main id="main">
${body}
</main>
</body>
</html>
`

writeFileSync(OUT, html, 'utf8')
if (existsSync(FRAG)) unlinkSync(FRAG)
console.log('Wrote', OUT)
