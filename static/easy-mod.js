(function () {
  'use strict';

  if (!window.Lampa) return;

  var PLUGIN_ID = 'easy_mods_client_2026';
  var SERVER_DEFAULT = 'https://your-easy-mods-domain.com';

  var SOURCES = [
    { id: 'veoveo', name: 'VeoVeo', icon: '🎥', vip: false, quality: 'HD, FullHD, 4K', balancer: 'https://veoveo.cc' },
    { id: 'videx', name: 'ViDEX', icon: '📺', vip: false, quality: 'HD, FullHD', balancer: 'https://videx.cc' },
    { id: 'mango', name: 'ManGo', icon: '🍊', vip: true, quality: '4K HDR10+, FullHD', balancer: 'https://mango.go' },
    { id: 'fxpro', name: 'FXpro', icon: '⭐', vip: true, quality: '4K HDR, +UA дубляж', balancer: 'https://fxpro.cc' },
    { id: 'flixsod', name: 'FlixSOD', icon: '🔥', vip: true, quality: '4K SDR, 1080p', balancer: 'https://flixsod.cc' },
    { id: 'alloha', name: 'Alloha', icon: '🌊', vip: true, quality: '4K HDR, много озвучек', balancer: 'https://alloha.tv' },
    { id: 'easy-mods', name: 'Easy-mods', icon: '💎', vip: false, quality: 'Server stream: 4K/HDR/UA', special: true },
    { id: 'hdrezka', name: 'HDRezka', icon: '🎞️', vip: true, quality: '4K SDR, дубляж', balancer: 'https://hdrezka.ag' },
    { id: 'hdvb', name: 'HDVB', icon: '📀', vip: true, quality: 'FullHD, 4K', balancer: 'https://hdvb.cc' },
    { id: 'collaps', name: 'Collaps', icon: '🔶', vip: false, quality: 'HD, FullHD', special: true },
    { id: 'bazon', name: 'Bazon', icon: '🟣', vip: false, quality: 'HD, FullHD', special: true }
  ];

  var state = {
    inited: false,
    currentCard: null,
    greeted: false,
    streamItems: []
  };

  function get(key, fallback) {
    return Lampa.Storage.get(key, fallback);
  }

  function set(key, value) {
    Lampa.Storage.set(key, value);
  }

  function notice(text, type) {
    if (Lampa.Notice && Lampa.Notice.show) Lampa.Notice.show(text, type || 'info');
  }

  function readCfg() {
    return {
      serverUrl: String(get('easy_mods_server_url', SERVER_DEFAULT)).replace(/\/+$/, ''),
      jackettUrl: String(get('easy_mods_jackett_url', 'http://127.0.0.1:9117')).replace(/\/+$/, ''),
      jackettKey: String(get('easy_mods_jackett_key', '')).trim(),
      isVip: !!get('easy_mods_is_vip', false),
      sourceEnabledMap: get('easy_mods_source_enabled_map', {}),
      quality: get('easy_mods_filter_quality', 'Auto'),
      voice: get('easy_mods_filter_voice', 'Любая'),
      minSeeders: parseInt(get('easy_mods_filter_seeders', 10), 10) || 0,
      maxSizeGb: parseFloat(get('easy_mods_filter_size', 0)) || 0
    };
  }

  function isSourceEnabled(sourceId) {
    var cfg = readCfg();
    var map = cfg.sourceEnabledMap;
    if (!map || typeof map !== 'object') return true;
    if (typeof map[sourceId] === 'boolean') return map[sourceId];
    return true;
  }

  function setSourceEnabled(sourceId, enabled) {
    var cfg = readCfg();
    var map = cfg.sourceEnabledMap;
    if (!map || typeof map !== 'object') map = {};
    map[sourceId] = !!enabled;
    set('easy_mods_source_enabled_map', map);
  }

  function cardToPayload(card) {
    if (!card) return null;

    var title = card.original_title || card.title || card.name || '';
    var year = card.release_date ? String(card.release_date).slice(0, 4) : (card.year || null);

    return {
      title: title,
      year: year,
      kinopoisk_id: card.kinopoisk_id || null,
      tmdb_id: card.id || null,
      imdb_id: card.imdb_id || null,
      type: card.seasons ? 'tv' : 'movie',
      season: card.season || null,
      episode: card.episode || null
    };
  }

  function htmlVip(source) {
    return source.vip ? ' <span style="color:#ff9800;font-weight:700">VIP</span>' : '';
  }

  function sourceTitle(source) {
    return source.icon + ' ' + source.name + ' · ' + source.quality + htmlVip(source);
  }

  function addSourcesToOnline() {
    if (!Lampa.Online || !Lampa.Online.addSource) return;

    SOURCES.forEach(function (source) {
      if (!isSourceEnabled(source.id)) return;
      if (source.vip && !readCfg().isVip) return;

      Lampa.Online.addSource(PLUGIN_ID + '_' + source.id, {
        title: sourceTitle(source),
        name: source.name,
        url: source.balancer || 'about:blank',
        search: true,
        timeline: true,
        premium: !!source.vip,
        params: {
          sourceId: source.id,
          special: !!source.special
        }
      });
    });
  }

  function doFetch(url, opts) {
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function applyClientFilters(items, cfg) {
    return (items || []).filter(function (item) {
      if (cfg.quality !== 'Auto' && item.quality !== cfg.quality) return false;
      if (cfg.voice !== 'Любая' && item.voice !== cfg.voice) return false;
      if (Number(item.seeders || 0) < cfg.minSeeders) return false;
      if (cfg.maxSizeGb > 0 && Number(item.sizeGb || 0) > cfg.maxSizeGb) return false;
      return true;
    });
  }

  function selectMenu(data) {
    if (!Lampa.Select || !Lampa.Select.show) {
      notice('Easy-mods: Select UI недоступен', 'error');
      return;
    }
    Lampa.Select.show(data);
  }

  function filterMenu(cfg, done) {
    selectMenu({
      title: 'Easy-mods · Фильтры',
      items: [
        { title: 'Качество: ' + cfg.quality, key: 'quality' },
        { title: 'Озвучка: ' + cfg.voice, key: 'voice' },
        { title: 'Минимум сидов: ' + cfg.minSeeders, key: 'seeders' },
        { title: 'Макс. размер GB: ' + (cfg.maxSizeGb || '∞'), key: 'size' },
        { title: 'Применить', key: 'apply' }
      ],
      onSelect: function (selected) {
        function pick(title, values, current, cb) {
          selectMenu({
            title: title,
            items: values.map(function (v) { return { title: (String(v) === String(current) ? '✅ ' : '') + v, v: v }; }),
            onSelect: function (row) { cb(row.v); }
          });
        }

        if (selected.key === 'quality') return pick('Качество', ['Auto', '4K HDR', '1080p', '720p'], cfg.quality, function (v) { cfg.quality = v; set('easy_mods_filter_quality', v); filterMenu(cfg, done); });
        if (selected.key === 'voice') return pick('Озвучка', ['Любая', 'Дубляж', 'Многоголосый', 'Оригинал', '+UA'], cfg.voice, function (v) { cfg.voice = v; set('easy_mods_filter_voice', v); filterMenu(cfg, done); });
        if (selected.key === 'seeders') return pick('Минимум сидов', ['0', '5', '10', '20', '50'], cfg.minSeeders, function (v) { cfg.minSeeders = parseInt(v, 10) || 0; set('easy_mods_filter_seeders', cfg.minSeeders); filterMenu(cfg, done); });
        if (selected.key === 'size') return pick('Макс размер GB', ['0', '5', '10', '20', '30', '50'], cfg.maxSizeGb, function (v) { cfg.maxSizeGb = parseFloat(v) || 0; set('easy_mods_filter_size', cfg.maxSizeGb); filterMenu(cfg, done); });

        done(cfg);
      }
    });
  }

  function playM3U8(item, card) {
    var title = card && (card.title || card.name || card.original_title) || item.title;
    var url = item.streamUrl || item.url;

    if (!url) {
      notice('Easy-mods: сервер не вернул ссылку streamUrl', 'error');
      return;
    }

    if (Lampa.Player && typeof Lampa.Player.play === 'function') {
      try {
        Lampa.Player.play({
          title: title,
          url: url,
          quality: item.quality || 'Auto'
        });
        return;
      } catch (e) {}

      try {
        Lampa.Player.play(url);
      } catch (e2) {
        notice('Easy-mods: ошибка запуска плеера', 'error');
      }
    }
  }

  function openStreamList(rawItems, card) {
    var cfg = readCfg();
    var list = applyClientFilters(rawItems, cfg);

    var items = [{ title: '⚙️ Фильтры', action: 'filters' }].concat(list.map(function (x) {
      return {
        title: x.title || 'Без названия',
        subtitle: [x.quality || 'Auto', x.voice || 'Любая', (x.seeders || 0) + ' сидов', (x.sizeGb || 0) + ' GB'].join(' · '),
        action: 'play',
        data: x
      };
    }));

    selectMenu({
      title: 'Easy-mods: варианты стрима (' + list.length + ')',
      items: items,
      onSelect: function (selected) {
        if (selected.action === 'filters') {
          filterMenu(cfg, function () {
            openStreamList(rawItems, card);
          });
          return;
        }

        if (selected.action === 'play') {
          playM3U8(selected.data, card);
        }
      }
    });
  }

  function searchOnServer(card) {
    var cfg = readCfg();
    var payload = cardToPayload(card);

    if (!payload || !payload.title) {
      notice('Easy-mods: не удалось определить название', 'error');
      return;
    }

    if (!state.greeted) {
      state.greeted = true;
      notice('Easy-mods использует мой сервер для быстрого просмотра', 'info');
    }

    notice('Easy-mods: ищем стримы на сервере…', 'info');

    doFetch(cfg.serverUrl + '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        year: payload.year,
        type: payload.type,
        season: payload.season,
        episode: payload.episode,
        jackettUrl: cfg.jackettUrl,
        jackettKey: cfg.jackettKey,
        isVip: cfg.isVip
      })
    }).then(function (result) {
      var rows = Array.isArray(result.items) ? result.items : [];
      if (!rows.length) {
        notice('Easy-mods: варианты не найдены', 'info');
        return;
      }

      state.streamItems = rows;
      openStreamList(rows, card);
    }).catch(function (error) {
      notice('Easy-mods: ошибка сервера (' + error.message + ')', 'error');
    });
  }

  function openSourceManager() {
    selectMenu({
      title: 'Easy-mods · Источники',
      items: SOURCES.map(function (source) {
        return {
          sid: source.id,
          title: (isSourceEnabled(source.id) ? '✅ ' : '⛔ ') + source.icon + ' ' + source.name,
          subtitle: source.vip ? 'VIP' : 'FREE'
        };
      }),
      onSelect: function (selected) {
        var enabled = isSourceEnabled(selected.sid);
        setSourceEnabled(selected.sid, !enabled);
        addSourcesToOnline();
        openSourceManager();
      }
    });
  }

  function installSettings() {
    if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_server_url', type: 'input', default: SERVER_DEFAULT },
      field: { name: 'Easy-mods: Мой сервер', description: 'URL backend, например https://mods.example.com' },
      onChange: function (v) { set('easy_mods_server_url', v); }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_jackett_url', type: 'input', default: 'http://127.0.0.1:9117' },
      field: { name: 'Easy-mods: Jackett URL (опционально)', description: 'Нужен, если сервер использует ваш Jackett' },
      onChange: function (v) { set('easy_mods_jackett_url', v); }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_jackett_key', type: 'input', default: '' },
      field: { name: 'Easy-mods: Jackett API Key (опционально)', description: 'Оставьте пустым, если сервер ищет сам' },
      onChange: function (v) { set('easy_mods_jackett_key', v); }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_is_vip', type: 'trigger', default: false },
      field: { name: 'Easy-mods: Я VIP', description: 'Вкл/выкл доступ к VIP-источникам в списке' },
      onChange: function () {
        var now = !readCfg().isVip;
        set('easy_mods_is_vip', now);
        notice('Easy-mods: VIP режим ' + (now ? 'включен' : 'выключен'), now ? 'accept' : 'info');
        addSourcesToOnline();
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_manage_sources', type: 'trigger', default: false },
      field: { name: 'Easy-mods: Вкл/выкл источники', description: 'Управление источниками' },
      onChange: function () { openSourceManager(); }
    });
  }

  function searchBackendSource(card, endpoint, sourceName) {
    var cfg = readCfg();
    var payload = cardToPayload(card);
    if (!payload || !payload.title) {
      notice('Easy-mods: не удалось определить название', 'error');
      return;
    }

    notice('Easy-mods: ищем ' + sourceName + '…', 'info');

    var url = cfg.serverUrl + '/' + endpoint + '?title=' + encodeURIComponent(payload.title);
    if (payload.kinopoisk_id) url += '&kp_id=' + payload.kinopoisk_id;
    if (payload.imdb_id) url += '&imdb_id=' + encodeURIComponent(payload.imdb_id);
    if (payload.year) url += '&year=' + payload.year;
    if (payload.season) url += '&season=' + payload.season;
    if (payload.episode) url += '&episode=' + payload.episode;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.timeout = 15000;
    xhr.onload = function () {
      try {
        var data = JSON.parse(xhr.responseText);
        var rows = (data.files || []).map(function (f) {
          return {
            title: (f.translation || f.quality || sourceName) + (f.quality ? ' · ' + f.quality : ''),
            url: f.url,
            quality: f.quality || 'HD',
            voice: f.translation || sourceName,
            seeders: 0,
            sizeGb: 0,
            streamUrl: f.url
          };
        }).filter(function (f) { return !!f.url; });

        if (!rows.length) {
          notice('Easy-mods: ' + sourceName + ' — варианты не найдены', 'info');
          return;
        }

        state.streamItems = rows;
        openStreamList(rows, card);
      } catch (e) {
        notice('Easy-mods: ' + sourceName + ' — ошибка разбора ответа', 'error');
      }
    };
    xhr.onerror = function () { notice('Easy-mods: ' + sourceName + ' — ошибка сети', 'error'); };
    xhr.ontimeout = function () { notice('Easy-mods: ' + sourceName + ' — таймаут', 'error'); };
    xhr.send();
  }

  function bindListeners() {
    if (!Lampa.Listener || !Lampa.Listener.follow) return;

    Lampa.Listener.follow('full', function (e) {
      if (e && e.data && e.data.movie) state.currentCard = e.data.movie;
      if (e && e.data && e.data.card) state.currentCard = e.data.card;
    });

    Lampa.Listener.follow('online', function (event) {
      if (!event) return;
      if (event.card) state.currentCard = event.card;
      if (event.movie) state.currentCard = event.movie;

      var sourceId = '';
      if (event.source && event.source.params && event.source.params.sourceId) sourceId = event.source.params.sourceId;
      if (event.sourceId) sourceId = event.sourceId;

      if (event.type === 'open' || event.type === 'init') {
        addSourcesToOnline();
      }

      if (sourceId === 'easy-mods' && (event.type === 'select' || event.type === 'open' || event.type === 'start')) {
        searchOnServer(state.currentCard);
      }

      if (sourceId === 'collaps' && (event.type === 'select' || event.type === 'open' || event.type === 'start')) {
        searchBackendSource(state.currentCard, 'collaps', 'Collaps');
      }

      if (sourceId === 'bazon' && (event.type === 'select' || event.type === 'open' || event.type === 'start')) {
        searchBackendSource(state.currentCard, 'bazon', 'Bazon');
      }
    });
  }

  function init() {
    if (state.inited) return;
    state.inited = true;

    installSettings();
    bindListeners();
    addSourcesToOnline();

    notice('Easy-mods: плагин активирован', 'accept');
  }

  if (window.appready) init();
  else if (Lampa.Listener && Lampa.Listener.follow) {
    Lampa.Listener.follow('app', function (e) {
      if (e && e.type === 'ready') init();
    });
  }
})();
