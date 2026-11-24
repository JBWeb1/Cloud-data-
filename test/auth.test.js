const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, db } = require('./helpers');

let t;
before(async () => { t = await startServer(); });
after(async () => { await t.stop(); });

test('register validates input and rejects duplicate emails', async () => {
  assert.equal((await t.api('POST', '/api/auth/register', { body: { email: 'bad', password: 'longenough' } })).status, 400);
  assert.equal((await t.api('POST', '/api/auth/register', { body: { email: 'a@b.co', password: 'short' } })).status, 400);

  const u = await t.registerUser();
  const dup = await t.api('POST', '/api/auth/register', { body: { email: u.email.toUpperCase(), password: 'whatever123' } });
  assert.equal(dup.status, 409);
});

test('register returns a session and never exposes the password hash', async () => {
  const u = await t.registerUser('Ada');
  assert.match(u.token, /^cds_/);
  assert.equal(u.user.name, 'Ada');
  assert.equal(u.user.password_hash, undefined);

  const me = await t.api('GET', '/api/account', { token: u.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.email, u.email);
  assert.equal(me.body.password_hash, undefined);
});

test('login works with the right password only', async () => {
  const u = await t.registerUser();
  const wrong = await t.api('POST', '/api/auth/login', { body: { email: u.email, password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  const unknown = await t.api('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'nope-nope' } });
  assert.equal(unknown.status, 401);

  const ok = await t.api('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
  assert.equal(ok.status, 200);
  assert.match(ok.body.token, /^cds_/);
});

test('requests without a valid token are refused', async () => {
  assert.equal((await t.api('GET', '/api/items')).status, 401);
  assert.equal((await t.api('GET', '/api/items', { token: 'cds_madeup' })).status, 401);
});

test('logout ends the session', async () => {
  const u = await t.registerUser();
  assert.equal((await t.api('POST', '/api/auth/logout', { token: u.token })).status, 204);
  assert.equal((await t.api('GET', '/api/account', { token: u.token })).status, 401);
});

test('changing the password signs out other sessions but keeps this one', async () => {
  const u = await t.registerUser();
  const other = (await t.api('POST', '/api/auth/login', { body: { email: u.email, password: u.password } })).body.token;

  const bad = await t.api('POST', '/api/account/password', {
    token: u.token, body: { current_password: 'wrong-one', new_password: 'brand new password' },
  });
  assert.equal(bad.status, 401);

  const ok = await t.api('POST', '/api/account/password', {
    token: u.token, body: { current_password: u.password, new_password: 'brand new password' },
  });
  assert.equal(ok.status, 200);
  assert.equal((await t.api('GET', '/api/account', { token: u.token })).status, 200);
  assert.equal((await t.api('GET', '/api/account', { token: other })).status, 401);

  const relogin = await t.api('POST', '/api/auth/login', { body: { email: u.email, password: 'brand new password' } });
  assert.equal(relogin.status, 200);
});

test('profile can be updated', async () => {
  const u = await t.registerUser();
  const res = await t.api('PATCH', '/api/account', { token: u.token, body: { name: 'New Name' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'New Name');
});

test('API keys: create, use, list without secret, revoke', async () => {
  const u = await t.registerUser();
  const created = await t.api('POST', '/api/account/keys', { token: u.token, body: { name: 'laptop' } });
  assert.equal(created.status, 201);
  assert.match(created.body.key, /^cdk_/);

  assert.equal((await t.api('GET', '/api/items', { token: created.body.key })).status, 200);

  const list = await t.api('GET', '/api/account/keys', { token: u.token });
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].key, undefined);
  assert.equal(list.body[0].name, 'laptop');

  assert.equal((await t.api('DELETE', `/api/account/keys/${created.body.id}`, { token: u.token })).status, 204);
  assert.equal((await t.api('GET', '/api/items', { token: created.body.key })).status, 401);
});

test('deleting an account needs the password and removes its data', async () => {
  const u = await t.registerUser();
  await t.api('POST', '/api/items', { token: u.token, body: { collection: 'c', data: { a: 1 } } });

  assert.equal((await t.api('DELETE', '/api/account', { token: u.token, body: { password: 'wrong-pass' } })).status, 401);
  assert.equal((await t.api('DELETE', '/api/account', { token: u.token, body: { password: u.password } })).status, 204);

  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM items WHERE owner_id = $1', [u.user.id]);
  assert.equal(rows[0].n, 0);
});

test('admin endpoints are for admins only', async () => {
  const regular = await t.registerUser();
  const admin = await t.registerUser();
  await db.query("UPDATE users SET role = 'user' WHERE id = $1", [regular.user.id]);
  await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);

  assert.equal((await t.api('GET', '/api/admin/users', { token: regular.token })).status, 403);

  const list = await t.api('GET', '/api/admin/users', { token: admin.token });
  assert.equal(list.status, 200);
  assert.ok(list.body.users.some((x) => x.id === regular.user.id));

  const stats = await t.api('GET', '/api/admin/stats', { token: admin.token });
  assert.equal(typeof stats.body.users, 'number');

  const promoted = await t.api('PATCH', `/api/admin/users/${regular.user.id}`, { token: admin.token, body: { role: 'admin' } });
  assert.equal(promoted.body.role, 'admin');
});
