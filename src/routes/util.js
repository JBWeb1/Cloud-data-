// Wraps async handlers so errors reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

module.exports = { wrap, isPlainObject, badRequest };
