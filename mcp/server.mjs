// MineChart.studio MCP server — Streamable HTTP (remote, e.g. Coolify/VPS)
// and stdio (local, `node server.mjs --stdio`).
//
// Read-only: serves the chart catalog extracted from index.html
// (see extract-catalog.mjs / catalog.json). All chart figures are
// sample/illustrative data (Data Sampel); cfg describes the data shape
// each chart type expects, not live mining figures.
//
// Auth: if MCP_API_KEY is set, every /mcp request must carry
//   Authorization: Bearer <MCP_API_KEY>
// /health and / stay public so Coolify / load balancers can probe them.
import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(resolve(here, 'catalog.json'), 'utf8'));
const API_KEY = process.env.MCP_API_KEY || '';

const DEPARTMENTS = catalog.departments;
const ALL_CHARTS = DEPARTMENTS.flatMap((d) =>
  d.charts.map((c) => ({ ...c, department: d.id, department_name: d.name }))
);
const TYPE_INDEX = new Map();
for (const c of ALL_CHARTS) {
  if (!TYPE_INDEX.has(c.type)) TYPE_INDEX.set(c.type, []);
  TYPE_INDEX.get(c.type).push(c);
}

function textResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}
function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function createServer() {
  const server = new McpServer({
    name: 'minechart-studio',
    version: catalog.version ?? '1.0.0',
  });

  server.tool('list_departments', 'List the 13 mining departments in MineChart.studio, each with its id, name, description and chart count.', {}, () =>
    textResult({
      departments: DEPARTMENTS.map((d) => ({
        id: d.id,
        num: d.num,
        name: d.name,
        short: d.short,
        desc: d.desc,
        chart_count: d.charts.length,
      })),
      total_departments: DEPARTMENTS.length,
      total_charts: catalog.stats.charts,
    })
  );

  server.tool(
    'list_chart_types',
    'List the 28 chart types in the catalog, with how many charts use each type, which departments use it, and one example title.',
    {},
    () =>
      textResult({
        types: [...TYPE_INDEX.entries()]
          .map(([type, charts]) => ({
            type,
            chart_count: charts.length,
            departments: [...new Set(charts.map((c) => c.department))],
            example_title: charts[0].title,
          }))
          .sort((a, b) => b.chart_count - a.chart_count),
        total_types: TYPE_INDEX.size,
      })
  );

  server.tool(
    'search_charts',
    'Search charts by keyword across title, type, KPI and insight, optionally filtered by department id and/or chart type. Returns compact matches with stable chart ids (use get_chart for the full definition including cfg).',
    {
      query: z.string().describe('Keyword(s) to search for, e.g. "MTTR", "fuel ratio", "backlog".'),
      department: z.string().optional().describe('Department id to restrict to, e.g. "plant", "fuel". See list_departments.'),
      type: z.string().optional().describe('Chart type to restrict to, e.g. "Waterfall Chart". See list_chart_types.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max matches to return (default 10).'),
    },
    ({ query, department, type, limit = 10 }) => {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return errorResult('search_charts needs a non-empty query.');
      const scored = [];
      for (const c of ALL_CHARTS) {
        if (department && c.department !== department.toLowerCase()) continue;
        if (type && c.type.toLowerCase() !== type.toLowerCase()) continue;
        const hay = {
          title: c.title.toLowerCase(),
          type: c.type.toLowerCase(),
          kpi: (c.kpi || '').toLowerCase(),
          insight: (c.insight || '').toLowerCase(),
          dept: c.department_name.toLowerCase(),
        };
        let score = 0;
        for (const t of tokens) {
          if (hay.title.includes(t)) score += 3;
          if (hay.type.includes(t)) score += 2;
          if (hay.kpi.includes(t)) score += 1;
          if (hay.insight.includes(t)) score += 1;
          if (hay.dept.includes(t)) score += 1;
        }
        if (score > 0) scored.push({ c, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return textResult({
        query,
        matches: scored.slice(0, limit).map(({ c, score }) => ({
          id: c.id,
          score,
          department: c.department,
          department_name: c.department_name,
          type: c.type,
          title: c.title,
          kpi: c.kpi,
          insight: c.insight,
        })),
        total_matches: scored.length,
      });
    }
  );

  server.tool(
    'get_chart',
    'Get the full definition of one chart by its stable id (e.g. "plant-0"), including its cfg — the exact data shape (labels, series, units) that chart type expects. Use search_charts to find ids.',
    {
      chart_id: z.string().describe('Stable chart id in the form "<department-id>-<index>", e.g. "plant-0", "fuel-3".'),
    },
    ({ chart_id }) => {
      const found = ALL_CHARTS.find((c) => c.id === chart_id);
      if (!found) {
        return errorResult(
          `No chart with id "${chart_id}". Ids look like "<department-id>-<index>" (e.g. "plant-0"). Use search_charts to find a valid id.`
        );
      }
      return textResult({
        id: found.id,
        department: found.department,
        department_name: found.department_name,
        type: found.type,
        title: found.title,
        kpi: found.kpi,
        insight: found.insight,
        cfg: found.cfg,
        note: 'Figures in cfg are sample/illustrative data (Data Sampel). Use cfg keys and shapes as the template when wiring real data.',
      });
    }
  );

  server.tool(
    'describe_chart_type',
    'Describe one chart type: which departments use it, how many charts, example titles, the union of cfg keys across its charts, and one full example cfg to copy as a template.',
    {
      type: z.string().describe('Chart type name, e.g. "Waterfall Chart", "Control Chart". Case-insensitive; a substring match is accepted if unambiguous.'),
    },
    ({ type }) => {
      const needle = type.toLowerCase();
      let charts = TYPE_INDEX.get(type) || null;
      if (!charts) {
        const candidates = [...TYPE_INDEX.keys()].filter((t) => t.toLowerCase().includes(needle));
        if (candidates.length === 1) charts = TYPE_INDEX.get(candidates[0]);
        else if (candidates.length > 1) {
          return errorResult(`Ambiguous chart type "${type}". Candidates: ${candidates.join(', ')}.`);
        } else {
          return errorResult(`Unknown chart type "${type}". Use list_chart_types for the 28 available types.`);
        }
      }
      const keys = [...new Set(charts.flatMap((c) => Object.keys(c.cfg || {})))].sort();
      return textResult({
        type: charts[0].type,
        chart_count: charts.length,
        departments: [...new Set(charts.map((c) => c.department))],
        example_titles: charts.slice(0, 5).map((c) => c.title),
        cfg_keys: keys,
        cfg_example: charts[0].cfg,
        cfg_example_of: `${charts[0].id} — ${charts[0].title}`,
      });
    }
  );

  server.resource('minechart-catalog', 'minechart://catalog', async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(catalog) }],
  }));

  return server;
}

async function handleMcp(req, res) {
  // Stateless mode: a fresh transport (and server) per request. The catalog
  // is read-only and loaded once, so there is no session state to keep.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close());
  try {
    await createServer().connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
  }
}

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  if (req.headers.authorization === `Bearer ${API_KEY}`) return next();
  res.status(401).json({ error: 'unauthorized: missing or invalid Bearer token' });
}

if (process.argv.includes('--stdio')) {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  console.error(`minechart-studio MCP (stdio) ready: ${catalog.stats.charts} charts, ${catalog.stats.departments} departments.`);
} else {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      server: 'minechart-studio',
      version: catalog.version,
      departments: catalog.stats.departments,
      charts: catalog.stats.charts,
      types: catalog.stats.types,
      auth: API_KEY ? 'bearer-required' : 'open',
    });
  });

  app.get('/', (_req, res) => {
    res.json({
      server: 'minechart-studio',
      version: catalog.version,
      description: catalog.description,
      stats: catalog.stats,
      endpoints: { mcp: 'POST /mcp (Streamable HTTP)', health: 'GET /health' },
      tools: ['list_departments', 'list_chart_types', 'search_charts', 'get_chart', 'describe_chart_type'],
      auth: API_KEY ? 'Bearer token required on /mcp' : 'No API key configured (open)',
    });
  });

  app.all('/mcp', requireApiKey, handleMcp);

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(
      `minechart-studio MCP listening on 0.0.0.0:${port} — ${catalog.stats.charts} charts, ${catalog.stats.departments} departments, ${catalog.stats.types} types. Auth: ${API_KEY ? 'bearer-required' : 'open (no MCP_API_KEY set)'}.`
    );
  });
}
