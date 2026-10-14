const { reportQueue } = require('../queues');
const { JOB_TYPES } = require('../jobs/types');
const { performJobWork } = require('./_utils');
const { assertRedisConnectionOrExit } = require('../config/redis');
const { attachWorkerTelemetry } = require('./telemetry');

async function start() {
  await assertRedisConnectionOrExit();
  attachWorkerTelemetry(reportQueue, JOB_TYPES.REPORT);

  reportQueue.process(JOB_TYPES.REPORT, 5, async (job) => {
    try {
      const queueWaitMs = await performJobWork(job, 5000);
      const { reportId } = job.data;
      console.log(`Report ${reportId} generated`);
      if (queueWaitMs == null) return { ok: true };
      return { ok: true, queueWaitMs };
    } catch (err) {
      throw err;
    }
  }).catch((err) => {
    console.error('Report worker fatal error:', err);
    process.exit(1);
  });

  console.log('Report worker started');
}

start().catch((err) => {
  console.error('Report worker fatal error:', err);
  process.exit(1);
});

