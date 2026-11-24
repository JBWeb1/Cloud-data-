// Integration tests for the MCP endpoint, using the official MCP client.
// Requires a reachable PostgreSQL database in DATABASE_URL.
process.env.MCP_KEY = 'test-mcp-key';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');

const COLLECTION = `mcp_test_${Date.now()}`;
let server;
let base;
let client;

function parse(res) {
  return JSON.parse(res.content[0].text);
}

before(async () => {
  await migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer test-mcp-key' } },
  }));
});

after(async () => {
  await client.close();
  await db.query('DELETE FROM items WHERE collection = $1', [COLLECTION]);
  server.close();
  await db.pool.end();
});

test('rejects a wrong MCP key', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
    body: '{}',
  });
  assert.equal(res.status, 401);
});

test('lists the data tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'create_item', 'delete_item', 'get_item', 'list_collections', 'list_items', 'update_item',
  ]);
});

test('tools create, find, update and delete data', async () => {
  const call = (name, args) => client.callTool({ name, arguments: args });

  const created = parse(await call('create_item', { collection: COLLECTION, data: { title: 'x', status: 'open' } }));
  await call('create_item', { collection: COLLECTION, data: { title: 'y', status: 'done' } });

  const open = parse(await call('list_items', { collection: COLLECTION, where: { status: 'open' } }));
  assert.equal(open.items.length, 1);
  assert.equal(open.items[0].id, created.id);

  const collections = parse(await call('list_collections', {}));
  assert.equal(collections.find((c) => c.collection === COLLECTION).count, 2);

  const merged = parse(await call('update_item', { id: created.id, data: { status: 'done' } }));
  assert.deepEqual(merged.data, { title: 'x', status: 'done' });

  parse(await call('delete_item', { id: created.id }));
  const missing = await call('get_item', { id: created.id });
  assert.equal(missing.isError, true);
});
