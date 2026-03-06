(function () {
  'use strict';

  var PLUGIN_ID = 'koro_mods';
  var PLUGIN_NAME = 'Easy-Mods';
  var DEFAULT_API = 'https://your-backend-domain.com/api';
  var CACHE_TTL = 5 * 60 * 1000;

  if (!window.Lampa) return;

  var State = {
    initialized: false,
    lastFetchAt: 0,
    cached: null,
    isLoading: false
  };

  function notice(text, type) {
    if (Lampa.Notice && Lampa.Notice.show) Lampa.Notice.show(text, type || 'info');
  }

  function settings() {
    return {
      api: Lampa.Storage.get('koro_mods_api', DEFAULT_API),
      key: Lampa.Storage.get('koro_mods_vip_key', '')
    };
  }

  function normalizeApi(url) {
    return String(url || DEFAULT_API).replace(/\/+$/, '');
  }

  function sourceTitle(src) {
    var vipBadge = src.vip ? ' <span style="color:#ff9800;font-weight:700">VIP</span>' : '';
    var quality = src.quality ? ' · ' + src.quality : '';
    return (src.icon || '🎬') + ' ' + src.name + quality + vipBadge;
  }

  function sourceDescr(src) {
    return src.description || 'Онлайн источник';
  }

  function mapToLampaSource(src) {
    return {
      title: sourceTitle(src),
      name: src.name,
      url: src.url || src.balancer,
      timeline: true,
      search: true,
      premium: !!src.vip,
      params: {
        quality: src.quality || 'HD',
        description: sourceDescr(src),
        vip: !!src.vip,
        icon: src.icon || '🎬'
      }
    };
  }

  function parseResponse(data) {
    if (!data || !Array.isArray(data.sources)) return { sources: [], isVip: false };
    return { sources: data.sources, isVip: !!data.isVip, vipMeta: data.vip || null };
  }

  function fetchSources(force) {
    var now = Date.now();
    if (!force && State.cached && now - State.lastFetchAt < CACHE_TTL) {
      return Promise.resolve(State.cached);
    }

    if (State.isLoading) {
      return new Promise(function (resolve) {
        var timer = setInterval(function () {
          if (!State.isLoading) {
            clearInterval(timer);
            resolve(State.cached || { sources: [], isVip: false });
          }
        }, 120);
      });
    }

    State.isLoading = true;

    var conf = settings();
    var api = normalizeApi(conf.api);
    var url = api + '/sources?vipKey=' + encodeURIComponent(conf.key || '');

    return fetch(url)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        State.cached = parseResponse(payload);
        State.lastFetchAt = Date.now();

        if (State.cached.isVip) {
          notice('Easy-Mods: VIP активирован', 'accept');
        }

        return State.cached;
      })
      .catch(function (error) {
        notice('Easy-Mods: ошибка загрузки источников (' + error.message + ')', 'error');
        return { sources: [], isVip: false };
      })
      .finally(function () {
        State.isLoading = false;
      });
  }

  function registerSources(data) {
    if (!Lampa.Online || !Lampa.Online.addSource) return;

    var list = data.sources || [];

    list.forEach(function (src) {
      var lampaSource = mapToLampaSource(src);
      Lampa.Online.addSource(PLUGIN_ID + '_' + (src.id || src.name), lampaSource);
    });

    notice('Easy-Mods: загружено источников: ' + list.length, 'info');
  }

  function bindOnlineListener() {
    if (!Lampa.Listener || !Lampa.Listener.follow) return;

    Lampa.Listener.follow('online', function (event) {
      if (!event) return;

      if (event.type === 'open' || event.type === 'init' || event.name === 'open') {
        fetchSources(false).then(registerSources);
      }
    });
  }

  function checkVipKey() {
    var conf = settings();
    var api = normalizeApi(conf.api);

    if (!conf.key) {
      notice('Easy-Mods: VIP ключ не задан (работает free-режим)', 'info');
      return;
    }

    fetch(api + '/check-vip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: conf.key })
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (data.valid) {
          notice('Easy-Mods: VIP ключ подтверждён', 'accept');
        } else {
          notice('Easy-Mods: VIP ключ невалиден (' + data.reason + ')', 'error');
        }
      })
      .catch(function (error) {
        notice('Easy-Mods: не удалось проверить VIP (' + error.message + ')', 'error');
      });
  }

  function installSettings() {
    if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: {
        name: 'koro_mods_api',
        type: 'input',
        values: '',
        default: DEFAULT_API
      },
      field: {
        name: 'Easy-Mods: API URL',
        description: 'URL backend API, например https://domain.com/api'
      },
      onChange: function (value) {
        Lampa.Storage.set('koro_mods_api', value);
        State.lastFetchAt = 0;
        State.cached = null;
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'interface',
      param: {
        name: 'koro_mods_vip_key',
        type: 'input',
        values: '',
        default: ''
      },
      field: {
        name: 'Easy-Mods: VIP ключ',
        description: 'Введите ключ для доступа к VIP источникам'
      },
      onChange: function (value) {
        Lampa.Storage.set('koro_mods_vip_key', value);
        State.lastFetchAt = 0;
        State.cached = null;
        checkVipKey();
      }
    });
  }

  function init() {
    if (State.initialized) return;
    State.initialized = true;

    installSettings();
    bindOnlineListener();
    checkVipKey();
    fetchSources(true).then(registerSources);

    notice('Easy-Mods плагин активирован', 'accept');
  }

  if (window.appready) init();
  else Lampa.Listener.follow('app', function (e) {
    if (e.type === 'ready') init();
  });
})();
