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
  sourcesFile: path.join(__dirname, 'sources.json'),

  /* Balancer API tokens — set via environment variables */
  balancers: {
    hdrezkaUrl:    process.env.HDREZKA_URL    || 'https://hdrezka.ag',
    hdrezkaToken:  process.env.HDREZKA_TOKEN  || '',
    zetflixUrl:    process.env.ZETFLIX_URL     || 'https://zetfilm.cc',
    zetflixToken:  process.env.ZETFLIX_TOKEN   || '',
    allohaUrl:     process.env.ALLOHA_URL      || 'https://api.alloha.tv',
    allohaToken:   process.env.ALLOHA_TOKEN    || '',
    videocdnUrl:   process.env.VIDEOCDN_URL    || 'https://videocdn.tv',
    videocdnToken: process.env.VIDEOCDN_TOKEN  || '',
    kodikUrl:      process.env.KODIK_URL       || 'https://kodikapi.com',
    kodikToken:    process.env.KODIK_TOKEN     || '',
    ashdiUrl:      process.env.ASHDI_URL       || 'https://api.ashdi.vip',
    ashdiToken:    process.env.ASHDI_TOKEN     || '',
    filmixUrl:     process.env.FILMIX_URL      || 'https://filmix.ac',
    filmixToken:   process.env.FILMIX_TOKEN    || '',
    filmixDevId:   process.env.FILMIX_DEV_ID   || ''
  }
};
