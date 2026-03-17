const { emailQueue, failedJobsQueue } = require('../queues');
const { JOB_TYPES } = require('../jobs/types');
const { sleep, getJobDurationMs } = require('./_utils');
const { assertRedisConnectionOrExit } = require('../config/redis');

function attachWorkerTelemetry(queue, jobType) {
  queue.on('failed', async (job, err) => {
    console.error(`[${jobType}] job failed`, { jobId: job?.id, error: err?.message || err });

    const maxAttempts = job?.opts?.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;

    // Only dead-letter after retries are exhausted to keep the DLQ meaningful.
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
  attachWorkerTelemetry(emailQueue, JOB_TYPES.EMAIL);

  emailQueue.process(5, JOB_TYPES.EMAIL, async (job) => {
    try {
      const { email } = job.data;
      await sleep(2000);
      console.log(`Email sent to ${email}`);
      return { ok: true };
    } catch (err) {
      // Throwing keeps Bull retry/backoff behavior intact.
      throw err;
    }
  });

  console.log('Email worker started');
}

start().catch((err) => {
  console.error('Email worker fatal error:', err);
  process.exit(1);
});

