const { emailQueue } = require('../queues');
const { JOB_TYPES } = require('../jobs/types');
const { performJobWork } = require('./_utils');
const { assertRedisConnectionOrExit } = require('../config/redis');
const { attachWorkerTelemetry } = require('./telemetry');

async function start() {
  await assertRedisConnectionOrExit();
  attachWorkerTelemetry(emailQueue, JOB_TYPES.EMAIL);

  // other order throws
  emailQueue.process(JOB_TYPES.EMAIL, 5, async (job) => {
    try {
      const queueWaitMs = await performJobWork(job, 2000);
      const { email } = job.data;
      console.log(`Email sent to ${email}`);
      if (queueWaitMs == null) return { ok: true };
      return { ok: true, queueWaitMs };
    } catch (err) {
      throw err;
    }
  }).catch((err) => {
    console.error('Email worker fatal error:', err);
    process.exit(1);
  });

  console.log('Email worker started');
}

start().catch((err) => {
  console.error('Email worker fatal error:', err);
  process.exit(1);
});

