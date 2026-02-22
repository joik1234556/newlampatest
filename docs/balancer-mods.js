/**
 * balancer-mods.js — Lampa plugin v2.0
 * Adds an "Easy-Mods" button to every movie/series card.
 * Clicking it shows a balancer picker → results sorted by quality → player.
 * ES5-compatible (Smart TV friendly). Requires jQuery (already included in Lampa).
 */
(function () {
  'use strict';

  if (!window.Lampa) return;

  /* ------------------------------------------------------------------ */
  /*  Constants                                                           */
  /* ------------------------------------------------------------------ */

  var PLUGIN_ID   = 'easy_mods';
  var PLUGIN_NAME = 'Easy-Mods';
  /* NOTE: Replace with your deployed proxy URL */
  var PROXY_DEFAULT = 'https://your-proxy-domain.com/api/balancers';
  var CACHE_TTL = 12 * 60 * 1000; /* 12 min */

  var QUALITY_ORDER = [
    '4K HDR10+', '4K HDR', '4K SDR', '4K', 'Ultra HD', 'UHD',
    '2160p',
    '1080p Ultra', '1080p', 'FullHD', 'Full HD', 'FHD',
    '720p', 'HD',
    '480p', '360p', 'Auto'
  ];

  /* Balancer definitions */
  var BALANCERS = [
    { id: 'hdrezka',  name: 'HDRezka',  icon: '🎞️', quality: '4K · 1080p · 720p',  voices: true,  series: true,  vip: false },
    { id: 'zetflix',  name: 'Zetflix',  icon: '🎬', quality: '4K · 1080p',          voices: false, series: true,  vip: false },
    { id: 'alloha',   name: 'Alloha',   icon: '🌊', quality: '4K HDR · 1080p',      voices: false, series: false, vip: false },
    { id: 'videocdn', name: 'VideoCDN', icon: '📀', quality: '1080p · 720p',         voices: false, series: true,  vip: false },
    { id: 'kodik',    name: 'Kodik',    icon: '📺', quality: '1080p · 720p',         voices: true,  series: true,  vip: false },
    { id: 'ashdi',    name: 'Ashdi',    icon: '🇺🇦', quality: '1080p · 720p',        voices: false, series: true,  vip: false },
    { id: 'filmix',   name: 'Filmix',   icon: '🎥', quality: '4K · 1080p',           voices: true,  series: true,  vip: true  }
  ];

  /* ------------------------------------------------------------------ */
  /*  State                                                               */
  /* ------------------------------------------------------------------ */

  var State = {
    inited: false,
    cache: {}
  };

  /* ------------------------------------------------------------------ */
  /*  Storage helpers                                                      */
  /* ------------------------------------------------------------------ */

  function get(key, fallback) {
    return Lampa.Storage.get(key, fallback);
  }

  function set(key, value) {
    Lampa.Storage.set(key, value);
  }

  function readCfg() {
    return {
      proxyUrl:     String(get('easy_mods_proxy', PROXY_DEFAULT)).replace(/\/+$/, ''),
      filmixToken:  String(get('easy_mods_filmix_token', '')).trim(),
      enabledMap:   get('easy_mods_enabled', {})
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
    set('easy_mods_enabled', map);
  }

  /* ------------------------------------------------------------------ */
  /*  Notifications                                                        */
  /* ------------------------------------------------------------------ */

  function notice(text, type) {
    if (Lampa.Noty && Lampa.Noty.show) {
      Lampa.Noty.show(text);
    } else if (Lampa.Notice && Lampa.Notice.show) {
      Lampa.Notice.show(text, type || 'info');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Cache                                                               */
  /* ------------------------------------------------------------------ */

  function cacheRead(key) {
    var entry = State.cache[key];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { delete State.cache[key]; return null; }
    return entry.data;
  }

  function cacheWrite(key, data) {
    State.cache[key] = { data: data, expiresAt: Date.now() + CACHE_TTL };
  }

  /* ------------------------------------------------------------------ */
  /*  Network                                                             */
  /* ------------------------------------------------------------------ */

  function doFetch(url) {
    if (Lampa.Reguest) {
      return new Promise(function (resolve, reject) {
        var network = new Lampa.Reguest();
        network.timeout(10000);
        network.silent(
          url,
          function (json) { resolve(json); },
          function (a, c) { reject(new Error(network.errorDecode ? network.errorDecode(a, c) : 'network error')); },
          false,
          { dataType: 'json' }
        );
      });
    }

    /* Fallback to native fetch */
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (res) {
      if (!res.ok) { var e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      return res.json();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Card → meta                                                         */
  /* ------------------------------------------------------------------ */

  function cardToMeta(card) {
    if (!card) return null;
    var title = card.original_title || card.title || card.name || '';
    var year = card.release_date
      ? String(card.release_date).slice(0, 4)
      : (card.first_air_date ? String(card.first_air_date).slice(0, 4) : (String(card.year || '')));
    return {
      title:   title,
      year:    year,
      kp_id:   card.kinopoisk_id || card.kp_id || null,
      tmdb_id: card.id || card.tmdb_id || null,
      imdb_id: card.imdb_id || null,
      type:    (card.seasons || card.number_of_seasons) ? 'tv' : 'movie'
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Quality sort                                                        */
  /* ------------------------------------------------------------------ */

  function qualityRank(q) {
    var label = String(q || '').trim().toLowerCase();
    for (var i = 0; i < QUALITY_ORDER.length; i++) {
      if (label.indexOf(QUALITY_ORDER[i].toLowerCase()) !== -1) return i;
    }
    return QUALITY_ORDER.length;
  }

  function sortByQuality(items) {
    return items.slice().sort(function (a, b) {
      return qualityRank(a.quality) - qualityRank(b.quality);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Proxy fetch                                                         */
  /* ------------------------------------------------------------------ */

  function fetchBalancer(balancerId, meta) {
    var cfg = readCfg();
    var qs = [
      'balancer='  + encodeURIComponent(balancerId),
      'title='     + encodeURIComponent(meta.title || ''),
      'year='      + encodeURIComponent(meta.year  || ''),
      'type='      + encodeURIComponent(meta.type  || 'movie')
    ];
    if (meta.kp_id)   qs.push('kp_id='   + encodeURIComponent(meta.kp_id));
    if (meta.tmdb_id) qs.push('tmdb_id=' + encodeURIComponent(meta.tmdb_id));
    if (meta.imdb_id) qs.push('imdb_id=' + encodeURIComponent(meta.imdb_id));
    if (balancerId === 'filmix' && cfg.filmixToken) {
      qs.push('filmix_token=' + encodeURIComponent(cfg.filmixToken));
    }

    var url = cfg.proxyUrl + '/search?' + qs.join('&');
    var cached = cacheRead(url);
    if (cached) return Promise.resolve(cached);

    return doFetch(url)
      .then(function (payload) {
        var items = (payload && Array.isArray(payload.items)) ? payload.items : [];
        cacheWrite(url, items);
        return items;
      })
      .catch(function (err) {
        notice(PLUGIN_NAME + ' [' + balancerId + ']: ' + (err.message || 'ошибка'), 'error');
        return [];
      });
  }

  /* ------------------------------------------------------------------ */
  /*  Lampa.Select wrapper                                                */
  /* ------------------------------------------------------------------ */

  function showSelect(data) {
    if (Lampa.Select && Lampa.Select.show) {
      Lampa.Select.show(data);
    } else {
      notice(PLUGIN_NAME + ': Select недоступен', 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Playback                                                            */
  /* ------------------------------------------------------------------ */

  function playUrl(item, card) {
    var url = item.url || item.streamUrl || item.link || '';
    if (!url) { notice(PLUGIN_NAME + ': нет ссылки для воспроизведения', 'error'); return; }
    var title = (card && (card.title || card.name || card.original_title)) || item.title || '';

    if (Lampa.Player && typeof Lampa.Player.play === 'function') {
      try {
        Lampa.Player.play({ title: title, url: url, quality: item.quality || '' });
        return;
      } catch (e) {}
      try { Lampa.Player.play(url); } catch (e2) {
        notice(PLUGIN_NAME + ': ошибка запуска плеера', 'error');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Episode picker                                                      */
  /* ------------------------------------------------------------------ */

  function openEpisodeMenu(seasons, card, onEp) {
    var seasonKeys = Object.keys(seasons).sort(function (a, b) { return a - b; });
    showSelect({
      title: PLUGIN_NAME + ' — Сезоны',
      items: seasonKeys.map(function (s) { return { title: 'Сезон ' + s, skey: s }; }),
      onSelect: function (row) {
        var eps = seasons[row.skey] || [];
        showSelect({
          title: PLUGIN_NAME + ' — Серии (Сезон ' + row.skey + ')',
          items: eps.map(function (ep) {
            return { title: 'Серия ' + ep.episode + (ep.title ? ' — ' + ep.title : ''), data: ep };
          }),
          onSelect: function (epRow) { onEp(epRow.data); }
        });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Voice picker                                                        */
  /* ------------------------------------------------------------------ */

  function openVoiceMenu(voices, onVoice) {
    showSelect({
      title: PLUGIN_NAME + ' — Озвучка',
      items: voices.map(function (v) {
        return { title: v.name || v.title || String(v), vdata: v };
      }),
      onSelect: function (row) { onVoice(row.vdata); }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Stream list (quality-sorted)                                        */
  /* ------------------------------------------------------------------ */

  function openStreamList(rawItems, card) {
    var sorted  = sortByQuality(rawItems).filter(function (x) { return !x.broken; });

    if (!sorted.length) {
      notice(PLUGIN_NAME + ': источники не найдены', 'info');
      return;
    }

    var menuItems = sorted.map(function (item) {
      var parts = [];
      if (item.balancer) parts.push(item.balancer);
      if (item.quality)  parts.push(item.quality);
      if (item.voice)    parts.push(item.voice);
      return { title: parts.join(' · ') || item.title || 'Без названия', data: item };
    });

    showSelect({
      title: PLUGIN_NAME + ' — Выберите качество (' + menuItems.length + ')',
      items: menuItems,
      onSelect: function (row) {
        var item = row.data;

        /* Multiple voices? → voice picker */
        if (item.voices && item.voices.length > 1) {
          return openVoiceMenu(item.voices, function (voice) {
            var clone = {};
            for (var k in item) { if (Object.prototype.hasOwnProperty.call(item, k)) clone[k] = item[k]; }
            clone.url   = (voice && voice.url)  ? voice.url : item.url;
            clone.voice = (voice && (voice.name || voice)) || item.voice;
            playUrl(clone, card);
          });
        }

        /* TV with seasons? → season/episode picker */
        if (item.seasons && typeof item.seasons === 'object') {
          return openEpisodeMenu(item.seasons, card, function (ep) { playUrl(ep, card); });
        }

        playUrl(item, card);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Balancer picker → search → results                                 */
  /* ------------------------------------------------------------------ */

  function openBalancerSelect(card) {
    var meta = cardToMeta(card);
    if (!meta || !meta.title) {
      notice(PLUGIN_NAME + ': не удалось определить название фильма', 'error');
      return;
    }

    var enabledBalancers = BALANCERS.filter(function (b) { return isEnabled(b.id); });

    if (!enabledBalancers.length) {
      notice(PLUGIN_NAME + ': все источники отключены', 'error');
      return;
    }

    /* Add "All sources" option at the top */
    var items = [{ title: '🔍 Все источники', balancer: null }].concat(
      enabledBalancers.map(function (b) {
        return {
          title: b.icon + ' ' + b.name + ' · ' + b.quality + (b.vip ? ' [VIP]' : ''),
          balancer: b
        };
      })
    );

    showSelect({
      title: PLUGIN_NAME + ' — ' + (meta.title || 'Источник'),
      items: items,
      onSelect: function (selected) {
        if (!selected.balancer) {
          /* Search all enabled balancers */
          notice(PLUGIN_NAME + ': поиск по всем источникам…', 'info');
          var tasks = enabledBalancers.map(function (b) {
            return fetchBalancer(b.id, meta).then(function (items) {
              return items.map(function (item) { item.balancer = item.balancer || b.name; return item; });
            });
          });
          Promise.all(tasks).then(function (results) {
            var all = [];
            results.forEach(function (arr) { all = all.concat(arr || []); });
            openStreamList(all, card);
          }).catch(function (err) {
            notice(PLUGIN_NAME + ': ошибка поиска (' + (err.message || '') + ')', 'error');
          });
        } else {
          /* Search single balancer */
          notice(PLUGIN_NAME + ': поиск [' + selected.balancer.name + ']…', 'info');
          fetchBalancer(selected.balancer.id, meta).then(function (items) {
            items.forEach(function (item) { item.balancer = item.balancer || selected.balancer.name; });
            openStreamList(items, card);
          });
        }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Source manager (toggle individual balancers)                        */
  /* ------------------------------------------------------------------ */

  function openSourceManager() {
    showSelect({
      title: PLUGIN_NAME + ' — Управление источниками',
      items: BALANCERS.map(function (b) {
        return {
          title: (isEnabled(b.id) ? '✅ ' : '⛔ ') + b.icon + ' ' + b.name,
          subtitle: (b.vip ? 'VIP · ' : '') + b.quality,
          bid: b.id
        };
      }),
      onSelect: function (row) {
        setEnabled(row.bid, !isEnabled(row.bid));
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
      param: { name: 'easy_mods_proxy', type: 'input', default: PROXY_DEFAULT },
      field: {
        name: PLUGIN_NAME + ': Proxy URL',
        description: 'URL бэкенд-прокси, например https://mods.example.com/api/balancers'
      },
      onChange: function (v) { set('easy_mods_proxy', v); State.cache = {}; }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_filmix_token', type: 'input', default: '' },
      field: {
        name: PLUGIN_NAME + ': Filmix токен',
        description: 'Введите токен для доступа к Filmix 4K (опционально)'
      },
      onChange: function (v) { set('easy_mods_filmix_token', v); State.cache = {}; }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_manage', type: 'trigger', default: false },
      field: {
        name: PLUGIN_NAME + ': Управление источниками',
        description: 'Включить / отключить отдельные балансеры'
      },
      onChange: function () { openSourceManager(); }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Button HTML (injected into the full movie card)                     */
  /* ------------------------------------------------------------------ */

  var BTN_HTML = '<div class="full-start__button selector view--' + PLUGIN_ID + '" data-subtitle="' + PLUGIN_NAME + '">'
    + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">'
    + '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<path d="M10 8l6 4-6 4V8z" fill="currentColor"/>'
    + '</svg>'
    + '<span>' + PLUGIN_NAME + '</span>'
    + '</div>';

  /* ------------------------------------------------------------------ */
  /*  Inject button into the full movie card                              */
  /* ------------------------------------------------------------------ */

  function injectButton(e) {
    /* Avoid injecting twice */
    var render = e.object.activity.render();
    if (render.find('.view--' + PLUGIN_ID).length) return;

    var btn = $(BTN_HTML);
    btn.on('hover:enter', function () {
      openBalancerSelect(e.data.movie);
    });

    /* Try to place after existing online/torrent button, fall back to appending */
    var anchor = render.find('.view--torrent, .view--online, .view--online_mod').first();
    if (anchor.length) {
      anchor.after(btn);
    } else {
      var btns = render.find('.full-start__buttons');
      if (btns.length) btns.append(btn);
      else render.append(btn);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Plugin manifest (makes Easy-Mods appear in context menu too)        */
  /* ------------------------------------------------------------------ */

  function registerManifest() {
    if (!Lampa.Manifest) return;
    Lampa.Manifest.plugins = {
      type: 'video',
      version: '2.0',
      name: PLUGIN_NAME,
      description: 'Онлайн-источники: HDRezka, Kodik, Alloha, VideoCDN и др.',
      component: PLUGIN_ID
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Init                                                                */
  /* ------------------------------------------------------------------ */

  function init() {
    if (State.inited) return;
    State.inited = true;

    installSettings();
    registerManifest();

    Lampa.Listener.follow('full', function (e) {
      /* NOTE: Lampa uses 'complite' (intentional internal typo) for the ready event */
      if (e.type === 'complite') injectButton(e);
    });

    notice(PLUGIN_NAME + ' активирован', 'accept');
  }

  if (window.appready) {
    init();
  } else if (Lampa.Listener && Lampa.Listener.follow) {
    Lampa.Listener.follow('app', function (e) {
      if (e && e.type === 'ready') init();
    });
  }

})();
