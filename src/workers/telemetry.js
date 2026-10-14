const { failedJobsQueue } = require('../queues');
const { getJobDurationMs } = require('./_utils');

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

module.exports = { attachWorkerTelemetry };
