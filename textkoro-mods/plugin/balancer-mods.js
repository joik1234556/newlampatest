/**
 * balancer-mods.js — Lampa plugin v1.0
 * Integrates HDRezka, Zetflix, Alloha, VideoCDN, Kodik, Ashdi, Filmix
 * Pure JavaScript (ES5-compatible), works via a backend proxy.
 */
(function () {
  'use strict';

  if (!window.Lampa) return;

  /* ------------------------------------------------------------------ */
  /*  Constants                                                           */
  /* ------------------------------------------------------------------ */

  var PLUGIN_ID   = 'balancer_mods';
  var PLUGIN_NAME = 'Balancer-Mods';
  /* NOTE: Replace this placeholder with your actual proxy URL before deploying */
  var PROXY_DEFAULT = 'https://your-proxy-domain.com/api/balancers';
  var CACHE_TTL   = 12 * 60 * 1000; // 12 minutes

  /* Quality sort order — best first */
  var QUALITY_ORDER = [
    '4K HDR', '4K HDR10+', '4K SDR', '4K', 'Ultra HD', 'UHD',
    '1080p', 'FullHD', 'Full HD', 'FHD',
    '720p', 'HD',
    '480p', '360p', 'Auto'
  ];

  /* Balancer definitions */
  var BALANCERS = [
    {
      id: 'hdrezka',
      name: 'HDRezka',
      icon: '🎞️',
      quality: '4K, 1080p, 720p',
      voices: true,
      series: true,
      vip: false
    },
    {
      id: 'zetflix',
      name: 'Zetflix',
      icon: '🎬',
      quality: '4K, 1080p',
      voices: false,
      series: true,
      vip: false
    },
    {
      id: 'alloha',
      name: 'Alloha',
      icon: '🌊',
      quality: '4K HDR, 1080p',
      voices: false,
      series: false,
      vip: false
    },
    {
      id: 'videocdn',
      name: 'VideoCDN',
      icon: '📀',
      quality: '1080p, 720p',
      voices: false,
      series: true,
      vip: false
    },
    {
      id: 'kodik',
      name: 'Kodik',
      icon: '📺',
      quality: '1080p, 720p',
      voices: true,
      series: true,
      vip: false
    },
    {
      id: 'ashdi',
      name: 'Ashdi',
      icon: '🇺🇦',
      quality: '1080p, 720p',
      voices: false,
      series: true,
      vip: false
    },
    {
      id: 'filmix',
      name: 'Filmix',
      icon: '🎥',
      quality: '4K, 1080p',
      voices: true,
      series: true,
      vip: true
    }
  ];

  /* ------------------------------------------------------------------ */
  /*  State                                                               */
  /* ------------------------------------------------------------------ */

  var State = {
    inited: false,
    cache: {},           // key → { data, expiresAt }
    currentCard: null
  };

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function notice(text, type) {
    if (Lampa.Notice && Lampa.Notice.show) {
      Lampa.Notice.show(text, type || 'info');
    }
  }

  function get(key, fallback) {
    return Lampa.Storage.get(key, fallback);
  }

  function set(key, value) {
    Lampa.Storage.set(key, value);
  }

  function readCfg() {
    return {
      proxyUrl: String(get('balancer_mods_proxy', PROXY_DEFAULT)).replace(/\/+$/, ''),
      filmixToken: String(get('balancer_mods_filmix_token', '')).trim(),
      enabledMap: get('balancer_mods_enabled', {})
    };
  }

  function isEnabled(id) {
    var map = readCfg().enabledMap;
    if (!map || typeof map !== 'object') return true;
    if (typeof map[id] === 'boolean') return map[id];
    return true;
  }

  function setEnabled(id, val) {
    var map = readCfg().enabledMap;
    if (!map || typeof map !== 'object') map = {};
    map[id] = !!val;
    set('balancer_mods_enabled', map);
  }

  /* ------------------------------------------------------------------ */
  /*  Cache                                                               */
  /* ------------------------------------------------------------------ */

  function cacheRead(key) {
    var entry = State.cache[key];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      delete State.cache[key];
      return null;
    }
    return entry.data;
  }

  function cacheWrite(key, data) {
    State.cache[key] = { data: data, expiresAt: Date.now() + CACHE_TTL };
  }

  /* ------------------------------------------------------------------ */
  /*  Network                                                             */
  /* ------------------------------------------------------------------ */

  function doFetch(url, opts) {
    /* Prefer Lampa.Network when available */
    if (Lampa.Network && typeof Lampa.Network.native === 'function') {
      return new Promise(function (resolve, reject) {
        Lampa.Network.native(
          url,
          function (data) {
            try { resolve(typeof data === 'string' ? JSON.parse(data) : data); }
            catch (e) { reject(new Error('Failed to parse response from Lampa.Network: ' + e.message)); }
          },
          function (err) { reject(new Error(err || 'network error')); },
          opts && opts.body ? opts.body : null,
          opts && opts.method ? opts.method : 'GET'
        );
      });
    }

    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        var e = new Error('HTTP ' + res.status);
        e.status = res.status;
        throw e;
      }
      return res.json();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Card helpers                                                        */
  /* ------------------------------------------------------------------ */

  function cardToMeta(card) {
    if (!card) return null;
    var title = card.original_title || card.title || card.name || '';
    var year  = card.release_date
      ? String(card.release_date).slice(0, 4)
      : (card.first_air_date ? String(card.first_air_date).slice(0, 4) : (card.year || ''));
    return {
      title: title,
      year: year,
      kp_id: card.kinopoisk_id || card.kp_id || null,
      tmdb_id: card.id || card.tmdb_id || null,
      imdb_id: card.imdb_id || null,
      type: card.seasons || card.number_of_seasons ? 'tv' : 'movie'
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Quality ordering                                                    */
  /* ------------------------------------------------------------------ */

  function qualityRank(q) {
    var label = String(q || '').trim();
    for (var i = 0; i < QUALITY_ORDER.length; i++) {
      if (label.toLowerCase().indexOf(QUALITY_ORDER[i].toLowerCase()) !== -1) {
        return i;
      }
    }
    return QUALITY_ORDER.length;
  }

  function sortByQuality(items) {
    return items.slice().sort(function (a, b) {
      return qualityRank(a.quality) - qualityRank(b.quality);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Search — call backend proxy                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Fetch results from one balancer via the proxy.
   * Returns a Promise that resolves to an array of stream items.
   */
  function fetchBalancer(balancerId, meta) {
    var cfg = readCfg();
    var qs = [
      'balancer=' + encodeURIComponent(balancerId),
      'title=' + encodeURIComponent(meta.title || ''),
      'year=' + encodeURIComponent(meta.year || ''),
      'type=' + encodeURIComponent(meta.type || 'movie')
    ];
    if (meta.kp_id)   qs.push('kp_id='   + encodeURIComponent(meta.kp_id));
    if (meta.tmdb_id) qs.push('tmdb_id=' + encodeURIComponent(meta.tmdb_id));
    if (meta.imdb_id) qs.push('imdb_id=' + encodeURIComponent(meta.imdb_id));

    /* filmix needs user token */
    if (balancerId === 'filmix' && cfg.filmixToken) {
      qs.push('filmix_token=' + encodeURIComponent(cfg.filmixToken));
    }

    var url = cfg.proxyUrl + '/search?' + qs.join('&');
    var cacheKey = url;

    var cached = cacheRead(cacheKey);
    if (cached) return Promise.resolve(cached);

    return doFetch(url)
      .then(function (payload) {
        var items = (payload && Array.isArray(payload.items)) ? payload.items : [];
        cacheWrite(cacheKey, items);
        return items;
      })
      .catch(function (err) {
        notice(PLUGIN_NAME + ' [' + balancerId + ']: ' + (err.message || 'ошибка'), 'error');
        return [];
      });
  }

  /* ------------------------------------------------------------------ */
  /*  UI — generic select helper                                          */
  /* ------------------------------------------------------------------ */

  function selectMenu(data) {
    if (!Lampa.Select || !Lampa.Select.show) {
      notice(PLUGIN_NAME + ': Select UI недоступен', 'error');
      return;
    }
    Lampa.Select.show(data);
  }

  /* ------------------------------------------------------------------ */
  /*  UI — play a stream URL                                              */
  /* ------------------------------------------------------------------ */

  function playUrl(item, card) {
    var url = item.url || item.streamUrl || item.link || '';
    if (!url) {
      notice(PLUGIN_NAME + ': источник не вернул ссылку', 'error');
      return;
    }

    var title = (card && (card.title || card.name || card.original_title)) || item.title || '';

    if (Lampa.Player && typeof Lampa.Player.play === 'function') {
      try {
        Lampa.Player.play({ title: title, url: url, quality: item.quality || 'Auto' });
        return;
      } catch (e) {}
      try {
        Lampa.Player.play(url);
      } catch (e2) {
        notice(PLUGIN_NAME + ': ошибка запуска плеера', 'error');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  UI — season / episode selection                                     */
  /* ------------------------------------------------------------------ */

  function openEpisodeMenu(seasons, card, onSelect) {
    var seasonItems = Object.keys(seasons).map(function (s) {
      return { title: 'Сезон ' + s, season: Number(s) };
    });
    seasonItems.sort(function (a, b) { return a.season - b.season; });

    selectMenu({
      title: PLUGIN_NAME + ': Сезоны',
      items: seasonItems,
      onSelect: function (seasonRow) {
        var episodes = seasons[seasonRow.season] || [];
        var epItems  = episodes.map(function (ep) {
          return {
            title: 'Серия ' + ep.episode + (ep.title ? ' — ' + ep.title : ''),
            data: ep
          };
        });

        selectMenu({
          title: PLUGIN_NAME + ': С' + seasonRow.season + ' — серии',
          items: epItems,
          onSelect: function (epRow) {
            onSelect(epRow.data);
          }
        });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  UI — voice selection                                                */
  /* ------------------------------------------------------------------ */

  function openVoiceMenu(voices, onSelect) {
    var items = voices.map(function (v) {
      return { title: v.name || v.title || v, voice: v };
    });

    selectMenu({
      title: PLUGIN_NAME + ': Озвучка',
      items: items,
      onSelect: function (row) { onSelect(row.voice); }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  UI — stream list (grouped by quality, 4K first)                    */
  /* ------------------------------------------------------------------ */

  function buildStreamTitle(item) {
    var parts = [];
    if (item.balancer) parts.push(item.balancer);
    if (item.quality)  parts.push(item.quality);
    if (item.voice)    parts.push(item.voice);
    if (item.season)   parts.push('С' + item.season);
    if (item.episode)  parts.push('Э' + item.episode);
    return parts.join(' · ') || item.title || 'Без названия';
  }

  function openStreamList(allItems, card) {
    if (!allItems || !allItems.length) {
      notice(PLUGIN_NAME + ': варианты не найдены', 'info');
      return;
    }

    var sorted = sortByQuality(allItems);
    var menuItems = sorted.map(function (item) {
      return {
        title: buildStreamTitle(item),
        data: item,
        broken: !!item.broken
      };
    }).filter(function (row) {
      return !row.broken; /* hide broken links */
    });

    if (!menuItems.length) {
      notice(PLUGIN_NAME + ': все источники недоступны', 'error');
      return;
    }

    selectMenu({
      title: PLUGIN_NAME + ': выберите качество (' + menuItems.length + ')',
      items: menuItems,
      onSelect: function (row) {
        var item = row.data;

        /* If this item has multiple voices, show voice picker first */
        if (item.voices && item.voices.length > 1) {
          return openVoiceMenu(item.voices, function (voice) {
            var clone = {};
            for (var k in item) { if (Object.prototype.hasOwnProperty.call(item, k)) clone[k] = item[k]; }
            clone.url = (voice && voice.url) ? voice.url : item.url;
            clone.voice = (voice && (voice.name || voice)) || item.voice;
            playUrl(clone, card);
          });
        }

        /* If this item is a TV series with seasons, show season/episode picker */
        if (item.seasons && typeof item.seasons === 'object') {
          return openEpisodeMenu(item.seasons, card, function (ep) {
            playUrl(ep, card);
          });
        }

        playUrl(item, card);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Search — all enabled balancers                                      */
  /* ------------------------------------------------------------------ */

  function searchAllBalancers(card) {
    var meta = cardToMeta(card);
    if (!meta || !meta.title) {
      notice(PLUGIN_NAME + ': не удалось определить название', 'error');
      return;
    }

    notice(PLUGIN_NAME + ': поиск по балансерам…', 'info');

    var tasks = BALANCERS
      .filter(function (b) { return isEnabled(b.id); })
      .map(function (b) {
        return fetchBalancer(b.id, meta).then(function (items) {
          return items.map(function (item) {
            item.balancer = item.balancer || b.name;
            return item;
          });
        });
      });

    Promise.all(tasks).then(function (results) {
      var allItems = [];
      results.forEach(function (arr) {
        allItems = allItems.concat(arr || []);
      });
      openStreamList(allItems, card);
    }).catch(function (err) {
      notice(PLUGIN_NAME + ': ошибка поиска (' + (err.message || err) + ')', 'error');
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Search — single balancer                                            */
  /* ------------------------------------------------------------------ */

  function searchOneBalancer(balancerId, card) {
    var meta = cardToMeta(card);
    if (!meta || !meta.title) {
      notice(PLUGIN_NAME + ': не удалось определить название', 'error');
      return;
    }

    notice(PLUGIN_NAME + ': поиск [' + balancerId + ']…', 'info');

    var balancer = null;
    BALANCERS.forEach(function (b) { if (b.id === balancerId) balancer = b; });

    fetchBalancer(balancerId, meta).then(function (items) {
      items.forEach(function (item) {
        item.balancer = item.balancer || (balancer ? balancer.name : balancerId);
      });
      openStreamList(items, card);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Register sources in Lampa Online                                    */
  /* ------------------------------------------------------------------ */

  function registerSources() {
    if (!Lampa.Online || !Lampa.Online.addSource) return;

    BALANCERS.forEach(function (b) {
      if (!isEnabled(b.id)) return;

      var label = b.icon + ' ' + b.name + ' · ' + b.quality;
      if (b.vip) label += ' <span style="color:#ff9800;font-weight:700">VIP</span>';

      Lampa.Online.addSource(PLUGIN_ID + '_' + b.id, {
        title: label,
        name: b.name,
        url: 'about:blank',
        search: true,
        timeline: false,
        premium: !!b.vip,
        params: { balancerId: b.id, pluginId: PLUGIN_ID }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Source manager (toggle individual balancers)                        */
  /* ------------------------------------------------------------------ */

  function openSourceManager() {
    var items = BALANCERS.map(function (b) {
      return {
        title: (isEnabled(b.id) ? '✅ ' : '⛔ ') + b.icon + ' ' + b.name,
        subtitle: (b.vip ? 'VIP · ' : '') + b.quality,
        bid: b.id
      };
    });

    selectMenu({
      title: PLUGIN_NAME + ': управление источниками',
      items: items,
      onSelect: function (row) {
        setEnabled(row.bid, !isEnabled(row.bid));
        registerSources();
        openSourceManager();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Settings                                                            */
  /* ------------------------------------------------------------------ */

  function installSettings() {
    if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'balancer_mods_proxy', type: 'input', default: PROXY_DEFAULT },
      field: {
        name: PLUGIN_NAME + ': Proxy URL',
        description: 'URL бэкенд-прокси, например https://mods.example.com/api/balancers'
      },
      onChange: function (v) {
        set('balancer_mods_proxy', v);
        /* clear cache on URL change */
        State.cache = {};
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'balancer_mods_filmix_token', type: 'input', default: '' },
      field: {
        name: PLUGIN_NAME + ': Filmix токен',
        description: 'Необходим для доступа к Filmix (опционально)'
      },
      onChange: function (v) {
        set('balancer_mods_filmix_token', v);
        State.cache = {};
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'balancer_mods_manage', type: 'trigger', default: false },
      field: {
        name: PLUGIN_NAME + ': Управление источниками',
        description: 'Включить или отключить отдельные балансеры'
      },
      onChange: function () { openSourceManager(); }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Lampa event listeners                                               */
  /* ------------------------------------------------------------------ */

  function bindListeners() {
    if (!Lampa.Listener || !Lampa.Listener.follow) return;

    /* Capture the current card from the full-card view */
    Lampa.Listener.follow('full', function (e) {
      if (e && e.data && e.data.movie) State.currentCard = e.data.movie;
      if (e && e.data && e.data.card)  State.currentCard = e.data.card;
    });

    /* React when an Online source from our plugin is opened */
    Lampa.Listener.follow('online', function (event) {
      if (!event) return;
      if (event.card)  State.currentCard = event.card;
      if (event.movie) State.currentCard = event.movie;

      /* Re-register after the panel opens */
      if (event.type === 'open' || event.type === 'init') {
        registerSources();
        return;
      }

      /* Determine which balancer was selected */
      var src = event.source || {};
      var params = src.params || {};
      if (params.pluginId !== PLUGIN_ID) return;

      var balancerId = params.balancerId || '';
      if (!balancerId) return;

      if (event.type === 'select' || event.type === 'open' || event.type === 'start') {
        if (balancerId === 'all') {
          searchAllBalancers(State.currentCard);
        } else {
          searchOneBalancer(balancerId, State.currentCard);
        }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Init                                                                */
  /* ------------------------------------------------------------------ */

  function init() {
    if (State.inited) return;
    State.inited = true;

    installSettings();
    bindListeners();
    registerSources();

    notice(PLUGIN_NAME + ': плагин активирован', 'accept');
  }

  if (window.appready) {
    init();
  } else if (Lampa.Listener && Lampa.Listener.follow) {
    Lampa.Listener.follow('app', function (e) {
      if (e && e.type === 'ready') init();
    });
  }

})();
