# Distributed task queue

Express API plus Bull queues on Redis, with three workers: email, report, and export.

## Stack

- Node
- Express
- Bull
- Redis
- Bull Board
- ioredis
- dotenv

Tests use `node:test`.

## Run

Redis, if the container already exists:

```bash
docker start jobqueue-redis
```

One time, if that container is missing:

```bash
docker run -d --name jobqueue-redis -p 6379:6379 redis
```

`redis-server` works too if you have it installed. Don't run both on port 6379.

```bash
npm install
npm start
```

Workers, each in its own terminal:

```bash
npm run workers:email
npm run workers:report
npm run workers:export
```

`npm run dev` uses nodemon.

- API: http://localhost:3000
- Bull Board: http://localhost:3000/admin/queues

## Endpoints

`priority` is 1-10. 1 is highest. A POST returns `{ jobId, queue }`.

```bash
curl -sS -X POST http://localhost:3000/jobs/email \
  -H "Content-Type: application/json" \
  -d '{"userId":"u_123","email":"user@example.com","subject":"Welcome!","priority":1}'
```

- `POST /jobs/email` — userId, email, subject, priority
- `POST /jobs/report` — reportId, type, priority
- `POST /jobs/export` — tableId, format, priority
- `GET /jobs/:id/status` — state, progress, attempts, failed reason
- `GET /jobs/failed` — jobs copied to `failedJobsQueue`
- `GET /health` — waiting, active, completed, failed, delayed for the three queues

```bash
curl -sS http://localhost:3000/jobs/<JOB_ID>/status
curl -sS http://localhost:3000/jobs/failed
curl -sS http://localhost:3000/health
```

## Behavior

5 workers per queue. Retries 3 times with exponential backoff starting at 2000ms. After the last attempt the job is copied to `failedJobsQueue`.

Normal jobs sleep 2s (email), 5s (report), and 3s (export). Jobs with `benchmarkId` sleep 10ms.

## Tests

```bash
npm test
```

They use Redis db 15 and a `bull-test` prefix, and will not wipe db 0. Redis has to be up. The API and workers do not need to be running.

## Benchmark

Start Redis, the API, and all three workers first.

```bash
npm run benchmark
```

Default is 5000 jobs, HTTP concurrency 20. Flags: `--jobs`, `--concurrency`, `--timeout 0` (no deadline), `--out bench.json` (JSON only).

```bash
npm run benchmark -- --jobs 5000 --concurrency 20 --timeout 0 --out bench.json
```

Prints completed/failed/pending, end-to-end jobs/sec, p50/p95/p99 of `finishedOn - submittedAt`, and recovery of every 10th job, which fails once.
