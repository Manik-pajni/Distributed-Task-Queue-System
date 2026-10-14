const Redis = require('ioredis');
const { getRedisConfig } = require('./env');

function createRedisClient() {
  const { host, port, db } = getRedisConfig();
  return new Redis({
    host,
    port,
    db,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
  });
}

async function assertRedisConnectionOrExit() {
  const client = createRedisClient();
  try {
    await client.ping();
    await client.quit();
  } catch (err) {
    console.error('Redis unreachable. Exiting.', err?.message || err);
    try {
      client.disconnect();
    } catch (_) {
      // ignore
    }
    process.exit(1);
  }
}

module.exports = { createRedisClient, assertRedisConnectionOrExit };

