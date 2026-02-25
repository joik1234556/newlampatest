/**
 * Easy-Mod — прямые стримы через TorBox для Lampa 3.1.6
 * Версия: 1.0
 * Backend: http://46.225.222.255:8000
 *
 * Архитектура:
 *   Кнопка «Easy-Mod» → easy_mod_variants → easy_mod_wait → Lampa.Player
 *
 * Компоненты:
 *   easy_mod_variants  — список вариантов (язык, озвучка, качество)
 *   easy_mod_wait      — экран ожидания с polling /stream/status
 */
(function () {
    'use strict';

    console.log('[Easy-Mod] Plugin v1.0 loaded for Lampa 3.1.6');

    var API_URL = 'http://46.225.222.255:8000';

    // ------------------------------------------------------------------
    // HTTP helper — Lampa.Request().silent() (correct for 3.1.6)
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
    // Utility: quality sort rank
    // ------------------------------------------------------------------
    function qualityRank(q) {
        var order = { '360p': 0, '480p': 1, '720p': 2, '1080p': 3, '2160p': 4, '4k': 4, '2k': 3 };
        return (order[String(q).toLowerCase()] !== undefined) ? order[String(q).toLowerCase()] : 2;
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
                    var row = $('<div class="easy-mod-item selector">')
                        .attr('data-id', v.id);

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

            // Focus first item
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

            apiPost('/stream/start', body, function (data) {
                try {
                    var jobId = (data && data.job_id) ? data.job_id : '';
                    console.log('[Easy-Mod] job created:', jobId, 'status:', data && data.status);

                    if (!jobId) {
                        Lampa.Noty.show('[Easy-Mod] \u041e\u0448\u0438\u0431\u043a\u0430: job_id \u043d\u0435 \u043f\u043e\u043b\u0443\u0447\u0435\u043d');
                        return;
                    }

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
                    Lampa.Noty.show('[Easy-Mod] \u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u043f\u0443\u0441\u043a\u0430');
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR /stream/start:', err);
                Lampa.Noty.show('[Easy-Mod] \u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0441\u0442\u0440\u0438\u043c: ' + String(err));
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR _startStream:', e.message);
        }
    };

    EasyModVariants.prototype._renderError = function (msg) {
        try {
            this._render.html(
                '<div class="easy-mod-error">'
                + '\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438: ' + msg
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
    // Component 2: easy_mod_wait
    // ------------------------------------------------------------------
    function EasyModWait(object) {
        this._object   = object || {};
        this._movie    = (object && object.movie)   ? object.movie   : {};
        this._jobId    = (object && object.job_id)  ? object.job_id  : '';
        this._variant  = (object && object.variant) ? object.variant : {};
        this._render   = $('<div class="easy-mod-wait">');
        this._timer    = null;
        this._destroy  = false;
        this._played   = false;
        console.log('[Easy-Mod] EasyModWait init job_id:', this._jobId);
    }

    EasyModWait.prototype.render = function () {
        return this._render;
    };

    EasyModWait.prototype.start = function () {
        try {
            console.log('[Easy-Mod] easy_mod_wait.start() job_id:', this._jobId);
            this._showWaiting(0);
            this._poll();
        } catch (e) {
            console.log('[Easy-Mod] ERROR easy_mod_wait.start():', e.message);
        }
    };

    EasyModWait.prototype._showWaiting = function (progress) {
        try {
            var pct = Math.round((progress || 0) * 100);
            this._render.html(
                '<div class="easy-mod-wait__inner">'
                + '<div class="easy-mod-spinner"></div>'
                + '<div class="easy-mod-wait__title">'
                + '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043f\u043e\u0442\u043e\u043a\u0430\u2026'
                + '</div>'
                + '<div class="easy-mod-wait__progress">' + pct + '%</div>'
                + '<div class="easy-mod-wait__hint">'
                + '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0447\u0435\u0440\u0435\u0437 TorBox. \u041f\u043e\u0434\u043e\u0436\u0434\u0438\u0442\u0435\u2026'
                + '</div>'
                + '<div class="easy-mod-wait__back selector">'
                + '\u041d\u0430\u0437\u0430\u0434'
                + '</div>'
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

    EasyModWait.prototype._poll = function () {
        var self = this;
        try {
            if (self._destroy || self._played) { return; }

            apiGet('/stream/status', { job_id: self._jobId }, function (data) {
                try {
                    if (self._destroy || self._played) { return; }

                    var state    = (data && data.state)      ? data.state      : 'unknown';
                    var progress = (data && data.progress)   ? data.progress   : 0;
                    var url      = (data && data.direct_url) ? data.direct_url : '';
                    var message  = (data && data.message)    ? data.message    : '';

                    console.log('[Easy-Mod] poll state:', state, 'progress:', progress);

                    if (state === 'ready' && url) {
                        self._played = true;
                        self._stopPolling();
                        self._play(url);
                        return;
                    }

                    if (state === 'failed') {
                        self._stopPolling();
                        self._showError(message || '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u043f\u043e\u0442\u043e\u043a\u0430 \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c');
                        return;
                    }

                    self._showWaiting(progress);

                    // Schedule next poll in 2 seconds
                    self._timer = setTimeout(function () {
                        try { self._poll(); } catch (e) { console.log('[Easy-Mod] ERROR poll timer:', e.message); }
                    }, 2000);
                } catch (e) {
                    console.log('[Easy-Mod] ERROR poll handler:', e.message);
                    self._timer = setTimeout(function () {
                        try { self._poll(); } catch (e2) { /* silent */ }
                    }, 3000);
                }
            }, function (err) {
                console.log('[Easy-Mod] ERROR poll request:', err);
                if (!self._destroy) {
                    self._timer = setTimeout(function () {
                        try { self._poll(); } catch (e) { /* silent */ }
                    }, 3000);
                }
            });
        } catch (e) {
            console.log('[Easy-Mod] ERROR _poll:', e.message);
        }
    };

    EasyModWait.prototype._play = function (url) {
        try {
            console.log('[Easy-Mod] starting playback url:', url.substring(0, 80));
            var title = (this._movie.title || 'Easy-Mod')
                + (this._variant.quality ? ' [' + this._variant.quality + ']' : '');

            Lampa.Player.play({
                title:     title,
                url:       url,
                poster:    (this._movie.poster || ''),
                subtitles: []
            });

            Lampa.Player.playlist([{
                title: title,
                url:   url
            }]);
        } catch (e) {
            console.log('[Easy-Mod] ERROR _play:', e.message);
            Lampa.Noty.show('[Easy-Mod] \u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043f\u043b\u0435\u0435\u0440: ' + e.message);
        }
    };

    EasyModWait.prototype._showError = function (msg) {
        try {
            this._render.html(
                '<div class="easy-mod-wait__inner">'
                + '<div class="easy-mod-error">\u041e\u0448\u0438\u0431\u043a\u0430: ' + msg + '</div>'
                + '<div class="easy-mod-wait__back selector">\u041d\u0430\u0437\u0430\u0434</div>'
                + '</div>'
            );
            var self = this;
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
    // Inject "Easy-Mod" button on film detail page
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

                    if (component && component.movie)        { movie = component.movie; }
                    else if (component && component.card)    { movie = component.card; }
                    else if (component && component.data)    { movie = component.data; }
                    else if (e && e.data && e.data.movie)    { movie = e.data.movie; }

                    if (!movie) {
                        console.log('[Easy-Mod] full event: cannot resolve movie');
                        return;
                    }

                    console.log('[Easy-Mod] full event for:', movie.title);

                    // Delay to let Lampa finish rendering the page
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
