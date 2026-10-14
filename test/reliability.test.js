process.env.REDIS_DB = process.env.TEST_REDIS_DB || '15';
process.env.BULL_PREFIX = `bull-test-${process.pid}`;

if (Number(process.env.REDIS_DB) === 0) {
  throw new Error('refusing to run reliability tests on redis db 0');
}
if (!String(process.env.BULL_PREFIX).startsWith('bull-test-')) {
  throw new Error('refusing to run reliability tests without a bull-test prefix');
}

require('dotenv').config();

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

let emailQueue;
let reportQueue;
let exportQueue;
let failedJobsQueue;
let server;
let port;
const runs = new Map();

function redisUp(host, portNumber) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: portNumber });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(path, body) {
  const res = await fetch(`http://127.0.0.1:${port}/jobs/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function findDlq(originalId) {
  const jobs = await failedJobsQueue.getJobs(
    ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'],
    0,
    -1,
    false
  );
  return jobs.find((job) => String(job.data && job.data.originalJobId) === String(originalId));
}

describe('queue reliability', { concurrency: 1, timeout: 20000 }, () => {
  before(async () => {
    const host = process.env.REDIS_HOST || 'localhost';
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    const up = await redisUp(host, redisPort);
    if (!up) {
      throw new Error(
        `Redis is not running on ${host}:${redisPort}. Start it with redis-server, then npm test.`
      );
    }

    ({ emailQueue, reportQueue, exportQueue, failedJobsQueue } = require('../src/queues'));
    const { attachWorkerTelemetry } = require('../src/workers/telemetry');
    const { createApp } = require('../index');

    for (const queue of [emailQueue, reportQueue, exportQueue, failedJobsQueue]) {
      queue.on('error', () => {});
    }

    attachWorkerTelemetry(emailQueue, 'email');
    emailQueue.process('email', 5, async (job) => {
      const id = String(job.id);
      const stamps = runs.get(id) || [];
      stamps.push(Date.now());
      runs.set(id, stamps);
      if (job.data.mode === 'permanent') throw new Error('permanent failure');
      if (job.data.mode === 'flaky' && stamps.length < 3) throw new Error('temporary failure');
      return { ok: true };
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });

    const app = createApp();
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    port = server.address().port;
    await emailQueue.isReady();
    await sleep(50);
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    const queues = [emailQueue, reportQueue, exportQueue, failedJobsQueue].filter(Boolean);
    for (const queue of queues) {
      if (Number(process.env.REDIS_DB) === 0) throw new Error('refusing to wipe redis db 0');
      if (!String(process.env.BULL_PREFIX).startsWith('bull-test-')) {
        throw new Error('refusing to wipe a non-test prefix');
      }
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close().catch(() => {});
    }
  });

  it('processes a valid job and keeps the production retry options', async () => {
    const { status, json } = await post('email', {
      userId: 'u1',
      email: 'a@b.com',
      subject: 'hi',
      priority: 2,
    });
    assert.equal(status, 202);
    assert.equal(json.queue, 'emailQueue');

    const job = await emailQueue.getJob(json.jobId);
    assert.ok(job);
    assert.equal(job.opts.attempts, 3);
    assert.deepEqual(job.opts.backoff, { type: 'exponential', delay: 2000 });
    assert.equal(job.data.benchmarkId, undefined);
    assert.equal(job.data.submittedAt, undefined);

    await job.finished();
    const fresh = await emailQueue.getJob(job.id);
    assert.equal(await fresh.getState(), 'completed');
    assert.equal(fresh.returnvalue.ok, true);
    assert.equal(await findDlq(job.id), undefined);

    const statusRes = await fetch(`http://127.0.0.1:${port}/jobs/${job.id}/status`);
    assert.equal(statusRes.status, 200);
    const body = await statusRes.json();
    assert.equal(body.state, 'completed');
    assert.equal(body.queue, 'emailQueue');
  });

  it('stamps submittedAt only when a benchmarkId is sent', async () => {
    const before = Date.now();
    const { status, json } = await post('email', {
      userId: 'u-bench',
      email: 'b@b.com',
      subject: 'bench',
      priority: 4,
      benchmarkId: 'bench-api-1',
    });
    assert.equal(status, 202);
    const job = await emailQueue.getJob(json.jobId);
    assert.equal(job.data.benchmarkId, 'bench-api-1');
    assert.equal(typeof job.data.submittedAt, 'number');
    assert.ok(job.data.submittedAt >= before);
    assert.ok(job.data.submittedAt <= Date.now());
    await job.finished();
  });

  it('retries a temporary failure with exponential backoff, then succeeds', async () => {
    const job = await emailQueue.add(
      'email',
      { mode: 'flaky' },
      { priority: 5, attempts: 3, backoff: { type: 'exponential', delay: 100 } }
    );

    await job.finished();
    const stamps = runs.get(String(job.id));
    assert.equal(stamps.length, 3);

    const gap1 = stamps[1] - stamps[0];
    const gap2 = stamps[2] - stamps[1];
    assert.ok(gap1 >= 70 && gap1 < 800, `first gap ${gap1}`);
    assert.ok(gap2 >= 180 && gap2 < 1500, `second gap ${gap2}`);
    assert.ok(gap2 > gap1, `expected the second wait to grow, gaps ${gap1} then ${gap2}`);

    const fresh = await emailQueue.getJob(job.id);
    assert.equal(await fresh.getState(), 'completed');
    assert.equal(await findDlq(job.id), undefined);
  });

  it('moves a job that keeps failing onto the failed-jobs queue', async () => {
    const job = await emailQueue.add(
      'email',
      { mode: 'permanent', userId: 'doomed' },
      { priority: 5, attempts: 3, backoff: { type: 'exponential', delay: 40 } }
    );

    await assert.rejects(job.finished(), /permanent failure/);
    const fresh = await emailQueue.getJob(job.id);
    assert.equal(await fresh.getState(), 'failed');
    assert.equal(fresh.attemptsMade, 3);
    assert.equal(runs.get(String(job.id)).length, 3);

    let dlqJob = null;
    for (let i = 0; i < 40 && !dlqJob; i += 1) {
      dlqJob = await findDlq(job.id);
      if (!dlqJob) await sleep(50);
    }
    assert.ok(dlqJob, 'expected a DLQ record after the last attempt');
    assert.equal(dlqJob.data.originalQueue, emailQueue.name);
    assert.equal(dlqJob.data.jobType, 'email');
    assert.equal(dlqJob.data.failedReason, 'permanent failure');
    assert.equal(dlqJob.data.data.userId, 'doomed');

    const failedRes = await fetch(`http://127.0.0.1:${port}/jobs/failed`);
    assert.equal(failedRes.status, 200);
    const failedBody = await failedRes.json();
    assert.ok(failedBody.some((row) => String(row.data.originalJobId) === String(job.id)));

    const statusRes = await fetch(`http://127.0.0.1:${port}/jobs/${job.id}/status`);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.state, 'failed');
    assert.equal(statusBody.attemptsMade, 3);
  });
});
