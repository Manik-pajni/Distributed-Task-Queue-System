const express = require('express');
const { emailQueue, reportQueue, exportQueue, failedJobsQueue } = require('../queues');
const { JOB_TYPES } = require('../jobs/types');
const {
  validatePriority,
  validateEmailJob,
  validateReportJob,
  validateExportJob,
} = require('../jobs/validators');

const router = express.Router();

function toServerError(publicMessage, details) {
  const err = new Error(publicMessage);
  err.statusCode = 500;
  err.publicMessage = publicMessage;
  err.details = details;
  return err;
}

async function addJob(queue, type, data, priority) {
  try {
    const job = await queue.add(type, data, { priority });
    return job;
  } catch (err) {
    throw toServerError('Failed to enqueue job', { queue: queue.name, message: err?.message });
  }
}

router.post('/email', async (req, res, next) => {
  try {
    const priority = validatePriority(req.body?.priority);
    const data = validateEmailJob(req.body);
    const job = await addJob(emailQueue, JOB_TYPES.EMAIL, data, priority);
    res.status(202).json({ jobId: job.id, queue: emailQueue.name });
  } catch (err) {
    next(err);
  }
});

router.post('/report', async (req, res, next) => {
  try {
    const priority = validatePriority(req.body?.priority);
    const data = validateReportJob(req.body);
    const job = await addJob(reportQueue, JOB_TYPES.REPORT, data, priority);
    res.status(202).json({ jobId: job.id, queue: reportQueue.name });
  } catch (err) {
    next(err);
  }
});

router.post('/export', async (req, res, next) => {
  try {
    const priority = validatePriority(req.body?.priority);
    const data = validateExportJob(req.body);
    const job = await addJob(exportQueue, JOB_TYPES.EXPORT, data, priority);
    res.status(202).json({ jobId: job.id, queue: exportQueue.name });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/status', async (req, res, next) => {
  try {
    const id = req.params.id;
    const queues = [emailQueue, reportQueue, exportQueue, failedJobsQueue];

    let found = null;
    for (const q of queues) {
      // We probe multiple queues because job IDs are per-queue in Bull.
      // This keeps the API ergonomic for clients.
      // eslint-disable-next-line no-await-in-loop
      const job = await q.getJob(id);
      if (job) {
        found = { queue: q, job };
        break;
      }
    }

    if (!found) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const state = await found.job.getState();
    const progress = found.job.progress();

    res.json({
      id: String(found.job.id),
      queue: found.queue.name,
      state,
      progress,
      attemptsMade: found.job.attemptsMade,
      attempts: found.job.opts?.attempts,
      failedReason: found.job.failedReason || null,
      data: found.job.data,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/failed', async (req, res, next) => {
  try {
    const jobs = await failedJobsQueue.getJobs(
      ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'],
      0,
      -1,
      false
    );

    const withState = await Promise.all(
      jobs.map(async (j) => ({
        id: String(j.id),
        state: await j.getState(),
        attemptsMade: j.attemptsMade,
        data: j.data,
        failedReason: j.failedReason || null,
        timestamp: j.timestamp,
      }))
    );

    res.json(withState);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

