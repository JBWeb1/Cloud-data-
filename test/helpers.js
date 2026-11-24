// Shared test setup. Requires a throwaway PostgreSQL database in DATABASE_URL.
const crypto = require('crypto');
const db = require('../src/db');
const { migrate } = require('../src/migrate');
const { createApp } = require('../src/app');

const createdEmails = [];

async function startServer(options) {
  await migrate();
  const server = createApp(options).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, path, { body, token, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  async function registerUser(name = 'Test') {
    const email = `test-${crypto.randomUUID()}@example.com`;
    createdEmails.push(email);
    const password = 'correct horse battery';
    const res = await api('POST', '/api/auth/register', { body: { email, password, name } });
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    return { email, password, token: res.body.token, user: res.body.user };
  }

  async function stop() {
    server.close();
    if (createdEmails.length) {
      await db.query('DELETE FROM users WHERE email = ANY($1)', [createdEmails]);
    }
    await db.pool.end();
  }

  return { base, api, registerUser, stop, trackEmail: (e) => createdEmails.push(e) };
}

module.exports = { startServer, db };
