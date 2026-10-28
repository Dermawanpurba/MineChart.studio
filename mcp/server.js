// MineChart.studio MCP server — DRAFT, stdio only, no dependencies.
// Reads catalog.json (extracted from MineChart.studio index.html) and exposes
// it to MCP clients (e.g. Google Antigravity) as tools.
// Run: node server.js   (reads catalog.json in the same folder)
// The catalog is SAMPLE data: it describes chart types and cfg shapes,
// not live mining figures, and it does not include the site's render code.
'use strict';
const fs = require('fs');
const path = require('path');

const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')
);
const DEPARTMENTS = catalog.departments;

function summaries(dep) {
  return dep.charts.map((c, i) => ({
    index: i,
    type: c.type,
    title: c.title,
    kpi: c.kpi,
    insight: c.insight,
  }));
}

function findDept(idOrName) {
  const q = String(idOrName || '').trim().toLowerCase();
  if (!q) return null;
  return (
    DEPARTMENTS.find((d) => d.id.toLowerCase() === q) ||
    DEPARTMENTS.find((d) => d.name.toLowerCase().includes(q)) ||
    DEPARTMENTS.find((d) => d.short.toLowerCase().includes(q)) ||
    null
  );
}

const TOOLS = [
  {
    name: 'list_departments',
    description:
      'List the 13 MineChart.studio departments with id, name, description and chart count. Use the id with search_charts / get_chart.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_chart_types',
    description:
      'List the 28 chart types used across the MineChart.studio catalog.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_charts',
    description:
      'Search charts by keyword (matched against title, insight, KPI, type and department name). Optionally filter by department id and/or chart type. Returns summaries without the full cfg; call get_chart for one chart in full.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword, e.g. MTTR, ban, BBM, downtime.' },
        department: { type: 'string', description: 'Department id, e.g. plant, fuel, hse.' },
        type: { type: 'string', description: 'Chart type, e.g. Donut Chart, Gauge Chart.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_chart',
    description:
      'Get one chart in full, including its cfg data shape, so the AI can imitate the data structure when building a new chart. Identify it by department id plus either its index in that department or a unique title fragment.',
    inputSchema: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'Department id, e.g. plant.' },
        index: { type: 'integer', description: 'Chart index within the department (0-based).' },
        title: { type: 'string', description: 'Unique fragment of the chart title.' },
      },
      required: ['department'],
      additionalProperties: false,
    },
  },
];

function toolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}
function toolError(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function callTool(name, args) {
  args = args || {};
  if (name === 'list_departments') {
    return toolResult({
      note: catalog.note,
      departments: DEPARTMENTS.map((d) => ({
        id: d.id,
        name: d.name,
        desc: d.desc,
        chartCount: d.charts.length,
      })),
    });
  }
  if (name === 'list_chart_types') {
    return toolResult({ chartTypes: catalog.chartTypes, count: catalog.chartTypes.length });
  }
  if (name === 'search_charts') {
    const q = String(args.query || '').toLowerCase();
    let pool = DEPARTMENTS;
    if (args.department) {
      const dep = findDept(args.department);
      if (!dep) return toolError('Department not found: ' + args.department);
      pool = [dep];
    }
    const out = [];
    for (const dep of pool) {
      for (const c of summaries(dep)) {
        const hay = (c.title + ' ' + c.insight + ' ' + c.kpi + ' ' + c.type + ' ' + dep.name).toLowerCase();
        if (args.type && c.type.toLowerCase() !== String(args.type).toLowerCase()) continue;
        if (q && !hay.includes(q)) continue;
        out.push({ department: dep.id, departmentName: dep.name, ...c });
      }
    }
    return toolResult({ count: out.length, results: out });
  }
  if (name === 'get_chart') {
    const dep = findDept(args.department);
    if (!dep) return toolError('Department not found: ' + args.department);
    let chart = null;
    let index = -1;
    if (Number.isInteger(args.index)) {
      index = args.index;
      chart = dep.charts[index] || null;
    } else if (args.title) {
      const t = String(args.title).toLowerCase();
      const hits = dep.charts
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.title.toLowerCase().includes(t));
      if (hits.length === 1) {
        chart = hits[0].c;
        index = hits[0].i;
      } else if (hits.length > 1) {
        return toolError(
          'Title fragment matched ' + hits.length + ' charts: ' +
            hits.map((h) => h.c.title).join(' | ') + '. Use index instead.'
        );
      }
    }
    if (!chart) return toolError('Chart not found in department ' + dep.id + '.');
    return toolResult({
      note: catalog.note,
      department: dep.id,
      departmentName: dep.name,
      index,
      type: chart.type,
      title: chart.title,
      kpi: chart.kpi,
      insight: chart.insight,
      cfg: chart.cfg,
    });
  }
  return toolError('Unknown tool: ' + name);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(line);
  }
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handle(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return; // Never log to stdout: it would corrupt JSON-RPC.
  }
  if (req.method && req.method.startsWith('notifications/')) return;

  const id = req.id;
  const respond = (result) => send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) =>
    send({ jsonrpc: '2.0', id, error: { code, message } });

  if (req.method === 'initialize') {
    return respond({
      protocolVersion:
        (req.params && req.params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'minechart-studio', version: '1.0.0' },
    });
  }
  if (req.method === 'ping') return respond({});
  if (req.method === 'tools/list') return respond({ tools: TOOLS });
  if (req.method === 'tools/call') {
    const params = req.params || {};
    if (!params.name) return fail(-32602, 'Missing tool name.');
    return respond(callTool(params.name, params.arguments || {}));
  }
  return fail(-32601, 'Method not found: ' + req.method);
}
