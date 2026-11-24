const config = require('./config');
const db = require('./db');
const { migrate } = require('./migrate');
const { createApp } = require('./app');

async function start() {
  await migrate();
  const server = createApp().listen(config.port, () => {
    console.log(`Cloud data server listening on port ${config.port}`);
  });

  const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => db.pool.end().then(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
