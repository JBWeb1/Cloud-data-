require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required('DATABASE_URL'),
  // Hosted databases (Supabase, Neon, Render, RDS...) usually require SSL.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // When set, every /api request must send this value in the `x-api-key` header.
  apiKey: process.env.API_KEY || null,
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
