const express = require('express');
const { emailQueue, reportQueue, exportQueue } = require('../queues');

const router = express.Router();

async function getCounts(queue) {
  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  return {
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    completed: counts.completed || 0,
    failed: counts.failed || 0,
    delayed: counts.delayed || 0,
  };
}

router.get('/health', async (req, res, next) => {
  try {
    const [email, report, exportQ] = await Promise.all([
      getCounts(emailQueue),
      getCounts(reportQueue),
      getCounts(exportQueue),
    ]);

    res.json({
      queues: {
        emailQueue: email,
        reportQueue: report,
        exportQueue: exportQ,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

