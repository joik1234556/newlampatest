(function () {
    'use strict';

    // -----------------------------------------------------------------
    // Dedup guard — prevent double-run if plugin is loaded twice
    // -----------------------------------------------------------------
    if (window.__easy_mod_loaded) { return; }
    window.__easy_mod_loaded = true;

    console.log('[Easy-Mod] loaded v4.9');

    // -----------------------------------------------------------------
    // Config — change only this line to point at a different server
    // -----------------------------------------------------------------
    var API = 'http://46.225.222.255:8000';

    // -----------------------------------------------------------------
    // Safe jQuery alias
    // In Lampa builds jQuery may live on window.$, window.jQuery or Lampa.$
    // -----------------------------------------------------------------
    var jq = window.jQuery || window.$ || (typeof Lampa !== 'undefined' && Lampa.$) || null;

    function noop() { return this; }

    function $(sel, ctx) {
        if (!jq) { return { length: 0, append: noop, after: noop, on: noop, find: function () { return $(sel); }, hasClass: noop, text: noop, html: noop, empty: noop, remove: noop, first: noop, last: noop, eq: noop }; }
        return ctx ? jq(sel, ctx) : jq(sel);
    }

    // -----------------------------------------------------------------
    // Logging helper
    // -----------------------------------------------------------------
    function log() {
        try { console.log.apply(console, ['[Easy-Mod]'].concat([].slice.call(arguments))); } catch (e2) {}
    }

    // -----------------------------------------------------------------
    // Network factory — Lampa 3.1.6 uses Lampa.Reguest (typo is intentional)
    // -----------------------------------------------------------------
    function makeRequest() {
        try {
            var Ctor = (typeof Lampa !== 'undefined' && Lampa.Reguest) ? Lampa.Reguest
                     : (typeof Lampa !== 'undefined' && Lampa.Request)  ? Lampa.Request
                     : null;
            return Ctor ? new Ctor() : null;
        } catch (e) {
            log('makeRequest error', e.message);
            return null;
        }
    }

    // -----------------------------------------------------------------
    // Query-string builder
    // -----------------------------------------------------------------
    function qs(params) {
        var out = [];
        for (var k in params) {
            if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== '' && params[k] !== null && params[k] !== undefined) {
                out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
            }
        }
        return out.length ? ('?' + out.join('&')) : '';
    }

    // -----------------------------------------------------------------
    // Low-level HTTP helpers: Lampa.Request → fetch → XHR
    // -----------------------------------------------------------------
    function netGet(url, ok, fail) {
        var req = makeRequest();
        if (req && req.silent) {
            log('netGet via Lampa.Request', url);
            try {
                req.silent(url, function (raw) {
                    try {
                        var json = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                        if (ok) { ok(json); }
                    } catch (e) {
                        log('netGet Lampa parse error', e.message);
                        if (fail) { fail('json parse error'); }
                    }
                }, function (err) {
                    log('netGet Lampa error', err, '— falling back to fetch/XHR');
                    netGetFallback(url, ok, fail);
                });
                return;
            } catch (e) {
                log('netGet Lampa exception', e.message, '— falling back');
            }
        }
        netGetFallback(url, ok, fail);
    }

    function netGetFallback(url, ok, fail) {
        if (typeof fetch !== 'undefined') {
            log('netGet via fetch', url);
            fetch(url, { mode: 'cors' })
                .then(function (r) { return r.json(); })
                .then(function (json) { if (ok) { ok(json); } })
                .catch(function (e) {
                    log('netGet fetch error', e.message);
                    if (fail) { fail(e.message || 'fetch error'); }
                });
        } else {
            log('netGet via XHR', url);
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) { return; }
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var json = JSON.parse(xhr.responseText);
                            if (ok) { ok(json); }
                        } catch (e) {
                            log('netGet XHR parse error', e.message);
                            if (fail) { fail('json parse error'); }
                        }
                    } else {
                        log('netGet XHR status', xhr.status);
                        if (fail) { fail('http ' + xhr.status); }
                    }
                };
                xhr.onerror = function () {
                    log('netGet XHR onerror');
                    if (fail) { fail('xhr error'); }
                };
                xhr.send();
            } catch (e) {
                log('netGet XHR exception', e.message);
                if (fail) { fail(e.message); }
            }
        }
    }

    function netPost(url, body, ok, fail) {
        var req = makeRequest();
        if (req && req.silent) {
            log('netPost via Lampa.Request', url);
            try {
                req.silent(url, function (raw) {
                    try {
                        var json = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                        if (ok) { ok(json); }
                    } catch (e) {
                        log('netPost Lampa parse error', e.message);
                        if (fail) { fail('json parse error'); }
                    }
                }, function (err) {
                    log('netPost Lampa error', err, '— falling back to fetch/XHR');
                    netPostFallback(url, body, ok, fail);
                }, body);
                return;
            } catch (e) {
                log('netPost Lampa exception', e.message, '— falling back');
            }
        }
        netPostFallback(url, body, ok, fail);
    }

    function netPostFallback(url, body, ok, fail) {
        if (typeof fetch !== 'undefined') {
            log('netPost via fetch', url);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                mode: 'cors'
            })
                .then(function (r) { return r.json(); })
                .then(function (json) { if (ok) { ok(json); } })
                .catch(function (e) {
                    log('netPost fetch error', e.message);
                    if (fail) { fail(e.message || 'fetch error'); }
                });
        } else {
            log('netPost via XHR', url);
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', url, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) { return; }
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var json = JSON.parse(xhr.responseText);
                            if (ok) { ok(json); }
                        } catch (e) {
                            log('netPost XHR parse error', e.message);
                            if (fail) { fail('json parse error'); }
                        }
                    } else {
                        log('netPost XHR status', xhr.status);
                        if (fail) { fail('http ' + xhr.status); }
                    }
                };
                xhr.onerror = function () {
                    log('netPost XHR onerror');
                    if (fail) { fail('xhr error'); }
                };
                xhr.send(JSON.stringify(body));
            } catch (e) {
                log('netPost XHR exception', e.message);
                if (fail) { fail(e.message); }
            }
        }
    }

    // -----------------------------------------------------------------
    // API helpers — build URL and delegate to netGet / netPost
    // -----------------------------------------------------------------
    function apiGet(path, params, ok, fail) {
        var url = API + path + qs(params || {});
        log('GET', url);
        netGet(url, ok, fail);
    }

    function apiPost(path, body, ok, fail) {
        var url = API + path;
        log('POST', url, JSON.stringify(body));
        netPost(url, body, ok, fail);
    }

    // -----------------------------------------------------------------
    // Play helper
    // -----------------------------------------------------------------
    function playDirect(url, movie) {
        var title  = (movie && (movie.title || movie.name)) || 'Easy-Mod';
        var poster = (movie && movie.poster) || '';
        log('play direct_url:', url);
        try {
            Lampa.Player.play({ title: title, url: url, poster: poster, subtitles: [] });
            try { Lampa.Player.playlist([{ title: title, url: url }]); } catch (e) {}
        } catch (e) {
            log('play error', e.message);
        }
    }

    // ==================================================================
    // Component: easy_mod_variants
    // Shows list of torrent/stream variants fetched from /variants
    // ==================================================================
    function EasyModVariants(object) {
        this._object = object || {};
        this._movie  = (object && object.movie) ? object.movie : {};
        this._render = $('<div class="easy-mod-page easy-mod-variants">');
        this._dead   = false;
        this._req    = null;
    }

    EasyModVariants.prototype.render = function () { return this._render; };

    EasyModVariants.prototype.start = function () {
        console.log('[Easy-Mod] VARIANTS START CALLED');
        try { Lampa.Noty.show('[Easy-Mod] variants.start()'); } catch (e) {}
        log('variants start');
        log('variants start movie=', JSON.stringify(this._movie || {}));
        var self  = this;
        var m     = self._movie || {};

        // Web Lampa fallback: movie may not be in object — try Activity
        if (!m.title && !m.name && !m.id) {
            try {
                var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
                if (act) { m = act.movie || act.card || act.data || m; }
            } catch (ex) {}
        }
        if (!m.title && !m.name && !m.id) {
            try {
                var actData = Lampa.Activity && Lampa.Activity.data && Lampa.Activity.data();
                if (actData) { m = actData.movie || actData.card || actData; }
            } catch (ex) {}
        }
        if (!m.title && !m.name && !m.id) {
            // URL fallback: ?card=TMDB_ID&media=movie&source=tmdb
            try {
                var urlStr = window.location.search ||
                             (window.location.hash ? window.location.hash.replace(/^#\/?/, '?') : '');
                if (urlStr) {
                    var urlParams = new URLSearchParams(urlStr);
                    var cardId = urlParams.get('card') || urlParams.get('tmdb_id');
                    if (cardId) { m = { id: cardId }; }
                }
            } catch (ex) {}
        }

        log('movie ctx', m);

        var title = m.title || m.name || m.original_title || m.original_name || '';
        var year  = m.year || (m.release_date ? m.release_date.slice(0, 4) : '') || '';
        var tmdb  = m.id || m.tmdb_id || '';  // some Activity data uses tmdb_id instead of id

        self._render.html('<div class="online-empty">Загрузка вариантов…</div>');

        var params = {};
        if (title) { params.title = title; }
        if (year)  { params.year  = year;  }
        if (tmdb)  { params.tmdb_id = tmdb; }

        log('variants request params=', JSON.stringify(params));
        apiGet('/variants', params, function (data) {
            if (self._dead) { return; }
            try {
                var variants = (data && data.variants && data.variants.length) ? data.variants : [];
                log('variants loaded N=' + variants.length);
                self._render.empty();

                if (!variants.length) {
                    self._render.html('<div class="online-empty">Ничего не найдено для «' + (title || '?') + '»</div>');
                    try { Lampa.Controller.toggle('content'); } catch (e) {}
                    return;
                }

                var list = $('<div class="easy-mod-list">');
                for (var i = 0; i < variants.length; i++) {
                    (function (v) {
                        var row = $('<div class="selector easy-mod-item">');
                        row.append($('<div class="easy-mod-item__title">').text(v.label || v.voice || 'Вариант'));
                        row.append($('<div class="easy-mod-item__meta">').text(
                            [v.quality, v.codec, v.language ? ('🌐 ' + v.language) : ''].filter(Boolean).join(' · ')
                        ));
                        if (v.seeders) {
                            row.append($('<div class="easy-mod-item__seeders">').text('⬆ ' + v.seeders + ' seeders'));
                        }

                        row.on('hover:enter click', function () {
                            try {
                                log('variant selected id=' + (v.id || '?') + ' magnet=' + (v.magnet ? v.magnet.slice(0, 40) : 'none'));
                                self._startStream(v);
                            } catch (e) {
                                log('variant select error', e.message);
                            }
                        });

                        list.append(row);
                    })(variants[i]);
                }

                self._render.append(list);
                try { Lampa.Controller.toggle('content'); } catch (e) {}
            } catch (e) {
                log('variants render error', e.message);
                self._render.html('<div class="online-empty">Ошибка отображения</div>');
            }
        }, function (err) {
            if (self._dead) { return; }
            log('variants error', err);
            try { Lampa.Noty.show('Easy-Mod: /variants error'); } catch (e) {}
            self._render.html(
                '<div class="online-empty">' +
                '<div>Ошибка сервера: ' + (err || '') + '</div>' +
                '<div class="easy-mod-error__hint">Откройте F12 → Console/Network для деталей</div>' +
                '</div>'
            );
        });
    };

    EasyModVariants.prototype._startStream = function (variant) {
        var self  = this;
        var m     = self._movie || {};
        var title = m.title || m.name || 'Easy-Mod';
        var body  = {
            variant_id: variant.id || '',
            magnet:     variant.magnet || '',
            title:      title
        };

        self._render.html('<div class="online-empty">Запуск потока…</div>');

        apiPost('/stream/start', body, function (resp) {
            if (self._dead) { return; }
            try {
                var jobId = resp && (resp.job_id || resp.id);
                var status = resp && resp.status;
                log('start stream job_id=' + jobId + ' status=' + status);

                if (status === 'ready' && resp.direct_url) {
                    // instant play — no wait screen needed
                    playDirect(resp.direct_url, m);
                    return;
                }

                if (!jobId) {
                    self._render.html('<div class="online-empty">Ошибка: не получен job_id</div>');
                    return;
                }

                // push wait screen
                try {
                    Lampa.Activity.push({
                        component: 'easy_mod_wait',
                        title:     'Easy-Mod',
                        job_id:    jobId,
                        movie:     m
                    });
                } catch (e) {
                    log('Activity.push wait error', e.message);
                    self._render.html('<div class="online-empty">Ожидание… job=' + jobId + '</div>');
                }
            } catch (e) {
                log('startStream response error', e.message);
            }
        }, function (err) {
            if (self._dead) { return; }
            log('startStream error', err);
            try { Lampa.Noty.show('Easy-Mod: /stream/start error'); } catch (e) {}
            self._render.html('<div class="online-empty">Ошибка запуска: ' + (err || '') + '</div>');
        });
    };

    EasyModVariants.prototype.pause   = function () {};
    EasyModVariants.prototype.stop    = function () {};

    EasyModVariants.create = function (object) { return new EasyModVariants(object); };

    EasyModVariants.prototype.destroy = function () {
        this._dead = true;
        try { if (this._req) { this._req.clear(); } } catch (e) {}
        try { this._render.remove(); } catch (e) {}
        log('variants destroyed');
    };

    // ==================================================================
    // Component: easy_mod_wait
    // Polls /stream/status, shows progress, auto-plays when ready
    // ==================================================================
    function EasyModWait(object) {
        this._object = object || {};
        this._movie  = (object && object.movie) ? object.movie : {};
        this._jobId  = (object && object.job_id) ? object.job_id : '';
        this._render = $('<div class="easy-mod-page easy-mod-wait">');
        this._dead   = false;
        this._timer  = null;
        this._ticks        = 0;
        this._statusErrors = 0;
        this._FAST_TICKS   = 15; // first 30 s at 2 s interval
        this._FAST_INTERVAL= 2000;
        this._SLOW_INTERVAL= 5000;
        this._MAX_TICKS    = 75; // ~(15×2 + 60×5) = 330 s ≈ 5.5 min
    }

    EasyModWait.prototype.render = function () { return this._render; };

    EasyModWait.prototype.start = function () {
        log('wait start job_id=' + this._jobId);
        this._render.html(
            '<div class="easy-mod-wait__msg">Подготовка потока…</div>' +
            '<div class="easy-mod-wait__progress">0%</div>' +
            '<div class="selector easy-mod-wait__back">← Назад к вариантам</div>'
        );

        var self = this;
        // back button
        try {
            self._render.find('.easy-mod-wait__back').on('hover:enter click', function () {
                try { Lampa.Activity.backward(); } catch (e) {
                    try { Lampa.Activity.back(); } catch (e2) {}
                }
            });
        } catch (e) {}

        self._scheduleNext();
    };

    EasyModWait.prototype._scheduleNext = function () {
        var self = this;
        if (self._dead) { return; }
        var delay = (self._ticks < self._FAST_TICKS) ? self._FAST_INTERVAL : self._SLOW_INTERVAL;
        self._timer = setTimeout(function () {
            self._poll();
        }, delay);
    };

    EasyModWait.prototype._poll = function () {
        var self = this;
        if (self._dead) { return; }
        self._ticks++;

        if (self._ticks > self._MAX_TICKS) {
            self._showError('Время ожидания истекло. Попробуйте позже.');
            return;
        }

        apiGet('/stream/status', { job_id: self._jobId }, function (resp) {
            if (self._dead) { return; }
            try {
                var state    = (resp && resp.state) || (resp && resp.status) || 'unknown';
                var progress = (resp && resp.progress != null) ? resp.progress : 0;
                var pct      = Math.round(progress * 100);
                log('status state=' + state + ' progress=' + pct + '% tick=' + self._ticks);

                var msg = 'Подготовка потока…';
                if (state === 'queued')    { msg = 'В очереди…'; }
                if (state === 'preparing') { msg = 'Подготовка потока… ' + pct + '%'; }
                if (state === 'ready')     { msg = 'Готово! Запускаем…'; }
                if (state === 'failed')    { msg = 'Ошибка: ' + ((resp && resp.message) || ''); }

                try {
                    self._render.find('.easy-mod-wait__msg').text(msg);
                    self._render.find('.easy-mod-wait__progress').text(pct + '%');
                } catch (e) {}

                if (state === 'ready' && resp.direct_url) {
                    self._dead = true;
                    clearTimeout(self._timer);
                    playDirect(resp.direct_url, self._movie);
                    return;
                }

                if (state === 'failed') {
                    self._showError((resp && resp.message) || 'Неизвестная ошибка');
                    return;
                }

                self._statusErrors = 0;
                self._scheduleNext();
            } catch (e) {
                log('poll response error', e.message);
                self._scheduleNext();
            }
        }, function (err) {
            if (self._dead) { return; }
            log('poll error', err);
            self._statusErrors++;
            if (self._statusErrors >= 3) {
                try { Lampa.Noty.show('Easy-Mod: /stream/status error'); } catch (e) {}
                self._statusErrors = 0;
            }
            self._scheduleNext();
        });
    };

    EasyModWait.prototype._showError = function (msg) {
        var self = this;
        clearTimeout(self._timer);
        self._dead = true;
        try {
            self._render.html(
                '<div class="easy-mod-wait__error">' + msg + '</div>' +
                '<div class="selector easy-mod-wait__back">← Вернуться к вариантам</div>'
            );
            self._render.find('.easy-mod-wait__back').on('hover:enter click', function () {
                try { Lampa.Activity.backward(); } catch (e) {
                    try { Lampa.Activity.back(); } catch (e2) {}
                }
            });
            try { Lampa.Controller.toggle('content'); } catch (e) {}
        } catch (e) {
            log('showError render error', e.message);
        }
    };

    EasyModWait.prototype.pause   = function () {};
    EasyModWait.prototype.stop    = function () {};

    EasyModWait.create = function (object) { return new EasyModWait(object); };

    EasyModWait.prototype.destroy = function () {
        this._dead = true;
        clearTimeout(this._timer);
        try { this._render.remove(); } catch (e) {}
        log('wait destroyed');
    };

    // ==================================================================
    // Button injection into film detail page
    // ==================================================================
    function injectButton(movie, render) {
        var tries   = 0;
        var maxTries = 60; // × 300 ms ≈ 18 s

        var timer = setInterval(function () {
            tries++;

            // safety: if render disappeared, abort
            if (!jq) { clearInterval(timer); return; }

            try {
                var find = (render && render.find) ?
                    function (s) { return render.find(s); } :
                    function (s) { return jq(s);           };

                // already injected?
                if (find('.easy-mod-btn').length) {
                    clearInterval(timer);
                    return;
                }

                // Candidate anchors (in priority order):
                // 1. .view--torrent          — torrent button
                // 2. last .full-start__button — any action button
                // 3. .full-start__buttons     — the bar itself (append)
                // 4. .full-start              — whole block (append)
                var anchor   = null;
                var appendMode = false;

                var torrentBtn = find('.view--torrent');
                if (torrentBtn.length) {
                    anchor = torrentBtn.first();
                }

                if (!anchor || !anchor.length) {
                    var btns = find('.full-start__button');
                    if (btns.length) { anchor = btns.last(); }
                }

                if (!anchor || !anchor.length) {
                    var bar = find('.full-start__buttons');
                    if (bar.length) { anchor = bar.first(); appendMode = true; }
                }

                if (!anchor || !anchor.length) {
                    var block = find('.full-start');
                    if (block.length) { anchor = block.first(); appendMode = true; }
                }

                if (!anchor || !anchor.length) {
                    if (tries >= maxTries) {
                        clearInterval(timer);
                        log('inject: timeout — no anchor found');
                    }
                    return; // DOM not ready yet
                }

                clearInterval(timer);

                var btn = jq('<div class="full-start__button selector easy-mod-btn">')
                    .append(jq('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>'))
                    .append(jq('<span>').text('Easy-Mod'));

                btn.on('hover:enter click', function () {
                    log('open variants for', (movie && (movie.title || movie.name)) || '?');
                    try { Lampa.Noty.show('[Easy-Mod] click'); } catch (e) {}
                    try {
                        Lampa.Activity.push({
                            component: 'easy_mod_variants',
                            title:     'Easy-Mod',
                            movie:     movie
                        });
                    } catch (e) {
                        try { Lampa.Noty.show('[Easy-Mod] Activity.push error: ' + (e && e.message)); } catch (e2) {}
                        log('Activity.push error', e.message);
                    }
                });

                if (appendMode) {
                    anchor.append(btn);
                } else {
                    anchor.after(btn);
                }

                log('button injected for', (movie && (movie.title || movie.name)) || '?');
            } catch (e) {
                log('inject interval error', e.message);
                if (tries >= maxTries) { clearInterval(timer); }
            }
        }, 300);
    }

    // ==================================================================
    // Hook film page
    // ==================================================================
    function hookFilmPage() {
        try {
            Lampa.Listener.follow('full', function (e) {
                try {
                    log('full event type=' + (e && e.type));

                    var movie =
                        (e && e.data  && e.data.movie)   ? e.data.movie   :
                        (e && e.object && e.object.movie) ? e.object.movie :
                        (e && e.object && e.object.card)  ? e.object.card  :
                        null;

                    // Web Lampa often omits movie in the event; try Activity as fallback
                    if (!movie) {
                        try {
                            var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
                            if (act) { movie = act.movie || act.card || null; }
                        } catch (ex) {}
                    }

                    if (!movie) {
                        log('full event: no movie data, skipping');
                        return;
                    }

                    var render = null;
                    try {
                        if (e.object && e.object.activity && e.object.activity.render) {
                            render = e.object.activity.render();
                        }
                    } catch (ex) {
                        log('render resolve error', ex.message);
                    }

                    injectButton(movie, render);
                } catch (e) {
                    log('full listener error', e.message);
                }
            });
            log('full listener registered');
        } catch (e) {
            log('hookFilmPage error', e.message);
        }
    }

    // ==================================================================
    // Register Lampa components
    // ==================================================================
    function registerComponents() {
        try {
            if (typeof Lampa === 'undefined' || !Lampa.Component) {
                log('Lampa.Component not available');
                return;
            }

            function reg(name, Ctor) {
                // 1) Two-arg constructor form: Web Lampa calls new Ctor(object)
                try {
                    if (typeof Lampa.Component.add === 'function') {
                        Lampa.Component.add(name, Ctor);
                        log('registered (constructor)', name);
                        return true;
                    }
                } catch (e) {
                    log('constructor register failed', name, e.message);
                }

                // 2) Factory fallback: { create(object) { return new Ctor(object); } }
                try {
                    Lampa.Component.add(name, { create: function (object) { return new Ctor(object); } });
                    log('registered (factory.create)', name);
                    return true;
                } catch (e2) {
                    log('factory register failed', name, e2.message);
                }

                // 3) Direct assign fallback
                try {
                    Lampa.Component[name] = Ctor;
                    log('registered (direct)', name);
                    return true;
                } catch (e3) {
                    log('direct register failed', name, e3.message);
                    return false;
                }
            }

            reg('easy_mod_variants', EasyModVariants);
            reg('easy_mod_wait', EasyModWait);

        } catch (e) {
            log('registerComponents fatal', e.message);
        }
    }

    // ==================================================================
    // Bootstrap
    // ==================================================================
    var _initDone = false;
    function init() {
        if (_initDone) { return; }
        _initDone = true;
        log('init');
        registerComponents();
        hookFilmPage();
        log('init done');
    }

    function boot() {
        try {
            if (typeof Lampa === 'undefined') {
                log('waiting for Lampa…');
                setTimeout(boot, 500);
                return;
            }

            if (Lampa.Listener && Lampa.Listener.follow) {
                init();
            } else {
                // Lampa exists but not fully ready; wait for its own ready event
                try {
                    Lampa.Listener.follow('app:ready', function () { init(); });
                } catch (e) {
                    setTimeout(init, 1000);
                }
            }
        } catch (e) {
            log('boot error', e.message);
            setTimeout(boot, 500);
        }
    }

    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    } catch (e) {
        boot();
    }

})();
