local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerSecond = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local saved = redis.call('HMGET', key, 'tokens', 'updatedAt')
local tokens = tonumber(saved[1])
local updatedAt = tonumber(saved[2])

if tokens == nil then
  tokens = capacity
  updatedAt = now
end

local secondsPassed = math.max(0, now - updatedAt) / 1000
tokens = math.min(capacity, tokens + secondsPassed * refillPerSecond)

local allowed = 0
local retryAfter = 0

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfter = math.ceil((cost - tokens) / refillPerSecond)
end

redis.call('HSET', key, 'tokens', tokens, 'updatedAt', now)
redis.call('EXPIRE', key, math.ceil(capacity / refillPerSecond) + 1)

return { allowed, math.floor(tokens), retryAfter }
