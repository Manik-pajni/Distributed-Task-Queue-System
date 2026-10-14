require('dotenv').config();

const fs = require('fs');
const { getRedisConfig } = require('../src/config/env');

const KINDS = [
  { path: 'email', queue: 'emailQueue', body: (id, i) => ({ userId: `${id}:${i}`, email: `bench${i}@example.com`, subject: 'benchmark', priority: 5, benchmarkId: id }) },
  { path: 'report', queue: 'reportQueue', body: (id, i) => ({ reportId: `${id}:${i}`, type: 'benchmark', priority: 5, benchmarkId: id }) },
  { path: 'export', queue: 'exportQueue', body: (id, i) => ({ tableId: `${id}:${i}`, format: 'csv', priority: 5, benchmarkId: id }) },
];

function readOpt(flag, envName) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] != null && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  if (process.env[envName] != null && process.env[envName] !== '') return process.env[envName];
  return null;
}

function readInt(flag, envName, fallback, min) {
  const raw = readOpt(flag, envName);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    console.error(`Bad value for ${flag}: ${raw}`);
    process.exit(1);
  }
  return n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function round2(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function roundMs(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function bucket(state) {
  if (state === 'completed' || state === 'failed' || state === 'missing') return state;
  return 'pending';
}

async function mapPool(items, limit, fn) {
  let next = 0;
  const workers = Math.min(limit, items.length);
  async function run() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      await fn(items[idx], idx);
    }
  }
  if (!workers) return;
  await Promise.all(Array.from({ length: workers }, () => run()));
}

async function pingRedis() {
  const Redis = require('ioredis');
  const cfg = getRedisConfig();
  const client = new Redis({
    host: cfg.host,
    port: cfg.port,
    db: cfg.db,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  try {
    await client.ping();
  } finally {
    client.disconnect();
  }
}

async function readJob(row, queues) {
  const queue = queues[row.queue];
  let job = await queue.getJob(row.jobId);
  if (!job) {
    row.state = 'missing';
    return;
  }
  let state = await job.getState();
  // finishedOn not on the hash yet
  if ((state === 'completed' || state === 'failed') && !Number.isFinite(Number(job.finishedOn))) {
    job = await queue.getJob(row.jobId);
    if (!job) {
      row.state = 'missing';
      return;
    }
    state = await job.getState();
    if ((state === 'completed' || state === 'failed') && !Number.isFinite(Number(job.finishedOn))) return;
  }
  row.state = state;
  row.attemptsMade = Number(job.attemptsMade) || 0;
  const submittedAt = Number(job.data && job.data.submittedAt);
  const finishedOn = Number(job.finishedOn);
  if (Number.isFinite(finishedOn)) row.finishedOn = finishedOn;
  if (state === 'completed' && Number.isFinite(submittedAt) && Number.isFinite(finishedOn)) {
    row.e2eMs = finishedOn - submittedAt;
  }
}

async function refresh(rows, queues) {
  const open = rows.filter((row) => bucket(row.state) === 'pending');
  const size = 50;
  for (let i = 0; i < open.length; i += size) {
    const slice = open.slice(i, i + size);
    await Promise.all(slice.map((row) => readJob(row, queues).catch((err) => {
      row.confirmError = err.message;
    })));
  }
}

function runMs(rows, wallStart, waitedMs, timedOut) {
  if (timedOut || !rows.length) return waitedMs;
  let last = 0;
  for (const row of rows) {
    if (row.state !== 'completed' && row.state !== 'failed') return waitedMs;
    if (!Number.isFinite(row.finishedOn)) return waitedMs;
    if (row.finishedOn > last) last = row.finishedOn;
  }
  const span = last - wallStart;
  if (!Number.isFinite(span) || span <= 0) return waitedMs;
  return span;
}

function isRecovered(row) {
  return Boolean(row.injected) && row.state === 'completed' && row.attemptsMade >= 1;
}

function summarize({ benchmarkId, url, jobs, concurrency, rows, submitFailed, submitDurationMs, totalTimeMs, wallStart, timedOut }) {
  const counts = { completed: 0, failed: 0, pending: 0, missing: 0 };
  const byQueue = {};
  let recovered = 0;
  let injected = 0;
  let injectedFailed = 0;
  let injectedPending = 0;
  let injectedMissing = 0;

  for (const row of rows) {
    if (!byQueue[row.queue]) {
      byQueue[row.queue] = {
        submitted: 0, completed: 0, failed: 0, pending: 0, missing: 0, injected: 0, recovered: 0,
      };
    }
    const q = byQueue[row.queue];
    q.submitted += 1;
    const name = bucket(row.state);
    counts[name] += 1;
    q[name] += 1;
    if (!row.injected) continue;
    injected += 1;
    q.injected += 1;
    if (isRecovered(row)) {
      recovered += 1;
      q.recovered += 1;
    } else if (row.state === 'failed') injectedFailed += 1;
    else if (row.state === 'missing') injectedMissing += 1;
    else if (bucket(row.state) === 'pending') injectedPending += 1;
  }

  const e2e = rows
    .filter((row) => row.state === 'completed' && Number.isFinite(row.e2eMs))
    .map((row) => row.e2eMs)
    .sort((a, b) => a - b);
  const measured = runMs(rows, wallStart, totalTimeMs, timedOut);

  return {
    benchmarkId,
    url,
    jobsRequested: jobs,
    concurrency,
    submitted: rows.length,
    submitFailed,
    submitDurationMs,
    completed: counts.completed,
    failed: counts.failed,
    pending: counts.pending,
    missing: counts.missing,
    accounted: counts.completed + counts.failed + counts.pending + counts.missing,
    completedPerSec: measured > 0 ? round2(counts.completed / (measured / 1000)) : null,
    totalTimeMs: measured,
    waitedMs: totalTimeMs,
    timedOut,
    e2eMs: {
      p50: roundMs(percentile(e2e, 50)),
      p95: roundMs(percentile(e2e, 95)),
      p99: roundMs(percentile(e2e, 99)),
      samples: e2e.length,
    },
    injected,
    recovered,
    recoveryPercent: injected ? round2((recovered / injected) * 100) : null,
    injectedFailed,
    injectedPending,
    injectedMissing,
    byQueue,
  };
}

function printSummary(s) {
  const e = s.e2eMs;
  const e2eText = e.samples ? `p50=${e.p50} p95=${e.p95} p99=${e.p99} (n=${e.samples})` : 'n/a';
  const endLabel = s.totalTimeMs === s.waitedMs
    ? 'from submit start until waiting stopped'
    : 'from submit start to last finishedOn';

  console.log('');
  console.log(`${s.benchmarkId}  ${s.url}`);
  console.log(`HTTP concurrency ${s.concurrency} (workers stay at 5)`);
  console.log(`submitted ${s.submitted}/${s.jobsRequested} in ${s.submitDurationMs}ms, submit errors ${s.submitFailed}`);
  console.log(`completed ${s.completed}, failed ${s.failed}, pending ${s.pending}, missing ${s.missing}`);
  console.log(`${s.completedPerSec} jobs/s (${s.completed} completed / ${s.totalTimeMs}ms ${endLabel})`);
  if (s.timedOut) console.log('timed out; pending was not counted as completed');
  console.log(`enqueue-to-completion ms: ${e2eText}`);
  console.log(
    `injected ${s.injected}, recovered ${s.recovered} (${s.recoveryPercent}%), ` +
    `failed ${s.injectedFailed}, pending ${s.injectedPending}, missing ${s.injectedMissing}`
  );
  for (const name of Object.keys(s.byQueue).sort()) {
    const q = s.byQueue[name];
    console.log(
      `  ${name}: submitted ${q.submitted}, completed ${q.completed}, failed ${q.failed}, ` +
      `pending ${q.pending}, missing ${q.missing}, injected ${q.injected}, recovered ${q.recovered}`
    );
  }
  console.log('');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(
      'node scripts/benchmark.js [--jobs 5000] [--concurrency 20] [--timeout 0] [--url http://localhost:3000] [--out summary.json]'
    );
    return;
  }

  const jobs = readInt('--jobs', 'BENCH_JOBS', 5000, 1);
  const concurrency = readInt('--concurrency', 'BENCH_CONCURRENCY', 20, 1);
  const url = (readOpt('--url', 'BENCH_URL') || 'http://localhost:3000').replace(/\/$/, '');
  const outPath = readOpt('--out', 'BENCH_OUT');
  const timeoutOpt = readOpt('--timeout', 'BENCH_TIMEOUT_MS');
  const timeoutMs = timeoutOpt == null ? 600000 + jobs * 30 : Number(timeoutOpt);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    console.error(`Bad timeout: ${timeoutOpt}`);
    process.exit(1);
  }

  const redisConfig = getRedisConfig();
  if (redisConfig.db !== 0) {
    console.error(`Refusing to load-test Redis db ${redisConfig.db}. This run uses db 0.`);
    process.exit(1);
  }
  if (process.env.BULL_PREFIX) {
    console.error(`Refusing to load-test with BULL_PREFIX=${process.env.BULL_PREFIX}.`);
    process.exit(1);
  }

  const benchmarkId = `bench-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const planned = [];
  for (let i = 0; i < jobs; i += 1) {
    const kind = KINDS[i % KINDS.length];
    const body = kind.body(benchmarkId, i);
    const injected = i % 10 === 0;
    if (injected) body.failOnce = true;
    planned.push({ path: kind.path, queue: kind.queue, body, injected });
  }

  try {
    await pingRedis();
  } catch (err) {
    console.error('Redis is not reachable. Start the existing container: docker start jobqueue-redis');
    console.error(err.message);
    process.exit(1);
  }

  const { emailQueue, reportQueue, exportQueue } = require('../src/queues');
  const queues = { emailQueue, reportQueue, exportQueue };
  const rows = [];

  try {
    await Promise.all(Object.values(queues).map((queue) => queue.isReady()));

    const wallStart = Date.now();
    let submitFailed = 0;
    await mapPool(planned, concurrency, async (item) => {
      try {
        const res = await fetch(`${url}/jobs/${item.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(item.body),
          signal: AbortSignal.timeout(15000),
        });
        const json = await res.json().catch(() => ({}));
        if (res.status !== 202 || json.jobId == null) {
          submitFailed += 1;
          return;
        }
        rows.push({
          queue: json.queue || item.queue,
          jobId: String(json.jobId),
          state: 'submitted',
          injected: Boolean(item.injected),
          attemptsMade: 0,
        });
      } catch (err) {
        submitFailed += 1;
        if (submitFailed === 1) console.error(`Submit error: ${err.message}`);
      }
    });

    const submitDurationMs = Date.now() - wallStart;
    console.log(`Submitted ${rows.length}/${jobs} (errors ${submitFailed}) in ${submitDurationMs}ms. Waiting for workers...`);

    const deadline = timeoutMs === 0 ? Infinity : Date.now() + timeoutMs;
    let timedOut = false;
    if (rows.length) {
      while (true) {
        await refresh(rows, queues);
        const pending = rows.filter((row) => bucket(row.state) === 'pending').length;
        if (pending === 0) break;
        if (Date.now() >= deadline) {
          timedOut = true;
          break;
        }
        console.log(`... ${rows.length - pending}/${rows.length}`);
        await sleep(1000);
      }
    }

    const summary = summarize({
      benchmarkId,
      url,
      jobs,
      concurrency,
      rows,
      submitFailed,
      submitDurationMs,
      totalTimeMs: Date.now() - wallStart,
      wallStart,
      timedOut,
    });
    printSummary(summary);

    if (outPath) {
      fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
      console.log(`Wrote ${outPath}`);
    }

    if (
      summary.pending > 0 ||
      summary.missing > 0 ||
      summary.submitted !== jobs ||
      summary.accounted !== summary.submitted
    ) {
      process.exitCode = 1;
    }
  } finally {
    // close() stalls
    await Promise.race([
      Promise.all(Object.values(queues).map((queue) => queue.close(true).catch(() => {}))),
      sleep(1000),
    ]);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode || 0);
  });
