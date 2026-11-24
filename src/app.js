const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const itemsRouter = require('./routes/items');

function requireApiKey(req, res, next) {
  if (!config.apiKey) return next();
  const given = Buffer.from(req.get('x-api-key') || '');
  const expected = Buffer.from(config.apiKey);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });

  app.use('/api/items', requireApiKey, itemsRouter);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
