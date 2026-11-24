const express = require('express');
const db = require('../db');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLLECTION_RE = /^[A-Za-z0-9_-]{1,64}$/;

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Wraps async handlers so errors reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(id)) return badRequest(res, 'id must be a UUID');
  next();
});

// List items, optionally filtered by collection.
router.get('/', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const { collection } = req.query;

  const params = [];
  let where = '';
  if (collection) {
    if (!COLLECTION_RE.test(collection)) return badRequest(res, 'invalid collection name');
    params.push(collection);
    where = 'WHERE collection = $1';
  }
  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT * FROM items ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ items: rows, limit, offset });
}));

router.get('/:id', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
  res.json(rows[0]);
}));

router.post('/', wrap(async (req, res) => {
  const { collection, data = {} } = req.body || {};
  if (!collection || !COLLECTION_RE.test(collection)) {
    return badRequest(res, 'collection is required (letters, numbers, _ or -, max 64 chars)');
  }
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');

  const { rows } = await db.query(
    'INSERT INTO items (collection, data) VALUES ($1, $2) RETURNING *',
    [collection, data],
  );
  res.status(201).json(rows[0]);
}));

// Replace an item's data entirely.
router.put('/:id', wrap(async (req, res) => {
  const { data } = req.body || {};
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');

  const { rows } = await db.query(
    'UPDATE items SET data = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [req.params.id, data],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
  res.json(rows[0]);
}));

// Merge fields into an item's existing data.
router.patch('/:id', wrap(async (req, res) => {
  const { data } = req.body || {};
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');

  const { rows } = await db.query(
    'UPDATE items SET data = data || $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *',
    [req.params.id, data],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Item not found' });
  res.json(rows[0]);
}));

router.delete('/:id', wrap(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM items WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Item not found' });
  res.status(204).end();
}));

module.exports = router;
