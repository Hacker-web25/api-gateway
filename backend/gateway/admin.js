const express = require('express');
const redis = require('./redis');
const config = require('./config');
const auth = require('./auth');
const { getLimit, setLimit, resetBuckets, useBucket } = require('./rateLimiter');

const router = express.Router();

async function currentConfig() {
  return {
    limit: await getLimit(),
    windowSeconds: config.windowSeconds
  };
}

router.get('/health', async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'ok', redis: 'up' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', redis: 'down' });
  }
});

router.get('/stats', async (req, res) => {
  const stats = await redis.hGetAll('stats');
  res.json({
    total: Number(stats.total || 0),
    allowed: Number(stats.allowed || 0),
    rejected: Number(stats.rejected || 0)
  });
});

router.get('/logs', async (req, res) => {
  const entries = await redis.lRange('logs', 0, config.maxLogs - 1);
  res.json(entries.map((entry) => JSON.parse(entry)));
});

router.get('/config', async (req, res) => {
  res.json(await currentConfig());
});

router.put('/config', auth, express.json(), async (req, res) => {
  const limit = req.body && req.body.limit;

  if (!Number.isInteger(limit) || limit < 1 || limit > config.maxLimit) {
    return res.status(400).json({
      error: 'limit must be a whole number from 1 to ' + config.maxLimit
    });
  }

  await setLimit(limit);
  res.json(await currentConfig());
});

router.get('/rate-limit', auth, async (req, res) => {
  const bucket = await useBucket(req.apiKey, 0);
  res.json({
    client: req.clientName,
    limit: bucket.limit,
    windowSeconds: config.windowSeconds,
    remaining: bucket.remaining
  });
});

router.post('/reset', auth, async (req, res) => {
  await redis.del(['logs', 'stats']);
  await resetBuckets();
  res.json({ status: 'reset' });
});

module.exports = router;
