function requiredEnv(name) {
  const val = process.env[name];
  if (!val) {
    const err = new Error(`Missing required env var: ${name}`);
    err.statusCode = 500;
    err.publicMessage = 'Server misconfigured';
    err.details = { missing: name };
    throw err;
  }
  return val;
}

function getRedisConfig() {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
  };
}

module.exports = { requiredEnv, getRedisConfig };

