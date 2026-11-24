const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let t;
let alice;
let bob;

before(async () => {
  t = await startServer();
  alice = await t.registerUser('Alice');
  bob = await t.registerUser('Bob');
});
after(async () => { await t.stop(); });

const as = (u) => (method, path, body) => t.api(method, path, { token: u.token, body });

test('health reports database connected', async () => {
  const res = await t.api('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.database, 'connected');
});

test('full create / read / update / delete cycle', async () => {
  const api = as(alice);
  const created = await api('POST', '/api/items', { collection: 'notes', data: { name: 'a', n: 1 } });
  assert.equal(created.status, 201);
  const { id } = created.body;

  assert.deepEqual((await api('GET', `/api/items/${id}`)).body.data, { name: 'a', n: 1 });
  assert.deepEqual((await api('PATCH', `/api/items/${id}`, { data: { n: 2 } })).body.data, { name: 'a', n: 2 });
  assert.deepEqual((await api('PUT', `/api/items/${id}`, { data: { only: true } })).body.data, { only: true });
  assert.equal((await api('DELETE', `/api/items/${id}`)).status, 204);
  assert.equal((await api('GET', `/api/items/${id}`)).status, 404);
});

test("users cannot see or change each other's data", async () => {
  const mine = (await as(alice)('POST', '/api/items', { collection: 'private', data: { secret: 1 } })).body;

  const bobApi = as(bob);
  assert.equal((await bobApi('GET', `/api/items/${mine.id}`)).status, 404);
  assert.equal((await bobApi('PATCH', `/api/items/${mine.id}`, { data: { hacked: true } })).status, 404);
  assert.equal((await bobApi('DELETE', `/api/items/${mine.id}`)).status, 404);
  assert.equal((await bobApi('GET', '/api/items?collection=private')).body.total, 0);

  assert.deepEqual((await as(alice)('GET', `/api/items/${mine.id}`)).body.data, { secret: 1 });
});

test('filtering, sorting, paging and totals', async () => {
  const api = as(alice);
  await api('POST', '/api/items/bulk', {
    collection: 'tasks',
    items: [{ title: 'a', status: 'open' }, { title: 'b', status: 'done' }, { title: 'c', status: 'open' }],
  });

  const open = await api('GET', `/api/items?collection=tasks&where=${encodeURIComponent('{"status":"open"}')}`);
  assert.equal(open.body.total, 2);
  assert.ok(open.body.items.every((i) => i.data.status === 'open'));

  const page = await api('GET', '/api/items?collection=tasks&limit=1&sort=created_at&order=asc');
  assert.equal(page.body.items.length, 1);
  assert.equal(page.body.total, 3);
  assert.equal(page.body.items[0].data.title, 'a');

  assert.equal((await api('GET', '/api/items?where=notjson')).status, 400);
});

test('bulk create validates its input', async () => {
  const api = as(alice);
  assert.equal((await api('POST', '/api/items/bulk', { collection: 'x', items: [] })).status, 400);
  assert.equal((await api('POST', '/api/items/bulk', { collection: 'x', items: [1, 2] })).status, 400);
});

test('collections: list, rename, delete', async () => {
  const api = as(bob);
  await api('POST', '/api/items/bulk', { collection: 'old-name', items: [{ a: 1 }, { a: 2 }] });

  const list = await api('GET', '/api/collections');
  assert.deepEqual(list.body.map((c) => [c.collection, c.count]), [['old-name', 2]]);

  const renamed = await api('PATCH', '/api/collections/old-name', { name: 'new-name' });
  assert.equal(renamed.body.count, 2);

  assert.equal((await api('DELETE', '/api/collections/new-name')).body.deleted, 2);
  assert.deepEqual((await api('GET', '/api/collections')).body, []);
});

test('export returns all of the user\'s items', async () => {
  const res = await as(alice)('GET', '/api/account/export');
  assert.equal(res.status, 200);
  assert.ok(res.body.items.length >= 4);
  assert.match(res.headers.get('content-disposition'), /attachment/);
});

test('validates input', async () => {
  const api = as(alice);
  assert.equal((await api('POST', '/api/items', { data: {} })).status, 400);
  assert.equal((await api('POST', '/api/items', { collection: 'c', data: [1] })).status, 400);
  assert.equal((await api('GET', '/api/items/not-a-uuid')).status, 400);
});
