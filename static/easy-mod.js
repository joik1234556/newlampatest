(function () {
  'use strict';

  // --- Dedup guard ---
  if (window.__easy_mod_loaded) return;
  window.__easy_mod_loaded = true;

  var API = 'https://YOUR-LEGAL-BACKEND.DOMAIN'; // <-- поменяй
  var BTN_CLASS = 'easy-mod-btn';

  function log() {
    try { console.log.apply(console, ['[Easy-Mod]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  // --- Network factory (Lampa 3.1.6 uses Reguest) ---
  function makeRequest() {
    var Ctor = (typeof Lampa !== 'undefined' && Lampa.Reguest) ? Lampa.Reguest
             : (typeof Lampa !== 'undefined' && Lampa.Request) ? Lampa.Request
             : null;
    return Ctor ? new Ctor() : null;
  }

  function qs(params) {
    var out = [];
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) {
      out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    return out.length ? ('?' + out.join('&')) : '';
  }

  function apiGet(path, params, ok, bad) {
    var url = API + path + qs(params || {});
    var req = makeRequest();
    if (!req) return bad && bad('no network');
    log('GET', url);
    req.silent(url, function (data) {
      try {
        var json = (typeof data === 'string') ? JSON.parse(data) : data;
        ok && ok(json);
      } catch (e) {
        bad && bad('json parse error');
      }
    }, function (err) {
      bad && bad(err || 'network error');
    });
  }

  // ------------------------------------------------------------------
  // Component: easy_mod_variants
  // ------------------------------------------------------------------
  function EasyModVariants(object) {
    this._object = object || {};
    this._movie  = (object && object.movie) ? object.movie : {};
    this._render = $('<div class="easy-mod-page">');
    this._dead   = false;
  }

  EasyModVariants.prototype.render = function () { return this._render; };

  EasyModVariants.prototype.start = function () {
    var self = this;
    var m = self._movie || {};
    var title = m.title || m.name || m.original_title || m.original_name || '';
    var year  = m.year || m.release_date || '';

    self._render.html('<div class="online-empty">Загрузка…</div>');

    apiGet('/easy_mod/variants', { title: title, year: year }, function (data) {
      if (self._dead) return;

      var variants = (data && data.variants && data.variants.length) ? data.variants : [];
      self._render.empty();

      if (!variants.length) {
        self._render.html('<div class="online-empty">Ничего не найдено</div>');
        try { Lampa.Controller.toggle('content'); } catch (e) {}
        return;
      }

      // список
      var list = $('<div class="easy-mod-list">');
      for (var i = 0; i < variants.length; i++) (function (v) {
        var row = $('<div class="selector easy-mod-item">');
        row.append($('<div class="easy-mod-item__title">').text(v.label || 'Вариант'));
        row.append($('<div class="easy-mod-item__meta">').text(v.quality || ''));

        row.on('hover:enter click', function () {
          try {
            var url = v.url || '';
            if (!url && v.id) {
              // optional: request play url by id
              self._render.html('<div class="online-empty">Подготовка…</div>');
              apiGet('/easy_mod/play', { id: v.id }, function (r) {
                var u = r && r.url ? r.url : '';
                if (!u) return Lampa.Noty.show('[Easy-Mod] Нет ссылки');
                play(u, m);
              }, function () {
                Lampa.Noty.show('[Easy-Mod] Ошибка получения ссылки');
              });
              return;
            }
            if (!url) return Lampa.Noty.show('[Easy-Mod] Нет ссылки');
            play(url, m);
          } catch (e) {
            log('play error', e.message);
          }
        });

        list.append(row);
      })(variants[i]);

      self._render.append(list);
      try { Lampa.Controller.toggle('content'); } catch (e) {}
    }, function () {
      if (self._dead) return;
      self._render.html('<div class="online-empty">Ошибка сервера</div>');
    });
  };

  EasyModVariants.prototype.destroy = function () {
    this._dead = true;
    try { this._render.remove(); } catch (e) {}
  };

  function play(url, movie) {
    var title = (movie && (movie.title || movie.name)) ? (movie.title || movie.name) : 'Easy-Mod';
    var poster = (movie && movie.poster) ? movie.poster : '';
    log('PLAY', url);
    Lampa.Player.play({ title: title, url: url, poster: poster, subtitles: [] });
    try { Lampa.Player.playlist([{ title: title, url: url }]); } catch (e) {}
  }

  // ------------------------------------------------------------------
  // Button injection (reliable, without depending on view--torrent)
  // ------------------------------------------------------------------
  function injectButton(movie, render) {
    var tries = 0;
    var maxTries = 60; // 18 sec

    var timer = setInterval(function () {
      tries++;
      if (tries > maxTries) {
        clearInterval(timer);
        log('inject: timeout');
        return;
      }

      var find = (render && render.find) ? function (s) { return render.find(s); } : function (s) { return $(s); };

      // already exists?
      if (find('.' + BTN_CLASS).length) {
        clearInterval(timer);
        return;
      }

      // best container: buttons bar
      var bar = find('.full-start__buttons');
      if (!bar.length) bar = find('.full-start');
      if (!bar.length) return; // not ready yet

      clearInterval(timer);

      var btn = $('<div class="full-start__button selector ' + BTN_CLASS + '">')
        .append('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>')
        .append($('<span>').text('Easy-Mod'));

      btn.on('hover:enter click', function () {
        log('open variants for', (movie && (movie.title || movie.name)) || '?');
        Lampa.Activity.push({ component: 'easy_mod_variants', title: 'Easy-Mod', movie: movie });
      });

      // insert near "Смотреть": append to the same bar
      bar.append(btn);
      log('button injected');
    }, 300);
  }

  function hookFull() {
    Lampa.Listener.follow('full', function (e) {
      // Не фильтруем по e.type — в разных сборках по-разному
      var movie =
        (e && e.data && e.data.movie) ? e.data.movie :
        (e && e.object && e.object.movie) ? e.object.movie :
        (e && e.object && e.object.card) ? e.object.card :
        null;

      if (!movie) return;

      var render = null;
      try {
        if (e.object && e.object.activity && e.object.activity.render) {
          render = e.object.activity.render();
        }
      } catch (ex) {}

      injectButton(movie, render);
    });
  }

  function registerComponents() {
    if (!Lampa.Component || !Lampa.Component.add) return;
    Lampa.Component.add('easy_mod_variants', EasyModVariants);
    log('components registered');
  }

  function init() {
    registerComponents();
    hookFull();
    log('init done');
  }

  function boot() {
    if (typeof Lampa === 'undefined') return setTimeout(boot, 500);
    init();
  }

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch (e) {
    boot();
  }
})();
