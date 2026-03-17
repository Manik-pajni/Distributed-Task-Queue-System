const { getRedisConfig } = require('./env');

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};

function getBullQueueOptions() {
  const { host, port } = getRedisConfig();
  return {
    redis: { host, port },
    defaultJobOptions,
  };
}

module.exports = { defaultJobOptions, getBullQueueOptions };

