const config = require('./config');

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

module.exports = auth;
