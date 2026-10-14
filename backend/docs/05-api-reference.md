# API reference

This is the list of everything the gateway answers, written for the person building the frontend. All bodies are JSON.

Base address: `http://<address of the gateway laptop>:3000`

Calls that need an API key send it in a header: `x-api-key: demo-key-1`

## Overview

| Method | Path | API key | Counts toward the limit | Purpose |
| --- | --- | --- | --- | --- |
| GET | /health | no | no | Is the gateway up, and can it reach Redis |
| GET | /stats | no | no | Total, allowed and rejected request counts |
| GET | /logs | no | no | The last 50 requests, newest first |
| GET | /config | no | no | The current limit |
| PUT | /config | yes | no | Change the limit |
| GET | /rate-limit | yes | no | Tokens left for the calling key |
| POST | /reset | yes | no | Clear the stats, logs and buckets |
| GET | /api/products | yes | yes | List products |
| GET | /api/products/:id | yes | yes | One product |
| POST | /api/orders | yes | yes | Place an order |
| GET | /api/orders | yes | yes | List orders |

Only the paths under `/api` are forwarded to the backend, rate limited and written to the logs and stats. The other paths belong to the gateway itself.

## Gateway endpoints

### GET /health

```
200  { "status": "ok", "redis": "up" }
503  { "status": "degraded", "redis": "down" }
```

Use this for the "Gateway online" badge. Any answer other than 200, or no answer at all, means offline.

### GET /stats

```
200  { "total": 11, "allowed": 1, "rejected": 10 }
```

- rejected is every request the gateway refused itself, which means status 401 and 429.
- allowed is every other request that reached the gateway under `/api`.
- total is allowed plus rejected.

### GET /logs

```
200  [
       {
         "time": "2026-10-14T13:44:35.517Z",
         "method": "GET",
         "path": "/api/products",
         "status": 429,
         "client": "demo-client",
         "durationMs": 1
       }
     ]
```

- The list has at most 50 entries, newest first.
- `status` is the status code the client received. The "429 Limited" label is simply `status === 429`.
- `client` is the name of the API key, or `unknown` when no valid key was sent.

### GET /config

```
200  { "limit": 5, "windowSeconds": 60 }
```

A limit of 5 means 5 requests per 60 seconds, sent in a burst if the client likes. This is the value behind the "Demo rate limit" slider.

### PUT /config

Request:

```
PUT /config
x-api-key: demo-key-1
content-type: application/json

{ "limit": 3 }
```

Answers:

```
200  { "limit": 3, "windowSeconds": 60 }
400  { "error": "limit must be a whole number from 1 to 100" }
401  { "error": "Missing x-api-key header" }
```

The change applies immediately. All buckets are refilled to the new size, so after moving the slider the next request starts from a full bucket. The limit is stored in Redis and is kept when the gateway restarts.

### GET /rate-limit

```
GET /rate-limit
x-api-key: demo-key-1

200  { "client": "demo-client", "limit": 5, "windowSeconds": 60, "remaining": 3 }
401  { "error": "Invalid API key" }
```

`remaining` is how many requests this key can send right now. Asking does not use a token.

### POST /reset

```
POST /reset
x-api-key: demo-key-1

200  { "status": "reset" }
```

Clears the logs, the stats and all buckets. The limit stays as it is. Use it between demo runs.

## Endpoints behind the gateway

Every call to a path under `/api` goes through the checks in this order: API key, rate limit, forward. Every answer except a 401 or a 503 carries these headers:

| Header | Meaning |
| --- | --- |
| X-RateLimit-Limit | The current limit |
| X-RateLimit-Remaining | Whole tokens left after this request |
| Retry-After | Only on 429. Seconds to wait before a token is available |

### GET /api/products

```
200  [ { "id": 1, "name": "Wireless Mouse", "price": 799, "stock": 120 }, ... ]
```

### GET /api/products/:id

```
200  { "id": 1, "name": "Wireless Mouse", "price": 799, "stock": 120 }
404  { "error": "Product not found" }
```

### POST /api/orders

Request:

```
POST /api/orders
x-api-key: demo-key-1
content-type: application/json

{ "productId": 2, "quantity": 3 }
```

Answers:

```
201  {
       "id": 1,
       "productId": 2,
       "quantity": 3,
       "total": 10497,
       "placedBy": "demo-client",
       "createdAt": "2026-10-14T13:45:03.161Z"
     }
400  { "error": "productId must be the id of an existing product" }
400  { "error": "quantity must be a whole number of at least 1" }
```

`placedBy` is filled in by the gateway. It comes from the API key, not from the body.

### GET /api/orders

```
200  [ { ...order }, { ...order } ]
```

Orders are kept in the sample API's memory and are lost when it restarts.

## Answers the gateway adds on any `/api` call

| Status | Body | When |
| --- | --- | --- |
| 401 | `{ "error": "Missing x-api-key header" }` | No key was sent |
| 401 | `{ "error": "Invalid API key" }` | The key is not in the list |
| 429 | `{ "error": "Too many requests", "retryAfter": 12 }` | The bucket is empty. The Retry-After header has the same number |
| 404 | `{ "error": "No route for /api/xyz" }` | The path is not in the routing table |
| 400 | `{ "error": "Unexpected token ..." }` | The body is not valid JSON |
| 502 | `{ "error": "Backend service is not reachable" }` | The sample API is down |
| 503 | `{ "error": "Rate limiter is unavailable" }` | The gateway cannot reach Redis |
| 504 | `{ "error": "Backend service took too long to respond" }` | The sample API did not answer in 5 seconds |

If Redis is down, `/stats` and `/logs` answer `500` with `{ "error": "Something went wrong" }`.

## CORS

The frontend runs in a browser on a different machine, so the browser applies CORS rules. The gateway handles them for every path:

- Any origin is allowed.
- Methods GET, POST, PUT and OPTIONS are allowed.
- The request headers `Content-Type` and `x-api-key` are allowed.
- The response headers `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `Retry-After` are exposed, so JavaScript can read them. Without that, the browser would hide them.

Sending `x-api-key` or a JSON body makes the browser send a preflight request first. The gateway answers it with 204 and no body.

## Suggested use by the frontend

1. On page load: `GET /health`, `GET /config`, `GET /stats`, `GET /logs`.
2. When the slider moves: `PUT /config` with the new limit.
3. When "Send demo request" is clicked: call the chosen endpoint with the API key. Read `status`, `X-RateLimit-Remaining` and `Retry-After` from the answer.
4. After every request: `GET /stats` and `GET /logs` to refresh the counters and the list. The gateway writes its log entry just after it sends the answer, so the refresh may need to wait a few tens of milliseconds to include the newest request.
5. To start over: `POST /reset`.

Demo keys: `demo-key-1` and `demo-key-2`. The two keys have separate buckets, which is a good thing to show.
