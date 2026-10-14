const config = require('./config');

function findRoute(path) {
  return config.routes.find((route) => {
    return path === route.prefix || path.startsWith(route.prefix + '/');
  });
}

async function proxy(req, res) {
  const path = req.originalUrl.split('?')[0];
  const route = findRoute(path);

  if (!route) {
    return res.status(404).json({ error: 'No route for ' + path });
  }

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

  try {
    const backendResponse = await fetch(route.target + req.originalUrl, options);
    const body = await backendResponse.text();

    res.status(backendResponse.status);
    res.set('content-type', backendResponse.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Backend service took too long to respond' });
    }
    console.log('Proxy error: ' + error.message);
    res.status(502).json({ error: 'Backend service is not reachable' });
  }
}

module.exports = proxy;
