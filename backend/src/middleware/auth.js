const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
