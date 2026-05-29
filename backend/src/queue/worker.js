const { Worker } = require('bullmq');
const { VideoJob } = require('../models');
const { onJob } = require('./index');
const { processVideo: processEnhance, processEdit } = require('./processor');

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Both modes run through the FFmpeg pipeline (hardware-accelerated, fast, GPU-agnostic).
// This matches the inline path in queue/index.js so behaviour is identical whether or not
// a dedicated worker is used.
const processJob = async ({ jobId, inputPath, pipeline, mode }) => {
  const run = mode === 'edit' ? processEdit : processEnhance;
  console.log(`[Worker] ${mode === 'edit' ? 'Editing' : 'Enhancing'} job ${jobId}`);
  await run(jobId, inputPath, { pipeline });
  return { success: true, jobId };
};

let worker = null;

try {
  worker = new Worker('video-processing', async (bullJob) => processJob(bullJob.data), {
    connection: REDIS_CONFIG,
    concurrency: 1,
    limiter: { max: 1, duration: 1000 },
  });
  worker.on('completed', (bullJob) => console.log(`[Worker] Job ${bullJob.id} completed`));
  worker.on('failed', (bullJob, err) => console.error(`[Worker] Job ${bullJob.id} failed:`, err.message));
  console.log('[Worker] BullMQ worker started (Redis required for queue)');
} catch (err) {
  console.warn(`[Worker] BullMQ unavailable — processing will happen inline.`);
  onJob((data) => processJob(data).catch((e) => console.error('[Worker] Job failed:', e.message)));
}
