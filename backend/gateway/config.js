const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:4000';

module.exports = {
  port: Number(process.env.PORT) || 3000,
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  windowSeconds: Number(process.env.WINDOW_SECONDS) || 60,
  defaultLimit: 5,
  maxLimit: 100,
  maxLogs: 50,
  backendTimeoutMs: 5000,
  apiKeys: [
    { key: 'demo-key-1', name: 'demo-client' },
    { key: 'demo-key-2', name: 'second-client' }
  ],
  routes: [
    { prefix: '/api/products', target: backendUrl },
    { prefix: '/api/orders', target: backendUrl }
  ]
};
