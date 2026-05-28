const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  subscription: { type: String, enum: ['free', 'basic', 'pro', 'enterprise'], default: 'free' },
  storageUsed: { type: Number, default: 0 },
  storageLimit: { type: Number, default: 5 * 1024 * 1024 * 1024 },
  jobsProcessed: { type: Number, default: 0 },
}, { timestamps: true });

schema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

schema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

schema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

const UserModel = mongoose.model('User', schema);

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function comparePassword(candidate, hashed) {
  return bcrypt.compare(candidate, hashed);
}

module.exports = { UserModel, schema, hashPassword, comparePassword };
