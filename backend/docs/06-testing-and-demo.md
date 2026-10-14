# Testing and the demo

## Start everything

Three programs must be running. Use one terminal for each, all inside the backend folder.

1. Redis. On a Mac, `brew services start redis` starts it in the background. Check it with `redis-cli ping`, which should answer `PONG`.
2. The sample API: `npm run api`
3. The gateway: `npm run gateway`

If the gateway prints `Redis error: connect ECONNREFUSED`, Redis is not running.

## The automated tests

```
npm test
```

The tests are in tests/gateway.test.js. They use the test runner that comes with Node, so there is nothing extra to install. They send real requests to the running gateway and check the answers.

Be aware of two things:

- The tests need the three programs running. If the gateway is not reachable, the first thing printed is `Gateway is not running`.
- The tests reset the stats, logs and buckets before every test, and put the limit back to 5 at the end. Do not run them in the middle of a demo.

What they cover:

| Group | What is checked |
| --- | --- |
| health | The gateway reports itself and Redis as up |
| authentication | No key, wrong key and a tricky key such as `constructor` give 401. A valid key works. Rejected keys do not use up tokens |
| routing | List, single item and POST are forwarded. Backend status codes come back unchanged. The request body and the caller's name reach the backend. An unknown path gives 404 |
| rate limiting | Requests pass up to the limit, then 429 with the headers. Each key has its own bucket. Tokens come back as time passes. 30 simultaneous requests let exactly 5 through. A new limit applies immediately |
| rate limit information | `/rate-limit` shows the tokens left and does not use one |
| stats and logs | The counters match what was sent. Logs are newest first. Admin calls are not logged. Reset clears everything |
| config | The limit can be read and changed. Bad values give 400. A key is required |
| cors | The browser preflight is answered and rejected requests carry CORS headers |

The test called `gives tokens back as time passes` does not wait a real 30 seconds. It moves the `updatedAt` time in the bucket back by 31 seconds directly in Redis, then sends a request. This works because the bucket only knows time through that one number.

## Trying it by hand

Each check below uses curl. Run them with the gateway running.

Start clean:

```
curl -X POST -H "x-api-key: demo-key-1" http://localhost:3000/reset
```

A normal request, expecting 200:

```
curl -i -H "x-api-key: demo-key-1" http://localhost:3000/api/products
```

Look for `X-RateLimit-Limit: 5` and `X-RateLimit-Remaining: 4` in the headers.

No key, expecting 401:

```
curl -i http://localhost:3000/api/products
```

Wrong key, expecting 401:

```
curl -i -H "x-api-key: wrong" http://localhost:3000/api/products
```

An unknown path, expecting 404 from the gateway:

```
curl -i -H "x-api-key: demo-key-1" http://localhost:3000/api/unknown
```

An order with data, expecting 201:

```
curl -i -X POST -H "x-api-key: demo-key-1" -H "content-type: application/json" -d '{"productId":2,"quantity":3}' http://localhost:3000/api/orders
```

Hit the limit. Send the products request six times in a row. The first five answer 200 and the sixth answers 429 with a `Retry-After` header. Wait that many seconds and one request is allowed again. To see the limit work with the second key, repeat with `demo-key-2`. It is not affected.

Change the limit:

```
curl -X PUT -H "x-api-key: demo-key-1" -H "content-type: application/json" -d '{"limit":2}' http://localhost:3000/config
```

Now only two requests pass before the 429.

Read the numbers:

```
curl http://localhost:3000/stats
curl http://localhost:3000/logs
curl -H "x-api-key: demo-key-1" http://localhost:3000/rate-limit
```

### Failure checks

Backend down, expecting 502. Stop the sample API with Ctrl+C in its terminal, then:

```
curl -i -H "x-api-key: demo-key-1" http://localhost:3000/api/products
```

Start the sample API again and the same request works with no change to the gateway.

Redis down, expecting 503. Run `brew services stop redis`, then:

```
curl -i http://localhost:3000/health
curl -i -H "x-api-key: demo-key-1" http://localhost:3000/api/products
```

Both answer 503. Run `brew services start redis` and the gateway recovers by itself within a few seconds.

## The two laptop demo

Laptop B is the gateway. Laptop A is the sender.

### Set up Laptop B

1. Connect it to the same Wi-Fi network as Laptop A.
2. Start Redis, the sample API and the gateway as described at the top.
3. Find its address on the network. On a Mac connected by Wi-Fi: `ipconfig getifaddr en0`. It looks like `192.168.1.23`.
4. The first time the gateway runs, macOS may ask whether Node may accept incoming connections. Choose Allow. If it did not ask and Laptop A cannot connect, check System Settings, Network, Firewall.

### Check from Laptop A

```
curl http://192.168.1.23:3000/health
```

Use the address from step 3. The answer should be `{"status":"ok","redis":"up"}`. Do not move on until this works.

### Run the sender on Laptop A

Laptop A needs Node.js and this backend folder. The sender uses nothing that has to be installed, so `npm install` is not needed on Laptop A.

```
npm run sender -- http://192.168.1.23:3000 demo-key-1 8
```

Sample output with the limit at 5:

```
Sending 8 orders to http://192.168.1.23:3000
request 1  status 201  tokens left: 4
request 2  status 201  tokens left: 3
request 3  status 201  tokens left: 2
request 4  status 201  tokens left: 1
request 5  status 201  tokens left: 0
request 6  status 429  blocked, retry after 12s
request 7  status 429  blocked, retry after 12s
request 8  status 429  blocked, retry after 12s
```

The optional fourth argument is the pause between requests in milliseconds. The default is 300.

The frontend on Laptop A uses the same address as its base URL.

### A demo script

1. Show both laptops on the same network and the dashboard saying Gateway online.
2. Reset with `POST /reset` so the counters start at zero.
3. Set the limit to 5 with the slider.
4. Send requests from Laptop A one by one. Each answers 200 and Allowed goes up.
5. Keep sending past the limit. The answers become 429 and Rejected goes up on the dashboard.
6. Send one with a wrong key to show the 401.
7. Wait 12 seconds, send again, and show that one request is allowed. This is the bucket refilling.
8. Move the slider and show that the new limit applies at once.

### If something goes wrong

| Symptom | Likely cause |
| --- | --- |
| Laptop A gets no answer from `/health` | The laptops are on different networks, a firewall is blocking port 3000, or some guest Wi-Fi networks stop devices from talking to each other. A phone hotspot is a reliable fallback |
| It works with `localhost` on Laptop B but not from Laptop A | The address is wrong, or Laptop A is using `localhost`, which means Laptop A itself |
| 401 on every request | The `x-api-key` header is missing or has a typo |
| 502 on every request | The sample API is not running |
| 503 on every request | Redis is not running |
| `EADDRINUSE` when starting | Something already uses that port. Set another one, for example `PORT=3001 npm run gateway` |
| The browser blocks the call | Check the browser console. A CORS error usually means the address is wrong, since the gateway adds the CORS headers to every answer |
