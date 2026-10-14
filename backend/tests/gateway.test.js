const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { createClient } = require('redis');

const gatewayUrl = process.env.GATEWAY_URL || 'http://127.0.0.1:3000';
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const keyOne = 'demo-key-1';
const keyTwo = 'demo-key-2';

const redis = createClient({ url: redisUrl });

async function call(method, path, key, body) {
  const headers = { 'content-type': 'application/json' };
  if (key) {
    headers['x-api-key'] = key;
  }

  const response = await fetch(gatewayUrl + path, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null
  };
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

before(async () => {
  try {
    await call('GET', '/health');
  } catch (error) {
    throw new Error('Gateway is not running at ' + gatewayUrl + '. Start Redis, the sample API and the gateway first.');
  }
  await redis.connect();
});

beforeEach(async () => {
  await call('PUT', '/config', keyOne, { limit: 5 });
  await call('POST', '/reset', keyOne);
});

after(async () => {
  await call('PUT', '/config', keyOne, { limit: 5 });
  await call('POST', '/reset', keyOne);
  await redis.quit();
});

describe('health', () => {
  it('reports the gateway and Redis as up', async () => {
    const response = await call('GET', '/health');
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body, { status: 'ok', redis: 'up' });
  });
});

describe('authentication', () => {
  it('rejects a request without an API key', async () => {
    const response = await call('GET', '/api/products');
    assert.strictEqual(response.status, 401);
  });

  it('rejects an unknown API key', async () => {
    const response = await call('GET', '/api/products', 'not-a-real-key');
    assert.strictEqual(response.status, 401);
  });

  it('rejects keys that are property names of plain objects', async () => {
    const response = await call('GET', '/api/products', 'constructor');
    assert.strictEqual(response.status, 401);
  });

  it('accepts a valid API key', async () => {
    const response = await call('GET', '/api/products', keyOne);
    assert.strictEqual(response.status, 200);
  });

  it('does not use up tokens on rejected keys', async () => {
    for (let i = 0; i < 10; i++) {
      await call('GET', '/api/products', 'not-a-real-key');
    }
    const response = await call('GET', '/api/products', keyOne);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-ratelimit-remaining'), '4');
  });
});

describe('routing', () => {
  it('forwards a list request to the sample API', async () => {
    const response = await call('GET', '/api/products', keyOne);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.length, 5);
  });

  it('forwards a request for a single item', async () => {
    const response = await call('GET', '/api/products/1', keyOne);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.name, 'Wireless Mouse');
  });

  it('passes the status code of the sample API back', async () => {
    const response = await call('GET', '/api/products/999', keyOne);
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, 'Product not found');
  });

  it('forwards the request body and tells the sample API who is calling', async () => {
    const response = await call('POST', '/api/orders', keyOne, { productId: 1, quantity: 2 });
    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.body.total, 1598);
    assert.strictEqual(response.body.placedBy, 'demo-client');
  });

  it('passes validation errors from the sample API back', async () => {
    const response = await call('POST', '/api/orders', keyOne, { productId: 99, quantity: 2 });
    assert.strictEqual(response.status, 400);
  });

  it('answers 404 when no route matches', async () => {
    const response = await call('GET', '/api/unknown', keyOne);
    assert.strictEqual(response.status, 404);
    assert.match(response.body.error, /No route/);
  });
});

describe('rate limiting', () => {
  it('allows requests up to the limit and then answers 429', async () => {
    await call('PUT', '/config', keyOne, { limit: 3 });

    const remaining = [];
    for (let i = 0; i < 3; i++) {
      const response = await call('GET', '/api/products', keyOne);
      assert.strictEqual(response.status, 200);
      remaining.push(response.headers.get('x-ratelimit-remaining'));
    }
    assert.deepStrictEqual(remaining, ['2', '1', '0']);

    const blocked = await call('GET', '/api/products', keyOne);
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.headers.get('x-ratelimit-limit'), '3');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.strictEqual(blocked.body.error, 'Too many requests');
  });

  it('keeps a separate bucket for each API key', async () => {
    await call('PUT', '/config', keyOne, { limit: 1 });
    await call('GET', '/api/products', keyOne);

    const first = await call('GET', '/api/products', keyOne);
    const second = await call('GET', '/api/products', keyTwo);
    assert.strictEqual(first.status, 429);
    assert.strictEqual(second.status, 200);
  });

  it('gives tokens back as time passes', async () => {
    await call('PUT', '/config', keyOne, { limit: 2 });
    await call('GET', '/api/products', keyOne);
    await call('GET', '/api/products', keyOne);

    const empty = await call('GET', '/api/products', keyOne);
    assert.strictEqual(empty.status, 429);

    const updatedAt = Number(await redis.hGet('bucket:' + keyOne, 'updatedAt'));
    await redis.hSet('bucket:' + keyOne, 'updatedAt', String(updatedAt - 31000));

    const refilled = await call('GET', '/api/products', keyOne);
    assert.strictEqual(refilled.status, 200);

    const emptyAgain = await call('GET', '/api/products', keyOne);
    assert.strictEqual(emptyAgain.status, 429);
  });

  it('never lets more than the limit through when requests arrive together', async () => {
    const responses = await Promise.all(
      Array.from({ length: 30 }, () => call('GET', '/api/products', keyOne))
    );
    const allowed = responses.filter((response) => response.status === 200);
    const blocked = responses.filter((response) => response.status === 429);
    assert.strictEqual(allowed.length, 5);
    assert.strictEqual(blocked.length, 25);
  });

  it('applies a new limit immediately', async () => {
    await call('PUT', '/config', keyOne, { limit: 1 });
    assert.strictEqual((await call('GET', '/api/products', keyOne)).status, 200);
    assert.strictEqual((await call('GET', '/api/products', keyOne)).status, 429);

    await call('PUT', '/config', keyOne, { limit: 3 });
    for (let i = 0; i < 3; i++) {
      assert.strictEqual((await call('GET', '/api/products', keyOne)).status, 200);
    }
    assert.strictEqual((await call('GET', '/api/products', keyOne)).status, 429);
  });
});

describe('rate limit information', () => {
  it('shows the tokens left without using one', async () => {
    await call('GET', '/api/products', keyOne);

    const first = await call('GET', '/rate-limit', keyOne);
    const second = await call('GET', '/rate-limit', keyOne);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.client, 'demo-client');
    assert.strictEqual(first.body.limit, 5);
    assert.strictEqual(first.body.remaining, 4);
    assert.strictEqual(second.body.remaining, 4);
  });

  it('needs an API key', async () => {
    const response = await call('GET', '/rate-limit');
    assert.strictEqual(response.status, 401);
  });
});

describe('stats and logs', () => {
  it('counts total, allowed and rejected requests', async () => {
    await call('PUT', '/config', keyOne, { limit: 2 });
    await call('GET', '/api/products', keyOne);
    await call('GET', '/api/products', keyOne);
    await call('GET', '/api/products', keyOne);
    await call('GET', '/api/products', 'not-a-real-key');
    await pause(100);

    const response = await call('GET', '/stats');
    assert.deepStrictEqual(response.body, { total: 4, allowed: 2, rejected: 2 });
  });

  it('lists the newest request first', async () => {
    await call('PUT', '/config', keyOne, { limit: 1 });
    await call('GET', '/api/products', keyOne);
    await call('GET', '/api/products/1', keyOne);
    await pause(100);

    const response = await call('GET', '/logs');
    assert.strictEqual(response.body.length, 2);
    assert.strictEqual(response.body[0].path, '/api/products/1');
    assert.strictEqual(response.body[0].status, 429);
    assert.strictEqual(response.body[0].client, 'demo-client');
    assert.strictEqual(response.body[1].status, 200);
  });

  it('does not log calls to the admin endpoints', async () => {
    await call('GET', '/stats');
    await call('GET', '/logs');
    await call('GET', '/health');
    await pause(100);

    const response = await call('GET', '/logs');
    assert.deepStrictEqual(response.body, []);
  });

  it('starts from zero after a reset', async () => {
    await call('GET', '/api/products', keyOne);
    await call('POST', '/reset', keyOne);

    const stats = await call('GET', '/stats');
    const logs = await call('GET', '/logs');
    assert.deepStrictEqual(stats.body, { total: 0, allowed: 0, rejected: 0 });
    assert.deepStrictEqual(logs.body, []);
  });
});

describe('config', () => {
  it('returns the current limit and window', async () => {
    const response = await call('GET', '/config');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.limit, 5);
    assert.strictEqual(typeof response.body.windowSeconds, 'number');
  });

  it('changes the limit', async () => {
    const response = await call('PUT', '/config', keyOne, { limit: 8 });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.limit, 8);

    const current = await call('GET', '/config');
    assert.strictEqual(current.body.limit, 8);
  });

  it('refuses limits that are not whole numbers from 1 to 100', async () => {
    for (const limit of [0, 101, 2.5, '5', null]) {
      const response = await call('PUT', '/config', keyOne, { limit: limit });
      assert.strictEqual(response.status, 400);
    }
  });

  it('needs an API key to change the limit', async () => {
    const response = await call('PUT', '/config', undefined, { limit: 3 });
    assert.strictEqual(response.status, 401);
  });
});

describe('cors', () => {
  it('answers the browser preflight request', async () => {
    const response = await fetch(gatewayUrl + '/api/products', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://192.168.1.10:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-api-key'
      }
    });
    assert.strictEqual(response.status, 204);
    assert.match(response.headers.get('access-control-allow-headers'), /x-api-key/);
  });

  it('adds the CORS headers to rejected requests too', async () => {
    const response = await call('GET', '/api/products');
    assert.strictEqual(response.status, 401);
    assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
  });
});
