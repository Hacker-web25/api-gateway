const { createClient } = require('redis');
const config = require('./config');

const client = createClient({
  url: config.redisUrl,
  disableOfflineQueue: true
});

client.on('error', (error) => {
  console.log('Redis error: ' + error.message);
});

module.exports = client;
