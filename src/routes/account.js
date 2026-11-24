// The signed-in user's own account: profile, password, sessions, API keys.
const express = require('express');
const auth = require('../auth');
const users = require('../users');
const store = require('../store');
const { wrap, badRequest } = require('./util');

const router = express.Router();
const MAX_API_KEYS = 25;

router.get('/', wrap(async (req, res) => {
  res.json(await users.getUser(req.user.id));
}));

router.patch('/', wrap(async (req, res) => {
  const { name } = req.body || {};
  const email = req.body?.email !== undefined ? users.normalizeEmail(req.body.email) : undefined;
  const problem = (email !== undefined && users.validateEmail(email)) || users.validateName(name);
  if (problem) return badRequest(res, problem);
  if (email && email !== req.user.email && (await users.findByEmailWithHash(email))) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  res.json(await users.updateProfile(req.user.id, { email, name }));
}));

// Changing the password signs out every other session.
router.post('/password', wrap(async (req, res) => {
  const { current_password: current, new_password: next } = req.body || {};
  const problem = users.validatePassword(next);
  if (problem) return badRequest(res, `new_${problem}`);

  const found = await users.findByIdWithHash(req.user.id);
  if (!(await auth.verifyPassword(String(current || ''), found.password_hash))) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  await users.setPassword(req.user.id, await auth.hashPassword(next));
  await users.deleteSessions(req.user.id, req.user.token_kind === 'session' ? req.user.token_id : null);
  res.json({ ok: true });
}));

// Deletes the account and all of its data. Requires the password.
router.delete('/', wrap(async (req, res) => {
  const found = await users.findByIdWithHash(req.user.id);
  if (!(await auth.verifyPassword(String(req.body?.password || ''), found.password_hash))) {
    return res.status(401).json({ error: 'Password is wrong' });
  }
  if (found.role === 'admin' && (await users.countAdmins()) === 1) {
    return res.status(409).json({ error: 'You are the only admin; make another user an admin first' });
  }
  await users.deleteUser(req.user.id);
  res.status(204).end();
}));

// Downloads every item the user owns as JSON.
router.get('/export', wrap(async (req, res) => {
  const items = await store.exportItems(req.user.id);
  res.set('Content-Disposition', 'attachment; filename="cloud-data-export.json"');
  res.json({ exported_at: new Date().toISOString(), user: req.user.email, items });
}));

// --- sessions (signed-in devices) ---

router.get('/sessions', wrap(async (req, res) => {
  const sessions = await users.listTokens(req.user.id, 'session');
  res.json(sessions.map((s) => ({ ...s, current: s.id === req.user.token_id })));
}));

router.delete('/sessions', wrap(async (req, res) => {
  await users.deleteSessions(req.user.id, req.user.token_kind === 'session' ? req.user.token_id : null);
  res.status(204).end();
}));

// --- personal API keys (for scripts, other apps and MCP) ---

router.get('/keys', wrap(async (req, res) => {
  res.json(await users.listTokens(req.user.id, 'api_key'));
}));

router.post('/keys', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100) return badRequest(res, 'name is required (max 100 characters)');
  if ((await users.listTokens(req.user.id, 'api_key')).length >= MAX_API_KEYS) {
    return res.status(409).json({ error: `You can have at most ${MAX_API_KEYS} API keys` });
  }
  const { token, record } = await auth.issueToken(req.user.id, 'api_key', { name });
  // The full key is only ever returned here.
  res.status(201).json({ ...record, key: token });
}));

router.delete('/keys/:id', wrap(async (req, res) => {
  if (!store.UUID_RE.test(req.params.id)) return badRequest(res, 'id must be a UUID');
  if (!(await users.deleteToken(req.user.id, req.params.id, 'api_key'))) {
    return res.status(404).json({ error: 'API key not found' });
  }
  res.status(204).end();
}));

module.exports = router;
