const { User } = require('../models');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

const tokenFor = (user) => jwt.sign(
  { id: user._id, email: user.email, name: user.name, subscription: user.subscription },
  JWT_SECRET,
  { expiresIn: JWT_EXPIRES }
);

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await User.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create({ name, email, password });
    const token = tokenFor(user);
    res.status(201).json({ token, user: User.toJSON(user) });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = tokenFor(user);
    res.json({ token, user: User.toJSON(user) });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: User.toJSON(user) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['name'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const user = await User.updateById(req.user.id, updates);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: User.toJSON(user) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
};
