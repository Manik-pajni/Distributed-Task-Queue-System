const { getRedisConfig } = require('./env');

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};

function getBullQueueOptions() {
  const { host, port, db } = getRedisConfig();
  const options = {
    redis: { host, port, db },
    defaultJobOptions,
  };
  if (process.env.BULL_PREFIX) options.prefix = process.env.BULL_PREFIX;
  return options;
}

module.exports = { defaultJobOptions, getBullQueueOptions };

