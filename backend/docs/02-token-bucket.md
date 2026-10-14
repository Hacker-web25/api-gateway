# The Token Bucket

## The idea

Every API key has a bucket. The bucket holds tokens.

- Every request takes one token out of the bucket.
- Tokens drip back into the bucket at a steady speed.
- The bucket can only hold so many tokens. When it is full, extra tokens are thrown away.
- If a request arrives and the bucket is empty, the request is refused with 429.

This gives two behaviours at once. A client that has been quiet has a full bucket and can send a quick burst. A client that keeps sending runs out of tokens and is slowed down to the speed of the drip.

## How the limit maps to a bucket here

The slider on the dashboard sets a number called the limit. In this project a limit of N means N requests per window, where the window is 60 seconds.

- The bucket holds N tokens. This is the capacity.
- N tokens come back every 60 seconds. This is the refill rate, N divided by 60 tokens per second.

| Limit | Burst allowed | One token comes back every |
| --- | --- | --- |
| 1 | 1 request | 60 seconds |
| 5 | 5 requests | 12 seconds |
| 10 | 10 requests | 6 seconds |

This matches what the dashboard shows when the limit is 1 and 11 requests are sent quickly: 1 allowed and 10 rejected.

## A worked example

Limit 3. The bucket holds 3 tokens and gains one token every 20 seconds, which is 0.05 tokens per second.

| Time | What happens | Tokens before | Tokens after | Result |
| --- | --- | --- | --- | --- |
| 0 s | First request. The bucket is created full | 3 | 2 | 200 |
| 1 s | Request | 2.05 | 1.05 | 200 |
| 2 s | Request | 1.10 | 0.10 | 200 |
| 3 s | Request | 0.15 | 0.15 | 429, retry after 17 s |
| 23 s | Request | 1.15 | 0.15 | 200 |

Look at the 1 s row. One second passed since the last request, so 0.05 tokens dripped in before the request took one.

At 3 s the bucket has 0.15 tokens. A request needs a whole token, so it is refused. The gateway tells the client how long to wait: it needs 0.85 more tokens, and tokens arrive at 0.05 per second, so 0.85 divided by 0.05 is 17 seconds. That number goes into the `Retry-After` header.

## There is no timer

You might expect a timer that adds a token every few seconds. There is none. A timer would have to run for every key all the time.

Instead, the refill is calculated when a request arrives, using the time that has passed since the last request:

```
secondsPassed = (now - updatedAt) / 1000
tokens = min(capacity, tokens + secondsPassed * refillPerSecond)
```

If the key has not been seen for a long time, `secondsPassed` is large, the sum goes above the capacity, and `min` cuts it back to a full bucket.

After that comes the actual decision:

```
if tokens >= 1:
    tokens = tokens - 1
    allowed
else:
    refused, retryAfter = (1 - tokens) / refillPerSecond, rounded up
```

Finally the new `tokens` and `updatedAt` are saved. The same steps appear in gateway/tokenBucket.lua.

## What is stored in Redis

One hash per API key, named `bucket:` followed by the key.

```
bucket:demo-key-1
  tokens      2.35
  updatedAt   1760449800000
```

- `tokens` is the number of tokens left, as a decimal.
- `updatedAt` is the time of the last calculation in milliseconds.

The hash expires after one window plus one second. After that long without a request the bucket would be full anyway, so deleting it changes nothing and keeps Redis clean.

## Why Token Bucket and not something simpler

| Algorithm | How it works | Problem |
| --- | --- | --- |
| Fixed window | Count requests in each clock minute. Reset the count at the start of every minute | A client can send N requests at 0:59 and N more at 1:01. That is 2N requests in two seconds |
| Sliding window | Count requests in the last 60 seconds, measured back from now | Needs to remember the time of every request, which uses more memory |
| Token bucket | The bucket described above | Slightly harder to explain, which is what this document is for |

Token bucket stores only two numbers per client, allows a controlled burst, and has no boundary trick.

## The limit is shared and changes reset the buckets

- The limit is one number for the whole gateway, not one per key. It lives in Redis under `config:limit`, so it survives a restart of the gateway.
- When the limit is changed through `PUT /config`, all buckets are deleted. The next request from each key starts with a full bucket of the new size. Without this, raising the limit from 1 to 10 on the slider would not feel like anything happened, because the old bucket would still be nearly empty.

## Checking a bucket without using a token

The script takes a fourth input called `cost`. A real request has cost 1. The endpoint `GET /rate-limit` calls the same script with cost 0. A cost of 0 refills the bucket, finds that there are always enough tokens, takes nothing out, and returns how many are left. That avoids writing the same maths a second time.

## Limits of this design

- The number of tokens left is shown rounded down. A bucket with 2.9 tokens shows 2.
- The refill time in `Retry-After` is rounded up to whole seconds, so the client may wait up to a second longer than strictly needed.
- The time comes from the gateway's clock, not Redis's. With one gateway this is fine. With several gateways on different machines, small clock differences could appear. Redis has a `TIME` command that avoids this. See docs/03-redis-and-lua.md.
