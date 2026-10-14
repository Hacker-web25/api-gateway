# Proxying

## What a reverse proxy is

A proxy is a program that passes requests along on behalf of someone else. A reverse proxy does this for a server. The client talks to the proxy and believes it is talking to the real service. The proxy makes its own request to the real service, waits for the answer and hands it back.

That is the last job of the gateway, and it is all in gateway/proxy.js. There is no proxy library. The forwarding is done with `fetch`, which is built into Node.

## The routing table

A gateway usually sits in front of several backend services. The routing table says which service handles which path. It is in gateway/config.js:

```js
routes: [
  { prefix: '/api/products', target: backendUrl },
  { prefix: '/api/orders', target: backendUrl }
]
```

Both entries point to the same sample API here, but each could point to a different machine. Changing where orders go would mean changing one line, and the client would not notice.

Finding the route is a small function:

```js
function findRoute(path) {
  return config.routes.find((route) => {
    return path === route.prefix || path.startsWith(route.prefix + '/');
  });
}
```

A path matches when it is exactly the prefix, or when it starts with the prefix followed by a slash. So `/api/products` and `/api/products/3` match the products route, but `/api/productsabc` does not.

If nothing matches, the gateway answers 404 with `No route for ...` and never calls a backend.

## Forwarding the request

```js
const path = req.originalUrl.split('?')[0];
```

The gateway attaches the whole chain to `/api` with `app.use('/api', ...)`. Express removes `/api` from `req.url` inside that chain, which would give a confusing path. `req.originalUrl` is always the full address the client asked for, for example `/api/products?page=2`. Splitting on `?` removes the query string so only the path is compared with the routing table.

```js
const options = {
  method: req.method,
  headers: {
    'content-type': 'application/json',
    'x-client': req.clientName
  },
  signal: AbortSignal.timeout(config.backendTimeoutMs)
};

if (req.method !== 'GET' && req.method !== 'HEAD') {
  options.body = JSON.stringify(req.body);
}
```

- The method is copied as it is.
- The body is only added for methods that carry one. A GET request may not have a body.
- The body is written out again with `JSON.stringify` because `express.json()` has already read the original and turned it into an object on `req.body`. A request body can only be read once.
- Only JSON bodies are supported. That is enough for this project.

Then the request is sent to the backend and its answer is passed back:

```js
const backendResponse = await fetch(route.target + req.originalUrl, options);
const body = await backendResponse.text();

res.status(backendResponse.status);
res.set('content-type', backendResponse.headers.get('content-type') || 'application/json');
res.send(body);
```

The target address plus the original URL gives the full address, for example `http://127.0.0.1:4000/api/products?page=2`. The backend's status code, content type and body go back to the client unchanged. That is why a 404 or a 400 from the backend arrives at the client as a 404 or a 400.

## Telling the backend who is calling

The proxy adds a header the client never sent:

```js
'x-client': req.clientName
```

The gateway has already checked the API key and knows the client's name, so it tells the backend. The backend does not need to know about API keys at all. Look at the orders route in sample-api/server.js: it reads `x-client` and stores it as `placedBy`.

This only works because clients cannot reach the backend directly. The sample API listens on 127.0.0.1 so that only the gateway, running on the same machine, can call it. If a client could reach the backend, it could send a fake `x-client` header, skip the rate limit and ignore authentication. A gateway is only a protection if it is the only way in.

## When the backend fails

| What happened | Status | Why |
| --- | --- | --- |
| The backend is not running or refuses the connection | 502 Bad Gateway | `fetch` throws an error |
| The backend does not answer within 5 seconds | 504 Gateway Timeout | `AbortSignal.timeout` stops the wait and throws a `TimeoutError` |
| The backend answers with an error code | the same code | It is passed through, not treated as a failure |

```js
} catch (error) {
  if (error.name === 'TimeoutError') {
    return res.status(504).json({ error: 'Backend service took too long to respond' });
  }
  console.log('Proxy error: ' + error.message);
  res.status(502).json({ error: 'Backend service is not reachable' });
}
```

Without the timeout, one stuck backend call would hold a request open forever. The 5 seconds is `backendTimeoutMs` in gateway/config.js.

Try it: stop the sample API and call `/api/products` through the gateway. You get 502. Start it again and the next request works, with no restart of the gateway.

## Limits of this design

- Only the content type is forwarded to the backend. Other headers from the client are not. This is on purpose, and it keeps the API key from being passed to backend services.
- Only JSON bodies work. File uploads and other formats would need a different approach.
- There is no retry, no load balancing across several copies of a backend and no caching. Each of those is something real gateways add.
- The whole response is read into memory before it is sent back. That is fine for small JSON and not suitable for very large downloads.
