const express = require('express');
const config = require('./config');
const redis = require('./redis');
const cors = require('./cors');
const admin = require('./admin');
const logger = require('./logger');
const auth = require('./auth');
const { rateLimiter } = require('./rateLimiter');
const proxy = require('./proxy');

const app = express();

app.use(cors);
app.use(admin);
app.use('/api', logger, auth, rateLimiter, express.json(), proxy);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  if (status === 500) {
    console.log('Server error: ' + error.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
  res.status(status).json({ error: error.message });
});

async function start() {
  await redis.connect();
  app.listen(config.port, '0.0.0.0', () => {
    console.log('Gateway running on port ' + config.port);
  });
}

start();
