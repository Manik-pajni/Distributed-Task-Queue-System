const { reportQueue, failedJobsQueue } = require('../queues');
const { JOB_TYPES } = require('../jobs/types');
const { sleep, getJobDurationMs } = require('./_utils');
const { assertRedisConnectionOrExit } = require('../config/redis');

function attachWorkerTelemetry(queue, jobType) {
  queue.on('failed', async (job, err) => {
    console.error(`[${jobType}] job failed`, { jobId: job?.id, error: err?.message || err });

    const maxAttempts = job?.opts?.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    if (attemptsMade >= maxAttempts) {
      await failedJobsQueue.add(
        'dead-letter',
        {
          originalQueue: queue.name,
          originalJobId: job?.id,
          jobType,
          data: job?.data,
          failedReason: err?.message || String(err),
        },
        { removeOnComplete: true }
      );
    }
  });

  queue.on('completed', (job) => {
    const durationMs = getJobDurationMs(job);
    console.log(`[${jobType}] job completed`, { jobId: job.id, durationMs });
  });
}

async function start() {
  await assertRedisConnectionOrExit();
  attachWorkerTelemetry(reportQueue, JOB_TYPES.REPORT);

  reportQueue.process(5, JOB_TYPES.REPORT, async (job) => {
    try {
      const { reportId } = job.data;
      await sleep(5000);
      console.log(`Report ${reportId} generated`);
      return { ok: true };
    } catch (err) {
      throw err;
    }
  });

  console.log('Report worker started');
}

start().catch((err) => {
  console.error('Report worker fatal error:', err);
  process.exit(1);
});

