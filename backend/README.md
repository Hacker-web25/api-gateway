# API Gateway Backend

A small API gateway built with Node.js, Express and Redis.

Every request from a client goes to the gateway first. The gateway checks the API key, counts how many requests that key has made using a Token Bucket stored in Redis, and only then forwards the request to the real backend service. A client that sends too many requests gets `429 Too Many Requests`.

If you are new to all of this, start with [docs/00-reading-order.md](docs/00-reading-order.md). It walks through the whole project in about 50 minutes.

## What is in this folder

```
sample-api/
  server.js          the "real" backend: products and orders (port 4000)
gateway/
  server.js          starts the gateway and sets the order of the checks (port 3000)
  config.js          port, API keys, routing table and defaults
  redis.js           the connection to Redis
  cors.js            lets a browser on another machine call the gateway
  auth.js            checks the x-api-key header
  rateLimiter.js     asks Redis whether the caller still has a token
  tokenBucket.lua    the Token Bucket itself, run inside Redis
  proxy.js           finds the right backend and forwards the request
  logger.js          records every request and keeps the counters
  admin.js           health, stats, logs, config, rate-limit info and reset
scripts/
  sender.js          sends requests with data to the gateway (for the second laptop)
tests/
  gateway.test.js    automated tests
docs/                guides, start with 00-reading-order.md
```

## What you need

- Node.js 20 or newer
- Redis running on the default port 6379

On a Mac:

```
brew install redis
brew services start redis
```

## Run it

Open three terminals in this folder.

```
npm install
```

Terminal 1, the sample API:

```
npm run api
```

Terminal 2, the gateway:

```
npm run gateway
```

Terminal 3, try it:

```
curl -H "x-api-key: demo-key-1" http://localhost:3000/api/products
```

Run the tests while the three services are running:

```
npm test
```

Send a series of requests with data, the way the second laptop does in the demo:

```
npm run sender -- http://localhost:3000 demo-key-1 8
```

The arguments are the gateway address, the API key and how many requests to send.

## Demo API keys

| Key | Client name |
| --- | --- |
| demo-key-1 | demo-client |
| demo-key-2 | second-client |

## Settings

All settings have defaults. Change one by putting it in front of the command, for example `WINDOW_SECONDS=10 npm run gateway`.

| Variable | Default | Meaning |
| --- | --- | --- |
| PORT | 3000 | Port of the gateway |
| API_PORT | 4000 | Port of the sample API |
| BACKEND_URL | http://127.0.0.1:4000 | Where the gateway forwards requests |
| REDIS_URL | redis://127.0.0.1:6379 | Where Redis is |
| WINDOW_SECONDS | 60 | A limit of N means N requests per this many seconds |

## Endpoints in short

Through the gateway, API key required, rate limited: `/api/products`, `/api/products/:id`, `/api/orders`

Gateway endpoints for the dashboard: `GET /health`, `GET /stats`, `GET /logs`, `GET /config`, `PUT /config`, `GET /rate-limit`, `POST /reset`

The full list with request and response examples is in [docs/05-api-reference.md](docs/05-api-reference.md).
