// MCP endpoint tests, using the official MCP client.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { startServer } = require('./helpers');

let t;
let user;
let client;

async function connect(key) {
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${t.base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  }));
  return c;
}

function parse(res) {
  return JSON.parse(res.content[0].text);
}

before(async () => {
  t = await startServer();
  user = await t.registerUser();
  const key = await t.api('POST', '/api/account/keys', { token: user.token, body: { name: 'claude desktop' } });
  client = await connect(key.body.key);
});

after(async () => {
  await client.close();
  await t.stop();
});

test('rejects a missing key and a login session token', async () => {
  const post = (headers) => fetch(`${t.base}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}',
  });
  assert.equal((await post({})).status, 401);
  // MCP only accepts personal API keys, not browser login sessions.
  assert.equal((await post({ authorization: `Bearer ${user.token}` })).status, 401);
});

test('lists the data tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), [
    'create_item', 'create_items', 'delete_item', 'get_item', 'list_collections', 'list_items', 'update_item',
  ]);
});

test('tools create, find, update and delete the key owner\'s data', async () => {
  const call = (name, args) => client.callTool({ name, arguments: args });

  const created = parse(await call('create_item', { collection: 'tasks', data: { title: 'x', status: 'open' } }));
  await call('create_items', { collection: 'tasks', items: [{ title: 'y', status: 'done' }] });

  const open = parse(await call('list_items', { collection: 'tasks', where: { status: 'open' } }));
  assert.equal(open.total, 1);
  assert.equal(open.items[0].id, created.id);

  const collections = parse(await call('list_collections', {}));
  assert.deepEqual(collections.map((c) => [c.collection, c.count]), [['tasks', 2]]);

  const merged = parse(await call('update_item', { id: created.id, data: { status: 'done' } }));
  assert.deepEqual(merged.data, { title: 'x', status: 'done' });

  // The items really belong to the key's owner.
  const viaRest = await t.api('GET', `/api/items/${created.id}`, { token: user.token });
  assert.equal(viaRest.status, 200);

  parse(await call('delete_item', { id: created.id }));
  assert.equal((await call('get_item', { id: created.id })).isError, true);
});

test("another user's key cannot reach this user's data", async () => {
  const mine = (await t.api('POST', '/api/items', { token: user.token, body: { collection: 'p', data: { a: 1 } } })).body;
  const other = await t.registerUser();
  const otherKey = (await t.api('POST', '/api/account/keys', { token: other.token, body: { name: 'k' } })).body.key;
  const otherClient = await connect(otherKey);
  try {
    const res = await otherClient.callTool({ name: 'get_item', arguments: { id: mine.id } });
    assert.equal(res.isError, true);
  } finally {
    await otherClient.close();
  }
});
