// Extract the DEPARTMENTS catalog from MineChart.studio's index.html
// into catalog.json (the single source of truth served by the MCP server).
//
// Usage (from this folder, inside a checkout of MineChart.studio):
//   node extract-catalog.mjs                 # reads ../index.html -> ./catalog.json
//   node extract-catalog.mjs in.html out.json # explicit paths
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(process.argv[2] || `${here}/../index.html`);
const outputPath = resolve(process.argv[3] || `${here}/catalog.json`);

const html = readFileSync(inputPath, 'utf8');
const marker = 'const DEPARTMENTS';
const mStart = html.indexOf(marker);
if (mStart === -1) throw new Error('DEPARTMENTS declaration not found in ' + inputPath);
const openIdx = html.indexOf('[', mStart);
if (openIdx === -1) throw new Error('DEPARTMENTS array literal not found');

// Scan the JS array literal, honouring strings, escapes and comments.
let i = openIdx;
let depth = 0;
let state = null; // "'", '"', '`', '//', '/*'
let escaped = false;
for (; i < html.length; i++) {
  const ch = html[i];
  const next = html[i + 1];
  if (state === '//') {
    if (ch === '\n') state = null;
    continue;
  }
  if (state === '/*') {
    if (ch === '*' && next === '/') { state = null; i++; }
    continue;
  }
  if (state === "'" || state === '"' || state === '`') {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === state) state = null;
    continue;
  }
  if (ch === '/' && next === '/') { state = '//'; i++; continue; }
  if (ch === '/' && next === '*') { state = '/*'; i++; continue; }
  if (ch === "'" || ch === '"' || ch === '`') { state = ch; continue; }
  if (ch === '[' || ch === '{') depth++;
  if (ch === ']' || ch === '}') {
    depth--;
    if (depth === 0) { i++; break; }
  }
}
if (depth !== 0) throw new Error('Unbalanced DEPARTMENTS literal');
const literal = html.slice(openIdx, i);
const departments = vm.runInNewContext(`(${literal})`, {}, { timeout: 5000 });
if (!Array.isArray(departments)) throw new Error('DEPARTMENTS did not evaluate to an array');

const catalog = {
  name: 'MineChart.studio',
  version: '5.0',
  description:
    'Pustaka Visualisasi Data 13 Departemen Pertambangan. Chart definitions with sample/illustrative data (Data Sampel) — cfg describes the data shape each chart type expects, not live mining figures.',
  source: 'DEPARTMENTS array in index.html',
  departments: departments.map((d) => ({
    id: d.id,
    num: d.num,
    name: d.name,
    short: d.short,
    desc: d.desc,
    charts: d.charts.map((c, idx) => ({
      id: `${d.id}-${idx}`,
      type: c.type,
      title: c.title,
      kpi: c.kpi,
      insight: c.insight,
      cfg: c.cfg ?? null,
    })),
  })),
};
const totalCharts = catalog.departments.reduce((n, d) => n + d.charts.length, 0);
const types = [...new Set(catalog.departments.flatMap((d) => d.charts.map((c) => c.type)))].sort();
// Fields kept for the dependency-free stdio server (server.js), which reads
// catalog.note and catalog.chartTypes.
catalog.note = catalog.description;
catalog.chartTypes = types;
catalog.stats = {
  departments: catalog.departments.length,
  charts: totalCharts,
  types: types.length,
  typeList: types,
};
writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log(
  `Wrote ${outputPath}: ${catalog.stats.departments} departments, ${totalCharts} charts, ${types.length} types.`
);
