const express = require('express');
const store = require('../store');

const router = express.Router();

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function notFound(res) {
  return res.status(404).json({ error: 'Item not found' });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Wraps async handlers so errors reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.param('id', (req, res, next, id) => {
  if (!store.UUID_RE.test(id)) return badRequest(res, 'id must be a UUID');
  next();
});

// List items, optionally filtered by collection.
router.get('/', wrap(async (req, res) => {
  const { collection, limit, offset } = req.query;
  if (collection && !store.COLLECTION_RE.test(collection)) {
    return badRequest(res, 'invalid collection name');
  }
  res.json(await store.listItems({ collection, limit, offset }));
}));

router.get('/:id', wrap(async (req, res) => {
  const item = await store.getItem(req.params.id);
  if (!item) return notFound(res);
  res.json(item);
}));

router.post('/', wrap(async (req, res) => {
  const { collection, data = {} } = req.body || {};
  if (!collection || !store.COLLECTION_RE.test(collection)) {
    return badRequest(res, 'collection is required (letters, numbers, _ or -, max 64 chars)');
  }
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');
  res.status(201).json(await store.createItem(collection, data));
}));

// Replace an item's data entirely.
router.put('/:id', wrap(async (req, res) => {
  const { data } = req.body || {};
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');
  const item = await store.replaceItem(req.params.id, data);
  if (!item) return notFound(res);
  res.json(item);
}));

// Merge fields into an item's existing data.
router.patch('/:id', wrap(async (req, res) => {
  const { data } = req.body || {};
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');
  const item = await store.mergeItem(req.params.id, data);
  if (!item) return notFound(res);
  res.json(item);
}));

router.delete('/:id', wrap(async (req, res) => {
  if (!(await store.deleteItem(req.params.id))) return notFound(res);
  res.status(204).end();
}));

module.exports = router;
