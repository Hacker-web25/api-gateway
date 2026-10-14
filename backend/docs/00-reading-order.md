# Reading order

This is a 50 minute path through the project for someone who has never seen an API gateway. Follow the steps in order. Each step names what to read, how long it should take, and what you should be able to explain when you finish it.

Before you start, get the project running by following the README. Seeing it work first makes the code much easier to read.

| Step | Read | Minutes | You should be able to explain |
| --- | --- | --- | --- |
| 1 | docs/01-request-flow.md | 5 | What a gateway is and the path one request takes |
| 2 | sample-api/server.js | 5 | What the backend does and why it knows nothing about keys or limits |
| 3 | gateway/server.js, gateway/config.js, gateway/redis.js | 5 | How the gateway starts and why the order of the checks matters |
| 4 | gateway/auth.js | 3 | How an API key is checked and what 401 means |
| 5 | docs/02-token-bucket.md | 7 | The Token Bucket idea, with a worked example |
| 6 | gateway/rateLimiter.js, gateway/tokenBucket.lua, docs/03-redis-and-lua.md | 12 | How the count is kept in Redis and why a Lua script is needed |
| 7 | gateway/proxy.js, docs/04-proxying.md | 5 | How a request is forwarded and what 502 and 504 mean |
| 8 | gateway/logger.js, gateway/admin.js, gateway/cors.js | 5 | Where the stats, logs and settings come from |
| 9 | docs/06-testing-and-demo.md | 3 | How to test every behaviour and how the two laptop demo is set up |

Total: 50 minutes.

docs/05-api-reference.md is not part of the path. It is the list of endpoints for the person building the frontend, and it is useful whenever you need the exact request or response of an endpoint.

## Which file uses which

| File | Uses |
| --- | --- |
| server.js | config, redis, cors, admin, logger, auth, rateLimiter, proxy |
| admin.js | redis, config, auth, rateLimiter |
| rateLimiter.js | redis, config, tokenBucket.lua |
| logger.js | redis, config |
| auth.js | config |
| proxy.js | config |
| redis.js | config |
| cors.js | nothing |

Nothing uses server.js. Every other file does one job and can be read on its own.

## Three ideas to hold on to

1. A request passes through a chain of small functions. Each one either lets the request continue or answers it immediately. This is called middleware.
2. The gateway keeps no counters in its own memory. All counting lives in Redis.
3. Redis can run a small script as one uninterrupted step. That is what makes the counting correct when many requests arrive at the same moment.
