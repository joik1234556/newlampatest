/**
 * routes/balancers.js
 * Backend proxy for balancer APIs.
 * Hides API tokens, normalises responses, provides CORS bypass.
 * Endpoints:
 *   GET /balancers/search?balancer=ID&kp_id=&tmdb_id=&imdb_id=&title=&year=&type=
 *   GET /balancers/list        – return available balancers with metadata
 */

const express = require('express');
const config  = require('../config');

const router = express.Router();

/* ------------------------------------------------------------------ */
/*  In-memory cache (shared with TTL from config)                       */
/* ------------------------------------------------------------------ */

const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + (ttlMs || config.cacheTtlMs) });
}

/* ------------------------------------------------------------------ */
/*  Balancer configs — read from config.balancers (env-backed)         */
/* ------------------------------------------------------------------ */

const BALANCER_CFG = {
  hdrezka: {
    name: 'HDRezka',
    baseUrl: config.balancers.hdrezkaUrl,
    token:   config.balancers.hdrezkaToken
  },
  zetflix: {
    name: 'Zetflix',
    baseUrl: config.balancers.zetflixUrl,
    token:   config.balancers.zetflixToken
  },
  alloha: {
    name: 'Alloha',
    baseUrl: config.balancers.allohaUrl,
    token:   config.balancers.allohaToken
  },
  videocdn: {
    name: 'VideoCDN',
    baseUrl: config.balancers.videocdnUrl,
    token:   config.balancers.videocdnToken
  },
  kodik: {
    name: 'Kodik',
    baseUrl: config.balancers.kodikUrl,
    token:   config.balancers.kodikToken
  },
  ashdi: {
    name: 'Ashdi',
    baseUrl: config.balancers.ashdiUrl,
    token:   config.balancers.ashdiToken
  },
  filmix: {
    name: 'Filmix',
    baseUrl: config.balancers.filmixUrl,
    token:   config.balancers.filmixToken,
    devId:   config.balancers.filmixDevId
  }
};

/* ------------------------------------------------------------------ */
/*  Shared HTTP helper                                                  */
/* ------------------------------------------------------------------ */

async function httpGet(url, extraHeaders) {
  const res = await fetch(url, {
    headers: Object.assign(
      {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; LampaBalancer/1.0)'
      },
      extraHeaders || {}
    ),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const err = new Error('upstream HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function httpPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; LampaBalancer/1.0)'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const err = new Error('upstream HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Normalise stream item                                               */
/* ------------------------------------------------------------------ */

function mkItem(params) {
  return {
    balancer:  params.balancer  || '',
    title:     params.title     || '',
    quality:   params.quality   || 'Auto',
    voice:     params.voice     || '',
    url:       params.url       || '',
    season:    params.season    || null,
    episode:   params.episode   || null,
    voices:    params.voices    || null,   // [{name,url}] if voice selection available
    seasons:   params.seasons   || null,   // {season: [{episode,url,title}]} for TV
    broken:    false
  };
}

/* ------------------------------------------------------------------ */
/*  HDRezka                                                             */
/* ------------------------------------------------------------------ */

async function searchHDRezka(params, cfg) {
  const { title, year, kp_id } = params;
  const base = cfg.baseUrl;

  /* Step 1: find movie page */
  const q = encodeURIComponent(title + (year ? ' ' + year : ''));
  const searchUrl = `${base}/search/?do=search&subaction=search&q=${q}`;
  const html = await fetch(searchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000)
  }).then((r) => r.text());

  /* Extract first result link */
  const linkMatch = html.match(/class="b-search__form_result_col"[\s\S]*?href="(https?:\/\/[^"]+)"/);
  if (!linkMatch) return [];

  const pageUrl  = linkMatch[1];
  const pageHtml = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000)
  }).then((r) => r.text());

  /* Extract id, translator ids, streams */
  const idMatch = pageHtml.match(/\/(\d+)-[^/]+\.html/);
  const movieId = idMatch ? idMatch[1] : null;
  if (!movieId) return [];

  /* Extract available translations */
  const transMatches = [...pageHtml.matchAll(/data-translator_id="(\d+)"[^>]*>([^<]+)</g)];
  if (!transMatches.length) return [];

  const items = [];

  for (const m of transMatches.slice(0, 6)) {
    const translatorId = m[1];
    const voiceName    = m[2].trim();

    try {
      /* Get stream data via AJAX endpoint */
      const ajaxUrl = `${base}/ajax/get_cdn_series/?id=${movieId}&translator_id=${translatorId}&action=get_movie`;
      const ajaxHtml = await fetch(ajaxUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': pageUrl
        },
        signal: AbortSignal.timeout(8000)
      }).then((r) => r.text());

      const cdnMatch = ajaxHtml.match(/"streams":"([^"]+)"/);
      if (!cdnMatch) continue;

      const streams = cdnMatch[1].replace(/\\/g, '');
      /* streams format: [360p]url,[720p]url,[1080p]url */
      const qMatches = [...streams.matchAll(/\[([^\]]+)\](https?:[^,\s]+)/g)];

      for (const qm of qMatches) {
        const quality = qm[1].replace(/^\s+|\s+$/g, '');
        const url     = qm[2];
        items.push(mkItem({
          balancer: 'HDRezka',
          title: title + ' (' + voiceName + ')',
          quality,
          voice: voiceName,
          url
        }));
      }
    } catch (_e) {
      /* skip this translator on error */
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  Zetflix                                                             */
/* ------------------------------------------------------------------ */

async function searchZetflix(params, cfg) {
  const { kp_id, tmdb_id, title } = params;
  if (!cfg.token) return [];

  const qs = new URLSearchParams({ token: cfg.token });
  if (kp_id)   qs.set('kp_id',   kp_id);
  if (tmdb_id) qs.set('tmdb_id', tmdb_id);
  if (!kp_id && !tmdb_id) qs.set('title', title);

  const payload = await httpGet(`${cfg.baseUrl}/api/?${qs}`);
  const data = payload.data || payload;
  if (!data || !data.iframe) return [];

  const items = [];
  const qualityMap = {
    link_4k:    '4K',
    link_1080p: '1080p',
    link_720p:  '720p',
    link_480p:  '480p',
    link_360p:  '360p'
  };

  for (const [key, quality] of Object.entries(qualityMap)) {
    if (data[key]) {
      items.push(mkItem({ balancer: 'Zetflix', title: params.title, quality, url: data[key] }));
    }
  }

  if (!items.length && data.iframe) {
    items.push(mkItem({ balancer: 'Zetflix', title: params.title, quality: 'Auto', url: data.iframe }));
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  Alloha                                                              */
/* ------------------------------------------------------------------ */

async function searchAlloha(params, cfg) {
  const { kp_id, tmdb_id, title } = params;
  if (!cfg.token) return [];

  const qs = new URLSearchParams({ token: cfg.token });
  if (kp_id)   qs.set('kp',   kp_id);
  if (tmdb_id) qs.set('tmdb', tmdb_id);
  if (!kp_id && !tmdb_id) qs.set('name', title);

  const payload = await httpGet(`${cfg.baseUrl}/?${qs}`);
  const data = payload.data || {};
  if (!data) return [];

  const items = [];
  const qualityMap = {
    link_4k:    '4K HDR',
    link_1080p: '1080p',
    link_720p:  '720p',
    link_480p:  '480p',
    link_360p:  '360p',
    link:       'Auto'
  };

  for (const [key, quality] of Object.entries(qualityMap)) {
    if (data[key] && key !== 'link') {
      items.push(mkItem({ balancer: 'Alloha', title: params.title, quality, url: data[key] }));
    }
  }

  if (!items.length && data.link) {
    items.push(mkItem({ balancer: 'Alloha', title: params.title, quality: 'Auto', url: data.link }));
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  VideoCDN                                                            */
/* ------------------------------------------------------------------ */

async function searchVideoCDN(params, cfg) {
  const { kp_id, tmdb_id, title, type } = params;
  if (!cfg.token) return [];

  const endpoint = type === 'tv' ? '/api/tv-series/short' : '/api/short';
  const qs = new URLSearchParams({ api_token: cfg.token });
  if (kp_id)   qs.set('kinopoisk_id', kp_id);
  if (tmdb_id) qs.set('tmdb_id',      tmdb_id);
  if (!kp_id && !tmdb_id) qs.set('title', title);

  const payload = await httpGet(`${cfg.baseUrl}${endpoint}?${qs}`);
  const rows = Array.isArray(payload.data) ? payload.data : [];
  if (!rows.length) return [];

  const items = [];

  for (const row of rows.slice(0, 3)) {
    if (!row.iframe_src) continue;

    /* VideoCDN returns seasons/episodes for TV */
    if (type === 'tv' && row.seasons) {
      const seasons = {};
      for (const [s, eps] of Object.entries(row.seasons)) {
        seasons[s] = eps.map((ep) => ({
          episode: ep.episode,
          title:   ep.title || '',
          url:     ep.iframe_src || row.iframe_src
        }));
      }
      items.push(mkItem({
        balancer: 'VideoCDN',
        title: params.title,
        quality: row.quality || '1080p',
        seasons
      }));
    } else {
      items.push(mkItem({
        balancer: 'VideoCDN',
        title: params.title,
        quality: row.quality || '1080p',
        url: row.iframe_src
      }));
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  Kodik                                                               */
/* ------------------------------------------------------------------ */

async function searchKodik(params, cfg) {
  const { kp_id, imdb_id, title, type } = params;
  if (!cfg.token) return [];

  const qs = new URLSearchParams({
    token: cfg.token,
    with_episodes: 'true',
    full_data: 'true',
    with_material_data: 'true'
  });

  if (kp_id)   qs.set('kinopoisk_id', kp_id);
  else if (imdb_id) qs.set('imdb_id', imdb_id);
  else qs.set('title', title);

  const payload = await httpGet(`${cfg.baseUrl}/search?${qs}`);
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (!results.length) return [];

  const items = [];

  for (const result of results.slice(0, 5)) {
    const link        = result.link ? 'https:' + result.link : '';
    const translation = result.translation ? result.translation.title : '';
    const quality     = result.quality || '720p';

    if (!link) continue;

    if (type === 'tv' && result.seasons) {
      const seasons = {};
      for (const [s, episodesObj] of Object.entries(result.seasons)) {
        if (episodesObj && episodesObj.episodes) {
          seasons[s] = Object.entries(episodesObj.episodes).map(([epNum, epLink]) => ({
            episode: epNum,
            title: '',
            url: epLink ? 'https:' + epLink : link
          }));
        }
      }
      items.push(mkItem({
        balancer: 'Kodik',
        title: params.title + (translation ? ' / ' + translation : ''),
        quality,
        voice: translation,
        seasons
      }));
    } else {
      items.push(mkItem({
        balancer: 'Kodik',
        title: params.title + (translation ? ' / ' + translation : ''),
        quality,
        voice: translation,
        url: link
      }));
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  Ashdi                                                               */
/* ------------------------------------------------------------------ */

async function searchAshdi(params, cfg) {
  const { kp_id, tmdb_id, title } = params;
  if (!cfg.token) return [];

  const qs = new URLSearchParams({ token: cfg.token });
  if (kp_id)   qs.set('kp',   kp_id);
  if (tmdb_id) qs.set('tmdb', tmdb_id);
  if (!kp_id && !tmdb_id) qs.set('name', title);

  const payload = await httpGet(`${cfg.baseUrl}/video?${qs}`);
  const data = payload.data || {};
  if (!data) return [];

  const items = [];
  const qualityMap = {
    link_1080p: '1080p',
    link_720p:  '720p',
    link_480p:  '480p',
    link:       'Auto'
  };

  for (const [key, quality] of Object.entries(qualityMap)) {
    if (data[key] && key !== 'link') {
      items.push(mkItem({ balancer: 'Ashdi', title: params.title, quality, url: data[key] }));
    }
  }

  if (!items.length && data.link) {
    items.push(mkItem({ balancer: 'Ashdi', title: params.title, quality: 'Auto', url: data.link }));
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  Filmix                                                              */
/* ------------------------------------------------------------------ */

async function searchFilmix(params, cfg, userToken) {
  const { title } = params;
  const token = userToken || cfg.token;
  if (!token) return [];

  const qs = new URLSearchParams({ search: title, user_dev_apk: '2.0.1' });
  if (cfg.devId) qs.set('user_dev_id', cfg.devId);

  const payload = await httpGet(`${cfg.baseUrl}/api/v2/search_result/for_players?${qs}`, {
    Authorization: 'Bearer ' + token
  });

  const posts = Array.isArray(payload.posts) ? payload.posts : [];
  const items = [];

  for (const post of posts.slice(0, 5)) {
    const qualities = post.player_links || {};
    for (const [quality, url] of Object.entries(qualities)) {
      if (!url) continue;
      items.push(mkItem({
        balancer: 'Filmix',
        title: post.title || params.title,
        quality,
        url
      }));
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/*  Dispatcher                                                          */
/* ------------------------------------------------------------------ */

const DISPATCHERS = {
  hdrezka:  searchHDRezka,
  zetflix:  searchZetflix,
  alloha:   searchAlloha,
  videocdn: searchVideoCDN,
  kodik:    searchKodik,
  ashdi:    searchAshdi,
  filmix:   searchFilmix
};

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */

/**
 * GET /balancers/list
 * Returns metadata about all configured balancers (no tokens).
 */
router.get('/list', (_req, res) => {
  const list = Object.entries(BALANCER_CFG).map(([id, cfg]) => ({
    id,
    name: cfg.name,
    configured: !!(cfg.token || id === 'hdrezka')
  }));
  res.json({ ok: true, balancers: list });
});

/**
 * GET /balancers/search
 * Query params:
 *   balancer   – balancer id (required)
 *   kp_id      – Kinopoisk ID (preferred)
 *   tmdb_id    – TMDB ID
 *   imdb_id    – IMDB ID
 *   title      – movie/show title (fallback)
 *   year       – release year
 *   type       – "movie" | "tv"
 *   filmix_token – user's Filmix token (optional, for 4K access)
 */
router.get('/search', async (req, res) => {
  const balancerId   = String(req.query.balancer || '').trim().toLowerCase();
  const kp_id        = String(req.query.kp_id   || '').trim();
  const tmdb_id      = String(req.query.tmdb_id  || '').trim();
  const imdb_id      = String(req.query.imdb_id  || '').trim();
  const title        = String(req.query.title    || '').trim();
  const year         = String(req.query.year     || '').trim();
  const type         = String(req.query.type     || 'movie').trim();
  const filmixToken  = String(req.query.filmix_token || '').trim();

  if (!balancerId) {
    return res.status(400).json({ ok: false, error: 'balancer_required' });
  }

  if (!DISPATCHERS[balancerId]) {
    return res.status(404).json({ ok: false, error: 'balancer_not_found', balancer: balancerId });
  }

  if (!kp_id && !tmdb_id && !imdb_id && !title) {
    return res.status(400).json({ ok: false, error: 'search_params_required' });
  }

  const cacheKey = `balancer:${balancerId}:${kp_id}:${tmdb_id}:${imdb_id}:${title}:${year}:${type}`;
  const fromCache = cacheGet(cacheKey);
  if (fromCache) {
    return res.json({ ok: true, cached: true, balancer: balancerId, items: fromCache });
  }

  const cfg    = BALANCER_CFG[balancerId];
  const params = { kp_id, tmdb_id, imdb_id, title, year, type };

  try {
    const items = await DISPATCHERS[balancerId](params, cfg, filmixToken || undefined);

    /* Validate and mark broken items (empty URL) */
    const processed = items.map((item) => {
      if (!item.url && !item.seasons) item.broken = true;
      return item;
    });

    cacheSet(cacheKey, processed);
    res.json({ ok: true, cached: false, balancer: balancerId, items: processed });
  } catch (err) {
    const status = (err.status === 404 || err.status === 502) ? err.status : 500;
    res.status(status).json({
      ok: false,
      error: 'balancer_error',
      balancer: balancerId,
      message: err.message
    });
  }
});

module.exports = router;
