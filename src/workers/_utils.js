const BENCHMARK_WORK_MS = 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJobDurationMs(job) {
  if (job?.processedOn && job?.finishedOn) return job.finishedOn - job.processedOn;
  return null;
}

// retries overwrite processedOn
async function recordQueueWait(job) {
  if (!job?.data?.benchmarkId || job.data.startedAt) return null;
  const startedAt = Date.now();
  const submittedAt = Number(job.data.submittedAt);
  const queueWaitMs = Number.isFinite(submittedAt) ? startedAt - submittedAt : null;
  await job.update({ ...job.data, startedAt, queueWaitMs });
  return queueWaitMs;
}

async function performJobWork(job, normalSleepMs) {
  if (job?.data?.failOnce === true && (Number(job.attemptsMade) || 0) < 1) {
    throw new Error('injected benchmark failure');
  }
  const queueWaitMs = await recordQueueWait(job);
  const workMs = job?.data?.benchmarkId ? BENCHMARK_WORK_MS : normalSleepMs;
  await sleep(workMs);
  return queueWaitMs;
}

module.exports = {
  BENCHMARK_WORK_MS,
  sleep,
  getJobDurationMs,
  recordQueueWait,
  performJobWork,
};

