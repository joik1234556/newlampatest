(function () {
    'use strict';

    // -----------------------------------------------------------------
    // Dedup guard — prevent double-run if plugin is loaded twice
    // -----------------------------------------------------------------
    if (window.__easy_mod_loaded) { return; }
    window.__easy_mod_loaded = true;

    console.log('[Easy-Mod] loaded v4.18');

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

    EasyModVariants.prototype.create = function () { return this._render; };
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
        // original_title is the non-localised title (e.g. English) — helps Jackett find more results
        var orig  = m.original_title || m.original_name || '';

        self._render.html('<div class="online-empty">Загрузка вариантов…</div>');

        var params = {};
        if (title) { params.title = title; }
        if (year)  { params.year  = year;  }
        if (tmdb)  { params.tmdb_id = tmdb; }
        if (orig && orig !== title) { params.original_title = orig; }

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
            title:      title,
            year:       m.year || '',
            tmdb_id:    m.id   || ''
        };

        log('startStream payload=' + JSON.stringify(body));
        self._render.html('<div class="online-empty">Запуск потока…</div>');

        apiPost('/stream/start', body, function (resp) {
            if (self._dead) { return; }
            log('startStream response=' + JSON.stringify(resp));
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

    EasyModWait.prototype.create = function () { return this._render; };
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
                if (state === 'preparing') {
                    if (pct <= 10) {
                        msg = 'TorBox обрабатывает запрос… ' + pct + '%';
                    } else if (pct <= 45) {
                        msg = 'TorBox загружает торрент… ' + pct + '%';
                    } else {
                        msg = 'Загрузка… ' + pct + '%';
                    }
                }
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
            var hint = '';
            if (msg && (msg.indexOf('HTTP 401') !== -1 || msg.indexOf('401') !== -1)) {
                hint = 'Проверьте TORBOX_API_KEY на сервере — ключ недействителен или истёк.';
            } else if (msg && (msg.indexOf('HTTP 422') !== -1 || msg.indexOf('422') !== -1)) {
                hint = 'TorBox отклонил запрос (422). Проверьте формат magnet-ссылки.';
            } else if (msg && (msg.indexOf('HTTP 429') !== -1 || msg.indexOf('429') !== -1)) {
                hint = 'Превышен лимит запросов TorBox. Подождите несколько минут.';
            } else if (msg && (msg.indexOf('RetryError') !== -1 || msg.indexOf('retry') !== -1 || msg.indexOf('попытки') !== -1)) {
                hint = 'TorBox недоступен или вернул ошибку несколько раз подряд. ' +
                       'Возможные причины: неверный API-ключ, превышен лимит, ' +
                       'TorBox на обслуживании. Попробуйте ещё раз через минуту.';
            } else if (msg && msg.indexOf('torrent_id') !== -1) {
                hint = 'TorBox не принял magnet-ссылку. Возможно, лимит активных ' +
                       'торрентов исчерпан или ссылка недействительна.';
            }
            self._render.html(
                '<div class="easy-mod-wait__error">' + msg + '</div>' +
                (hint ? '<div class="easy-mod-wait__hint" style="font-size:0.85em;opacity:0.75;margin-top:0.5em">' + hint + '</div>' : '') +
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

    EasyModWait.prototype.destroy = function () {
        this._dead = true;
        clearTimeout(this._timer);
        try { this._render.remove(); } catch (e) {}
        log('wait destroyed');
    };

    // Animated SVG spinner (same style as modss balanser loader, smaller)
    var BTN_SPINNER = '<svg class="easy-mod-btn-spinner" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 100 100"><circle cx="50" cy="50" fill="none" stroke="currentColor" stroke-width="8" r="35" stroke-dasharray="164.93 56.98"><animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="0.9s" values="0 50 50;360 50 50" keyTimes="0;1"/></circle></svg>';
    var BTN_ICO = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

    // ==================================================================
    // Button injection into film detail page (modss-style)
    // ==================================================================
    function getFullActivityRoot() {
        try {
            var a = Lampa.Activity.active();
            if (a && a.activity && typeof a.activity.render === 'function') return a.activity.render();
        } catch (ex) {}
        return jq('body');
    }

    // Returns true if button is already present or was successfully injected.
    // Returns false if the container is not yet in the DOM (caller should retry).
    function injectEasyButtonModssStyle() {
        var activity = getFullActivityRoot();
        if (!activity || !activity.find) return false;

        // Dedup guard — use view--easy_mod class
        if (activity.find('.view--easy_mod').length) return true;

        // Find buttons container (new layout first, then classic)
        var container = activity.find('.full-start-new__buttons').first();
        if (!container.length) container = activity.find('.full-start__buttons').first();
        if (!container.length) {
            log('inject btn fail — container not found');
            return false;
        }

        // Resolve movie data from active Activity
        var m = {};
        try {
            var act = Lampa.Activity.active();
            m = (act && (act.movie || act.card || act.data)) || {};
        } catch (ex) {}

        var btn = jq('<div class="full-start__button selector view--easy_mod">')
            .append(jq(BTN_ICO))
            .append(jq('<span>').text('Easy-Mod'));

        btn.on('hover:enter click', function () {
            // Show modss-style loading spinner inside button
            btn.html(BTN_SPINNER + '<span>Поиск…</span>');
            // Refresh movie data at click time
            var movie = m;
            try {
                var actData = Lampa.Activity.data && Lampa.Activity.data();
                if (actData && (actData.movie || actData.card)) movie = actData.movie || actData.card;
            } catch (ex) {}
            log('open variants for', (movie && (movie.title || movie.name)) || '?');
            // Restore button after a short delay (Activity.push navigates away)
            setTimeout(function () {
                try { btn.html(BTN_ICO + '<span>Easy-Mod</span>'); } catch (e) {}
            }, 1500);
            try {
                Lampa.Activity.push({
                    component: 'easy_mod_variants',
                    title:     'Easy-Mod',
                    movie:     movie,
                    page:      1
                });
            } catch (err) {
                log('Activity.push error', err.message);
                try { btn.html(BTN_ICO + '<span>Easy-Mod</span>'); } catch (e) {}
            }
        });

        // Insert left of Watch button (modss-style priority order)
        var torrentBtn  = activity.find('.view--torrent').first();
        var playBtn     = activity.find('.button--play').first();
        var firstFullBtn = activity.find('.full-start__button').first();

        if (torrentBtn.length) {
            torrentBtn.before(btn);
            log('inject btn ok — before torrent');
        } else if (playBtn.length) {
            playBtn.before(btn);
            log('inject btn ok — before play');
        } else if (firstFullBtn.length) {
            firstFullBtn.before(btn);
            log('inject btn ok — before first btn');
        } else {
            container.prepend(btn);
            log('inject btn ok — prepended');
        }
        return true;
    }

    // ==================================================================
    // Hook film page
    // ==================================================================
    function hookFilmPage() {
        try {
            Lampa.Listener.follow('full', function (e) {
                try {
                    log('full event fired type=' + (e && e.type));
                    if (e && e.type && e.type !== 'complite' && e.type !== 'start') { return; }
                    // DOM renders slightly after the event — use setTimeout like modss
                    setTimeout(function () {
                        if (!injectEasyButtonModssStyle()) {
                            setTimeout(injectEasyButtonModssStyle, 250);
                        }
                    }, 100);
                } catch (err) {
                    log('full listener error', err.message);
                }
            });
            log('full listener registered');
        } catch (e) {
            log('hookFilmPage error', e.message);
        }
    }

    // ==================================================================
    // Register Lampa components (modss-style: plain constructor)
    // ==================================================================
    function registerComponents() {
        try {
            if (typeof Lampa === 'undefined' || !Lampa.Component || typeof Lampa.Component.add !== 'function') {
                log('Lampa.Component.add not available');
                return;
            }
            Lampa.Component.add('easy_mod_variants', EasyModVariants);
            log('registered easy_mod_variants');
            Lampa.Component.add('easy_mod_wait', EasyModWait);
            log('registered easy_mod_wait');
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
