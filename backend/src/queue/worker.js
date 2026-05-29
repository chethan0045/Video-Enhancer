const { Worker } = require('bullmq');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { VideoJob } = require('../models');
const { onJob } = require('./index');
const { processEdit } = require('./processor');

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const processVideo = async ({ jobId, inputPath, pipeline, mode }) => {
  // Edit jobs (trim/crop) never touch the Python AI engine — handle them with the JS editor.
  if (mode === 'edit') {
    console.log(`[Worker] Editing job ${jobId}`);
    await processEdit(jobId, inputPath, { pipeline });
    return { success: true, jobId };
  }

  console.log(`[Worker] Processing job ${jobId}`);

  const pythonScript = path.join(__dirname, '..', '..', '..', 'python-engine', 'run_pipeline.py');
  const pythonPath = process.env.PYTHON_PATH || 'python';
  const outputDir = path.join(__dirname, '..', 'outputs', jobId);
  const framesDir = path.join(outputDir, 'frames');

  fs.mkdirSync(framesDir, { recursive: true });

  const args = [
    pythonScript,
    '--input', inputPath,
    '--output', outputDir,
    '--job-id', jobId,
    '--config', JSON.stringify(pipeline || {}),
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', async (data) => {
      stdout += data.toString();
      const lines = stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'progress') {
            await VideoJob.updateById(jobId, {
              $set: { progress: parsed.progress, status: parsed.status, [`pipelineStages.${parsed.stage}.status`]: parsed.stageStatus },
            });
          }
        } catch { }
      }
      stdout = '';
    });

    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', async (code) => {
      if (code === 0) {
        await VideoJob.updateById(jobId, {
          $set: { status: 'completed', progress: 100, completedAt: new Date(), outputPath: path.join(outputDir, 'output.mp4') },
        });
        resolve({ success: true, jobId });
      } else {
        await VideoJob.updateById(jobId, { $set: { status: 'failed', error: stderr.slice(0, 1000) } });
        reject(new Error(stderr));
      }
    });

    proc.on('error', (err) => reject(err));
  });
};

let worker = null;

try {
  worker = new Worker('video-processing', async (bullJob) => processVideo(bullJob.data), {
    connection: REDIS_CONFIG,
    concurrency: 1,
    limiter: { max: 1, duration: 1000 },
  });
  worker.on('completed', (bullJob) => console.log(`[Worker] Job ${bullJob.id} completed`));
  worker.on('failed', (bullJob, err) => console.error(`[Worker] Job ${bullJob.id} failed:`, err.message));
  console.log('[Worker] BullMQ worker started (Redis required for queue)');
} catch (err) {
  console.warn(`[Worker] BullMQ unavailable — processing will happen inline.`);
  onJob((data) => processVideo(data).catch((e) => console.error('[Worker] Job failed:', e.message)));
}
