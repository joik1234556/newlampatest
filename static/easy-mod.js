(function () {
    'use strict';

    if (window.__easy_mod_loaded) { return; }
    window.__easy_mod_loaded = true;

    var VERSION = '5.5';
    var API = 'http://46.225.222.255:8000';

    // jQuery alias (Lampa always exposes $ globally)
    var jq = window.jQuery || window.$ || (typeof Lampa !== 'undefined' && Lampa.$) || null;
    function noop() { return this; }
    function jqStub(sel, ctx) {
        return { length: 0, append: noop, prepend: noop, before: noop, after: noop, on: noop,
            find: function () { return jqStub(sel); }, hasClass: noop, addClass: noop, removeClass: noop,
            text: noop, html: noop, empty: noop, remove: noop, first: noop, last: noop, eq: noop,
            attr: noop, css: noop };
    }
    function jqSafe(sel, ctx) {
        if (!jq) { return jqStub(sel); }
        return ctx ? jq(sel, ctx) : jq(sel);
    }

    function log() {
        try { console.log.apply(console, ['[Easy-Mod]'].concat([].slice.call(arguments))); } catch (e) {}
    }
    log('loaded v' + VERSION);

    // -------------------------------------------------------
    // CSS — EXACT copy of modss_online_css template + easy-mod extras
    // -------------------------------------------------------
    var _CSS = [
        // --- From modss_online_css (exact) ---
        ".online_modss--full.focus .online_modss__body{background:#b58d362e}",
        ".online_modss--full.focus{-webkit-transform:scale(1.02);-ms-transform:scale(1.02);-o-transform:scale(1.02);transform:scale(1.02);-webkit-transition:-webkit-transform .3s linear 0s;transition:-webkit-transform .3s linear 0s;-o-transition:-o-transform .3s linear 0s;transition:transform .3s linear 0s}",
        ".online_modss{position:relative;-webkit-border-radius:.3em;-moz-border-radius:.3em;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}",
        ".online_modss__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative}",
        "@media screen and (max-width:480px){.online_modss__body{padding:.8em 1.2em}}",
        ".online_modss__img{position:relative;width:13em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;min-height:8.2em}",
        ".online_modss__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;-webkit-border-radius:.3em;-moz-border-radius:.3em;border-radius:.3em;opacity:0;-webkit-transition:opacity .3s;-o-transition:opacity .3s;-moz-transition:opacity .3s;transition:opacity .3s}",
        ".online_modss__img--loaded>img{opacity:1}",
        "@media screen and (max-width:480px){.online_modss__img{width:7em;min-height:6em}}",
        ".online_modss__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;-moz-background-size:contain;-o-background-size:contain;background-size:contain}",
        ".online_modss__head,.online_modss__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}",
        ".online_modss__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}",
        "@media screen and (max-width:480px){.online_modss__title{font-size:1.4em}}",
        ".online_modss__time{padding-left:2em}",
        ".online_modss__info{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}",
        ".online_modss__quality{padding-left:1em;white-space:nowrap}",
        ".online_modss.focus::after{content:'';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;-webkit-border-radius:.7em;-moz-border-radius:.7em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}",
        ".online_modss+.online_modss{margin-top:1.5em}",
        ".online-empty{line-height:1.4}",
        ".online-empty__title{font-size:1.8em;margin-bottom:.3em}",
        ".online-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}",
        // --- Easy-Mod specific additions ---
        // Quality badge (top-right of poster, like modss episode badges)
        ".em-quality{position:absolute;top:.5em;right:.5em;background:rgba(0,0,0,0.7);color:#fff;padding:.15em .45em;border-radius:.3em;font-size:.85em;font-weight:700;line-height:1.2}",
        ".em-quality--4k{color:#ffd402}",
        ".em-quality--1080{color:#4caf50}",
        // Seeders badge (bottom-right of poster)
        ".em-seeders{position:absolute;bottom:.5em;right:.5em;background:#168FDF;color:#fff;padding:.15em .45em;border-radius:.3em;font-size:.8em}",
        // Wait screen
        ".em-wait{display:-webkit-box;display:flex;-webkit-box-orient:vertical;flex-direction:column;-webkit-box-align:center;align-items:center;-webkit-box-pack:center;justify-content:center;min-height:15em;text-align:center;padding:3em 2em}",
        ".em-wait__pct{font-size:3em;font-weight:700;margin-bottom:.3em}",
        ".em-wait__msg{font-size:1.1em;opacity:.7;margin-bottom:1.5em}",
        ".em-wait__error{color:#f44336;margin-bottom:.5em;font-size:1.1em}",
        ".em-wait__hint{font-size:.85em;opacity:.7;margin-bottom:1em}",
        // Back button
        ".em-back{display:inline-block;padding:.4em 1.2em;border-radius:.3em;cursor:pointer;font-size:1em;background:rgba(0,0,0,.3);margin-top:1em}",
        ".em-back.focus{background:#fff;color:#000}",
        // Button spinner style
        ".view--easy_mod .em-spin{display:inline-block;vertical-align:middle;margin-right:.3em}",
        ".view--easy_mod span{display:inline-block;vertical-align:middle}",
        ".view--easy_mod.focus{-webkit-transform:scale(1.02);transform:scale(1.02)}",
        // Filter bar
        ".em-filters{display:-webkit-box;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;gap:.45em;padding:.3em 0 1.1em;-webkit-box-align:center;align-items:center}",
        ".em-filter-group{display:-webkit-box;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;gap:.4em;-webkit-box-align:center;align-items:center;margin-right:.8em}",
        ".em-filter-label{font-size:.8em;opacity:.55;margin-right:.1em;white-space:nowrap}",
        ".em-filter-btn{display:inline-block;padding:.25em .75em;border-radius:2em;cursor:pointer;font-size:.85em;background:rgba(255,255,255,.1);white-space:nowrap}",
        ".em-filter-btn.focus{background:#fff;color:#000}",
        ".em-filter-btn.active{background:rgba(255,212,2,.85);color:#000}",
        ".em-filter-btn.active.focus{background:#fff;color:#000}",
        // Voice/language tags on card
        ".em-voice-row{margin-top:.4em;display:-webkit-box;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;gap:.35em;-webkit-box-align:center;align-items:center}",
        ".em-tag{display:inline-block;padding:.1em .5em;border-radius:.25em;font-size:.75em;background:rgba(255,255,255,.15);white-space:nowrap}",
        ".em-tag--voice{background:rgba(181,141,54,.35)}",
        ".em-tag--lang{background:rgba(24,143,223,.35)}",
        ".em-tag--quality{background:rgba(76,175,80,.25)}",
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
    // Play helper
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
    function fmtSize(mb) {
        if (!mb) { return ''; }
        return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB';
    }

    var _LANG_LABELS = { ru: '\u0420\u0443\u0441', ua: '\u0423\u043a\u0440', uk: '\u0423\u043a\u0440', en: 'ENG', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pl: 'PL' };
    function langLabel(code) {
        var c = (code || '').toLowerCase();
        return _LANG_LABELS[c] || code.toUpperCase();
    }

    function qualityColorClass(q) {
        q = (q || '').toLowerCase();
        if (q === '2160p' || q === '4k') { return 'em-quality--4k'; }
        if (q === '1080p') { return 'em-quality--1080'; }
        return '';
    }

    // Animated SVG spinner (same as modss-balanser-loader but smaller for button)
    var BTN_SPIN = '<svg class="em-spin" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 100 100"><circle cx="50" cy="50" fill="none" stroke="currentColor" stroke-width="8" r="35" stroke-dasharray="164.93 56.98"><animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="0.9s" values="0 50 50;360 50 50" keyTimes="0;1"/></circle></svg>';
    var BTN_ICO  = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

    // Large spinner for loading screens
    var SPIN48 = '<svg xmlns="http://www.w3.org/2000/svg" class="modss-balanser-loader" width="94" height="94" viewBox="0 0 100 100"><circle cx="50" cy="50" fill="none" stroke="#ffffff" stroke-width="5" r="35" stroke-dasharray="164.93 56.98"><animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="1s" values="0 50 50;360 50 50" keyTimes="0;1"/></circle></svg>';

    // -------------------------------------------------------
    // Build a modss-style card (exact online_modss structure)
    // -------------------------------------------------------
    function buildCard(v, movie, onSelect) {
        // Resolve poster URL from movie object
        var posterUrl = (movie && (movie.poster || movie.poster_path)) || '';
        if (posterUrl && posterUrl.charAt(0) === '/') {
            posterUrl = 'https://image.tmdb.org/t/p/w185' + posterUrl;
        }

        // Movie year (from movie object)
        var movieYear = '';
        if (movie) {
            movieYear = movie.year || '';
            if (!movieYear && movie.release_date)   { movieYear = movie.release_date.slice(0, 4); }
            if (!movieYear && movie.first_air_date) { movieYear = movie.first_air_date.slice(0, 4); }
        }

        // Card title: label from provider, or voice + quality combo
        var codec = (v.codec || '').toUpperCase();
        var cardTitle = v.label || (v.voice ? v.voice + ' \u2022 ' + (v.quality || '').toUpperCase() : '');
        if (!cardTitle) { cardTitle = '\u0412\u0430\u0440\u0438\u0430\u043d\u0442'; }

        // Meta info line: codec (if not baseline), language, size, year
        var infoParts = [];
        var codecNorm = codec.replace('.', '');
        if (codecNorm && codecNorm !== 'H264') { infoParts.push(v.codec); }
        if (v.language && v.language !== 'multi') { infoParts.push(langLabel(v.language)); }
        var sz = fmtSize(v.size_mb);
        if (sz) { infoParts.push(sz); }
        if (movieYear) { infoParts.push(movieYear); }
        var infoHtml = infoParts.join('<span class="online_modss-split"> \u2022 </span>');

        // Quality text for right column
        var qCls = qualityColorClass(v.quality);
        var qualHtml = '<span class="em-quality' + (qCls ? ' ' + qCls : '') + '">' + (v.quality || '1080p').toUpperCase() + '</span>';

        // Build card using exact modss_online_full HTML structure
        var card = jq('<div class="online_modss online_modss--full selector">');

        // Left: image area
        var imgWrap = jq('<div class="online_modss__img">');
        imgWrap.append('<div class="online_modss__loader"></div>');
        if (posterUrl) {
            var img = jq('<img alt="">').attr('src', posterUrl);
            img.on('load',  function () { imgWrap.addClass('online_modss__img--loaded'); });
            img.on('error', function () { imgWrap.find('.online_modss__loader').remove(); });
            imgWrap.append(img);
        }
        // Quality badge (top-right, like modss episode number)
        imgWrap.append(jq('<div class="em-quality' + (qCls ? ' ' + qCls : '') + '">').text((v.quality || '1080p').toUpperCase()));
        // Seeders badge (bottom-right)
        if (v.seeders) {
            imgWrap.append(jq('<div class="em-seeders">').text('\u2b06 ' + v.seeders));
        }
        card.append(imgWrap);

        // Right: body
        var body = jq('<div class="online_modss__body">');

        // Head row: title + quality
        var head = jq('<div class="online_modss__head">');
        head.append(jq('<div class="online_modss__title">').text(cardTitle));
        head.append(jq('<div class="online_modss__time">').html(qualHtml));
        body.append(head);

        // Footer row: meta info
        var footer = jq('<div class="online_modss__footer">');
        var infoEl = jq('<div class="online_modss__info">');
        if (infoHtml) { infoEl.html(infoHtml); }
        footer.append(infoEl);
        body.append(footer);

        // Voice + language tags row
        var tagRow = jq('<div class="em-voice-row">');
        if (v.voice) {
            tagRow.append(jq('<span class="em-tag em-tag--voice">').text('\u041e\u0437\u0432\u0443\u0447\u043a\u0430: ' + v.voice));
        }
        if (v.language) {
            tagRow.append(jq('<span class="em-tag em-tag--lang">').text('\u042f\u0437\u044b\u043a: ' + langLabel(v.language)));
        }
        if (tagRow.children().length) { body.append(tagRow); }

        card.append(body);

        card.on('hover:enter click', function () { if (onSelect) { onSelect(v); } });
        return card;
    }

    // -------------------------------------------------------
    // Filter bar: quality + voice pills (modss-style)
    // -------------------------------------------------------
    function buildFilters(variants, activeVoice, activeQuality, activeSeason, seasons, onChange) {
        var voices = [], qualities = [], voiceSeen = {}, qualSeen = {};
        for (var i = 0; i < variants.length; i++) {
            var vc = variants[i].voice || '';
            var qc = (variants[i].quality || '').toLowerCase();
            if (vc && !voiceSeen[vc]) { voiceSeen[vc] = true; voices.push(vc); }
            if (qc && !qualSeen[qc]) { qualSeen[qc] = true; qualities.push(qc); }
        }
        var hasSeason = seasons && seasons.length > 0;
        // Always show quality/voice rows when there is at least 1 distinct value
        // (consistent with modss which always shows its filter bar)
        var hasQual  = qualities.length >= 1;
        var hasVoice = voices.length >= 1;
        if (!hasSeason && !hasQual && !hasVoice) { return null; }

        var wrap = jq('<div class="em-filters">');

        // Season group (for TV series)
        if (hasSeason) {
            var sg = jq('<div class="em-filter-group">');
            sg.append(jq('<span class="em-filter-label">').text('\u0421\u0435\u0437\u043e\u043d:'));
            var sAll = jq('<div class="em-filter-btn selector">').text('\u0412\u0441\u0435');
            if (!activeSeason) { sAll.addClass('active'); }
            sAll.on('hover:enter click', function () { onChange('season', 0); });
            sg.append(sAll);
            for (var si = 0; si < seasons.length; si++) {
                (function (s) {
                    var btn = jq('<div class="em-filter-btn selector">').text(String(s));
                    if (activeSeason === s) { btn.addClass('active'); }
                    btn.on('hover:enter click', function () { onChange('season', s); });
                    sg.append(btn);
                })(seasons[si]);
            }
            wrap.append(sg);
        }

        // Quality group
        if (hasQual) {
            var qg = jq('<div class="em-filter-group">');
            qg.append(jq('<span class="em-filter-label">').text('\u041a\u0430\u0447\u0435\u0441\u0442\u0432\u043e:'));
            var qAll = jq('<div class="em-filter-btn selector">').text('\u0412\u0441\u0435');
            if (!activeQuality) { qAll.addClass('active'); }
            qAll.on('hover:enter click', function () { onChange('quality', ''); });
            qg.append(qAll);
            for (var qi = 0; qi < qualities.length; qi++) {
                (function (q) {
                    var btn = jq('<div class="em-filter-btn selector">').text(q.toUpperCase());
                    if (activeQuality === q) { btn.addClass('active'); }
                    btn.on('hover:enter click', function () { onChange('quality', q); });
                    qg.append(btn);
                })(qualities[qi]);
            }
            wrap.append(qg);
        }

        // Voice group
        if (hasVoice) {
            var vg = jq('<div class="em-filter-group">');
            vg.append(jq('<span class="em-filter-label">').text('\u041e\u0437\u0432\u0443\u0447\u043a\u0430:'));
            var vAll = jq('<div class="em-filter-btn selector">').text('\u0412\u0441\u0435');
            if (!activeVoice) { vAll.addClass('active'); }
            vAll.on('hover:enter click', function () { onChange('voice', ''); });
            vg.append(vAll);
            for (var vi = 0; vi < voices.length; vi++) {
                (function (v) {
                    var btn = jq('<div class="em-filter-btn selector">').text(v);
                    if (activeVoice === v) { btn.addClass('active'); }
                    btn.on('hover:enter click', function () { onChange('voice', v); });
                    vg.append(btn);
                })(voices[vi]);
            }
            wrap.append(vg);
        }

        return wrap;
    }

    // -------------------------------------------------------
    // Loading state HTML (modss-style spinner)
    // -------------------------------------------------------
    function loadingHtml(subtitle) {
        return '<div class="online-empty" style="text-align:center;padding:3em 2em">' +
            '<div class="online-empty__title">Easy-Mod</div>' +
            '<div class="online-empty__time">' + (subtitle || '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026') + '</div>' +
            SPIN48 +
            '</div>';
    }

    // ==================================================================
    // Component: easy_mod_variants
    // ==================================================================
    function EasyModVariants(object) {
        this._object        = object || {};
        this._movie         = (object && object.movie) ? object.movie : {};
        this._render        = jq('<div class="easy-mod-page" style="padding:1.5em 2em;min-height:10em">');
        this._scroll        = null;
        this._dead          = false;
        this._allVariants   = [];
        this._filterVoice   = '';
        this._filterQuality = '';
        this._filterSeason  = 0;   // 0 = no season filter (all seasons)
        this._isSeries      = false;
        this._seriesSeasons = [];
    }

    EasyModVariants.prototype.create = function () { return this._render; };
    EasyModVariants.prototype.render = function () { return this._render; };

    EasyModVariants.prototype.start = function () {
        log('variants start');
        var self = this;
        var m = self._movie || {};

        // Resolve movie from Activity if not passed
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

        // Detect TV series using only reliable TMDB signals
        var isSeries = !!(m.first_air_date ||
                          (m.number_of_seasons && parseInt(m.number_of_seasons, 10) > 0));
        self._isSeries = isSeries;

        // Build season list from TMDB data (used in the filter bar)
        if (isSeries) {
            var seasons = [];
            if (m.seasons && m.seasons.length) {
                m.seasons.forEach(function (s) {
                    if ((s.season_number || 0) > 0) { seasons.push(s.season_number); }
                });
            }
            if (!seasons.length) {
                var ns = (m.number_of_seasons && parseInt(m.number_of_seasons, 10)) || 3;
                for (var i = 1; i <= ns; i++) { seasons.push(i); }
            }
            self._seriesSeasons = seasons;
        } else {
            self._seriesSeasons = [];
        }

        self._fetchVariants();
    };

    EasyModVariants.prototype._fetchVariants = function () {
        var self  = this;
        var m     = self._movie || {};
        var title = m.title || m.name || m.original_title || m.original_name || '';
        var year  = m.year  || (m.release_date ? m.release_date.slice(0, 4) : '')
                            || (m.first_air_date ? m.first_air_date.slice(0, 4) : '');
        var tmdb  = m.id    || m.tmdb_id || '';
        var orig  = m.original_title || m.original_name || '';

        var loadingLabel = title
            ? '\u041f\u043e\u0438\u0441\u043a \u0434\u043b\u044f \u00ab' + title + '\u00bb' +
              (self._filterSeason ? ' \u2022 \u0421\u0435\u0437\u043e\u043d ' + self._filterSeason : '') + '\u2026'
            : '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026';
        self._render.html(loadingHtml(loadingLabel));

        var params = {};
        if (title) { params.title = title; }
        if (year)  { params.year  = year; }
        if (tmdb)  { params.tmdb_id = tmdb; }
        if (orig && orig !== title) { params.original_title = orig; }
        if (self._filterSeason) { params.season = self._filterSeason; }

        apiGet('/variants', params, function (data) {
            if (self._dead) { return; }
            try {
                var variants = (data && data.variants && data.variants.length) ? data.variants : [];
                log('variants loaded N=' + variants.length);
                self._allVariants  = variants;
                self._filterVoice  = '';
                self._filterQuality = '';
                self._renderVariants();
            } catch (e) {
                log('variants render error', e.message);
                self._render.html('<div class="online-empty"><div class="online-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f</div></div>');
            }
        }, function (err) {
            if (self._dead) { return; }
            log('variants error', err);
            self._render.html(
                '<div class="online-empty" style="padding:2em">' +
                '<div class="online-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430</div>' +
                '<div class="online-empty__time">' + (err || '\u041d\u0435\u0442 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f') + '</div>' +
                '</div>'
            );
        });
    };

    EasyModVariants.prototype._renderVariants = function () {
        var self     = this;
        var m        = self._movie || {};
        var variants = self._allVariants || [];
        var fv       = self._filterVoice   || '';
        var fq       = self._filterQuality || '';

        // Destroy previous scroll
        try { if (self._scroll && self._scroll.destroy) { self._scroll.destroy(); } } catch (e) {}
        self._scroll = null;
        self._render.empty();

        // Apply quality/voice client-side filters
        var shown = [];
        for (var k = 0; k < variants.length; k++) {
            var v = variants[k];
            if (fv && (v.voice || '') !== fv) { continue; }
            if (fq && (v.quality || '').toLowerCase() !== fq) { continue; }
            shown.push(v);
        }

        // Filter bar (season + quality + voice)
        var filterBar = buildFilters(
            variants, fv, fq,
            self._filterSeason, self._seriesSeasons || [],
            function (type, val) {
                if (type === 'quality') {
                    self._filterQuality = val;
                    self._renderVariants();
                } else if (type === 'voice') {
                    self._filterVoice = val;
                    self._renderVariants();
                } else if (type === 'season') {
                    self._filterSeason  = val;
                    self._allVariants   = [];
                    self._filterVoice   = '';
                    self._filterQuality = '';
                    self._fetchVariants();
                }
            }
        );

        if (!shown.length) {
            var emptyWrap = jq('<div style="padding:0 1em">');
            if (filterBar) { emptyWrap.append(filterBar); }
            emptyWrap.append(
                '<div class="online-empty" style="padding:1em 0">' +
                '<div class="online-empty__title">\u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e</div>' +
                '</div>'
            );
            self._render.append(emptyWrap);
            try { Lampa.Controller.toggle('content'); } catch (e) {}
            return;
        }

        // Wrap in Lampa.Scroll (like modss), fallback to plain list
        try {
            var sc = new Lampa.Scroll({ mask: true, over: true });
            sc.render().addClass('layer--wheight');
            if (filterBar) { sc.body().append(filterBar); }
            for (var i = 0; i < shown.length; i++) {
                (function (v2) {
                    sc.body().append(buildCard(v2, m, function (sel) { self._startStream(sel); }));
                })(shown[i]);
            }
            self._render.append(sc.render());
            sc.start();
            self._scroll = sc;
        } catch (scrollErr) {
            log('Lampa.Scroll error:', scrollErr.message);
            var list = jq('<div style="padding:0 1em">');
            if (filterBar) { list.append(filterBar); }
            for (var j = 0; j < shown.length; j++) {
                (function (v3) {
                    list.append(buildCard(v3, m, function (sel) { self._startStream(sel); }));
                })(shown[j]);
            }
            self._render.append(list);
        }

        try { Lampa.Controller.toggle('content'); } catch (e) {}
    };

    EasyModVariants.prototype._startStream = function (variant) {
        var self  = this;
        var m     = self._movie || {};
        var body  = {
            variant_id: variant.id     || '',
            magnet:     variant.magnet || '',
            title:      m.title || m.name || 'Easy-Mod',
        };

        self._render.html(loadingHtml('\u0417\u0430\u043f\u0443\u0441\u043a \u043f\u043e\u0442\u043e\u043a\u0430\u2026'));

        apiPost('/stream/start', body, function (resp) {
            if (self._dead) { return; }
            try {
                var jobId  = resp && (resp.job_id || resp.id);
                var status = resp && resp.status;

                // Cache hit — instant play
                if (status === 'ready' && resp.direct_url) {
                    playDirect(resp.direct_url, m);
                    return;
                }
                if (!jobId) {
                    self._render.html('<div class="online-empty"><div class="online-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430: \u043d\u0435\u0442 job_id</div></div>');
                    return;
                }

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
                '<div class="online-empty" style="padding:2em">' +
                '<div class="online-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u043f\u0443\u0441\u043a\u0430</div>' +
                '<div class="online-empty__time">' + (err || '') + '</div>' +
                '</div>'
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
    // Polls /stream/status, updates progress, auto-plays when ready
    // ==================================================================
    function EasyModWait(object) {
        this._object  = object || {};
        this._movie   = (object && object.movie)   || {};
        this._variant = (object && object.variant) || {};
        this._jobId   = (object && object.job_id)  || '';
        this._render  = jq('<div class="easy-mod-page em-wait" style="padding:2em;min-height:10em">');
        this._dead    = false;
        this._timer   = null;
        this._ticks        = 0;
        this._statusErrors = 0;
        this._FAST_TICKS   = 15;
        this._FAST_INTERVAL= 2000;
        this._SLOW_INTERVAL= 5000;
        this._MAX_TICKS    = 75;
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
            (posterUrl ? '<img src="' + posterUrl + '" style="width:6em;height:9em;object-fit:cover;border-radius:.5em;margin-bottom:1em">' : '') +
            '<div style="font-size:1.3em;font-weight:600;margin-bottom:.3em">' + filmTitle + '</div>' +
            (varLabel ? '<div style="font-size:.9em;opacity:.6;margin-bottom:1em">' + varLabel + '</div>' : '') +
            '<div class="em-wait__pct">0%</div>' +
            '<div class="em-wait__msg">\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 TorBox\u2026</div>' +
            '<div class="em-back selector">\u2190 \u041d\u0430\u0437\u0430\u0434 \u043a \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u0430\u043c</div>'
        );

        self._render.find('.em-back').on('hover:enter click', function () {
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
                    if (pct <= 10)      { msg = '\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u0442\u043e\u0440\u0440\u0435\u043d\u0442\u0430 \u0432 TorBox\u2026'; }
                    else if (pct <= 45) { msg = 'TorBox \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u2026'; }
                    else                { msg = '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 ' + pct + '%\u2026'; }
                }
                if (state === 'ready')  { msg = '\u0413\u043e\u0442\u043e\u0432\u043e! \u0417\u0430\u043f\u0443\u0441\u043a\u0430\u0435\u043c\u2026'; }
                if (state === 'failed') { msg = (resp && resp.message) || '\u041e\u0448\u0438\u0431\u043a\u0430'; }

                try {
                    self._render.find('.em-wait__pct').text(pct + '%');
                    self._render.find('.em-wait__msg').text(msg);
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
        } else if (msg.indexOf('stalled') !== -1) {
            hint = '\u041d\u0435\u0442 \u0441\u0438\u0434\u0435\u0440\u043e\u0432. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a.';
        }

        try {
            self._render.html(
                '<div class="em-wait__error">' + msg + '</div>' +
                (hint ? '<div class="em-wait__hint">' + hint + '</div>' : '') +
                '<div class="em-back selector">\u2190 \u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u0430\u043c</div>'
            );
            self._render.find('.em-back').on('hover:enter click', function () {
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
    // Button injection into film detail page
    // Modss-style: spinner in button, double event hook
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

        // Remove stale button (it may hold a closure for a previously viewed film)
        root.find('.view--easy_mod').remove();

        // Find button container (new Lampa layout first, then classic)
        var container = root.find('.full-start-new__buttons').first();
        if (!container.length) { container = root.find('.full-start__buttons').first(); }
        if (!container.length) { return false; }

        // Resolve movie
        var m = {};
        try {
            var act = Lampa.Activity.active();
            m = (act && (act.movie || act.card || act.data)) || {};
        } catch (ex) {}

        var btn = jq('<div class="full-start__button selector view--easy_mod">')
            .append(jq(BTN_ICO))
            .append(jq('<span>').text('Easy-Mod'));

        btn.on('hover:enter click', function () {
            btn.html(BTN_SPIN + '<span>\u041f\u043e\u0438\u0441\u043a\u2026</span>');

            // Always re-read current movie from Activity at click time to avoid stale closures
            var movie = {};
            try {
                var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
                movie = (act && (act.movie || act.card || act.data)) || {};
            } catch (ex) {}
            if (!movie.title && !movie.name && !movie.id) {
                // Fallback to injected closure value
                movie = m;
            }

            log('open variants for', (movie && (movie.title || movie.name)) || '?');

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

        // Insert before torrent / play / first button
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
    // Hook film page (modss-style: both 'full' and 'activity' events)
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
