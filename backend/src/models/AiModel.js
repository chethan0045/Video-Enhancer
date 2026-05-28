const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  displayName: String,
  category: { type: String, enum: ['denoise', 'deblur', 'upscale', 'temporal', 'face_restore', 'depth', 'interpolation', 'hdr', 'color', 'film_texture'], required: true },
  version: String,
  description: String,
  requirements: { minVRAM: Number, recommendedVRAM: Number },
  parameters: [{ name: String, type: String, default: mongoose.Schema.Types.Mixed, min: Number, max: Number, options: [String] }],
  active: { type: Boolean, default: true },
  performance: { avgProcessingTime: Number, framesPerSecond: Number },
}, { timestamps: true });

const AiModelModel = mongoose.model('AIModel', schema);

module.exports = { AiModelModel, schema };
