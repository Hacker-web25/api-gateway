const fs = require('fs');
const path = require('path');
const redis = require('./redis');
const config = require('./config');

const tokenBucketScript = fs.readFileSync(path.join(__dirname, 'tokenBucket.lua'), 'utf8');

async function getLimit() {
  const saved = await redis.get('config:limit');
  if (saved === null) {
    return config.defaultLimit;
  }
  return Number(saved);
}

async function resetBuckets() {
  const bucketKeys = config.apiKeys.map((item) => 'bucket:' + item.key);
  await redis.del(bucketKeys);
}

async function setLimit(limit) {
  await redis.set('config:limit', String(limit));
  await resetBuckets();
}

async function useBucket(apiKey, cost) {
  const limit = await getLimit();
  const refillPerSecond = limit / config.windowSeconds;

  const result = await redis.eval(tokenBucketScript, {
    keys: ['bucket:' + apiKey],
    arguments: [String(limit), String(refillPerSecond), String(Date.now()), String(cost)]
  });

  return {
    limit: limit,
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfter: result[2]
  };
}

async function rateLimiter(req, res, next) {
  let result;

  try {
    result = await useBucket(req.apiKey, 1);
  } catch (error) {
    console.log('Rate limiter error: ' + error.message);
    return res.status(503).json({ error: 'Rate limiter is unavailable' });
  }

  res.set('X-RateLimit-Limit', String(result.limit));
  res.set('X-RateLimit-Remaining', String(result.remaining));

  if (!result.allowed) {
    res.set('Retry-After', String(result.retryAfter));
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: result.retryAfter
    });
  }

  next();
}

module.exports = { rateLimiter, getLimit, setLimit, resetBuckets, useBucket };
