// User account queries.
const db = require('./db');

const PUBLIC_FIELDS = 'id, email, name, role, created_at, updated_at';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  return EMAIL_RE.test(email) && email.length <= 254 ? null : 'a valid email is required';
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'password must be at least 8 characters';
  if (password.length > 200) return 'password must be at most 200 characters';
  return null;
}

function validateName(name) {
  if (name === undefined) return null;
  return typeof name === 'string' && name.length <= 100 ? null : 'name must be text of at most 100 characters';
}

/** The first account ever created becomes an admin. */
async function createUser({ email, name = '', passwordHash }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, name, password_hash, role)
     VALUES ($1, $2, $3, CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'user' ELSE 'admin' END)
     RETURNING ${PUBLIC_FIELDS}`,
    [email, name, passwordHash],
  );
  return rows[0];
}

async function findByEmailWithHash(email) {
  const { rows } = await db.query(`SELECT ${PUBLIC_FIELDS}, password_hash FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

async function findByIdWithHash(id) {
  const { rows } = await db.query(`SELECT ${PUBLIC_FIELDS}, password_hash FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getUser(id) {
  const { rows } = await db.query(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function updateProfile(id, { email, name }) {
  const { rows } = await db.query(
    `UPDATE users SET
       email = COALESCE($2, email),
       name = COALESCE($3, name),
       updated_at = now()
     WHERE id = $1 RETURNING ${PUBLIC_FIELDS}`,
    [id, email ?? null, name ?? null],
  );
  return rows[0];
}

async function setPassword(id, passwordHash) {
  await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [id, passwordHash]);
}

async function setRole(id, role) {
  const { rows } = await db.query(
    `UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING ${PUBLIC_FIELDS}`,
    [id, role],
  );
  return rows[0] || null;
}

async function deleteUser(id) {
  const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [id]);
  return rowCount > 0;
}

async function countAdmins() {
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'");
  return rows[0].n;
}

async function listUsers({ limit = 50, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.name, u.role, u.created_at,
            (SELECT COUNT(*)::int FROM items i WHERE i.owner_id = u.id) AS item_count
     FROM users u ORDER BY u.created_at LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const total = (await db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
  return { users: rows, total, limit, offset };
}

async function stats() {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM items) AS items,
      (SELECT COUNT(DISTINCT (owner_id, collection))::int FROM items) AS collections,
      (SELECT COUNT(*)::int FROM tokens WHERE kind = 'session' AND expires_at > now()) AS active_sessions,
      (SELECT COUNT(*)::int FROM tokens WHERE kind = 'api_key') AS api_keys
  `);
  return rows[0];
}

// --- tokens belonging to a user ---

async function listTokens(userId, kind) {
  const { rows } = await db.query(
    `SELECT id, name, prefix, expires_at, last_used_at, created_at
     FROM tokens WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC`,
    [userId, kind],
  );
  return rows;
}

async function deleteToken(userId, tokenId, kind) {
  const { rowCount } = await db.query(
    'DELETE FROM tokens WHERE id = $1 AND user_id = $2 AND kind = $3',
    [tokenId, userId, kind],
  );
  return rowCount > 0;
}

/** Signs out every session except (optionally) one. */
async function deleteSessions(userId, exceptTokenId = null) {
  await db.query(
    "DELETE FROM tokens WHERE user_id = $1 AND kind = 'session' AND id IS DISTINCT FROM $2",
    [userId, exceptTokenId],
  );
}

async function deleteTokenById(tokenId) {
  await db.query('DELETE FROM tokens WHERE id = $1', [tokenId]);
}

async function claimUnownedItems(userId) {
  await db.query('UPDATE items SET owner_id = $1 WHERE owner_id IS NULL', [userId]);
}

async function purgeExpiredTokens() {
  await db.query('DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < now()');
}

module.exports = {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validateName,
  createUser,
  findByEmailWithHash,
  findByIdWithHash,
  getUser,
  updateProfile,
  setPassword,
  setRole,
  deleteUser,
  countAdmins,
  listUsers,
  stats,
  listTokens,
  deleteToken,
  deleteSessions,
  deleteTokenById,
  claimUnownedItems,
  purgeExpiredTokens,
};
