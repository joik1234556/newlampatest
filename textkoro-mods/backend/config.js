const path = require('path');

function parseList(value, fallback) {
  const raw = String(value || fallback || '').trim();
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 60),
  defaultJackettUrl: process.env.JACKETT_URL || 'http://jackett:9117',
  defaultJackettKey: process.env.JACKETT_KEY || '',
  torrServers: parseList(process.env.TORR_SERVERS, 'http://torrserver:8090'),
  streamPublicBase: process.env.STREAM_PUBLIC_BASE || '',
  sourcesFile: path.join(__dirname, 'sources.json')
};
