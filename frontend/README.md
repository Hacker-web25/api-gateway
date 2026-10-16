# Frontend

Two screens, one for each laptop. Both are plain HTML, CSS and JavaScript with no build step, no framework and no dependencies, so they open and run the same way the backend does.

| Folder | Runs on | What it is |
| --- | --- | --- |
| `client/` | Laptop A, the sender | Sends requests through the gateway and shows what came back |
| `dashboard/` | Laptop B, the gateway | Shows every request crossing the gateway, the token buckets and the log |

Each folder is self contained. Copy only the folder that laptop needs.

## Running them

`serve.js` is a small static file server written with Node's built in `http` and `fs` modules. It takes a folder name and a port.

On Laptop B, next to Redis, the sample API and the gateway:

```
npm run dashboard
```

Then open `http://localhost:5173`.

On Laptop A:

```
npm run client
```

Then open `http://localhost:5174`.

Both screens have a gateway address box in the top right. On Laptop B leave it at `http://127.0.0.1:3000`. On Laptop A set it to Laptop B's address on the network, for example `http://192.168.1.23:3000`, and press Connect. The address is remembered in the browser.

## How each screen talks to the gateway

Neither screen holds any state of its own. Everything on the screen is read from the gateway.

**Dashboard**

| Call | Used for |
| --- | --- |
| `GET /health` | The lamp in the header |
| `GET /stats` | The three counters |
| `GET /logs` | The log table, and the packets moving along the wire |
| `GET /config` | The limit and the window |
| `PUT /config` | The limit slider |
| `GET /rate-limit` | The token pips for each demo key |
| `POST /reset` | Clear counters |

The packets are not decoration. The dashboard polls `/logs`, works out which entries are new since the last poll, and sends one packet along the wire for each. A 401 stops at gate one, a 429 or 503 stops at gate two, a 502 or 504 stops at gate three, and anything else reaches the backend. Admin calls are not rate limited and are not written to the log, so the dashboard can poll without changing the numbers it is showing.

`GET /rate-limit` is used for the pips because it reads a bucket with a cost of zero. Looking at the tokens does not spend one.

**Client**

| Call | Used for |
| --- | --- |
| `GET /health` | The lamp in the header |
| `GET /rate-limit` | The allowance pips and the limit |
| `GET /api/products` or `POST /api/orders` | The send buttons |

The response panel reads `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `Retry-After` from the answer. The gateway lists those three in `Access-Control-Expose-Headers`, which is what allows a browser on another machine to read them.

Send 10 at once fires ten requests in the same moment with `Promise.all`. With a limit of 5 exactly five come back as 2xx every time. That is the Lua script doing its job.

## Things worth knowing

- The countdown between tokens is an estimate. The frontend restarts it each time the gateway reports one more token, so it is right going forward, but it cannot see the fraction of a token already in the bucket. The `Retry-After` number shown after a 429 comes from the gateway and is exact.
- Requests are sent with `cache: 'no-store'`. Without it a browser can answer from its own cache, or turn a repeat into a 304, and neither would reach the gateway.
- `a wrong key` on the client is there so a 401 can be shown without editing anything. A wrong key never reaches the rate limiter, so it has no bucket and spends no tokens.
- If the client cannot reach the gateway, check that both laptops are on the same network and that the address is Laptop B's network address rather than `localhost`.
