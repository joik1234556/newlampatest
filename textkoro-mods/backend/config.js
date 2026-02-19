const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  apiPrefix: '/api',
  dataDir: __dirname,
  sourcesFile: path.join(__dirname, 'sources.json'),
  vipKeysFile: path.join(__dirname, 'vip-keys.json'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  vipCacheTtlMs: 30_000
};
