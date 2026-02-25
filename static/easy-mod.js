/**
 * Easy-Mod — прямые стримы через TorBox для Lampa 3.1.6
 * Версия: 2.0
 * Backend: http://46.225.222.255:8000
 *
 * Новое в v2.0:
 *   - Мгновенный старт (без экрана ожидания) при cache hit в /stream/start
 *   - Адаптивный polling: первые 30s каждые 2s, потом каждые 5s
 *   - Улучшенный экран ошибки с кнопкой «Вернуться к вариантам»
 *   - Дедуп: повторный выбор того же варианта → тот же job_id
 *
 * Компоненты:
 *   easy_mod_variants  — список вариантов (язык, озвучка, качество)
 *   easy_mod_wait      — экран ожидания с adaptive polling /stream/status
 */
(function () {
    'use strict';

    console.log('[Easy-Mod] Plugin v2.0 loaded for Lampa 3.1.6');

    var API_URL = 'http://46.225.222.255:8000';

    // Adaptive polling thresholds (ms)
    var POLL_FAST_UNTIL_MS  = 30000;   // first 30 s: fast polling
    var POLL_FAST_INTERVAL  = 2000;    // 2 s
    var POLL_SLOW_INTERVAL  = 5000;    // 5 s

    // ------------------------------------------------------------------
    // HTTP helpers — Lampa.Request().silent() (correct for 3.1.6)
    // ------------------------------------------------------------------
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

    function apiGet(path, params, onSuccess, onError) {
        try {
            var url = API_URL + path + buildQs(params || {});
            console.log('[Easy-Mod] GET ' + url);
            var req = new Lampa.Request();
            req.silent(url, function (data) {
                try {
                    var json = (typeof data === 'string') ? JSON.parse(data) : data;
                    onSuccess(json);
                } catch (e) {
                    console.log('[Easy-Mod] ERROR parse:', e.message, 'url:', url);
                    if (onError) { onError(e); }
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR network:', err, 'url:', url);
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
            var req = new Lampa.Request();
            req.timeout(15000);
            req.headers({ 'Content-Type': 'application/json' });
            req.silent(url, function (data) {
                try {
                    var json = (typeof data === 'string') ? JSON.parse(data) : data;
                    onSuccess(json);
                } catch (e) {
                    console.log('[Easy-Mod] ERROR post parse:', e.message);
                    if (onError) { onError(e); }
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR post network:', err);
                if (onError) { onError(err); }
            }, JSON.stringify(body));
        } catch (e) {
            console.log('[Easy-Mod] ERROR apiPost:', e.message);
            if (onError) { onError(e); }
        }
    }

    // ------------------------------------------------------------------
    // Player helper
    // ------------------------------------------------------------------
    function playDirect(url, title, poster) {
        try {
            console.log('[Easy-Mod] playing url:', url.substring(0, 80));
            Lampa.Player.play({
                title:     title  || 'Easy-Mod',
                url:       url,
                poster:    poster || '',
                subtitles: []
            });
            Lampa.Player.playlist([{ title: title || 'Easy-Mod', url: url }]);
        } catch (e) {
            console.log('[Easy-Mod] ERROR playDirect:', e.message);
            try { Lampa.Noty.show('[Easy-Mod] \u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043f\u043b\u0435\u0435\u0440'); } catch (e2) { /* silent */ }
        }
    }

    // ------------------------------------------------------------------
    // Component 1: easy_mod_variants
    // ------------------------------------------------------------------
    function EasyModVariants(object) {
        this._object  = object || {};
        this._movie   = (object && object.movie) ? object.movie : {};
        this._render  = $('<div class="easy-mod-variants">');
        this._destroy = false;
        console.log('[Easy-Mod] EasyModVariants init movie:', this._movie.title || '?');
    }

    EasyModVariants.prototype.render = function () {
        return this._render;
    };

    EasyModVariants.prototype.start = function () {
        try {
            console.log('[Easy-Mod] easy_mod_variants.start()');
            this._loadVariants();
        } catch (e) {
            console.log('[Easy-Mod] ERROR easy_mod_variants.start():', e.message);
        }
    };

    EasyModVariants.prototype._loadVariants = function () {
        var self = this;
        try {
            self._render.html(
                '<div class="easy-mod-loading">'
                + '<div class="easy-mod-spinner"></div>'
                + '<span>\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u043e\u0432\u2026</span>'
                + '</div>'
            );

            var params = { title: self._movie.title || '' };
            if (self._movie.year) { params.year = self._movie.year; }
            if (self._movie.id)   { params.tmdb_id = String(self._movie.id); }

            apiGet('/variants', params, function (data) {
                try {
                    if (self._destroy) { return; }
                    var variants = (data && Array.isArray(data.variants)) ? data.variants : [];
                    console.log('[Easy-Mod] variants count:', variants.length);
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
                self._render.html(
                    '<div class="easy-mod-empty">'
                    + '\u0412\u0430\u0440\u0438\u0430\u043d\u0442\u044b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b'
                    + '</div>'
                );
                return;
            }

            var title = $('<div class="easy-mod-title">')
                .text('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0432\u0430\u0440\u0438\u0430\u043d\u0442');
            self._render.append(title);

            var list = $('<div class="easy-mod-list">');

            var i;
            for (i = 0; i < variants.length; i++) {
                (function (v) {
                    var row = $('<div class="easy-mod-item selector">').attr('data-id', v.id);

                    var labelEl = $('<div class="easy-mod-item__label">').text(v.label || v.voice);
                    var meta    = $('<div class="easy-mod-item__meta">');

                    var parts = [];
                    if (v.quality)  { parts.push(v.quality); }
                    if (v.codec)    { parts.push(v.codec); }
                    if (v.size_mb)  { parts.push(Math.round(v.size_mb / 1024 * 10) / 10 + ' GB'); }
                    if (v.seeders)  { parts.push('\u2191 ' + v.seeders); }
                    meta.text(parts.join('  \u00b7  '));

                    row.append(labelEl).append(meta);

                    row.on('hover:enter click', function () {
                        try {
                            console.log('[Easy-Mod] variant selected id:', v.id, 'label:', v.label);
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
                console.log('[Easy-Mod] WARNING: controller focus:', e.message);
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

            console.log('[Easy-Mod] POST /stream/start variant_id:', variant.id);

            // Show loading indicator on the button row
            try { self._render.find('[data-id="' + variant.id + '"]').addClass('easy-mod-item--loading'); } catch (e) { /* silent */ }

            apiPost('/stream/start', body, function (data) {
                try {
                    var jobId     = (data && data.job_id)     ? data.job_id     : '';
                    var status    = (data && data.status)     ? data.status     : '';
                    var directUrl = (data && data.direct_url) ? data.direct_url : '';

                    console.log('[Easy-Mod] /stream/start → job_id:', jobId, 'status:', status);

                    if (!jobId) {
                        try { Lampa.Noty.show('[Easy-Mod] \u041e\u0448\u0438\u0431\u043a\u0430: job_id \u043d\u0435 \u043f\u043e\u043b\u0443\u0447\u0435\u043d'); } catch (e) { /* silent */ }
                        return;
                    }

                    // ── INSTANT PLAY: cache hit, no wait screen needed ──────────
                    if (status === 'ready' && directUrl) {
                        console.log('[Easy-Mod] cache hit — instant play');
                        var playTitle = (self._movie.title || 'Easy-Mod')
                            + (variant.quality ? ' [' + variant.quality + ']' : '');
                        playDirect(directUrl, playTitle, self._movie.poster || '');
                        return;
                    }

                    // ── QUEUED: open wait screen with adaptive polling ───────────
                    if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                        Lampa.Activity.push({
                            component: 'easy_mod_wait',
                            title:     'Easy-Mod \u2014 \u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430',
                            movie:     self._movie,
                            job_id:    jobId,
                            variant:   variant
                        });
                    }
                } catch (e) {
                    console.log('[Easy-Mod] ERROR _startStream handler:', e.message);
                    try { Lampa.Noty.show('[Easy-Mod] \u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u043f\u0443\u0441\u043a\u0430'); } catch (e2) { /* silent */ }
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR /stream/start:', err);
                try { Lampa.Noty.show('[Easy-Mod] \u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0441\u0442\u0440\u0438\u043c: ' + String(err)); } catch (e) { /* silent */ }
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR _startStream:', e.message);
        }
    };

    EasyModVariants.prototype._renderError = function (msg) {
        try {
            this._render.html(
                '<div class="easy-mod-error">'
                + '\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438: ' + String(msg)
                + '</div>'
            );
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

    // ------------------------------------------------------------------
    // Component 2: easy_mod_wait  (adaptive polling)
    // ------------------------------------------------------------------
    function EasyModWait(object) {
        this._object     = object || {};
        this._movie      = (object && object.movie)   ? object.movie   : {};
        this._jobId      = (object && object.job_id)  ? object.job_id  : '';
        this._variant    = (object && object.variant) ? object.variant : {};
        this._render     = $('<div class="easy-mod-wait">');
        this._timer      = null;
        this._destroy    = false;
        this._played     = false;
        this._startedAt  = Date.now();   // for adaptive polling
        console.log('[Easy-Mod] EasyModWait init job_id:', this._jobId);
    }

    EasyModWait.prototype.render = function () {
        return this._render;
    };

    EasyModWait.prototype.start = function () {
        try {
            console.log('[Easy-Mod] easy_mod_wait.start() job_id:', this._jobId);
            this._showWaiting(0, '\u0417\u0430\u043f\u0440\u043e\u0441 \u043a TorBox\u2026');
            this._poll();
        } catch (e) {
            console.log('[Easy-Mod] ERROR easy_mod_wait.start():', e.message);
        }
    };

    EasyModWait.prototype._showWaiting = function (progress, statusText) {
        try {
            var pct = Math.round((progress || 0) * 100);
            var st  = statusText || ('\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043f\u043e\u0442\u043e\u043a\u0430\u2026 ' + pct + '%');
            this._render.html(
                '<div class="easy-mod-wait__inner">'
                + '<div class="easy-mod-spinner"></div>'
                + '<div class="easy-mod-wait__title">' + st + '</div>'
                + '<div class="easy-mod-wait__hint">'
                + '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0447\u0435\u0440\u0435\u0437 TorBox. \u041f\u043e\u0434\u043e\u0436\u0434\u0438\u0442\u0435\u2026'
                + '</div>'
                + '<div class="easy-mod-wait__back selector">\u041d\u0430\u0437\u0430\u0434</div>'
                + '</div>'
            );

            var self = this;
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

            apiGet('/stream/status', { job_id: self._jobId }, function (data) {
                try {
                    if (self._destroy || self._played) { return; }

                    var state    = (data && data.state)      ? data.state      : 'unknown';
                    var progress = (data && data.progress != null) ? data.progress : 0;
                    var url      = (data && data.direct_url) ? data.direct_url  : '';
                    var message  = (data && data.message)    ? data.message     : '';

                    console.log('[Easy-Mod] poll state:', state, 'progress:', progress,
                                'elapsed:', Math.round((Date.now() - self._startedAt) / 1000) + 's');

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
                        self._showError(message || '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u043f\u043e\u0442\u043e\u043a\u0430 \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c');
                        return;
                    }

                    var statusText = '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043f\u043e\u0442\u043e\u043a\u0430\u2026 '
                        + Math.round(progress * 100) + '%';
                    if (state === 'queued')    { statusText = '\u0412 \u043e\u0447\u0435\u0440\u0435\u0434\u0438\u2026'; }
                    if (state === 'preparing') {
                        statusText = '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043f\u043e\u0442\u043e\u043a\u0430\u2026 '
                            + Math.round(progress * 100) + '%';
                    }

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
                + '<div class="easy-mod-error">\u041e\u0448\u0438\u0431\u043a\u0430: ' + String(msg) + '</div>'
                + '<div class="easy-mod-wait__back selector">'
                + '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u0430\u043c'
                + '</div>'
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

    // ------------------------------------------------------------------
    // Register Lampa components
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // Inject «Easy-Mod» button on film detail page
    // ------------------------------------------------------------------
    function hookFilmPage() {
        try {
            if (!Lampa.Listener || typeof Lampa.Listener.follow !== 'function') {
                console.log('[Easy-Mod] ERROR: Lampa.Listener not available');
                return;
            }

            Lampa.Listener.follow('full', function (e) {
                try {
                    var component = (e && e.object) ? e.object : e;
                    var movie = null;

                    if (component && component.movie)     { movie = component.movie; }
                    else if (component && component.card) { movie = component.card; }
                    else if (component && component.data) { movie = component.data; }
                    else if (e && e.data && e.data.movie) { movie = e.data.movie; }

                    if (!movie) {
                        console.log('[Easy-Mod] full event: cannot resolve movie');
                        return;
                    }

                    console.log('[Easy-Mod] full event for:', movie.title);

                    setTimeout(function () {
                        try {
                            injectButton(component, movie);
                        } catch (err) {
                            console.log('[Easy-Mod] ERROR delayed injectButton:', err.message);
                        }
                    }, 300);
                } catch (err) {
                    console.log('[Easy-Mod] ERROR full handler:', err.message);
                }
            });

            console.log('[Easy-Mod] film page hook registered');
        } catch (e) {
            console.log('[Easy-Mod] ERROR hookFilmPage():', e.message);
        }
    }

    function injectButton(component, movie) {
        try {
            var render;
            if (component && component.activity && typeof component.activity.render === 'function') {
                render = component.activity.render();
            } else if (component && typeof component.render === 'function') {
                render = component.render();
            } else if (component && component.$el) {
                render = component.$el;
            }

            if (!render || !render.length) {
                console.log('[Easy-Mod] injectButton: no render');
                return;
            }

            var container = render.find('.full-start__buttons');
            if (!container.length) { container = render.find('.full-start'); }
            if (!container.length) { container = render.find('.view--start'); }

            if (!container.length) {
                console.log('[Easy-Mod] injectButton: buttons container not found');
                return;
            }

            if (container.find('.easy-mod-btn').length) { return; }  // already injected

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
                    console.log('[Easy-Mod] button pressed for:', movie.title);
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

            container.append(btn);
            console.log('[Easy-Mod] button injected for:', movie.title);
        } catch (e) {
            console.log('[Easy-Mod] ERROR injectButton():', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Initialise
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // Boot — wait for Lampa, hook ready event
    // ------------------------------------------------------------------
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
                        console.log('[Easy-Mod] Lampa "ready" received');
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

    // ------------------------------------------------------------------
    // Entry point
    // ------------------------------------------------------------------
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
