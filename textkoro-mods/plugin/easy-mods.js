(function () {
  'use strict';

  if (!window.Lampa) return;

  var PLUGIN_ID = 'easy_mods_2026';
  var PLUGIN_TITLE = 'Easy-mods';

  var DEFAULTS = {
    jackettUrl: 'http://127.0.0.1:9117',
    jackettKey: '',
    minSeeders: 10,
    quality: 'Auto',
    voice: 'Любая',
    maxSizeGb: 0,
    sourceEnabledMap: {}
  };

  var SOURCE_LIST = [
    { id: 'veoveo', name: 'VeoVeo', icon: '🎥', vip: false, quality: 'HD, FullHD, 4K', balancer: 'https://veoveo.cc' },
    { id: 'videx', name: 'ViDEX', icon: '📺', vip: false, quality: 'HD, FullHD', balancer: 'https://videx.cc' },
    { id: 'mango', name: 'ManGo', icon: '🍊', vip: true, quality: '4K HDR10+, FullHD', balancer: 'https://mango.go' },
    { id: 'fxpro', name: 'FXpro', icon: '⭐', vip: true, quality: '4K HDR, +UA дубляж', balancer: 'https://fxpro.cc' },
    { id: 'flixsod', name: 'FlixSOD', icon: '🔥', vip: true, quality: '4K SDR, 1080p', balancer: 'https://flixsod.cc' },
    { id: 'alloha', name: 'Alloha', icon: '🌊', vip: true, quality: '4K HDR, много озвучек', balancer: 'https://alloha.tv' },
    { id: 'easy-mods', name: 'Easy-mods', icon: '💠', vip: false, quality: '4K HDR, Jackett + TorrServer', special: true },
    { id: 'hdrezka', name: 'HDRezka', icon: '🎞️', vip: true, quality: '4K SDR, дубляж', balancer: 'https://hdrezka.ag' },
    { id: 'hdvb', name: 'HDVB', icon: '📀', vip: true, quality: 'FullHD, 4K', balancer: 'https://hdvb.cc' }
  ];

  var state = {
    inited: false,
    currentCard: null,
    lastResults: []
  };

  function notice(text, type) {
    if (Lampa.Notice && Lampa.Notice.show) Lampa.Notice.show(text, type || 'info');
  }

  function get(key, fallback) {
    return Lampa.Storage.get(key, fallback);
  }

  function set(key, value) {
    Lampa.Storage.set(key, value);
  }

  function getConfig() {
    return {
      jackettUrl: String(get('easy_mods_jackett_url', DEFAULTS.jackettUrl)).replace(/\/+$/, ''),
      jackettKey: String(get('easy_mods_jackett_key', DEFAULTS.jackettKey)).trim(),
      minSeeders: parseInt(get('easy_mods_min_seeders', DEFAULTS.minSeeders), 10) || 0,
      quality: get('easy_mods_quality', DEFAULTS.quality),
      voice: get('easy_mods_voice', DEFAULTS.voice),
      maxSizeGb: parseFloat(get('easy_mods_max_size_gb', DEFAULTS.maxSizeGb)) || 0,
      sourceEnabledMap: get('easy_mods_source_enabled_map', DEFAULTS.sourceEnabledMap)
    };
  }

  function getSourceEnabledMap() {
    var map = getConfig().sourceEnabledMap;
    if (!map || typeof map !== 'object') map = {};
    return map;
  }

  function isSourceEnabled(sourceId) {
    var map = getSourceEnabledMap();
    if (typeof map[sourceId] === 'boolean') return map[sourceId];
    return true;
  }

  function setSourceEnabled(sourceId, enabled) {
    var map = getSourceEnabledMap();
    map[sourceId] = !!enabled;
    set('easy_mods_source_enabled_map', map);
  }

  function markVip(source) {
    return source.vip ? ' <span style="color:#ff9800;font-weight:700">VIP</span>' : '';
  }

  function makeSourceTitle(source) {
    return source.icon + ' ' + source.name + ' · ' + source.quality + markVip(source);
  }

  function addOnlineSources() {
    if (!Lampa.Online || !Lampa.Online.addSource) return;

    SOURCE_LIST.forEach(function (source) {
      if (!isSourceEnabled(source.id)) return;

      var payload = {
        title: makeSourceTitle(source),
        name: source.name,
        url: source.balancer || 'about:blank',
        search: true,
        timeline: true,
        premium: !!source.vip,
        params: {
          sourceId: source.id,
          special: !!source.special,
          quality: source.quality,
          vip: !!source.vip,
          icon: source.icon
        }
      };

      Lampa.Online.addSource(PLUGIN_ID + '_' + source.id, payload);
    });

    notice('Easy-mods: источники обновлены', 'accept');
  }

  function cardToQuery(card) {
    if (!card) return '';
    var title = card.original_title || card.title || card.name || '';
    var year = card.release_date ? String(card.release_date).slice(0, 4) : (card.year || '');
    return (title + ' ' + year).trim();
  }

  function normalizeMagnet(item) {
    var uri = item.MagnetUri || item.Link || '';
    if (uri && uri.indexOf('magnet:?') === 0) return uri;
    return '';
  }

  function parseSize(sizeBytes) {
    var num = Number(sizeBytes || 0);
    if (!num || !isFinite(num)) return 0;
    return num / 1024 / 1024 / 1024;
  }

  function detectQuality(text) {
    var t = String(text || '').toLowerCase();
    if (/(2160|4k|uhd|hdr)/i.test(t)) return '4K HDR';
    if (/(1080|fhd)/i.test(t)) return '1080p';
    if (/(720|hd)/i.test(t)) return '720p';
    return 'Auto';
  }

  function detectVoice(text) {
    var t = String(text || '').toLowerCase();
    if (/(ua|укр|україн)/i.test(t)) return '+UA';
    if (/(дубляж|dubbing|dubbed)/i.test(t)) return 'Дубляж';
    if (/(многоголос|multi|mvo)/i.test(t)) return 'Многоголосый';
    if (/(оригинал|original|eng)/i.test(t)) return 'Оригинал';
    return 'Любая';
  }

  function mapJackettResult(item) {
    var title = item.Title || 'Без названия';
    var sizeGb = parseSize(item.Size);
    var seeders = Number(item.Seeders || 0);

    return {
      title: title,
      tracker: item.Tracker || item.TrackerId || 'indexer',
      magnet: normalizeMagnet(item),
      seeders: seeders,
      peers: Number(item.Peers || 0),
      sizeGb: sizeGb,
      quality: detectQuality(title),
      voice: detectVoice(title),
      publishDate: item.PublishDate || null
    };
  }

  function applyFilters(items, filters) {
    return items.filter(function (item) {
      if (!item.magnet) return false;
      if (filters.quality !== 'Auto' && item.quality !== filters.quality) return false;
      if (filters.voice !== 'Любая' && item.voice !== filters.voice) return false;
      if (item.seeders < filters.minSeeders) return false;
      if (filters.maxSizeGb > 0 && item.sizeGb > filters.maxSizeGb) return false;
      return true;
    }).sort(function (a, b) {
      if (b.seeders !== a.seeders) return b.seeders - a.seeders;
      return a.sizeGb - b.sizeGb;
    });
  }

  function formatTorrentLabel(item) {
    return item.quality + ' · ' + item.voice + ' · ' + item.seeders + ' сидов · ' + item.sizeGb.toFixed(2) + ' GB';
  }

  function safeSelect(params) {
    if (Lampa.Select && Lampa.Select.show) return Lampa.Select.show(params);
    notice('Easy-mods: Lampa.Select недоступен', 'error');
  }

  function updateFilterValue(title, choices, currentValue, onDone) {
    var items = choices.map(function (value) {
      return {
        title: (value === currentValue ? '✅ ' : '') + value,
        value: value
      };
    });

    safeSelect({
      title: title,
      items: items,
      onSelect: function (selected) {
        onDone(selected.value);
      }
    });
  }

  function openFilterMenu(filters, onApply) {
    var items = [
      { title: 'Качество: ' + filters.quality, action: 'quality' },
      { title: 'Озвучка: ' + filters.voice, action: 'voice' },
      { title: 'Минимум сидов: ' + filters.minSeeders, action: 'seeds' },
      { title: 'Максимум размер (GB): ' + (filters.maxSizeGb || '∞'), action: 'size' },
      { title: 'Применить фильтры', action: 'apply' }
    ];

    safeSelect({
      title: 'Easy-mods · Фильтры',
      items: items,
      onSelect: function (item) {
        if (item.action === 'quality') {
          updateFilterValue('Качество', ['Auto', '4K HDR', '1080p', '720p'], filters.quality, function (v) {
            filters.quality = v;
            set('easy_mods_quality', v);
            openFilterMenu(filters, onApply);
          });
          return;
        }

        if (item.action === 'voice') {
          updateFilterValue('Озвучка', ['Любая', 'Дубляж', 'Многоголосый', 'Оригинал', '+UA'], filters.voice, function (v) {
            filters.voice = v;
            set('easy_mods_voice', v);
            openFilterMenu(filters, onApply);
          });
          return;
        }

        if (item.action === 'seeds') {
          updateFilterValue('Минимум сидов', ['0', '5', '10', '20', '50'], String(filters.minSeeders), function (v) {
            filters.minSeeders = parseInt(v, 10) || 0;
            set('easy_mods_min_seeders', filters.minSeeders);
            openFilterMenu(filters, onApply);
          });
          return;
        }

        if (item.action === 'size') {
          updateFilterValue('Макс. размер GB', ['0', '5', '10', '20', '30', '50'], String(filters.maxSizeGb), function (v) {
            filters.maxSizeGb = parseFloat(v) || 0;
            set('easy_mods_max_size_gb', filters.maxSizeGb);
            openFilterMenu(filters, onApply);
          });
          return;
        }

        onApply(filters);
      }
    });
  }

  function playViaTorrServer(item, card) {
    if (!Lampa.TorrServer || !Lampa.TorrServer.add) {
      notice('Easy-mods: TorrServer модуль недоступен', 'error');
      return;
    }

    var title = (card && (card.title || card.name || card.original_title)) || item.title;
    var poster = card && card.poster_path ? card.poster_path : '';

    try {
      var result = Lampa.TorrServer.add({
        title: title,
        url: item.magnet,
        poster: poster,
        data: { source: 'easy-mods', tracker: item.tracker },
        callback: function (stream) {
          if (stream) runPlayer(stream, title);
        }
      });

      if (result && typeof result.then === 'function') {
        result.then(function (stream) {
          if (stream) runPlayer(stream, title);
        });
      } else if (typeof result === 'string') {
        runPlayer(result, title);
      }

      notice('Easy-mods: отправлено в TorrServer', 'accept');
    } catch (e) {
      notice('Easy-mods: ошибка TorrServer (' + e.message + ')', 'error');
    }
  }

  function runPlayer(stream, title) {
    if (!stream) return;

    if (Lampa.Player && typeof Lampa.Player.play === 'function') {
      try {
        Lampa.Player.play({
          url: stream.url || stream,
          title: title,
          quality: 'torrent'
        });
        return;
      } catch (e) {}

      try {
        Lampa.Player.play(stream.url || stream);
      } catch (e2) {
        notice('Easy-mods: не удалось запустить плеер', 'error');
      }
    }
  }

  function openTorrentList(results, card, query) {
    var cfg = getConfig();
    var filtered = applyFilters(results, cfg);

    var items = [
      {
        title: '⚙️ Настроить фильтры',
        subtitle: 'Качество / Озвучка / Сиды / Размер',
        action: 'filters'
      }
    ];

    filtered.slice(0, 200).forEach(function (item) {
      items.push({
        title: item.title,
        subtitle: formatTorrentLabel(item) + ' · ' + item.tracker,
        action: 'torrent',
        item: item
      });
    });

    safeSelect({
      title: 'Easy-mods · ' + query + ' (' + filtered.length + ')',
      items: items,
      onSelect: function (selected) {
        if (selected.action === 'filters') {
          openFilterMenu(cfg, function () {
            openTorrentList(results, card, query);
          });
          return;
        }

        if (selected.action === 'torrent' && selected.item) {
          playViaTorrServer(selected.item, card);
        }
      }
    });
  }

  function fetchJackett(query) {
    var cfg = getConfig();

    if (!cfg.jackettKey) {
      notice('Easy-mods: укажите Jackett API Key в настройках', 'error');
      return Promise.resolve([]);
    }

    var endpoint = cfg.jackettUrl + '/api/v2.0/indexers/all/results?apikey=' +
      encodeURIComponent(cfg.jackettKey) + '&Query=' + encodeURIComponent(query);

    return fetch(endpoint)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        var rows = Array.isArray(payload.Results) ? payload.Results : [];
        return rows.map(mapJackettResult);
      })
      .catch(function (error) {
        notice('Easy-mods: Jackett недоступен (' + error.message + ')', 'error');
        return [];
      });
  }

  function openEasyModsSearch(card) {
    var query = cardToQuery(card);
    if (!query) {
      notice('Easy-mods: не удалось определить название фильма', 'error');
      return;
    }

    notice('Easy-mods: поиск в Jackett…', 'info');

    fetchJackett(query).then(function (results) {
      state.lastResults = results;

      if (!results.length) {
        notice('Easy-mods: ничего не найдено', 'info');
        return;
      }

      openTorrentList(results, card, query);
    });
  }

  function openSourceToggleMenu() {
    var items = SOURCE_LIST.map(function (source) {
      var enabled = isSourceEnabled(source.id);
      return {
        sourceId: source.id,
        title: (enabled ? '✅ ' : '⛔ ') + source.icon + ' ' + source.name,
        subtitle: source.vip ? 'VIP' : 'FREE'
      };
    });

    safeSelect({
      title: 'Easy-mods · Управление источниками',
      items: items,
      onSelect: function (selected) {
        var current = isSourceEnabled(selected.sourceId);
        setSourceEnabled(selected.sourceId, !current);
        addOnlineSources();
        openSourceToggleMenu();
      }
    });
  }

  function installSettings() {
    if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_jackett_url', type: 'input', default: DEFAULTS.jackettUrl },
      field: { name: 'Easy-mods: Jackett URL', description: 'Например: http://127.0.0.1:9117' },
      onChange: function (v) { set('easy_mods_jackett_url', v); }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_jackett_key', type: 'input', default: DEFAULTS.jackettKey },
      field: { name: 'Easy-mods: Jackett API Key', description: 'Ключ из Jackett Dashboard' },
      onChange: function (v) { set('easy_mods_jackett_key', v); }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_manage_sources', type: 'trigger', default: false },
      field: { name: 'Easy-mods: Вкл/выкл источники', description: 'Открыть список источников' },
      onChange: function () { openSourceToggleMenu(); }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: { name: 'easy_mods_manual_search', type: 'trigger', default: false },
      field: { name: 'Easy-mods: Открыть поиск Jackett', description: 'Запустить поиск для текущей карточки' },
      onChange: function () { openEasyModsSearch(state.currentCard); }
    });
  }

  function listenOnlineEvents() {
    if (!Lampa.Listener || !Lampa.Listener.follow) return;

    Lampa.Listener.follow('full', function (e) {
      if (e && e.data && e.data.movie) state.currentCard = e.data.movie;
      if (e && e.data && e.data.card) state.currentCard = e.data.card;
    });

    Lampa.Listener.follow('online', function (event) {
      if (!event) return;

      if (event.movie) state.currentCard = event.movie;
      if (event.card) state.currentCard = event.card;

      var sourceId = '';
      if (event.source && event.source.params && event.source.params.sourceId) sourceId = event.source.params.sourceId;
      if (event.sourceId) sourceId = event.sourceId;

      if (sourceId === 'easy-mods' && (event.type === 'select' || event.type === 'open' || event.type === 'start')) {
        openEasyModsSearch(state.currentCard);
      }

      if (event.type === 'open' || event.type === 'init') {
        addOnlineSources();
      }
    });
  }

  function init() {
    if (state.inited) return;
    state.inited = true;

    installSettings();
    listenOnlineEvents();
    addOnlineSources();

    notice('Easy-mods: плагин активирован', 'accept');
  }

  if (window.appready) init();
  else if (Lampa.Listener && Lampa.Listener.follow) {
    Lampa.Listener.follow('app', function (e) {
      if (e && e.type === 'ready') init();
    });
  }
})();
