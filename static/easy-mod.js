/**
 * Easy-Mod — прямые стримы через TorBox для Lampa 3.1.6
 * Версия: 3.0
 * Backend: http://46.225.222.255:8000
 */
(function () {
    'use strict';

    // ── Dedup guard (must be the first thing inside the IIFE) ─────────
    console.log('[Easy-Mod] loaded v3.0');
    window.easy_mod_plugin = window.easy_mod_plugin || false;
    if (window.easy_mod_plugin) {
        console.log('[Easy-Mod] already loaded, skip');
        return;
    }
    window.easy_mod_plugin = true;

    var API_URL = 'http://46.225.222.255:8000';

    // Adaptive polling thresholds (ms)
    var POLL_FAST_UNTIL_MS = 30000;   // first 30 s
    var POLL_FAST_INTERVAL = 2000;    // 2 s
    var POLL_SLOW_INTERVAL = 5000;    // 5 s

    // ── Network factory — Lampa.Reguest (3.1.6) with fallback ────────
    function makeRequest() {
        try {
            var Ctor = (typeof Lampa !== 'undefined' && Lampa.Reguest)
                ? Lampa.Reguest
                : (typeof Lampa !== 'undefined' && Lampa.Request)
                    ? Lampa.Request
                    : null;
            if (!Ctor) { throw new Error('No network class'); }
            return new Ctor();
        } catch (e) {
            console.log('[Easy-Mod] ERROR makeRequest:', e.message);
            return null;
        }
    }

    // ── Query-string builder ──────────────────────────────────────────
    function buildQs(params) {
        var parts = [];
        var key;
        for (key in params) {
            if (Object.prototype.hasOwnProperty.call(params, key)) {
                parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
            }
        }
        return parts.length ? ('?' + parts.join('&')) : '';
    }

    // ── HTTP helpers ──────────────────────────────────────────────────
    function apiGet(path, params, onSuccess, onError) {
        try {
            var url = API_URL + path + buildQs(params || {});
            console.log('[Easy-Mod] GET ' + url);
            var req = makeRequest();
            if (!req) { if (onError) { onError('no network'); } return; }
            req.silent(url, function (data) {
                try {
                    var json = (typeof data === 'string') ? JSON.parse(data) : data;
                    onSuccess(json);
                } catch (e) {
                    console.log('[Easy-Mod] ERROR parse GET:', e.message, url);
                    if (onError) { onError(e); }
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR network GET:', err, url);
                if (onError) { onError(err); }
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR apiGet:', e.message);
            if (onError) { onError(e); }
        }
    }

    function apiPost(path, body, onSuccess, onError) {
        try {
            var url = API_URL + path;
            console.log('[Easy-Mod] POST ' + url);
            var req = makeRequest();
            if (!req) { if (onError) { onError('no network'); } return; }
            try { if (typeof req.timeout === 'function') { req.timeout(15000); } } catch (e) { /* silent */ }
            try { if (typeof req.headers === 'function') { req.headers({'Content-Type': 'application/json'}); } } catch (e) { /* silent */ }
            req.silent(url, function (data) {
                try {
                    var json = (typeof data === 'string') ? JSON.parse(data) : data;
                    onSuccess(json);
                } catch (e) {
                    console.log('[Easy-Mod] ERROR parse POST:', e.message);
                    if (onError) { onError(e); }
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR network POST:', err);
                if (onError) { onError(err); }
            }, JSON.stringify(body));
        } catch (e) {
            console.log('[Easy-Mod] ERROR apiPost:', e.message);
            if (onError) { onError(e); }
        }
    }

    // ── Player helper ─────────────────────────────────────────────────
    function playDirect(url, title, poster) {
        try {
            console.log('[Easy-Mod] play direct_url:', url.substring(0, 80));
            Lampa.Player.play({
                title:     title  || 'Easy-Mod',
                url:       url,
                poster:    poster || '',
                subtitles: []
            });
            Lampa.Player.playlist([{title: title || 'Easy-Mod', url: url}]);
        } catch (e) {
            console.log('[Easy-Mod] ERROR playDirect:', e.message);
            try { Lampa.Noty.show('[Easy-Mod] Не удалось запустить плеер'); } catch (e2) { /* silent */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Component 1: easy_mod_variants
    // ─────────────────────────────────────────────────────────────────
    function EasyModVariants(object) {
        this._object  = object || {};
        this._movie   = (object && object.movie)  ? object.movie  : {};
        this._render  = $('<div class="easy-mod-variants">');
        this._destroy = false;
        console.log('[Easy-Mod] EasyModVariants init movie:', this._movie.title || '?');
    }

    EasyModVariants.prototype.render = function () {
        return this._render;
    };

    EasyModVariants.prototype.start = function () {
        try {
            console.log('[Easy-Mod] easy_mod_variants start');
            this._loadVariants();
        } catch (e) {
            console.log('[Easy-Mod] ERROR easy_mod_variants start:', e.message);
        }
    };

    EasyModVariants.prototype._loadVariants = function () {
        var self = this;
        try {
            self._render.html(
                '<div class="easy-mod-loading">'
                + '<div class="easy-mod-spinner"></div>'
                + '<span>Загрузка вариантов…</span>'
                + '</div>'
            );

            var movie  = self._movie;
            var query  = movie.title || movie.name || movie.original_title || movie.original_name || '';
            var params = {title: query};
            if (movie.year)             { params.year    = movie.year; }
            if (movie.id)               { params.tmdb_id = String(movie.id); }

            apiGet('/variants', params, function (data) {
                try {
                    if (self._destroy) { return; }
                    var variants = (data && Array.isArray(data.variants)) ? data.variants : [];
                    console.log('[Easy-Mod] variants loaded N=' + variants.length);
                    self._renderVariants(variants);
                } catch (e) {
                    console.log('[Easy-Mod] ERROR _loadVariants handler:', e.message);
                    self._renderError(e.message);
                }
            }, function (err) {
                if (!self._destroy) { self._renderError(String(err)); }
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR _loadVariants:', e.message);
            self._renderError(e.message);
        }
    };

    EasyModVariants.prototype._renderVariants = function (variants) {
        var self = this;
        try {
            self._render.empty();

            if (!variants.length) {
                self._render.html('<div class="easy-mod-empty">Варианты не найдены</div>');
                return;
            }

            var title = $('<div class="easy-mod-title">').text('Выберите вариант');
            self._render.append(title);

            var list = $('<div class="easy-mod-list">');

            var i;
            for (i = 0; i < variants.length; i++) {
                (function (v) {
                    var row = $('<div class="easy-mod-item selector">').attr('data-id', v.id);
                    var labelEl = $('<div class="easy-mod-item__label">').text(v.label || v.voice || '');
                    var meta    = $('<div class="easy-mod-item__meta">');
                    var parts   = [];
                    if (v.quality)  { parts.push(v.quality); }
                    if (v.codec)    { parts.push(v.codec); }
                    if (v.size_mb)  { parts.push(Math.round(v.size_mb / 1024 * 10) / 10 + ' GB'); }
                    if (v.seeders)  { parts.push('↑ ' + v.seeders); }
                    meta.text(parts.join('  ·  '));
                    row.append(labelEl).append(meta);
                    row.on('hover:enter click', function () {
                        try {
                            console.log('[Easy-Mod] variant selected id:', v.id, 'label:', (v.label || v.voice));
                            self._startStream(v);
                        } catch (e2) {
                            console.log('[Easy-Mod] ERROR variant click:', e2.message);
                        }
                    });
                    list.append(row);
                })(variants[i]);
            }

            self._render.append(list);

            try {
                Lampa.Controller.enable('content');
                self._render.find('.selector').first().focus();
            } catch (e) {
                console.log('[Easy-Mod] WARNING controller focus:', e.message);
            }
        } catch (e) {
            console.log('[Easy-Mod] ERROR _renderVariants:', e.message);
        }
    };

    EasyModVariants.prototype._startStream = function (variant) {
        var self = this;
        try {
            var body = {
                variant_id: variant.id,
                magnet:     variant.magnet || '',
                title:      (self._movie.title || '') + ' [' + (variant.quality || '') + ']'
            };

            try { self._render.find('[data-id="' + variant.id + '"]').addClass('easy-mod-item--loading'); } catch (e) { /* silent */ }

            apiPost('/stream/start', body, function (data) {
                try {
                    var jobId     = (data && data.job_id)     ? data.job_id     : '';
                    var status    = (data && data.status)     ? data.status     : '';
                    var directUrl = (data && data.direct_url) ? data.direct_url : '';

                    console.log('[Easy-Mod] start stream job_id=' + jobId + ' status=' + status);

                    if (!jobId) {
                        try { Lampa.Noty.show('[Easy-Mod] Ошибка: job_id не получен'); } catch (e) { /* silent */ }
                        return;
                    }

                    // Cache hit — instant play
                    if (status === 'ready' && directUrl) {
                        console.log('[Easy-Mod] cache hit — instant play');
                        var t = (self._movie.title || 'Easy-Mod') + (variant.quality ? ' [' + variant.quality + ']' : '');
                        playDirect(directUrl, t, self._movie.poster || '');
                        return;
                    }

                    // Not ready — open wait screen
                    if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                        Lampa.Activity.push({
                            component: 'easy_mod_wait',
                            title:     'Easy-Mod — Подготовка',
                            movie:     self._movie,
                            job_id:    jobId,
                            variant:   variant
                        });
                    }
                } catch (e) {
                    console.log('[Easy-Mod] ERROR _startStream handler:', e.message);
                    try { Lampa.Noty.show('[Easy-Mod] Ошибка запуска'); } catch (e2) { /* silent */ }
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR /stream/start:', err);
                try { Lampa.Noty.show('[Easy-Mod] Не удалось запустить стрим: ' + String(err)); } catch (e) { /* silent */ }
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR _startStream:', e.message);
        }
    };

    EasyModVariants.prototype._renderError = function (msg) {
        try {
            this._render.html('<div class="easy-mod-error">Ошибка загрузки: ' + String(msg) + '</div>');
        } catch (e) {
            console.log('[Easy-Mod] ERROR _renderError:', e.message);
        }
    };

    EasyModVariants.prototype.pause   = function () {};
    EasyModVariants.prototype.stop    = function () {};
    EasyModVariants.prototype.destroy = function () {
        try {
            this._destroy = true;
            this._render.remove();
            console.log('[Easy-Mod] easy_mod_variants destroyed');
        } catch (e) {
            console.log('[Easy-Mod] ERROR variants destroy:', e.message);
        }
    };

    // ─────────────────────────────────────────────────────────────────
    // Component 2: easy_mod_wait  (adaptive polling)
    // ─────────────────────────────────────────────────────────────────
    function EasyModWait(object) {
        this._object    = object || {};
        this._movie     = (object && object.movie)   ? object.movie   : {};
        this._jobId     = (object && object.job_id)  ? object.job_id  : '';
        this._variant   = (object && object.variant) ? object.variant : {};
        this._render    = $('<div class="easy-mod-wait">');
        this._timer     = null;
        this._destroy   = false;
        this._played    = false;
        this._startedAt = Date.now();
        console.log('[Easy-Mod] EasyModWait init job_id:', this._jobId);
    }

    EasyModWait.prototype.render = function () {
        return this._render;
    };

    EasyModWait.prototype.start = function () {
        try {
            console.log('[Easy-Mod] easy_mod_wait start job_id:', this._jobId);
            this._showWaiting(0, 'Запрос к TorBox…');
            this._poll();
        } catch (e) {
            console.log('[Easy-Mod] ERROR easy_mod_wait start:', e.message);
        }
    };

    EasyModWait.prototype._showWaiting = function (progress, statusText) {
        try {
            var pct = Math.round((progress || 0) * 100);
            var st  = statusText || ('Подготовка потока… ' + pct + '%');
            var self = this;
            this._render.html(
                '<div class="easy-mod-wait__inner">'
                + '<div class="easy-mod-spinner"></div>'
                + '<div class="easy-mod-wait__title">' + st + '</div>'
                + '<div class="easy-mod-wait__hint">Загрузка через TorBox. Подождите…</div>'
                + '<div class="easy-mod-wait__back selector">Назад</div>'
                + '</div>'
            );
            this._render.find('.easy-mod-wait__back').on('hover:enter click', function () {
                try {
                    self._stopPolling();
                    if (Lampa.Activity && typeof Lampa.Activity.backward === 'function') {
                        Lampa.Activity.backward();
                    }
                } catch (e) {
                    console.log('[Easy-Mod] ERROR back button:', e.message);
                }
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR _showWaiting:', e.message);
        }
    };

    EasyModWait.prototype._nextInterval = function () {
        var elapsed = Date.now() - this._startedAt;
        return (elapsed < POLL_FAST_UNTIL_MS) ? POLL_FAST_INTERVAL : POLL_SLOW_INTERVAL;
    };

    EasyModWait.prototype._poll = function () {
        var self = this;
        try {
            if (self._destroy || self._played) { return; }

            apiGet('/stream/status', {job_id: self._jobId}, function (data) {
                try {
                    if (self._destroy || self._played) { return; }

                    var state     = (data && data.state)          ? data.state      : 'unknown';
                    var progress  = (data && data.progress != null) ? data.progress  : 0;
                    var url       = (data && data.direct_url)     ? data.direct_url : '';
                    var message   = (data && data.message)        ? data.message    : '';
                    var elapsed   = Math.round((Date.now() - self._startedAt) / 1000);

                    console.log('[Easy-Mod] status state=' + state + ' progress=' + progress + ' elapsed=' + elapsed + 's');

                    if (state === 'ready' && url) {
                        self._played = true;
                        self._stopPolling();
                        var title = (self._movie.title || 'Easy-Mod')
                            + (self._variant && self._variant.quality ? ' [' + self._variant.quality + ']' : '');
                        playDirect(url, title, self._movie.poster || '');
                        return;
                    }

                    if (state === 'failed') {
                        self._stopPolling();
                        self._showError(message || 'Создание потока не удалось');
                        return;
                    }

                    var statusText = 'Подготовка потока… ' + Math.round(progress * 100) + '%';
                    if (state === 'queued')    { statusText = 'В очереди…'; }
                    if (state === 'preparing') { statusText = 'Подготовка потока… ' + Math.round(progress * 100) + '%'; }

                    self._showWaiting(progress, statusText);

                    var interval = self._nextInterval();
                    self._timer = setTimeout(function () {
                        try { self._poll(); } catch (e) {
                            console.log('[Easy-Mod] ERROR poll timer:', e.message);
                        }
                    }, interval);
                } catch (e) {
                    console.log('[Easy-Mod] ERROR poll handler:', e.message);
                    if (!self._destroy) {
                        self._timer = setTimeout(function () {
                            try { self._poll(); } catch (e2) { /* silent */ }
                        }, POLL_SLOW_INTERVAL);
                    }
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR poll request:', err);
                if (!self._destroy) {
                    self._timer = setTimeout(function () {
                        try { self._poll(); } catch (e) { /* silent */ }
                    }, POLL_SLOW_INTERVAL);
                }
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR _poll:', e.message);
        }
    };

    EasyModWait.prototype._showError = function (msg) {
        try {
            this._render.html(
                '<div class="easy-mod-wait__inner">'
                + '<div class="easy-mod-error">Ошибка: ' + String(msg) + '</div>'
                + '<div class="easy-mod-wait__back selector">Вернуться к вариантам</div>'
                + '</div>'
            );
            this._render.find('.easy-mod-wait__back').on('hover:enter click', function () {
                try {
                    if (Lampa.Activity && typeof Lampa.Activity.backward === 'function') {
                        Lampa.Activity.backward();
                    }
                } catch (e) {
                    console.log('[Easy-Mod] ERROR back after error:', e.message);
                }
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR _showError:', e.message);
        }
    };

    EasyModWait.prototype._stopPolling = function () {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    };

    EasyModWait.prototype.pause   = function () { this._stopPolling(); };
    EasyModWait.prototype.stop    = function () { this._stopPolling(); };
    EasyModWait.prototype.destroy = function () {
        try {
            this._destroy = true;
            this._stopPolling();
            this._render.remove();
            console.log('[Easy-Mod] easy_mod_wait destroyed');
        } catch (e) {
            console.log('[Easy-Mod] ERROR wait destroy:', e.message);
        }
    };

    // ─────────────────────────────────────────────────────────────────
    // Register Lampa components
    // ─────────────────────────────────────────────────────────────────
    function registerComponents() {
        try {
            console.log('[Easy-Mod] registerComponents()');
            if (typeof Lampa === 'undefined' || !Lampa.Component) {
                console.log('[Easy-Mod] ERROR: Lampa.Component not available');
                return;
            }
            if (typeof Lampa.Component.add === 'function') {
                Lampa.Component.add('easy_mod_variants', EasyModVariants);
                Lampa.Component.add('easy_mod_wait',     EasyModWait);
                console.log('[Easy-Mod] components registered via Lampa.Component.add()');
            } else if (typeof Lampa.Component === 'object') {
                Lampa.Component['easy_mod_variants'] = EasyModVariants;
                Lampa.Component['easy_mod_wait']     = EasyModWait;
                console.log('[Easy-Mod] components registered directly on Lampa.Component');
            } else {
                console.log('[Easy-Mod] WARNING: cannot register components');
            }
        } catch (e) {
            console.log('[Easy-Mod] ERROR registerComponents():', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Button injection — setInterval strategy, max 50 tries (~15 s)
    // ─────────────────────────────────────────────────────────────────
    function injectButton(movie) {
        try {
            var tries      = 0;
            var maxTries   = 50;

            var interval = setInterval(function () {
                try {
                    tries++;
                    if (tries > maxTries) {
                        clearInterval(interval);
                        console.log('[Easy-Mod] gave up waiting for anchor after ' + maxTries + ' tries');
                        return;
                    }

                    // ── Find the anchor to insert AFTER ────────────
                    var anchor = null;

                    // Primary: the TorBox-style button already on page
                    var torrentAnchor = $('.view--torrent');
                    if (torrentAnchor.length) {
                        anchor = torrentAnchor.first();
                    }

                    // Fallback: first button in the buttons bar
                    if (!anchor || !anchor.length) {
                        var firstBtn = $('.full-start__buttons .full-start__button:first-child');
                        if (firstBtn.length) { anchor = firstBtn; }
                    }

                    if (!anchor || !anchor.length) { return; } // not ready yet

                    // Already injected?
                    if ($('.easy-mod-btn').length) {
                        clearInterval(interval);
                        return;
                    }

                    clearInterval(interval);

                    // ── Build the button ───────────────────────────
                    var btn = $('<div>')
                        .addClass('full-start__button selector easy-mod-btn')
                        .append(
                            $('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" '
                              + 'viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                              + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">')
                                .html('<polygon points="5 3 19 12 5 21 5 3"/>')
                        )
                        .append($('<span>').text('Easy-Mod'));

                    btn.on('hover:enter click', function () {
                        try {
                            console.log('[Easy-Mod] open variants for:', (movie && movie.title) || '?');
                            if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                                Lampa.Activity.push({
                                    component: 'easy_mod_variants',
                                    title:     'Easy-Mod',
                                    movie:     movie
                                });
                            }
                        } catch (e) {
                            console.log('[Easy-Mod] ERROR button handler:', e.message);
                        }
                    });

                    anchor.after(btn);
                    console.log('[Easy-Mod] button injected for:', (movie && movie.title) || '?');
                } catch (e) {
                    console.log('[Easy-Mod] ERROR injectButton interval:', e.message);
                }
            }, 300);
        } catch (e) {
            console.log('[Easy-Mod] ERROR injectButton():', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Hook into film detail page via Lampa.Listener 'full'
    // ─────────────────────────────────────────────────────────────────
    function hookFilmPage() {
        try {
            if (!Lampa.Listener || typeof Lampa.Listener.follow !== 'function') {
                console.log('[Easy-Mod] ERROR: Lampa.Listener not available');
                return;
            }

            Lampa.Listener.follow('full', function (e) {
                try {
                    // Only act on the 'complite' sub-event (Lampa 3.1.6 spelling)
                    if (e && e.type && e.type !== 'complite') { return; }

                    console.log('[Easy-Mod] full complite');

                    // Resolve the movie object from various event shapes
                    var movie = null;
                    if (e && e.data && e.data.movie)         { movie = e.data.movie; }
                    else if (e && e.object && e.object.movie) { movie = e.object.movie; }
                    else if (e && e.object && e.object.card)  { movie = e.object.card; }
                    else if (e && e.object && e.object.data)  { movie = e.object.data; }
                    else if (e && e.movie)                    { movie = e.movie; }
                    else if (e && e.card)                     { movie = e.card; }

                    if (!movie) {
                        console.log('[Easy-Mod] full complite: cannot resolve movie');
                        return;
                    }

                    console.log('[Easy-Mod] full complite movie:', movie.title || movie.name || '?');
                    injectButton(movie);
                } catch (err) {
                    console.log('[Easy-Mod] ERROR full handler:', err.message);
                }
            });

            console.log('[Easy-Mod] film page hook registered');
        } catch (e) {
            console.log('[Easy-Mod] ERROR hookFilmPage():', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Initialise
    // ─────────────────────────────────────────────────────────────────
    function init() {
        try {
            console.log('[Easy-Mod] init()');
            registerComponents();
            hookFilmPage();
            console.log('[Easy-Mod] init() done');
        } catch (e) {
            console.log('[Easy-Mod] ERROR init():', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Boot — wait for Lampa global
    // ─────────────────────────────────────────────────────────────────
    function boot() {
        try {
            if (typeof Lampa === 'undefined') {
                console.log('[Easy-Mod] Lampa not ready, retry 500ms...');
                setTimeout(boot, 500);
                return;
            }

            console.log('[Easy-Mod] boot() — Lampa found');

            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('ready', function () {
                    try {
                        console.log('[Easy-Mod] Lampa ready received');
                        init();
                    } catch (e) {
                        console.log('[Easy-Mod] ERROR ready handler:', e.message);
                    }
                });
            }

            // Also call immediately in case 'ready' already fired
            init();

            console.log('[Easy-Mod] boot() complete');
        } catch (e) {
            console.log('[Easy-Mod] ERROR boot():', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Entry point
    // ─────────────────────────────────────────────────────────────────
    try {
        if (typeof document !== 'undefined' && document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    } catch (e) {
        console.log('[Easy-Mod] ERROR entry point:', e.message);
        try { boot(); } catch (e2) { /* intentionally silent */ }
    }

})();
