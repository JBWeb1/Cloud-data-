require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// TRUST_PROXY: "true", a number of proxy hops, or unset.
function parseTrustProxy(value) {
  if (!value) return false;
  if (value === 'true') return true;
  const n = Number(value);
  return Number.isInteger(n) ? n : value;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required('DATABASE_URL'),
  // Hosted databases (Supabase, Neon, Render, RDS...) usually require SSL.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // Set to false to stop new sign-ups (existing users can still log in).
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS) || 30,
  // Set when running behind a load balancer or reverse proxy so rate limits see real client IPs.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
};
