const { VideoJob } = require('../models');
const { addJob } = require('../queue');

const { JOB_MODES } = require('../models/VideoJob');

exports.createJob = async (req, res) => {
  try {
    const title = req.body.title;
    let settings = {};
    try { settings = JSON.parse(req.body.settings || '{}'); } catch { }

    const mode = JOB_MODES.includes(req.body.mode) ? req.body.mode : 'enhance';

    // multer.fields → req.files = { video: [..], videos: [..] }
    const singleFile = req.files?.video?.[0];
    const multiFiles = req.files?.videos || [];

    let inputPath, inputPaths;
    if (mode === 'merge') {
      inputPaths = multiFiles.map(f => f.path);
      if (inputPaths.length < 2) return res.status(400).json({ error: 'Merge requires at least 2 videos' });
      inputPath = inputPaths[0]; // satisfies required field / used as the "before" reference
    } else {
      inputPath = singleFile ? singleFile.path : req.body.inputPath;
      if (!inputPath) return res.status(400).json({ error: 'No input video provided' });
      if (singleFile && !singleFile.mimetype.startsWith('video/')) {
        return res.status(400).json({ error: 'File must be a video' });
      }
    }

    const job = await VideoJob.create({
      userId: req.user.id,
      title: title || 'Untitled',
      mode,
      inputPath,
      inputPaths,
      inputSize: singleFile?.size,
      inputFormat: singleFile?.mimetype,
      pipeline: settings.pipeline || settings,
    });

    await addJob(job);
    res.status(201).json({ job });
  } catch (err) {
    console.error('[Jobs] Create error:', err);
    res.status(500).json({ error: 'Failed to create job: ' + err.message });
  }
};

exports.listJobs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const result = await VideoJob.findByUser(req.user.id, page, limit, status);
    res.json(result);
  } catch (err) {
    console.error('[Jobs] List error:', err);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
};

exports.getJob = async (req, res) => {
  try {
    const job = await VideoJob.findById(req.params.id);
    if (!job || job.userId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get job' });
  }
};

exports.cancelJob = async (req, res) => {
  try {
    const job = await VideoJob.findById(req.params.id);
    if (!job || job.userId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return res.status(400).json({ error: 'Job already finished' });
    }
    const updated = await VideoJob.updateById(req.params.id, { $set: { status: 'cancelled', progress: 0 } });
    res.json({ job: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel job' });
  }
};

exports.retryJob = async (req, res) => {
  try {
    const job = await VideoJob.findById(req.params.id);
    if (!job || job.userId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'failed') return res.status(400).json({ error: 'Job is not in failed state' });

    const { defaultStages, defaultEditStages } = require('../models/VideoJob');
    const stages = job.mode === 'edit' ? defaultEditStages() : defaultStages();
    const updated = await VideoJob.updateById(req.params.id, {
      $set: { status: 'queued', progress: 0, error: null, pipelineStages: stages },
    });

    if (updated) await addJob(updated);
    res.json({ job: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retry job' });
  }
};

exports.updatePipeline = async (req, res) => {
  try {
    const job = await VideoJob.findById(req.params.id);
    if (!job || job.userId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
    if (!['queued', 'processing'].includes(job.status)) {
      return res.status(400).json({ error: 'Can only update pipeline on queued/processing jobs' });
    }
    const pipeline = req.body.pipeline;
    if (!pipeline) return res.status(400).json({ error: 'Pipeline settings required' });
    const updated = await VideoJob.updateById(req.params.id, { $set: { pipeline } });
    res.json({ job: updated });
  } catch (err) {
    console.error('[Jobs] Update pipeline error:', err);
    res.status(500).json({ error: 'Failed to update pipeline' });
  }
};

exports.deleteJob = async (req, res) => {
  try {
    const job = await VideoJob.findById(req.params.id);
    if (!job || job.userId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
    await VideoJob.deleteById(req.params.id);
    res.json({ message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete job' });
  }
};
