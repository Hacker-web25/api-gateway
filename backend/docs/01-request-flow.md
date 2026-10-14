# The path of a request

## What an API gateway is

Think of a reception desk in an office building. Visitors do not walk straight to the person they want to see. They stop at the desk first. The desk checks who they are, checks that they are not visiting too often, and then sends them to the right floor.

An API gateway is that desk for a backend. Every request goes to the gateway first. Only requests that pass its checks reach the real service.

Without a gateway, anyone can call the backend as often as they like. One broken script or one attacker can send thousands of requests a second and slow it down for everyone. The gateway protects the backend from that.

## The three programs

```
  Client                 Gateway                     Sample API
  (second laptop)        (port 3000)                 (port 4000)
 +--------------+      +----------------------+      +----------------+
 |              | ---> | 1. log               | ---> | products       |
 | sends        |      | 2. check API key     |      | orders         |
 | requests     | <--- | 3. check rate limit  | <--- |                |
 |              |      | 4. forward           |      +----------------+
 +--------------+      +----------+-----------+
                                  |
                                  v
                            +-----------+
                            |   Redis   |
                            | (port     |
                            |  6379)    |
                            +-----------+
```

- The client is whoever calls the gateway. In the demo it is the second laptop.
- The gateway is the Node.js program in the gateway folder.
- The sample API is a small backend in the sample-api folder. It only exists so the gateway has something to forward to.
- Redis remembers how many requests each client has made.

The sample API listens only on 127.0.0.1, which means only programs on the same machine can reach it. The gateway listens on 0.0.0.0, which means other machines can reach it. So the only way in from outside is through the gateway.

## One request, step by step

A client sends `GET /api/products` with the header `x-api-key: demo-key-1`.

| Step | File | What happens | If it fails |
| --- | --- | --- | --- |
| 1 | cors.js | Adds the headers that let a browser on another machine read the answer | none |
| 2 | logger.js | Starts a timer. After the answer is sent it records the request | none |
| 3 | auth.js | Checks the x-api-key header against the list in config.js | 401 Unauthorized |
| 4 | rateLimiter.js | Asks Redis for a token. Redis answers allowed or not | 429 Too Many Requests, or 503 if Redis is down |
| 5 | server.js | Reads the JSON body, if there is one | 400 Bad Request |
| 6 | proxy.js | Finds the backend in the routing table and forwards the request | 404 no route, 502 backend down, 504 backend too slow |
| 7 | logger.js | Saves the log entry and updates the counters in Redis | none |

The backend never sees a request that failed at step 3 or 4.

## Middleware

Each step above is a middleware. A middleware is a function that receives three things: the request, the response and a function called `next`.

Here is auth.js, the smallest one:

```js
function auth(req, res, next) {
  const apiKey = req.header('x-api-key');

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-api-key header' });
  }

  const client = config.apiKeys.find((item) => item.key === apiKey);
  if (!client) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  req.apiKey = client.key;
  req.clientName = client.name;
  next();
}
```

A middleware has exactly two choices:

- Call `next()`. The request moves on to the next middleware.
- Send a response. The request stops here and nothing after it runs.

Notice that auth.js saves `req.apiKey` and `req.clientName` on the request. Later middleware reads them. That is how one step hands information to the next.

## Why the order matters

In gateway/server.js the chain is written on one line:

```js
app.use('/api', logger, auth, rateLimiter, express.json(), proxy);
```

- logger comes first so that rejected requests are also recorded.
- auth comes before rateLimiter because the limit is counted per API key. We need to know who the caller is before we can count.
- rateLimiter comes before express.json() so that we do not spend time reading the body of a request we are about to refuse.
- proxy is last because it is the only step that talks to the backend.

Put auth after rateLimiter and the rate limiter would not know whose bucket to use. Put proxy before auth and anyone could reach the backend.

The dashboard endpoints (`/health`, `/stats` and so on) are not in this chain. They are registered separately in admin.js, so calling them does not use up tokens and does not show up in the logs.

## Status codes you will see

| Code | Meaning | Who sends it |
| --- | --- | --- |
| 200 | OK | The backend, passed through |
| 201 | Created, used when an order is placed | The backend, passed through |
| 400 | The request body is wrong | The gateway for broken JSON, the backend for wrong values |
| 401 | The API key is missing or wrong | The gateway |
| 404 | Nothing found | The gateway when no route matches, the backend when the item does not exist |
| 429 | Too many requests, wait and try again | The gateway |
| 502 | The backend could not be reached | The gateway |
| 503 | The gateway cannot reach Redis | The gateway |
| 504 | The backend took too long | The gateway |

## What "allowed" and "rejected" mean in the stats

- Rejected means the gateway refused the request itself: status 401 or 429.
- Allowed means the gateway let the request through. This includes requests where the backend then answered with an error, and requests that ended in 502, 503 or 504.
- Total is allowed plus rejected.

## What this design does not cover

- Requests with a wrong API key are refused cheaply but are not rate limited. Someone could keep sending bad keys. A production gateway would also limit by IP address.
- There is one gateway process. Running several is possible because the counts are in Redis, but the demo does not need it.
- API keys are written in config.js as plain text. A production system would store them hashed in a database.
