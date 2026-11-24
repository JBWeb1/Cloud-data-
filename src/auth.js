// Passwords, tokens and the middleware that identifies the signed-in user.
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

// Token prefixes make leaked tokens easy to recognise.
const PREFIX = { session: 'cds_', api_key: 'cdk_' };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the email is unknown, so login takes the same time either way.
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(KEY_LENGTH * 2);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Creates a token, stores its hash, and returns the plain token (shown to the user once). */
async function issueToken(userId, kind, { name = '', ttlDays = null } = {}) {
  const token = PREFIX[kind] + crypto.randomBytes(32).toString('base64url');
  const expiresAt = ttlDays ? new Date(Date.now() + ttlDays * 86400000) : null;
  const { rows } = await db.query(
    `INSERT INTO tokens (user_id, kind, name, token_hash, prefix, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, kind, name, prefix, expires_at, created_at`,
    [userId, kind, name, hashToken(token), token.slice(0, 12), expiresAt],
  );
  return { token, record: rows[0] };
}

/** Looks up the user for a plain token. `kinds` limits which token types are accepted. */
async function userForToken(token, kinds) {
  if (!token) return null;
  const { rows } = await db.query(
    `UPDATE tokens t SET last_used_at = now()
     FROM users u
     WHERE t.token_hash = $1
       AND t.kind = ANY($2)
       AND (t.expires_at IS NULL OR t.expires_at > now())
       AND u.id = t.user_id
     RETURNING u.id, u.email, u.name, u.role, u.created_at, t.id AS token_id, t.kind AS token_kind`,
    [hashToken(token), kinds],
  );
  return rows[0] || null;
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** Middleware: requires a valid session token or API key and sets req.user. */
function authenticate(kinds = ['session', 'api_key']) {
  return async (req, res, next) => {
    try {
      const user = await userForToken(bearerToken(req), kinds);
      if (!user) {
        return res.status(401).json({ error: 'Sign in required: send "Authorization: Bearer <token>"' });
      }
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  DUMMY_HASH,
  issueToken,
  userForToken,
  bearerToken,
  authenticate,
  requireAdmin,
};
