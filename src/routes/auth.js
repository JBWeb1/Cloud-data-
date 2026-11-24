// Sign-up, login and logout.
const express = require('express');
const config = require('../config');
const auth = require('../auth');
const users = require('../users');
const { wrap, badRequest } = require('./util');

const router = express.Router();

async function startSession(user) {
  const { token, record } = await auth.issueToken(user.id, 'session', { ttlDays: config.sessionTtlDays });
  return { token, expires_at: record.expires_at, user };
}

router.post('/register', wrap(async (req, res) => {
  if (!config.allowRegistration) {
    return res.status(403).json({ error: 'Sign-ups are turned off on this server' });
  }
  const { password, name } = req.body || {};
  const email = users.normalizeEmail(req.body?.email);
  const problem = users.validateEmail(email) || users.validatePassword(password) || users.validateName(name);
  if (problem) return badRequest(res, problem);

  if (await users.findByEmailWithHash(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const user = await users.createUser({ email, name: name || '', passwordHash: await auth.hashPassword(password) });
  // The first account (the admin) takes over any items saved before accounts existed.
  if (user.role === 'admin') await users.claimUnownedItems(user.id);
  res.status(201).json(await startSession(user));
}));

router.post('/login', wrap(async (req, res) => {
  const email = users.normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const found = await users.findByEmailWithHash(email);
  const ok = await auth.verifyPassword(password, found ? found.password_hash : auth.DUMMY_HASH);
  if (!found || !ok) return res.status(401).json({ error: 'Wrong email or password' });

  const { password_hash: _, ...user } = found;
  res.json(await startSession(user));
}));

// Ends the session used for this request.
router.post('/logout', auth.authenticate(['session']), wrap(async (req, res) => {
  await users.deleteTokenById(req.user.token_id);
  res.status(204).end();
}));

module.exports = router;
