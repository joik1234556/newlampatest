const express = require('express');
const fs = require('fs/promises');
const config = require('../config');

const router = express.Router();

const memoryCache = new Map();
const rateState = new Map();
let rrIndex = 0;

function now() {
  return Date.now();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function qualityFromTitle(title) {
  const t = normalizeText(title).toLowerCase();
  if (/(2160|4k|uhd|hdr)/i.test(t)) return '4K HDR';
  if (/(1080|fhd)/i.test(t)) return '1080p';
  if (/(720|hd)/i.test(t)) return '720p';
  return 'Auto';
}

function voiceFromTitle(title) {
  const t = normalizeText(title).toLowerCase();
  if (/(ua|укр|україн)/i.test(t)) return '+UA';
  if (/(дубляж|dubbing|dubbed)/i.test(t)) return 'Дубляж';
  if (/(многоголос|multi|mvo)/i.test(t)) return 'Многоголосый';
  if (/(оригинал|original|eng)/i.test(t)) return 'Оригинал';
  return 'Любая';
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function rateLimit(req, res, next) {
  const ip = getClientIp(req);
  const ts = now();
  const item = rateState.get(ip) || { resetAt: ts + config.rateLimitWindowMs, hits: 0 };

  if (ts > item.resetAt) {
    item.hits = 0;
    item.resetAt = ts + config.rateLimitWindowMs;
  }

  item.hits += 1;
  rateState.set(ip, item);

  if (item.hits > config.rateLimitMax) {
    return res.status(429).json({ ok: false, error: 'rate_limited', retryAfterMs: item.resetAt - ts });
  }

  next();
}

function readCache(key) {
  const value = memoryCache.get(key);
  if (!value) return null;
  if (value.expiresAt < now()) {
    memoryCache.delete(key);
    return null;
  }
  return value.payload;
}

function writeCache(key, payload, ttlMs) {
  memoryCache.set(key, { payload, expiresAt: now() + ttlMs });
}

async function readSources() {
  const raw = await fs.readFile(config.sourcesFile, 'utf8');
  return JSON.parse(raw);
}

function selectTorrServer() {
  const list = config.torrServers;
  if (!list.length) throw new Error('TORR_SERVERS list is empty');
  const index = rrIndex % list.length;
  rrIndex += 1;
  return list[index].replace(/\/+$/, '');
}

function normalizeMagnet(item) {
  const uri = item.MagnetUri || item.Link || '';
  return String(uri).startsWith('magnet:?') ? uri : '';
}

function toGb(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number((value / 1024 / 1024 / 1024).toFixed(2));
}

function mapJackettResult(item, serverUrl) {
  const magnet = normalizeMagnet(item);
  const title = item.Title || 'No title';

  return {
    title,
    quality: qualityFromTitle(title),
    voice: voiceFromTitle(title),
    seeders: Number(item.Seeders || 0),
    sizeGb: toGb(item.Size),
    tracker: item.Tracker || item.TrackerId || 'indexer',
    magnet,
    streamUrl: magnet ? `${serverUrl}/stream?magnet=${encodeURIComponent(magnet)}` : null
  };
}

router.use(rateLimit);

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'easy-mods-backend',
    torrServers: config.torrServers.length,
    cacheEntries: memoryCache.size,
    ts: new Date().toISOString()
  });
});

router.get('/sources', async (req, res) => {
  try {
    const list = await readSources();
    const isVip = String(req.query.isVip || '') === 'true';
    const enabled = list.filter((item) => (isVip ? true : !item.vip));

    res.json({ ok: true, total: enabled.length, isVip, sources: enabled });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'sources_failed', message: error.message });
  }
});

router.post('/search', async (req, res) => {
  const body = req.body || {};
  const title = normalizeText(body.title);
  const year = normalizeText(body.year);
  const jackettUrl = normalizeText(body.jackettUrl) || config.defaultJackettUrl;
  const jackettKey = normalizeText(body.jackettKey) || config.defaultJackettKey;
  const query = `${title} ${year}`.trim();

  if (!title) return res.status(400).json({ ok: false, error: 'title_required' });
  if (!jackettKey) return res.status(400).json({ ok: false, error: 'jackett_key_required' });

  const cacheKey = `search:${jackettUrl}:${query.toLowerCase()}`;
  const fromCache = readCache(cacheKey);
  if (fromCache) return res.json({ ok: true, cached: true, query, items: fromCache });

  try {
    const endpoint = `${jackettUrl.replace(/\/+$/, '')}/api/v2.0/indexers/all/results?apikey=${encodeURIComponent(jackettKey)}&Query=${encodeURIComponent(query)}`;
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });

    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: 'jackett_error', status: response.status });
    }

    const payload = await response.json();
    const rows = Array.isArray(payload.Results) ? payload.Results : [];
    const serverUrl = `${req.protocol}://${req.get('host')}`;

    const items = rows
      .map((item) => mapJackettResult(item, serverUrl))
      .filter((item) => item.magnet)
      .sort((a, b) => b.seeders - a.seeders)
      .slice(0, 120);

    writeCache(cacheKey, items, config.cacheTtlMs);

    res.json({ ok: true, cached: false, query, items });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'search_failed', message: error.message });
  }
});

router.post('/stream', async (req, res) => {
  try {
    const magnet = normalizeText(req.body && req.body.magnet);
    if (!magnet || !magnet.startsWith('magnet:?')) {
      return res.status(400).json({ ok: false, error: 'invalid_magnet' });
    }

    const torrServer = selectTorrServer();

    const warmedEndpoints = [
      `${torrServer}/stream?link=${encodeURIComponent(magnet)}&preload=1` ,
      `${torrServer}/torrent/add?link=${encodeURIComponent(magnet)}`
    ];

    let warmStatus = 'skipped';

    for (const endpoint of warmedEndpoints) {
      try {
        const response = await fetch(endpoint, { method: 'GET' });
        if (response.ok) {
          warmStatus = 'ok';
          break;
        }
      } catch (_e) {
        warmStatus = 'failed';
      }
    }

    const publicBase = config.streamPublicBase ? config.streamPublicBase.replace(/\/+$/, '') : torrServer;
    const streamUrl = `${publicBase}/stream?link=${encodeURIComponent(magnet)}&play=true&m3u=true`;

    res.json({
      ok: true,
      torrServer,
      warmStatus,
      streamUrl,
      playlist: streamUrl
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'stream_failed', message: error.message });
  }
});

router.get('/stream', async (req, res) => {
  try {
    const magnet = normalizeText(req.query.magnet);
    if (!magnet || !magnet.startsWith('magnet:?')) {
      return res.status(400).json({ ok: false, error: 'invalid_magnet' });
    }

    const torrServer = selectTorrServer();
    const publicBase = config.streamPublicBase ? config.streamPublicBase.replace(/\/+$/, '') : torrServer;
    const streamUrl = `${publicBase}/stream?link=${encodeURIComponent(magnet)}&play=true&m3u=true`;

    res.json({ ok: true, torrServer, streamUrl, playlist: streamUrl });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'stream_failed', message: error.message });
  }
});

module.exports = router;
