const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultJobOptions } = require('../src/config/bull');
const {
  validatePriority,
  validateEmailJob,
  validateReportJob,
  validateExportJob,
} = require('../src/jobs/validators');
const { BENCHMARK_WORK_MS, recordQueueWait, performJobWork } = require('../src/workers/_utils');

test('production retry defaults stay 3 attempts and 2000ms exponential', () => {
  assert.deepEqual(defaultJobOptions, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
});

test('priority must be an integer from 1 to 10', () => {
  assert.equal(validatePriority(1), 1);
  assert.equal(validatePriority(10), 10);
  for (const bad of [0, 11, -1, 1.5, 'high', null, undefined, 10.2]) {
    assert.throws(() => validatePriority(bad), (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.publicMessage, /priority/i);
      return true;
    });
  }
});

test('email, report, and export payloads are checked', () => {
  assert.deepEqual(
    validateEmailJob({ userId: 'u1', email: 'a@b.com', subject: 'hi', priority: 1 }),
    { userId: 'u1', email: 'a@b.com', subject: 'hi' }
  );
  assert.deepEqual(validateReportJob({ reportId: 'r1', type: 'monthly' }), {
    reportId: 'r1',
    type: 'monthly',
  });
  assert.deepEqual(validateExportJob({ tableId: 't1', format: 'csv' }), {
    tableId: 't1',
    format: 'csv',
  });

  assert.throws(() => validateEmailJob(null), (err) => err.statusCode === 400);
  assert.throws(() => validateEmailJob([]), (err) => err.statusCode === 400);
  assert.throws(() => validateEmailJob({}), (err) => err.statusCode === 400);
  assert.throws(
    () => validateEmailJob({ userId: 5, email: 'a@b.com', subject: 'hi' }),
    (err) => err.statusCode === 400 && /userId/.test(err.publicMessage)
  );
  assert.throws(
    () => validateEmailJob({ userId: 'u', email: '', subject: 'hi' }),
    (err) => err.statusCode === 400 && /email/.test(err.publicMessage)
  );
  assert.throws(
    () => validateReportJob({ reportId: 'r1' }),
    (err) => err.statusCode === 400 && /type/.test(err.publicMessage)
  );
  assert.throws(
    () => validateExportJob({ tableId: 't1' }),
    (err) => err.statusCode === 400 && /format/.test(err.publicMessage)
  );
});

test('benchmarkId is optional and has to be a non-empty string', () => {
  const tagged = validateEmailJob({
    userId: 'u1',
    email: 'a@b.com',
    subject: 'hi',
    benchmarkId: 'bench-1',
  });
  assert.equal(tagged.benchmarkId, 'bench-1');
  assert.throws(
    () => validateReportJob({ reportId: 'r', type: 't', benchmarkId: 5 }),
    (err) => err.statusCode === 400 && /benchmarkId/.test(err.publicMessage)
  );
  assert.throws(
    () => validateExportJob({ tableId: 't', format: 'csv', benchmarkId: '' }),
    (err) => err.statusCode === 400
  );
});

test('queue wait is worker start minus submit time, recorded once', async () => {
  const submittedAt = Date.now() - 40;
  const job = {
    data: { benchmarkId: 'b1', submittedAt, email: 'a@b.com' },
    async update(next) {
      this.data = next;
    },
  };

  const wait = await recordQueueWait(job);
  assert.ok(wait >= 40, `expected wait >= 40, got ${wait}`);
  assert.equal(job.data.queueWaitMs, wait);
  assert.equal(job.data.startedAt - submittedAt, wait);

  const startedAt = job.data.startedAt;
  assert.equal(await recordQueueWait(job), null);
  assert.equal(job.data.startedAt, startedAt);

  let updates = 0;
  const plain = {
    data: { email: 'a@b.com' },
    async update() {
      updates += 1;
    },
  };
  assert.equal(await recordQueueWait(plain), null);
  assert.equal(updates, 0);
});

test('failOnce is an optional boolean and is kept only when true', () => {
  assert.equal(BENCHMARK_WORK_MS, 10);
  const tagged = validateEmailJob({
    userId: 'u1',
    email: 'a@b.com',
    subject: 'hi',
    benchmarkId: 'bench-1',
    failOnce: true,
  });
  assert.equal(tagged.failOnce, true);
  assert.equal(tagged.benchmarkId, 'bench-1');

  const off = validateReportJob({ reportId: 'r1', type: 't', failOnce: false });
  assert.equal(off.failOnce, undefined);

  assert.throws(
    () => validateExportJob({ tableId: 't', format: 'csv', failOnce: 'yes' }),
    (err) => err.statusCode === 400 && /failOnce/.test(err.publicMessage)
  );
});

test('injected failures throw once, then benchmark jobs do 10ms of work', async () => {
  const job = {
    attemptsMade: 0,
    data: { failOnce: true, benchmarkId: 'b1', submittedAt: Date.now(), email: 'a@b.com' },
    async update(next) {
      this.data = next;
    },
  };

  await assert.rejects(() => performJobWork(job, 2000), /injected benchmark failure/);

  job.attemptsMade = 1;
  const started = Date.now();
  const wait = await performJobWork(job, 2000);
  const elapsed = Date.now() - started;
  assert.equal(typeof wait, 'number');
  assert.ok(elapsed < 500, `benchmark work took ${elapsed}ms, expected the 10ms path`);
});

test('jobs without benchmarkId still sleep the normal duration', async () => {
  const job = {
    attemptsMade: 0,
    data: { email: 'a@b.com' },
    async update() {
      throw new Error('plain jobs should not be rewritten');
    },
  };
  const started = Date.now();
  const wait = await performJobWork(job, 2000);
  const elapsed = Date.now() - started;
  assert.equal(wait, null);
  assert.ok(elapsed >= 1900 && elapsed < 3500, `normal sleep elapsed ${elapsed}ms`);
});
