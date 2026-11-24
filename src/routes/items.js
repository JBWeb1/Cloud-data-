// The signed-in user's items and collections.
const express = require('express');
const store = require('../store');
const { wrap, isPlainObject, badRequest } = require('./util');

const items = express.Router();
const collections = express.Router();

function notFound(res) {
  return res.status(404).json({ error: 'Item not found' });
}

function validCollection(name) {
  return typeof name === 'string' && store.COLLECTION_RE.test(name);
}

const COLLECTION_HELP = 'collection names use letters, numbers, _ or -, max 64 chars';

items.param('id', (req, res, next, id) => {
  if (!store.UUID_RE.test(id)) return badRequest(res, 'id must be a UUID');
  next();
});

// GET /api/items?collection=notes&where={"status":"open"}&sort=updated_at&order=asc&limit=20&offset=0
items.get('/', wrap(async (req, res) => {
  const { collection, sort, order, limit, offset } = req.query;
  if (collection && !validCollection(collection)) return badRequest(res, COLLECTION_HELP);

  let where;
  if (req.query.where) {
    try {
      where = JSON.parse(req.query.where);
    } catch {
      return badRequest(res, 'where must be a JSON object, e.g. {"status":"open"}');
    }
    if (!isPlainObject(where)) return badRequest(res, 'where must be a JSON object');
  }
  res.json(await store.listItems(req.user.id, { collection, where, sort, order, limit, offset }));
}));

items.get('/:id', wrap(async (req, res) => {
  const item = await store.getItem(req.user.id, req.params.id);
  if (!item) return notFound(res);
  res.json(item);
}));

items.post('/', wrap(async (req, res) => {
  const { collection, data = {} } = req.body || {};
  if (!validCollection(collection)) return badRequest(res, `collection is required; ${COLLECTION_HELP}`);
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');
  res.status(201).json(await store.createItem(req.user.id, collection, data));
}));

// Create many items at once: { "collection": "notes", "items": [ {...}, {...} ] }
items.post('/bulk', wrap(async (req, res) => {
  const { collection, items: list } = req.body || {};
  if (!validCollection(collection)) return badRequest(res, `collection is required; ${COLLECTION_HELP}`);
  if (!Array.isArray(list) || list.length === 0 || list.length > store.MAX_BULK) {
    return badRequest(res, `items must be an array of 1 to ${store.MAX_BULK} JSON objects`);
  }
  if (!list.every(isPlainObject)) return badRequest(res, 'every entry in items must be a JSON object');
  const created = await store.createItems(req.user.id, collection, list);
  res.status(201).json({ created: created.length, items: created });
}));

// Replace an item's data entirely.
items.put('/:id', wrap(async (req, res) => {
  const { data } = req.body || {};
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');
  const item = await store.replaceItem(req.user.id, req.params.id, data);
  if (!item) return notFound(res);
  res.json(item);
}));

// Merge fields into an item's existing data.
items.patch('/:id', wrap(async (req, res) => {
  const { data } = req.body || {};
  if (!isPlainObject(data)) return badRequest(res, 'data must be a JSON object');
  const item = await store.mergeItem(req.user.id, req.params.id, data);
  if (!item) return notFound(res);
  res.json(item);
}));

items.delete('/:id', wrap(async (req, res) => {
  if (!(await store.deleteItem(req.user.id, req.params.id))) return notFound(res);
  res.status(204).end();
}));

// --- collections ---

collections.param('name', (req, res, next, name) => {
  if (!validCollection(name)) return badRequest(res, COLLECTION_HELP);
  next();
});

collections.get('/', wrap(async (req, res) => {
  res.json(await store.listCollections(req.user.id));
}));

// Rename: { "name": "new-name" }
collections.patch('/:name', wrap(async (req, res) => {
  const to = req.body?.name;
  if (!validCollection(to)) return badRequest(res, `name is required; ${COLLECTION_HELP}`);
  const moved = await store.renameCollection(req.user.id, req.params.name, to);
  if (!moved) return res.status(404).json({ error: 'Collection not found' });
  res.json({ collection: to, count: moved });
}));

// Deletes every item in the collection.
collections.delete('/:name', wrap(async (req, res) => {
  const deleted = await store.deleteCollection(req.user.id, req.params.name);
  if (!deleted) return res.status(404).json({ error: 'Collection not found' });
  res.json({ deleted });
}));

module.exports = { items, collections };
