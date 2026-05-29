/**
 * Model registry — auto-selects between Mongoose (MongoDB) and NeDB (file-based).
 */
const db = require('../db');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { buildDefaultPipeline, defaultStages, defaultEditStages, stagesForMode, JOB_MODES } = require('./VideoJob');

// ── User Model ───────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name: String, email: String, password: String, subscription: { type: String, default: 'free' },
  storageUsed: { type: Number, default: 0 }, storageLimit: { type: Number, default: 5368709120 }, jobsProcessed: { type: Number, default: 0 },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = function (c) { return bcrypt.compare(c, this.password); };

const User = {
  collection: () => db.getCollection('User', userSchema),

  async findByEmail(email) {
    const col = this.collection();
    try { return await col.findOne({ email }); } catch { return null; }
  },

  async findById(id) {
    const col = this.collection();
    try { return await col.findById(id); } catch { return null; }
  },

  async create(data) {
    const hashed = await bcrypt.hash(data.password, 12);
    const col = this.collection();
    return col.create({ ...data, password: hashed, subscription: 'free', storageUsed: 0, storageLimit: 5368709120, jobsProcessed: 0 });
  },

  async updateById(id, data) {
    const col = this.collection();
    return col.findByIdAndUpdate(id, { $set: data }, { new: true });
  },

  toJSON(user) {
    if (!user) return null;
    const u = { ...user };
    delete u.password;
    return u;
  },
};

// ── VideoJob Model ───────────────────────────────────────
const jobSchema = new mongoose.Schema({
  userId: String, title: String, mode: { type: String, default: 'enhance' }, inputPath: String, inputPaths: Array, outputPath: String,
  inputFormat: String, inputSize: Number, inputDuration: Number,
  inputResolution: { width: Number, height: Number },
  status: { type: String, default: 'queued' }, progress: { type: Number, default: 0 },
  pipeline: {}, pipelineStages: { type: Array, default: () => defaultStages() },
  error: String, fileSize: Number,
}, { timestamps: true });

const VideoJob = {
  collection: () => db.getCollection('VideoJob', jobSchema),

  async findById(id) {
    const col = this.collection();
    try { return await col.findById(id); } catch { return null; }
  },

  async findByUser(userId, page = 1, limit = 20, statusFilter) {
    const col = this.collection();
    const filter = { userId };
    if (statusFilter) filter.status = statusFilter;
    const [jobs, total] = await Promise.all([
      col.find(filter, { sort: { createdAt: -1 }, skip: (page - 1) * limit, limit }),
      col.countDocuments(filter),
    ]);
    return { jobs, total, page, limit, pages: Math.ceil(total / limit) };
  },

  async create(data) {
    const col = this.collection();
    const mode = JOB_MODES.includes(data.mode) ? data.mode : 'enhance';
    const defaults = buildDefaultPipeline();
    const userPipe = data.pipeline || {};
    const pipeline = {};
    for (const key of Object.keys(defaults)) {
      pipeline[key] = { ...defaults[key], ...(userPipe[key] || {}) };
    }
    return col.create({
      ...data,
      mode,
      pipeline,
      pipelineStages: stagesForMode(mode),
      status: 'queued', progress: 0,
    });
  },

  async updateById(id, update) {
    const col = this.collection();
    return col.findByIdAndUpdate(id, update, { new: true });
  },

  async deleteById(id) {
    const col = this.collection();
    return col.deleteOne({ _id: id });
  },
};

// ── AIModel Model ────────────────────────────────────────
const modelSchema = new mongoose.Schema({
  name: String, displayName: String, category: String, version: String,
  description: String, requirements: {}, parameters: [], active: { type: Boolean, default: true }, performance: {},
}, { timestamps: true });

const MODELS_SEED = [
  { name: 'BasicVSR++', displayName: 'BasicVSR++', category: 'temporal', version: '1.0', description: 'BasicVSR++: Improved Video Super-Resolution', requirements: { minVRAM: 6, recommendedVRAM: 12 }, active: true },
  { name: 'RVRT', displayName: 'RVRT', category: 'temporal', version: '1.0', description: 'Recurrent Video Restoration Transformer', requirements: { minVRAM: 8, recommendedVRAM: 16 }, active: true },
  { name: 'Real-ESRGAN', displayName: 'Real-ESRGAN', category: 'upscale', version: '1.0', description: 'Real-ESRGAN: Real-World Super-Resolution', requirements: { minVRAM: 4, recommendedVRAM: 8 }, active: true },
  { name: 'BSRGAN', displayName: 'BSRGAN', category: 'upscale', version: '1.0', description: 'Blind Super-Resolution GAN', requirements: { minVRAM: 4, recommendedVRAM: 8 }, active: true },
  { name: 'SwinIR', displayName: 'SwinIR', category: 'upscale', version: '1.0', description: 'Image Restoration using Swin Transformer', requirements: { minVRAM: 4, recommendedVRAM: 8 }, active: true },
  { name: 'CodeFormer', displayName: 'CodeFormer', category: 'face_restore', version: '1.0', description: 'Face Restoration with Transformers', requirements: { minVRAM: 4, recommendedVRAM: 8 }, active: true },
  { name: 'GFPGAN', displayName: 'GFPGAN', category: 'face_restore', version: '1.0', description: 'Generative Facial Prior for Face Restoration', requirements: { minVRAM: 4, recommendedVRAM: 8 }, active: true },
  { name: 'Restormer', displayName: 'Restormer', category: 'deblur', version: '1.0', description: 'Transformer for High-Resolution Image Restoration', requirements: { minVRAM: 4, recommendedVRAM: 8 }, active: true },
  { name: 'RIFE', displayName: 'RIFE', category: 'interpolation', version: '1.0', description: 'Real-Time Intermediate Flow Estimation', requirements: { minVRAM: 2, recommendedVRAM: 4 }, active: true },
  { name: 'MiDaS', displayName: 'MiDaS', category: 'depth', version: '1.0', description: 'Multi-ISP Depth Estimation', requirements: { minVRAM: 2, recommendedVRAM: 4 }, active: true },
];

const AIModel = {
  collection: () => db.getCollection('AIModel', modelSchema),
  _seeded: false,

  async list(category) {
    const col = this.collection();
    const filter = { active: true };
    if (category) filter.category = category;
    if (!this._seeded) { await this._seed(); }
    return col.find(filter, { sort: { category: 1, name: 1 } });
  },

  async findById(id) {
    const col = this.collection();
    if (!this._seeded) { await this._seed(); }
    return col.findById(id);
  },

  async findByName(name) {
    const col = this.collection();
    if (!this._seeded) { await this._seed(); }
    return col.findOne({ name });
  },

  async _seed() {
    if (this._seeded) return;
    const col = this.collection();
    const existing = await col.countDocuments({});
    if (existing === 0) {
      for (const m of MODELS_SEED) { await col.create(m); }
      console.log(`[Models] Seeded ${MODELS_SEED.length} AI models`);
    }
    this._seeded = true;
  },
};

module.exports = { User, VideoJob, AIModel };
