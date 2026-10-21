#!/usr/bin/env node
/**
 * Pushes this app to Make through the custom-app API (Web API v2, "SDK Apps").
 *
 *   MAKE_API_TOKEN=... MAKE_ZONE=eu1 node deploy.mjs
 *
 * The token needs the sdk-apps:read and sdk-apps:write scopes (Make → Profile → API access).
 * MAKE_ZONE is the zone in your Make address: eu1, eu2, us1 or us2.
 * Running it again updates the app in place; the connection is created once and its name is
 * kept in .make-state.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.MAKE_API_TOKEN;
const ZONE = process.env.MAKE_ZONE || 'eu1';
if (!TOKEN) { console.error('Set MAKE_API_TOKEN (scopes sdk-apps:read, sdk-apps:write).'); process.exit(1); }
const API = `https://${ZONE}.make.com/api/v2`;
const VERSION = 1;

const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const STATE_FILE = path.join(DIR, '.make-state.json');
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');

async function call(method, url, body, { okStatuses = [] } = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok && !okStatuses.includes(res.status)) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: null }; }
}

const app = read('app.json');
const A = `/sdk/apps/${app.name}/${VERSION}`;

// 1. The app itself.
const existing = await call('GET', A, undefined, { okStatuses: [404] });
if (existing.status === 404) {
  await call('POST', '/sdk/apps', { name: app.name, label: app.label, description: app.description, theme: app.theme, language: app.language });
  console.log('created app', app.name);
}
await call('PUT', `${A}/base`, read('base.iml.json'));

// 2. The connection: router key, live or sandbox, optional data key.
const conn = read('connection.json');
if (!state.connection) {
  const r = await call('POST', `/sdk/apps/${app.name}/connections`, { type: conn.type, label: conn.label });
  state.connection = (r.json.appConnection || r.json.connection || r.json).name;
  save();
  console.log('created connection', state.connection);
}
await call('PUT', `/sdk/apps/connections/${state.connection}/api`, conn.api);
await call('PUT', `/sdk/apps/connections/${state.connection}/parameters`, conn.parameters);

// 3. The RPC that fills the Routing mode dropdown.
for (const f of fs.readdirSync(path.join(DIR, 'rpcs'))) {
  const rpc = read(`rpcs/${f}`);
  const got = await call('GET', `${A}/rpcs/${rpc.name}`, undefined, { okStatuses: [404] });
  if (got.status === 404) await call('POST', `${A}/rpcs`, { name: rpc.name, label: rpc.label, connection: state.connection });
  else await call('PATCH', `${A}/rpcs/${rpc.name}`, { label: rpc.label, connection: state.connection });
  await call('PUT', `${A}/rpcs/${rpc.name}/api`, rpc.api);
  await call('PUT', `${A}/rpcs/${rpc.name}/parameters`, rpc.parameters);
  console.log('rpc', rpc.name);
}

// 4. The modules.
for (const f of fs.readdirSync(path.join(DIR, 'modules'))) {
  const m = read(`modules/${f}`);
  const got = await call('GET', `${A}/modules/${m.name}`, undefined, { okStatuses: [404] });
  if (got.status === 404) {
    await call('POST', `${A}/modules`, { name: m.name, typeId: m.typeId, label: m.label, description: m.description, moduleInitMode: 'blank' });
  }
  await call('PATCH', `${A}/modules/${m.name}`, { label: m.label, description: m.description, connection: state.connection });
  for (const section of ['api', 'parameters', 'expect', 'interface', 'samples']) {
    await call('PUT', `${A}/modules/${m.name}/${section}`, m[section]);
  }
  console.log('module', m.name);
}

// 5. Module groups in the module picker.
await call('PUT', `${A}/groups`, read('groups.json'));
console.log(`Done. Open https://${ZONE}.make.com and find "${app.label}" under Custom Apps.`);
