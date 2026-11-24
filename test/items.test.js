// Integration tests. Requires a reachable PostgreSQL database in DATABASE_URL
// (a throwaway one: the test clears the `items` table rows it creates).
process.env.API_KEY = 'test-key';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');

const COLLECTION = `test_${Date.now()}`;
let server;
let base;

async function api(method, path, body, headers = { 'x-api-key': 'test-key' }) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  await migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await db.query('DELETE FROM items WHERE collection = $1', [COLLECTION]);
  server.close();
  await db.pool.end();
});

test('health reports database connected', async () => {
  const res = await api('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.database, 'connected');
});

test('rejects requests without the API key', async () => {
  const res = await api('GET', '/api/items', undefined, {});
  assert.equal(res.status, 401);
});

test('full create / read / update / delete cycle', async () => {
  const created = await api('POST', '/api/items', { collection: COLLECTION, data: { name: 'a', n: 1 } });
  assert.equal(created.status, 201);
  const { id } = created.body;

  const fetched = await api('GET', `/api/items/${id}`);
  assert.deepEqual(fetched.body.data, { name: 'a', n: 1 });

  const listed = await api('GET', `/api/items?collection=${COLLECTION}`);
  assert.equal(listed.body.items.length, 1);

  const patched = await api('PATCH', `/api/items/${id}`, { data: { n: 2 } });
  assert.deepEqual(patched.body.data, { name: 'a', n: 2 });

  const replaced = await api('PUT', `/api/items/${id}`, { data: { only: true } });
  assert.deepEqual(replaced.body.data, { only: true });

  assert.equal((await api('DELETE', `/api/items/${id}`)).status, 204);
  assert.equal((await api('GET', `/api/items/${id}`)).status, 404);
});

test('validates input', async () => {
  assert.equal((await api('POST', '/api/items', { data: {} })).status, 400);
  assert.equal((await api('POST', '/api/items', { collection: COLLECTION, data: [1] })).status, 400);
  assert.equal((await api('GET', '/api/items/not-a-uuid')).status, 400);
});
