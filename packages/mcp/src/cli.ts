#!/usr/bin/env node
/**
 * aistupidlevel-mcp: the AI Stupid Level MCP server over stdio.
 * stdout carries the protocol, so every diagnostic goes to stderr, and keys are never printed.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { VERSION, resolveConfig } from './config.js';

const HELP = `aistupidlevel-mcp ${VERSION}: MCP server for AI Stupid Level (https://aistupidlevel.info)

Usage: npx -y @aistupidlevel/mcp      (speaks MCP over stdio; add it to your MCP client)

Environment:
  ASL_DATA_KEY     Data API key (asl_live_...) for rankings, history, drift, incidents.
                   Free key: https://aistupidlevel.info/account/data-keys (10 requests/day, 1/minute)
  ASL_ROUTER_KEY   Smart Router key (aism_...) for preview_route, ask_router and usage.
                   https://aistupidlevel.info/router/keys
  ASL_SANDBOX      true: every Smart Router call returns a mock answer (nothing spent)
  ASL_CACHE_TTL    seconds a Data API answer is reused (default 900)
  ASL_MAX_WAIT     wait and retry once when the per-minute limit asks for at most this many seconds (default 15)
  ASL_TIMEOUT_MS   Smart Router request timeout in ms (default 300000)
`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stderr.write(HELP);
  process.exit(0);
}
if (args.includes('--version') || args.includes('-v')) {
  process.stderr.write(`${VERSION}\n`);
  process.exit(0);
}

const log = (m: string) => process.stderr.write(`[aistupidlevel-mcp] ${m}\n`);
const cfg = resolveConfig();
const server = createServer({ log });
const transport = new StdioServerTransport();
await server.connect(transport);
log(`v${VERSION} running on stdio; Data API key ${cfg.dataKey ? 'set' : 'not set (ASL_DATA_KEY)'}, router key ${cfg.routerKey ? 'set' : 'not set (ASL_ROUTER_KEY)'}${cfg.forceSandbox ? ', sandbox forced' : ''}.`);

const shutdown = () => { server.close().finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
