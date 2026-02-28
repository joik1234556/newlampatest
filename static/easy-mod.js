(function () {
    'use strict';

    if (window.__easy_mod_loaded) { return; }
    window.__easy_mod_loaded = true;

    var VERSION = '5.0';
    var API = 'http://46.225.222.255:8000';

    // Safe jQuery alias (Lampa uses window.$, window.jQuery or Lampa.$)
    var jq = window.jQuery || window.$ || (typeof Lampa !== 'undefined' && Lampa.$) || null;
    function noop() { return this; }
    function $(sel, ctx) {
        if (!jq) {
            return { length: 0, append: noop, prepend: noop, before: noop, after: noop, on: noop,
                find: function () { return $(sel); }, hasClass: noop, addClass: noop, removeClass: noop,
                text: noop, html: noop, empty: noop, remove: noop, first: noop, last: noop, eq: noop,
                attr: noop, css: noop };
        }
        return ctx ? jq(sel, ctx) : jq(sel);
    }
    function log() {
        try { console.log.apply(console, ['[Easy-Mod]'].concat([].slice.call(arguments))); } catch (e) {}
    }
    log('loaded v' + VERSION);

    // -------------------------------------------------------
    // Inline CSS — modss-style (self-contained, no external file needed)
    // -------------------------------------------------------
    var _CSS = [
        /* Variant card — mirrors modss .online_modss */
        '.easy-mod-card{position:relative;border-radius:.3em;background-color:rgba(0,0,0,.3);display:-webkit-box;display:flex;cursor:pointer}',
        '.easy-mod-card+.easy-mod-card{margin-top:1.5em}',
        '.easy-mod-card.focus::after{content:"";position:absolute;top:-.6em;left:-.6em;right:-.6em;bottom:-.6em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}',
        '.easy-mod-card.focus{-webkit-transform:scale(1.02);transform:scale(1.02);-webkit-transition:-webkit-transform .3s linear;transition:transform .3s linear}',
        /* Poster area */
        '.easy-mod-card__img{position:relative;width:13em;-webkit-flex-shrink:0;flex-shrink:0;min-height:8.2em;border-radius:.3em;overflow:hidden;background:rgba(0,0,0,.5)}',
        '.easy-mod-card__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;opacity:0;-webkit-transition:opacity .3s;transition:opacity .3s}',
        '.easy-mod-card__img.loaded>img{opacity:1}',
        '.easy-mod-card__img-loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin:-1em 0 0 -1em;background:url(./img/loader.svg) no-repeat 50% 50%;background-size:contain}',
        /* Quality badge */
        '.easy-mod-card__quality{position:absolute;top:.4em;right:.4em;background:rgba(0,0,0,.7);color:#fff;padding:.15em .4em;border-radius:.3em;font-size:.8em;font-weight:700;line-height:1.2}',
        '.easy-mod-card__quality--4k{color:#ffd402}',
        '.easy-mod-card__quality--1080{color:#4caf50}',
        /* Seeders badge */
        '.easy-mod-card__seeders{position:absolute;bottom:.4em;right:.4em;background:#168FDF;color:#fff;padding:.15em .4em;border-radius:.3em;font-size:.75em}',
        /* Card body */
        '.easy-mod-card__body{padding:1.2em;line-height:1.4;-webkit-box-flex:1;flex-grow:1;position:relative;display:-webkit-box;display:flex;-webkit-box-orient:vertical;flex-direction:column;justify-content:center}',
        '.easy-mod-card__title{font-size:1.4em;font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-bottom:.4em}',
        '.easy-mod-card__meta{font-size:.9em;opacity:.7;line-height:1.5}',
        '.easy-mod-card__size{font-size:.8em;opacity:.55;margin-top:.3em}',
        /* Page wrapper */
        '.easy-mod-page{padding:1.5em 2em;min-height:10em}',
        /* Empty / loading state */
        '.easy-mod-empty{line-height:1.4;text-align:center;padding:3em 2em}',
        '.easy-mod-empty__title{font-size:1.8em;margin-bottom:.3em}',
        '.easy-mod-empty__sub{font-size:1.1em;opacity:.6;margin-bottom:1.5em}',
        /* Back button */
        '.easy-mod-btn-back{display:inline-block;padding:.4em 1.2em;border-radius:.3em;cursor:pointer;font-size:1em;background:rgba(0,0,0,.3);margin-top:1em}',
        '.easy-mod-btn-back.focus{background:#fff;color:#000}',
        /* Wait screen */
        '.easy-mod-wait{display:-webkit-box;display:flex;-webkit-box-orient:vertical;flex-direction:column;-webkit-box-align:center;align-items:center;-webkit-box-pack:center;justify-content:center;min-height:15em;text-align:center;padding:2em}',
        '.easy-mod-wait__pct{font-size:3em;font-weight:700;margin-bottom:.3em}',
        '.easy-mod-wait__msg{font-size:1.1em;opacity:.7;margin-bottom:1.5em}',
        '.easy-mod-wait__error{color:#f44336;margin-bottom:.5em;font-size:1.1em}',
        '.easy-mod-wait__hint{font-size:.85em;opacity:.7;margin-bottom:1em}',
        /* Film page button */
        '.view--easy_mod.focus{-webkit-transform:scale(1.02);transform:scale(1.02);-webkit-transition:-webkit-transform .2s ease;transition:transform .2s ease}',
        '.view--easy_mod .easy-mod-btn-spinner{display:inline-block;vertical-align:middle;margin-right:.3em}',
        '.view--easy_mod span{display:inline-block;vertical-align:middle}',
        /* Mobile */
        '@media screen and (max-width:480px){.easy-mod-card__img{width:7em;min-height:6em}.easy-mod-card__title{font-size:1.2em}}',
    ].join('');

    function injectCSS() {
        if (document.getElementById('easy-mod-css')) { return; }
        try {
            var s = document.createElement('style');
            s.id = 'easy-mod-css';
            s.textContent = _CSS;
            (document.head || document.body).appendChild(s);
        } catch (e) { log('injectCSS error', e.message); }
    }

    // -------------------------------------------------------
    // Network helpers
    // -------------------------------------------------------
    function makeRequest() {
        try {
            var Ctor = (typeof Lampa !== 'undefined' && Lampa.Reguest) ? Lampa.Reguest
                     : (typeof Lampa !== 'undefined' && Lampa.Request) ? Lampa.Request : null;
            return Ctor ? new Ctor() : null;
        } catch (e) { return null; }
    }

    function qs(params) {
        var out = [];
        for (var k in params) {
            if (Object.prototype.hasOwnProperty.call(params, k) &&
                params[k] !== '' && params[k] !== null && params[k] !== undefined) {
                out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
            }
        }
        return out.length ? ('?' + out.join('&')) : '';
    }

    function netGet(url, ok, fail) {
        var req = makeRequest();
        if (req && req.silent) {
            try {
                req.silent(url, function (raw) {
                    try {
                        var j = (typeof raw === 'string') ? JSON.parse(raw) : raw;
                        if (ok) { ok(j); }
                    } catch (e) { if (fail) { fail('json parse error'); } }
                }, function () { netGetFb(url, ok, fail); });
                return;
            } catch (e) {}
        }
        netGetFb(url, ok, fail);
    }

    function netGetFb(url, ok, fail) {
        if (typeof fetch !== 'undefined') {
            fetch(url, { mode: 'cors' })
                .then(function (r) { return r.json(); })
                .then(function (j) { if (ok) { ok(j); } })
                .catch(function (e) { if (fail) { fail(e.message || 'fetch error'); } });
        } else {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) { return; }
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { var j = JSON.parse(xhr.responseText); if (ok) { ok(j); } }
                    catch (e) { if (fail) { fail('json parse error'); } }
                } else { if (fail) { fail('http ' + xhr.status); } }
            };
            xhr.onerror = function () { if (fail) { fail('xhr error'); } };
            xhr.send();
        }
    }

    function netPost(url, body, ok, fail) {
        if (typeof fetch !== 'undefined') {
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                mode: 'cors',
            })
                .then(function (r) { return r.json(); })
                .then(function (j) { if (ok) { ok(j); } })
                .catch(function (e) { if (fail) { fail(e.message || 'fetch error'); } });
        } else {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) { return; }
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { var j = JSON.parse(xhr.responseText); if (ok) { ok(j); } }
                    catch (e) { if (fail) { fail('json parse error'); } }
                } else { if (fail) { fail('http ' + xhr.status); } }
            };
            xhr.onerror = function () { if (fail) { fail('xhr error'); } };
            xhr.send(JSON.stringify(body));
        }
    }

    function apiGet(path, params, ok, fail) {
        var url = API + path + qs(params || {});
        log('GET', url);
        netGet(url, ok, fail);
    }

    function apiPost(path, body, ok, fail) {
        log('POST', API + path);
        netPost(API + path, body, ok, fail);
    }

    // -------------------------------------------------------
    // Play helper — passes direct URL to Lampa.Player
    // -------------------------------------------------------
    function playDirect(url, movie) {
        var title  = (movie && (movie.title || movie.name)) || 'Easy-Mod';
        var poster = (movie && (movie.poster || movie.poster_path)) || '';
        if (poster && poster.charAt(0) === '/') {
            poster = 'https://image.tmdb.org/t/p/w500' + poster;
        }
        log('play url:', url.slice(0, 80));
        try {
            Lampa.Player.play({ title: title, url: url, poster: poster, subtitles: [] });
            try { Lampa.Player.playlist([{ title: title, url: url }]); } catch (e) {}
        } catch (e) { log('play error', e.message); }
    }

    // -------------------------------------------------------
    // Helpers
    // -------------------------------------------------------
    function qualityClass(q) {
        q = (q || '').toLowerCase();
        if (q === '2160p' || q === '4k') { return 'easy-mod-card__quality--4k'; }
        if (q === '1080p') { return 'easy-mod-card__quality--1080'; }
        return '';
    }

    function fmtSize(mb) {
        if (!mb) { return ''; }
        return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB';
    }

    // Animated SVG spinner (48px, for loading states)
    var _SPINNER48 = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" fill="none" stroke="currentColor" stroke-width="6" r="35" stroke-dasharray="164.93 56.98">' +
        '<animateTransform attributeName="transform" type="rotate" repeatCount="indefinite"' +
        ' dur="0.9s" values="0 50 50;360 50 50" keyTimes="0;1"/>' +
        '</circle></svg>'
    );

    // -------------------------------------------------------
    // Render a modss-style poster card for one variant
    // -------------------------------------------------------
    function renderCard(v, movie, onSelect) {
        var card = jq('<div class="easy-mod-card selector">');

        // Poster image (from movie metadata)
        var posterUrl = (movie && (movie.poster || movie.poster_path)) || '';
        if (posterUrl && posterUrl.charAt(0) === '/') {
            posterUrl = 'https://image.tmdb.org/t/p/w185' + posterUrl;
        }
        var imgWrap = jq('<div class="easy-mod-card__img">');
        imgWrap.append('<div class="easy-mod-card__img-loader"></div>');
        if (posterUrl) {
            var img = jq('<img alt="">').attr('src', posterUrl);
            img.on('load',  function () { imgWrap.addClass('loaded'); });
            img.on('error', function () { imgWrap.find('.easy-mod-card__img-loader').remove(); });
            imgWrap.append(img);
        }

        // Quality badge — top-right corner of poster
        var qLabel = (v.quality || '1080p').toUpperCase();
        var qBadge = jq('<div class="easy-mod-card__quality">').text(qLabel);
        var qcls = qualityClass(v.quality);
        if (qcls) { qBadge.addClass(qcls); }
        imgWrap.append(qBadge);

        // Seeders badge — bottom-right of poster
        if (v.seeders) {
            imgWrap.append(jq('<div class="easy-mod-card__seeders">').text('\u2b06 ' + v.seeders));
        }
        card.append(imgWrap);

        // Body text
        var body = jq('<div class="easy-mod-card__body">');
        // Build a friendly card title: prefer label, else voice + quality combo, else default
        var cardTitle = v.label || (v.voice ? v.voice + ' \u2022 ' + (v.quality || '').toUpperCase() : '') || '\u0412\u0430\u0440\u0438\u0430\u043d\u0442';
        body.append(jq('<div class="easy-mod-card__title">').text(cardTitle));

        var metaParts = [];
        // Show codec when it differs from common H264 baseline (Latin comparison for safety)
        var codec = (v.codec || '').toUpperCase();
        if (codec && codec !== 'H264' && codec !== 'H.264') { metaParts.push(v.codec); }
        if (v.language && v.language !== 'multi') { metaParts.push('\ud83c\udf10 ' + v.language.toUpperCase()); }
        if (metaParts.length) {
            body.append(jq('<div class="easy-mod-card__meta">').text(metaParts.join(' \u00b7 ')));
        }
        var sz = fmtSize(v.size_mb);
        if (sz) { body.append(jq('<div class="easy-mod-card__size">').text(sz)); }
        card.append(body);

        card.on('hover:enter click', function () { if (onSelect) { onSelect(v); } });
        return card;
    }

    // ==================================================================
    // Component: easy_mod_variants
    // Shows list of playback variants fetched from /variants
    // ==================================================================
    function EasyModVariants(object) {
        this._object = object || {};
        this._movie  = (object && object.movie) ? object.movie : {};
        this._render = jq('<div class="easy-mod-page easy-mod-variants">');
        this._scroll = null;
        this._dead   = false;
    }

    EasyModVariants.prototype.create = function () { return this._render; };
    EasyModVariants.prototype.render = function () { return this._render; };

    EasyModVariants.prototype.start = function () {
        log('variants start');
        var self = this;
        var m = self._movie || {};

        // Resolve movie from Lampa Activity if not passed
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
        self._movie = m;

        var title = m.title || m.name || m.original_title || m.original_name || '';
        var year  = m.year  || (m.release_date ? m.release_date.slice(0, 4) : '');
        var tmdb  = m.id    || m.tmdb_id || '';
        var orig  = m.original_title || m.original_name || '';

        // Show loading spinner
        self._render.html(
            '<div class="easy-mod-empty">' +
            '<div class="easy-mod-empty__title">Easy-Mod</div>' +
            '<div class="easy-mod-empty__sub">' +
            (title ? '\u041f\u043e\u0438\u0441\u043a \u0434\u043b\u044f \u00ab' + title + '\u00bb\u2026' : '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026') +
            '</div>' + _SPINNER48 + '</div>'
        );

        var params = {};
        if (title) { params.title = title; }
        if (year)  { params.year  = year; }
        if (tmdb)  { params.tmdb_id = tmdb; }
        if (orig && orig !== title) { params.original_title = orig; }

        apiGet('/variants', params, function (data) {
            if (self._dead) { return; }
            try {
                var variants = (data && data.variants && data.variants.length) ? data.variants : [];
                log('variants loaded N=' + variants.length);
                self._render.empty();

                if (!variants.length) {
                    self._render.html(
                        '<div class="easy-mod-empty">' +
                        '<div class="easy-mod-empty__title">\u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e</div>' +
                        '<div class="easy-mod-empty__sub">\u00ab' + (title || '?') + '\u00bb \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u043d\u0438 \u0432 \u043e\u0434\u043d\u043e\u043c \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0435</div>' +
                        '</div>'
                    );
                    try { Lampa.Controller.toggle('content'); } catch (e) {}
                    return;
                }

                // Try Lampa.Scroll (like modss); fall back to plain div list
                try {
                    var sc = new Lampa.Scroll({ mask: true, over: true });
                    sc.render().addClass('layer--wheight');
                    for (var i = 0; i < variants.length; i++) {
                        (function (v) {
                            sc.body().append(renderCard(v, m, function (sel) { self._startStream(sel); }));
                        })(variants[i]);
                    }
                    self._render.append(sc.render());
                    sc.start();
                    self._scroll = sc;
                } catch (scrollErr) {
                    log('Lampa.Scroll unavailable:', scrollErr.message);
                    var list = jq('<div style="padding:1em 2em">');
                    for (var j = 0; j < variants.length; j++) {
                        (function (v2) {
                            list.append(renderCard(v2, m, function (sel) { self._startStream(sel); }));
                        })(variants[j]);
                    }
                    self._render.append(list);
                }

                try { Lampa.Controller.toggle('content'); } catch (e) {}
            } catch (e) {
                log('variants render error', e.message);
                self._render.html(
                    '<div class="easy-mod-empty"><div class="easy-mod-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f</div></div>'
                );
            }
        }, function (err) {
            if (self._dead) { return; }
            log('variants error', err);
            self._render.html(
                '<div class="easy-mod-empty">' +
                '<div class="easy-mod-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430</div>' +
                '<div class="easy-mod-empty__sub">' + (err || '\u041d\u0435\u0442 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f') + '</div>' +
                '</div>'
            );
        });
    };

    EasyModVariants.prototype._startStream = function (variant) {
        var self  = this;
        var m     = self._movie || {};
        var body  = {
            variant_id: variant.id     || '',
            magnet:     variant.magnet || '',
            title:      m.title || m.name || 'Easy-Mod',
        };

        self._render.html(
            '<div class="easy-mod-empty">' +
            '<div class="easy-mod-empty__title">Easy-Mod</div>' +
            '<div class="easy-mod-empty__sub">\u0417\u0430\u043f\u0443\u0441\u043a \u043f\u043e\u0442\u043e\u043a\u0430\u2026</div>' +
            _SPINNER48 + '</div>'
        );

        apiPost('/stream/start', body, function (resp) {
            if (self._dead) { return; }
            try {
                var jobId  = resp && (resp.job_id || resp.id);
                var status = resp && resp.status;

                // Cache hit — play immediately
                if (status === 'ready' && resp.direct_url) {
                    playDirect(resp.direct_url, m);
                    return;
                }
                if (!jobId) {
                    self._render.html(
                        '<div class="easy-mod-empty"><div class="easy-mod-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430: \u043d\u0435\u0442 job_id</div></div>'
                    );
                    return;
                }

                // Push wait screen
                try {
                    Lampa.Activity.push({
                        component: 'easy_mod_wait',
                        title:     'Easy-Mod \u2014 \u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430',
                        job_id:    jobId,
                        movie:     m,
                        variant:   variant,
                    });
                } catch (e) { log('push wait error', e.message); }
            } catch (e) { log('_startStream response error', e.message); }
        }, function (err) {
            if (self._dead) { return; }
            log('_startStream network error', err);
            self._render.html(
                '<div class="easy-mod-empty">' +
                '<div class="easy-mod-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u043f\u0443\u0441\u043a\u0430</div>' +
                '<div class="easy-mod-empty__sub">' + (err || '') + '</div></div>'
            );
        });
    };

    EasyModVariants.prototype.pause   = function () {};
    EasyModVariants.prototype.stop    = function () {};
    EasyModVariants.prototype.destroy = function () {
        this._dead = true;
        try { if (this._scroll && this._scroll.destroy) { this._scroll.destroy(); } } catch (e) {}
        try { this._render.remove(); } catch (e) {}
    };

    // ==================================================================
    // Component: easy_mod_wait
    // Polls /stream/status, shows progress, auto-plays when ready
    // ==================================================================
    function EasyModWait(object) {
        this._object  = object || {};
        this._movie   = (object && object.movie)   || {};
        this._variant = (object && object.variant) || {};
        this._jobId   = (object && object.job_id)  || '';
        this._render  = jq('<div class="easy-mod-page easy-mod-wait">');
        this._dead    = false;
        this._timer   = null;
        this._ticks        = 0;
        this._statusErrors = 0;
        this._FAST_TICKS   = 15;    // first 30 s at 2 s interval
        this._FAST_INTERVAL= 2000;
        this._SLOW_INTERVAL= 5000;
        this._MAX_TICKS    = 75;    // ~5.5 min total
    }

    EasyModWait.prototype.create = function () { return this._render; };
    EasyModWait.prototype.render = function () { return this._render; };

    EasyModWait.prototype.start = function () {
        var self = this;
        var m    = self._movie   || {};
        var v    = self._variant || {};

        var posterUrl = (m.poster || m.poster_path) || '';
        if (posterUrl && posterUrl.charAt(0) === '/') {
            posterUrl = 'https://image.tmdb.org/t/p/w185' + posterUrl;
        }
        var filmTitle = m.title || m.name || 'Easy-Mod';
        var varLabel  = v.label || '';

        self._render.html(
            (posterUrl
                ? '<img src="' + posterUrl + '" style="width:6em;height:9em;object-fit:cover;border-radius:.5em;margin-bottom:1em">'
                : '') +
            '<div style="font-size:1.3em;font-weight:600;margin-bottom:.3em">' + filmTitle + '</div>' +
            (varLabel ? '<div style="font-size:.9em;opacity:.6;margin-bottom:1em">' + varLabel + '</div>' : '') +
            '<div class="easy-mod-wait__pct">0%</div>' +
            '<div class="easy-mod-wait__msg">\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 TorBox\u2026</div>' +
            '<div class="easy-mod-btn-back selector">\u2190 \u041d\u0430\u0437\u0430\u0434 \u043a \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u0430\u043c</div>'
        );

        self._render.find('.easy-mod-btn-back').on('hover:enter click', function () {
            try { Lampa.Activity.backward(); } catch (e) {
                try { Lampa.Activity.back(); } catch (e2) {}
            }
        });

        self._scheduleNext();
    };

    EasyModWait.prototype._scheduleNext = function () {
        var self = this;
        if (self._dead) { return; }
        var delay = self._ticks < self._FAST_TICKS ? self._FAST_INTERVAL : self._SLOW_INTERVAL;
        self._timer = setTimeout(function () { self._poll(); }, delay);
    };

    EasyModWait.prototype._poll = function () {
        var self = this;
        if (self._dead) { return; }
        self._ticks++;
        if (self._ticks > self._MAX_TICKS) {
            self._showError('\u0412\u0440\u0435\u043c\u044f \u043e\u0436\u0438\u0434\u0430\u043d\u0438\u044f \u0438\u0441\u0442\u0435\u043a\u043b\u043e. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a.');
            return;
        }

        apiGet('/stream/status', { job_id: self._jobId }, function (resp) {
            if (self._dead) { return; }
            try {
                var state    = (resp && resp.state) || 'unknown';
                var progress = (resp && resp.progress != null) ? resp.progress : 0;
                var pct      = Math.round(progress * 100);

                var msg = '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430\u2026';
                if (state === 'queued')    { msg = '\u0412 \u043e\u0447\u0435\u0440\u0435\u0434\u0438 TorBox\u2026'; }
                if (state === 'preparing') {
                    if (pct <= 10)       { msg = '\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u0442\u043e\u0440\u0440\u0435\u043d\u0442\u0430 \u0432 TorBox\u2026'; }
                    else if (pct <= 45)  { msg = 'TorBox \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u2026'; }
                    else                 { msg = '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 ' + pct + '%\u2026'; }
                }
                if (state === 'ready')  { msg = '\u0413\u043e\u0442\u043e\u0432\u043e! \u0417\u0430\u043f\u0443\u0441\u043a\u0430\u0435\u043c\u2026'; }
                if (state === 'failed') { msg = (resp && resp.message) || '\u041e\u0448\u0438\u0431\u043a\u0430'; }

                try {
                    self._render.find('.easy-mod-wait__pct').text(pct + '%');
                    self._render.find('.easy-mod-wait__msg').text(msg);
                } catch (e) {}

                if (state === 'ready' && resp.direct_url) {
                    self._dead = true;
                    clearTimeout(self._timer);
                    playDirect(resp.direct_url, self._movie);
                    return;
                }
                if (state === 'failed') {
                    self._showError((resp && resp.message) || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430');
                    return;
                }

                self._statusErrors = 0;
                self._scheduleNext();
            } catch (e) {
                log('poll error', e.message);
                self._scheduleNext();
            }
        }, function (err) {
            if (self._dead) { return; }
            log('poll network error', err);
            self._statusErrors++;
            if (self._statusErrors >= 3) { self._statusErrors = 0; }
            self._scheduleNext();
        });
    };

    EasyModWait.prototype._showError = function (msg) {
        var self = this;
        clearTimeout(self._timer);
        self._dead = true;

        var hint = '';
        if (msg.indexOf('401') !== -1) {
            hint = '\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 TORBOX_API_KEY \u043d\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0435.';
        } else if (msg.indexOf('429') !== -1) {
            hint = '\u041f\u0440\u0435\u0432\u044b\u0448\u0435\u043d \u043b\u0438\u043c\u0438\u0442 TorBox. \u041f\u043e\u0434\u043e\u0436\u0434\u0438\u0442\u0435.';
        } else if (msg.indexOf('stalled') !== -1 || msg.indexOf('\u0437\u0430\u0432\u0438\u0441') !== -1) {
            hint = '\u041d\u0435\u0442 \u0441\u0438\u0434\u0435\u0440\u043e\u0432. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a.';
        }

        try {
            self._render.html(
                '<div class="easy-mod-wait__error">' + msg + '</div>' +
                (hint ? '<div class="easy-mod-wait__hint">' + hint + '</div>' : '') +
                '<div class="easy-mod-btn-back selector">\u2190 \u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u0430\u043c</div>'
            );
            self._render.find('.easy-mod-btn-back').on('hover:enter click', function () {
                try { Lampa.Activity.backward(); } catch (e) {
                    try { Lampa.Activity.back(); } catch (e2) {}
                }
            });
            try { Lampa.Controller.toggle('content'); } catch (e) {}
        } catch (e) {}
    };

    EasyModWait.prototype.pause   = function () {};
    EasyModWait.prototype.stop    = function () {};
    EasyModWait.prototype.destroy = function () {
        this._dead = true;
        clearTimeout(this._timer);
        try { this._render.remove(); } catch (e) {}
    };

    // ==================================================================
    // Button SVG icons
    // ==================================================================
    var BTN_SPINNER = (
        '<svg class="easy-mod-btn-spinner" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" fill="none" stroke="currentColor" stroke-width="8" r="35" stroke-dasharray="164.93 56.98">' +
        '<animateTransform attributeName="transform" type="rotate" repeatCount="indefinite"' +
        ' dur="0.9s" values="0 50 50;360 50 50" keyTimes="0;1"/>' +
        '</circle></svg>'
    );
    var BTN_ICO = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"' +
        ' fill="none" stroke="currentColor" stroke-width="2">' +
        '<polygon points="5 3 19 12 5 21 5 3"/></svg>'
    );

    // ==================================================================
    // Button injection into film detail page (modss-style)
    // ==================================================================
    function getActivityRoot() {
        try {
            var a = Lampa.Activity.active();
            if (a && a.activity && typeof a.activity.render === 'function') {
                return a.activity.render();
            }
        } catch (ex) {}
        return jq('body');
    }

    function injectButton() {
        var root = getActivityRoot();
        if (!root || !root.find) { return false; }

        // Dedup guard
        if (root.find('.view--easy_mod').length) { return true; }

        // Find button container (new Lampa layout first, then classic)
        var container = root.find('.full-start-new__buttons').first();
        if (!container.length) { container = root.find('.full-start__buttons').first(); }
        if (!container.length) { return false; }

        // Resolve movie from active Activity
        var m = {};
        try {
            var act = Lampa.Activity.active();
            m = (act && (act.movie || act.card || act.data)) || {};
        } catch (ex) {}

        var btn = jq('<div class="full-start__button selector view--easy_mod">')
            .append(jq(BTN_ICO))
            .append(jq('<span>').text('Easy-Mod'));

        btn.on('hover:enter click', function () {
            // Show modss-style spinner while navigating
            btn.html(BTN_SPINNER + '<span>\u041f\u043e\u0438\u0441\u043a\u2026</span>');

            var movie = m;
            try {
                var actData = Lampa.Activity.data && Lampa.Activity.data();
                if (actData && (actData.movie || actData.card)) {
                    movie = actData.movie || actData.card;
                }
            } catch (ex) {}

            log('open variants for', (movie && (movie.title || movie.name)) || '?');

            // Restore after navigation (Activity.push navigates away)
            setTimeout(function () {
                try { btn.html(BTN_ICO + '<span>Easy-Mod</span>'); } catch (e) {}
            }, 1500);

            try {
                Lampa.Activity.push({
                    component: 'easy_mod_variants',
                    title:     'Easy-Mod',
                    movie:     movie,
                    page:      1,
                });
            } catch (err) {
                log('Activity.push error', err.message);
                try { btn.html(BTN_ICO + '<span>Easy-Mod</span>'); } catch (e) {}
            }
        });

        // Insert before torrent / play / first button (like modss priority)
        var torrentBtn  = root.find('.view--torrent').first();
        var playBtn     = root.find('.button--play').first();
        var firstBtn    = root.find('.full-start__button').first();

        if (torrentBtn.length)    { torrentBtn.before(btn); }
        else if (playBtn.length)  { playBtn.before(btn); }
        else if (firstBtn.length) { firstBtn.before(btn); }
        else                      { container.prepend(btn); }

        log('button injected');
        return true;
    }

    // ==================================================================
    // Hook film page (modss-style: listen to 'full' + 'activity' events)
    // ==================================================================
    function hookFilmPage() {
        try {
            Lampa.Listener.follow('full', function (e) {
                try {
                    if (e && e.type && e.type !== 'complite' && e.type !== 'start') { return; }
                    setTimeout(function () {
                        if (!injectButton()) { setTimeout(injectButton, 300); }
                    }, 100);
                } catch (err) { log('full listener error', err.message); }
            });

            // Also react on activity start (like modss does)
            Lampa.Listener.follow('activity', function (e) {
                try {
                    if (e.component === 'full' && e.type === 'start') {
                        setTimeout(function () { injectButton(); }, 100);
                    }
                } catch (err) {}
            });
        } catch (e) { log('hookFilmPage error', e.message); }
    }

    // ==================================================================
    // Register Lampa components
    // ==================================================================
    function registerComponents() {
        try {
            if (typeof Lampa === 'undefined' || !Lampa.Component ||
                typeof Lampa.Component.add !== 'function') { return; }
            Lampa.Component.add('easy_mod_variants', EasyModVariants);
            Lampa.Component.add('easy_mod_wait', EasyModWait);
            log('components registered');
        } catch (e) { log('registerComponents error', e.message); }
    }

    // ==================================================================
    // Bootstrap
    // ==================================================================
    var _initDone = false;
    function init() {
        if (_initDone) { return; }
        _initDone = true;
        injectCSS();
        registerComponents();
        hookFilmPage();
        log('init done — v' + VERSION);
    }

    function boot() {
        try {
            if (typeof Lampa === 'undefined') { setTimeout(boot, 500); return; }
            if (Lampa.Listener && Lampa.Listener.follow) {
                init();
            } else {
                try {
                    Lampa.Listener.follow('app:ready', function () { init(); });
                } catch (e) { setTimeout(init, 1000); }
            }
        } catch (e) { log('boot error', e.message); setTimeout(boot, 500); }
    }

    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else { boot(); }
    } catch (e) { boot(); }

})();
