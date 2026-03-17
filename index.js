const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const { assertRedisConnectionOrExit } = require('./src/config/redis');
const { mountBullBoard } = require('./src/config/bullBoard');
const jobsRouter = require('./src/routes/jobs');
const healthRouter = require('./src/routes/health');

async function main() {
  await assertRedisConnectionOrExit();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  mountBullBoard(app);

  app.use('/jobs', jobsRouter);
  app.use('/', healthRouter);

  // Centralized error handler keeps API failures consistent.
  // We avoid leaking internals while still returning actionable messages.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.statusCode || 500;
    res.status(status).json({
      error: err.publicMessage || 'Internal server error',
      details: err.details,
    });
  });

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
    console.log('Bull Board at http://localhost:%s/admin/queues', port);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

