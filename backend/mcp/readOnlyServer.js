#!/usr/bin/env node
/*
 * Read-only MCP bridge for local AI tooling.
 *
 * This process never opens a listening port, never accesses the database, and
 * only proxies an allowlisted set of authenticated HTTP GET requests.
 */
const readline = require('readline');

const API_BASE = String(process.env.KHA_MCP_API_BASE || 'http://127.0.0.1:7000/api').replace(/\/+$/, '');
const AUTH_TOKEN = String(process.env.KHA_MCP_AUTH_TOKEN || '').trim();
const REQUEST_TIMEOUT_MS = Math.max(1000, Math.min(Number(process.env.KHA_MCP_REQUEST_TIMEOUT_MS) || 10000, 30000));
const MAX_RESPONSE_CHARS = 60000;

if (!AUTH_TOKEN) {
  process.stderr.write('KHA_MCP_AUTH_TOKEN is required. Refusing to start the read-only MCP server.\n');
  process.exit(1);
}

const TOOLS = [
  {
    name: 'search_products',
    description: 'Searches active products and their current inventory. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name, SKU, or barcode.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum rows to return.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_customers',
    description: 'Searches customers by name, phone, email, or code. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Customer search text.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum rows to return.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_orders',
    description: 'Lists order summaries. Read-only; order details are not modified.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Optional status, such as pending, completed, or cancelled.' },
        from: { type: 'string', description: 'Optional start date in YYYY-MM-DD.' },
        to: { type: 'string', description: 'Optional end date in YYYY-MM-DD.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum rows to return.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_sales_summary',
    description: 'Returns current sales and negative-stock summary. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function clampLimit(value, fallback = 20) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return Math.max(1, Math.min(numeric, 50));
}

function stringArg(args, key) {
  return String(args?.[key] || '').trim();
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function buildToolPath(name, args = {}) {
  const params = new URLSearchParams();
  if (name === 'search_products') {
    const query = stringArg(args, 'query');
    if (!query) throw new Error('query is required.');
    params.set('q', query);
    params.set('limit', String(clampLimit(args.limit)));
    return `/products/search?${params}`;
  }
  if (name === 'search_customers') {
    const query = stringArg(args, 'query');
    if (!query) throw new Error('query is required.');
    params.set('q', query);
    params.set('limit', String(clampLimit(args.limit)));
    return `/customers?${params}`;
  }
  if (name === 'list_orders') {
    const status = stringArg(args, 'status');
    const from = stringArg(args, 'from');
    const to = stringArg(args, 'to');
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', String(clampLimit(args.limit)));
    params.set('meta', '1');
    return `/invoices?${params}`;
  }
  if (name === 'get_sales_summary') return '/stats/summary';
  throw new Error(`Unknown read-only tool: ${name}`);
}

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Backend returned non-JSON data.');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function handleRequest(request) {
  const { id, method, params = {} } = request || {};
  if (!method) return id === undefined ? null : jsonRpcError(id, -32600, 'Invalid JSON-RPC request.');

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ban-hang-pos-readonly', version: '1.0.0' },
        instructions: 'Read-only bridge. It cannot create, update, delete, or directly access database data.',
      },
    };
  }

  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

  if (method === 'tools/call') {
    try {
      const name = String(params.name || '');
      const data = await getJson(buildToolPath(name, params.arguments || {}));
      const serialized = JSON.stringify(data, null, 2);
      const text = serialized.length > MAX_RESPONSE_CHARS
        ? `${serialized.slice(0, MAX_RESPONSE_CHARS)}\n\n[Response truncated by read-only MCP safety limit.]`
        : serialized;
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: error.message || 'Read-only MCP request failed.' }], isError: true },
      };
    }
  }

  return id === undefined ? null : jsonRpcError(id, -32601, `Method not found: ${method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const response = await handleRequest(JSON.parse(line));
    if (response) writeMessage(response);
  } catch (error) {
    writeMessage(jsonRpcError(null, -32700, error.message || 'Invalid JSON input.'));
  }
});
