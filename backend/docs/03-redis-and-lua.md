# Redis and the Lua script

This is the hardest part of the project. Read it slowly. The rest of the code is ordinary Express.

## What Redis is

Redis is a database that keeps its data in memory. It stores keys and values, and it answers in a fraction of a millisecond. That speed is what lets the gateway ask it a question on every single request.

Why not just keep the counts in a JavaScript variable inside the gateway?

- A variable is lost when the gateway restarts. Redis keeps the data.
- A variable lives inside one process. If you run two gateways, each would count separately and a client could use twice the limit. Both gateways can talk to the same Redis, so they share one count.
- The settings, logs and stats also need to survive a restart and be shared, so they live in Redis as well.

## The Redis commands used in this project

| Command | Meaning | Used in |
| --- | --- | --- |
| GET, SET | Read or write one value | rateLimiter.js, for the limit |
| DEL | Delete keys | rateLimiter.js and admin.js, to reset |
| HMGET, HSET | Read or write several fields of a hash. A hash is a small table stored under one key | tokenBucket.lua, for the bucket |
| EXPIRE | Delete a key automatically after some seconds | tokenBucket.lua |
| LPUSH, LTRIM, LRANGE | Add to the front of a list, cut a list to a length, read part of a list | logger.js and admin.js, for the logs |
| HINCRBY, HGETALL | Add to a number inside a hash, read a whole hash | logger.js and admin.js, for the stats |
| MULTI, EXEC | Run several commands together as one group | logger.js |
| PING | Ask Redis if it is alive | admin.js, for /health |
| EVAL | Run a Lua script | rateLimiter.js |

Every Redis command is also a method on the client in Node. For example `redis.get('config:limit')` sends GET, and `redis.hGetAll('stats')` sends HGETALL.

You can try the commands yourself. With Redis running, open `redis-cli` and type:

```
HGETALL bucket:demo-key-1
GET config:limit
LRANGE logs 0 4
HGETALL stats
TTL bucket:demo-key-1
```

Send a few requests through the gateway between commands and watch the values change.

## The problem: two requests at the same time

Imagine the rate limiter written the obvious way, using plain commands:

1. Read the tokens from Redis.
2. Work out the new value.
3. Write it back.

Now two requests arrive at the same moment, and the bucket has exactly 1 token left.

| Time | Request A | Request B |
| --- | --- | --- |
| 1 | reads tokens: 1 | |
| 2 | | reads tokens: 1 |
| 3 | writes tokens: 0, allowed | |
| 4 | | writes tokens: 0, allowed |

Both were allowed, but there was only one token. This is called a race condition. With a limit of 5 and 60 simultaneous requests, far more than 5 could slip through.

The fix is to make steps 1 to 3 impossible to interrupt.

## The solution: a Lua script

Redis can run a small program written in a language called Lua. Redis runs a script from start to end without handling any other command in between. For the same bucket, request B has to wait until request A's script has completely finished. So B reads 0 tokens and is refused.

The test `never lets more than the limit through when requests arrive together` in tests/gateway.test.js proves it by sending 30 requests at once with a limit of 5. Exactly 5 pass every time.

You only need to know four things about Lua to read the script:

- `local name = value` creates a variable.
- `if ... then ... else ... end` is a condition.
- `redis.call('COMMAND', ...)` runs a Redis command from inside the script.
- `{ a, b, c }` is a list.

## How Node calls the script

From gateway/rateLimiter.js:

```js
const result = await redis.eval(tokenBucketScript, {
  keys: ['bucket:' + apiKey],
  arguments: [String(limit), String(refillPerSecond), String(Date.now()), String(cost)]
});
```

The script text is read from tokenBucket.lua once, when the gateway starts. Each call passes two lists:

- `keys` are the Redis keys the script will touch. Inside the script they are `KEYS[1]`.
- `arguments` are plain values. Inside the script they are `ARGV[1]`, `ARGV[2]` and so on.

Lua lists start counting at 1, not 0.

The script sends back a list of three numbers, which Node reads as `result[0]`, `result[1]` and `result[2]`.

## The script, line by line

```lua
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerSecond = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
```

Give names to the inputs. Arguments arrive as text, so `tonumber` turns them into numbers.

- `capacity` is the limit, the size of the bucket.
- `refillPerSecond` is how many tokens drip in each second.
- `now` is the current time in milliseconds.
- `cost` is how many tokens this call takes. It is 1 for a real request and 0 for just looking.

```lua
local saved = redis.call('HMGET', key, 'tokens', 'updatedAt')
local tokens = tonumber(saved[1])
local updatedAt = tonumber(saved[2])
```

Read the two fields of the bucket. If the bucket does not exist yet, Redis returns nothing, and `tonumber` turns that into `nil`.

```lua
if tokens == nil then
  tokens = capacity
  updatedAt = now
end
```

A new client starts with a full bucket.

```lua
local secondsPassed = math.max(0, now - updatedAt) / 1000
tokens = math.min(capacity, tokens + secondsPassed * refillPerSecond)
```

The refill, as explained in docs/02-token-bucket.md. `math.max(0, ...)` protects against a clock that moved backwards, which would otherwise take tokens away. `math.min(capacity, ...)` stops the bucket from overflowing.

```lua
local allowed = 0
local retryAfter = 0

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfter = math.ceil((cost - tokens) / refillPerSecond)
end
```

The decision. If there are enough tokens, take them and mark the request as allowed. Otherwise work out how many seconds until there will be enough. `math.ceil` rounds up to whole seconds.

```lua
redis.call('HSET', key, 'tokens', tokens, 'updatedAt', now)
redis.call('EXPIRE', key, math.ceil(capacity / refillPerSecond) + 1)
```

Save the bucket and set it to expire after one window plus a second. The save happens even when the request is refused, because the refill that was calculated must not be lost.

```lua
return { allowed, math.floor(tokens), retryAfter }
```

Send back three numbers: 1 or 0 for allowed, the whole tokens left, and the seconds to wait. Redis cannot send back decimals from a script, so `math.floor` rounds the tokens down.

## Choices worth knowing about

**The time comes from Node.** The script receives `Date.now()` as an argument. This keeps the script simple and makes it easy to test. The alternative is to ask Redis for its own clock inside the script with `redis.call('TIME')`. That is better when several gateways run on different machines, because they would all use Redis's one clock. For one gateway the difference does not matter.

**EVAL sends the script every time.** Redis also has EVALSHA, which sends only a short fingerprint of a script it has already seen. That saves a little network traffic. It is an optimization, so this project uses the simpler EVAL.

**If Redis is down, requests are refused.** In gateway/rateLimiter.js the call to Redis is inside a try and catch. When Redis cannot be reached the gateway answers 503 and the request never reaches the backend. This is called failing closed: protection is kept and availability is lost. The opposite, failing open, would let every request through when Redis is down. That keeps the service running but removes the protection exactly when something is wrong. For a gateway whose job is protection, failing closed is the safer default. It is a decision, and either can be defended.

**Redis connection settings.** In gateway/redis.js the client is created with `disableOfflineQueue: true`. Without it, a command sent while Redis is down would wait quietly until Redis returned, and the client would hang instead of getting a 503. With it, the command fails immediately.

## Why the logger uses MULTI

In gateway/logger.js four commands run together:

```js
await redis
  .multi()
  .lPush('logs', JSON.stringify(entry))
  .lTrim('logs', 0, config.maxLogs - 1)
  .hIncrBy('stats', 'total', 1)
  .hIncrBy('stats', wasRejected ? 'rejected' : 'allowed', 1)
  .exec();
```

`multi()` collects the commands, and `exec()` sends them to Redis in one go. Redis runs them one after the other without anything in between. This costs one trip to Redis instead of four, and the log and the counters are always updated together. A request to `/stats` can never see the total updated but not the allowed count.

`lPush` adds the entry to the front of the list and `lTrim` cuts the list back to the last 50 entries, so the logs never grow without limit.

## Limits of this design

- The script protects one bucket. It is correct for any number of gateway processes sharing the same Redis.
- Bucket names contain the API key itself. A production system would store a hash of the key instead, so that anyone who can read Redis does not learn the keys.
- This project uses one Redis server. If that server were replaced by a cluster, all keys used by one script call would have to live on the same node. Here each call uses a single key, so that is already true.
