const Queue = require('bull');
const { getBullQueueOptions } = require('../config/bull');

const emailQueue = new Queue('emailQueue', getBullQueueOptions());
const reportQueue = new Queue('reportQueue', getBullQueueOptions());
const exportQueue = new Queue('exportQueue', getBullQueueOptions());
const failedJobsQueue = new Queue('failedJobsQueue', getBullQueueOptions());

module.exports = { emailQueue, reportQueue, exportQueue, failedJobsQueue };

