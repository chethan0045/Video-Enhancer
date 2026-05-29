/**
 * Queue module — tries BullMQ (Redis ≥5), falls back to in-memory EventEmitter.
 */

const EventEmitter = require('events');
const { VideoJob } = require('../models');

let queue = null;
let useBull = false;

try {
  const { Queue: BullQueue } = require('bullmq');
  const redis = require('ioredis');

  const testClient = new redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  });

  testClient.connect().then(async () => {
    const info = await testClient.info('server');
    const match = info.match(/redis_version:(\S+)/);
    const ver = match ? match[1] : '0.0.0';
    const major = parseInt(ver.split('.')[0], 10);
    if (major >= 5) {
      useBull = true;
      queue = new BullQueue('video-processing', {
        connection: { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379') },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      });
      console.log(`[Queue] BullMQ active (Redis ${ver})`);
    } else {
      console.warn(`[Queue] Redis ${ver} too old (need ≥5). Using in-memory queue.`);
    }
    testClient.disconnect();
  }).catch((err) => {
    console.warn(`[Queue] Redis unavailable (${err.message}). Using in-memory queue.`);
    testClient.disconnect();
  });
} catch (err) {
  console.warn(`[Queue] BullMQ unavailable. Using in-memory queue.`);
}

const memoryEmitter = new EventEmitter();
const memoryJobs = new Map();
const { processVideo, processEdit } = require('./processor');

exports.addJob = async (job) => {
  const jobId = job._id.toString();
  const mode = job.mode === 'edit' ? 'edit' : 'enhance';
  const run = mode === 'edit' ? processEdit : processVideo;

  // Process inline with the FFmpeg pipeline (hardware-accelerated, fast, runs on any GPU
  // and falls back to CPU). FFmpeg work happens in spawned child processes, so the API/
  // websocket event loop stays responsive. No separate worker process is required — this
  // is the same path the live server uses. BullMQ/Redis is optional and only enqueued when
  // a dedicated worker is explicitly enabled via USE_QUEUE_WORKER=true.
  if (process.env.USE_QUEUE_WORKER === 'true' && useBull && queue) {
    return queue.add('process-video', {
      jobId, userId: job.userId.toString(), inputPath: job.inputPath, pipeline: job.pipeline, mode,
    }, { jobId, priority: 1 });
  }

  memoryJobs.set(jobId, { jobId, inputPath: job.inputPath, pipeline: job.pipeline, mode });
  setImmediate(() => {
    run(jobId, job.inputPath, { pipeline: job.pipeline }).catch((err) => {
      console.error(`[Queue] Job ${jobId} failed:`, err.message);
      VideoJob.updateById(jobId, { $set: { status: 'failed', error: err.message } }).catch(() => {});
    });
  });
};

exports.getQueue = () => queue;

exports.getQueueStatus = async () => {
  if (useBull && queue) {
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(), queue.getActiveCount(),
      queue.getCompletedCount(), queue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }
  return { waiting: memoryJobs.size, active: 0, completed: 0, failed: 0 };
};

exports.onJob = (handler) => {
  memoryEmitter.on('job', handler);
};
