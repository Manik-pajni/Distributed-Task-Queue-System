const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

const { emailQueue, reportQueue, exportQueue, failedJobsQueue } = require('../queues');

function mountBullBoard(app) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullAdapter(emailQueue),
      new BullAdapter(reportQueue),
      new BullAdapter(exportQueue),
      new BullAdapter(failedJobsQueue),
    ],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());
}

module.exports = { mountBullBoard };

