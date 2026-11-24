// Admin-only endpoints. Requires a user with role "admin".
const express = require('express');
const users = require('../users');
const store = require('../store');
const { wrap, badRequest } = require('./util');

const router = express.Router();

router.get('/stats', wrap(async (req, res) => {
  res.json(await users.stats());
}));

router.get('/users', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  res.json(await users.listUsers({ limit, offset }));
}));

router.param('id', (req, res, next, id) => {
  if (!store.UUID_RE.test(id)) return badRequest(res, 'id must be a UUID');
  next();
});

router.patch('/users/:id', wrap(async (req, res) => {
  const { role } = req.body || {};
  if (!['user', 'admin'].includes(role)) return badRequest(res, 'role must be "user" or "admin"');
  if (req.params.id === req.user.id && role !== 'admin' && (await users.countAdmins()) === 1) {
    return res.status(409).json({ error: 'You are the only admin' });
  }
  const user = await users.setRole(req.params.id, role);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
}));

router.delete('/users/:id', wrap(async (req, res) => {
  if (req.params.id === req.user.id) {
    return badRequest(res, 'Delete your own account from /api/account instead');
  }
  if (!(await users.deleteUser(req.params.id))) return res.status(404).json({ error: 'User not found' });
  res.status(204).end();
}));

module.exports = router;
