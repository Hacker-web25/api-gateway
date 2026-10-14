const redis = require('./redis');
const config = require('./config');

function logger(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', async () => {
    const entry = {
      time: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      client: req.clientName || 'unknown',
      durationMs: Date.now() - startedAt
    };

    const wasRejected = res.statusCode === 401 || res.statusCode === 429;

    try {
      await redis
        .multi()
        .lPush('logs', JSON.stringify(entry))
        .lTrim('logs', 0, config.maxLogs - 1)
        .hIncrBy('stats', 'total', 1)
        .hIncrBy('stats', wasRejected ? 'rejected' : 'allowed', 1)
        .exec();
    } catch (error) {
      console.log('Could not write log: ' + error.message);
    }
  });

  next();
}

module.exports = logger;
