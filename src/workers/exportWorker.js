const { exportQueue } = require('../queues');
const { JOB_TYPES } = require('../jobs/types');
const { performJobWork } = require('./_utils');
const { assertRedisConnectionOrExit } = require('../config/redis');
const { attachWorkerTelemetry } = require('./telemetry');

async function start() {
  await assertRedisConnectionOrExit();
  attachWorkerTelemetry(exportQueue, JOB_TYPES.EXPORT);

  exportQueue.process(JOB_TYPES.EXPORT, 5, async (job) => {
    try {
      const queueWaitMs = await performJobWork(job, 3000);
      const { tableId } = job.data;
      console.log(`Export for table ${tableId} completed`);
      if (queueWaitMs == null) return { ok: true };
      return { ok: true, queueWaitMs };
    } catch (err) {
      throw err;
    }
  }).catch((err) => {
    console.error('Export worker fatal error:', err);
    process.exit(1);
  });

  console.log('Export worker started');
}

start().catch((err) => {
  console.error('Export worker fatal error:', err);
  process.exit(1);
});

