# Distributed Task Queue (Node + Bull + Redis)

This project is a distributed task queue system built with Express and Bull (backed by Redis).  
It exposes a simple REST API to enqueue jobs with priorities and provides a Bull Board dashboard to monitor queues.

## Tech stack

- Node.js
- Express
- Bull (Redis-backed job queue)
- Redis
- Bull Board (`@bull-board/express`, `@bull-board/api`)

## Run locally

1. Start Redis:

```bash
redis-server
```

2. Configure env:

```bash
cp .env.example .env
```

3. Install dependencies:

```bash
npm install
```

4. Start the API:

```bash
npm start
```

5. Start workers (in separate terminals):

```bash
npm run workers:email
npm run workers:report
npm run workers:export
```

- API base: `http://localhost:3000`
- Bull Board: `http://localhost:3000/admin/queues`

## API endpoints (with examples)

### POST `/jobs/email`

Enqueue an email job. `priority` is required (1 = highest, 10 = lowest).

```bash
curl -sS -X POST http://localhost:3000/jobs/email \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "u_123",
    "email": "user@example.com",
    "subject": "Welcome!",
    "priority": 1
  }'
```

### POST `/jobs/report`

```bash
curl -sS -X POST http://localhost:3000/jobs/report \
  -H "Content-Type: application/json" \
  -d '{
    "reportId": "r_456",
    "type": "monthly",
    "priority": 5
  }'
```

### POST `/jobs/export`

```bash
curl -sS -X POST http://localhost:3000/jobs/export \
  -H "Content-Type: application/json" \
  -d '{
    "tableId": "t_789",
    "format": "csv",
    "priority": 10
  }'
```

### GET `/jobs/:id/status`

Returns job status, progress, attempts, and failure reason (if any).

```bash
curl -sS http://localhost:3000/jobs/<JOB_ID>/status
```

### GET `/health`

Returns queue stats (waiting/active/completed/failed counts) for the 3 primary queues.

```bash
curl -sS http://localhost:3000/health
```

### GET `/jobs/failed`

Returns jobs that were moved to the dead-letter queue (`failedJobsQueue`) after exhausting retries.

```bash
curl -sS http://localhost:3000/jobs/failed
```

## Bull Board screenshot

![Bull Board screenshot placeholder](docs/bull-board-screenshot.png)

