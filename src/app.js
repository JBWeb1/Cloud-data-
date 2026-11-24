const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const config = require('./config');
const db = require('./db');
const { authenticate, requireAdmin } = require('./auth');
const { createMcpRouter } = require('./mcp');
const authRouter = require('./routes/auth');
const accountRouter = require('./routes/account');
const adminRouter = require('./routes/admin');
const { items, collections } = require('./routes/items');

function createApp({ authRateLimit = 20 } = {}) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '2mb' }));

  // Web dashboard (public/index.html).
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });

  // Slows down password guessing: limited attempts per IP address per 15 minutes.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: authRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts, try again later' },
  });
  // General limit for everything else, per IP address per minute.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many requests, slow down' },
  });

  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api', apiLimiter);
  app.use('/api/account', authenticate(), accountRouter);
  app.use('/api/admin', authenticate(), requireAdmin, adminRouter);
  app.use('/api/items', authenticate(), items);
  app.use('/api/collections', authenticate(), collections);
  app.use('/mcp', apiLimiter, createMcpRouter());

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large' });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
