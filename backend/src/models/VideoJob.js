const mongoose = require('mongoose');

const stageSchema = new mongoose.Schema({
  name: String,
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'skipped'], default: 'pending' },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  startedAt: Date,
  completedAt: Date,
  error: String,
  duration: Number,
}, { _id: false });

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true },
  mode: { type: String, enum: ['enhance', 'edit', 'merge', 'extract-audio', 'subtitle', 'denoise-audio'], default: 'enhance', index: true },
  inputPath: { type: String, required: true },
  inputPaths: [String], // for merge jobs (ordered list of source clips)
  inputFormat: String,
  inputSize: Number,
  inputDuration: Number,
  inputResolution: { width: Number, height: Number },
  outputPath: String,
  outputFormat: { type: String, default: 'mp4' },
  thumbnailPath: String,
  status: {
    type: String,
    enum: ['queued', 'extracting', 'processing', 'enhancing', 'rebuilding', 'exporting', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    index: true,
  },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  pipeline: {
    denoise: { enabled: Boolean, strength: Number },
    deblur: { enabled: Boolean, strength: Number },
    upscale: { enabled: Boolean, target: { type: String, enum: ['1080p', '2k', '4k', '8k'] }, model: String },
    temporal: { enabled: Boolean, model: String },
    faceRestore: { enabled: Boolean, model: String, strength: Number },
    depthSimulation: { enabled: Boolean, blurStrength: Number },
    fpsInterpolation: { enabled: Boolean, targetFps: Number },
    hdr: { enabled: Boolean, strength: Number },
    colorGrading: { enabled: Boolean, lut: String, warmth: Number, contrast: Number, saturation: Number },
    filmTexture: { enabled: Boolean, type: String },
    editor: {
      trim: {
        enabled: { type: Boolean, default: false },
        start: { type: Number, default: 0 },
        end: { type: Number, default: 0 },
      },
      crop: {
        enabled: { type: Boolean, default: false },
        x: { type: Number, default: 0 },
        y: { type: Number, default: 0 },
        width: { type: Number, default: 0 },
        height: { type: Number, default: 0 },
      },
    },
  },
  pipelineStages: [stageSchema],
  error: String,
  startedAt: Date,
  completedAt: Date,
  estimatedRemaining: Number,
  fileSize: Number,
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

schema.index({ userId: 1, createdAt: -1 });

schema.virtual('duration_formatted').get(function () {
  if (!this.inputDuration) return '0:00';
  const m = Math.floor(this.inputDuration / 60);
  const s = Math.floor(this.inputDuration % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
});

const VideoJobModel = mongoose.model('VideoJob', schema);

function buildDefaultPipeline() {
  return {
    denoise: { enabled: true, strength: 0.5 },
    deblur: { enabled: true, strength: 0.5 },
    upscale: { enabled: true, target: '4k', model: 'Real-ESRGAN' },
    temporal: { enabled: true, model: 'BasicVSR++' },
    faceRestore: { enabled: true, model: 'CodeFormer', strength: 0.6 },
    depthSimulation: { enabled: false, blurStrength: 0.3 },
    fpsInterpolation: { enabled: false, targetFps: 60 },
    hdr: { enabled: true, strength: 0.7 },
    colorGrading: { enabled: true, lut: 'cinematic', warmth: 0, contrast: 0.2, saturation: 0.1 },
    filmTexture: { enabled: false, type: 'grain_light' },
    editor: {
      trim: { enabled: false, start: 0, end: 0 },
      crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
    },
  };
}

function defaultStages() {
  return [
    { name: 'denoise' }, { name: 'deblur' }, { name: 'temporal' }, { name: 'upscale' },
    { name: 'face_restore' }, { name: 'depth_simulation' }, { name: 'fps_interpolation' },
    { name: 'hdr' }, { name: 'color_grading' }, { name: 'film_texture' }, { name: 'export' },
  ].map(s => ({ ...s, status: 'pending', progress: 0 }));
}

// Edit jobs (trim/crop) skip the AI pipeline — they track only these lightweight stages.
function defaultEditStages() {
  return [
    { name: 'trim' }, { name: 'crop' }, { name: 'export' },
  ].map(s => ({ ...s, status: 'pending', progress: 0 }));
}

// Stage sets for the other Phase-1 editor tools.
function mkStages(names) {
  return names.map(name => ({ name, status: 'pending', progress: 0 }));
}

// Returns the appropriate stage list for a given job mode.
function stagesForMode(mode) {
  switch (mode) {
    case 'edit': return defaultEditStages();
    case 'merge': return mkStages(['merge', 'export']);
    case 'extract-audio': return mkStages(['extract', 'export']);
    case 'subtitle': return mkStages(['extract', 'transcribe', 'export']);
    case 'denoise-audio': return mkStages(['clean', 'export']);
    default: return defaultStages();
  }
}

const JOB_MODES = ['enhance', 'edit', 'merge', 'extract-audio', 'subtitle', 'denoise-audio'];

module.exports = { VideoJobModel, schema, buildDefaultPipeline, defaultStages, defaultEditStages, stagesForMode, JOB_MODES };
