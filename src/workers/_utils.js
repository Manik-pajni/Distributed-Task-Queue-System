function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJobDurationMs(job) {
  if (job?.processedOn && job?.finishedOn) return job.finishedOn - job.processedOn;
  return null;
}

module.exports = { sleep, getJobDurationMs };

