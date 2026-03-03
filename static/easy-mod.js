(function () {
    'use strict';

    if (window.__easy_mod_loaded) { return; }
    window.__easy_mod_loaded = true;

    var VERSION = '6.0';
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
        // ⚡ Cached / instant badge (bottom-left of poster)
        ".em-cached-badge{position:absolute;bottom:.5em;left:.5em;background:#ff9800;color:#fff;padding:.15em .5em;border-radius:.3em;font-size:.8em;font-weight:700}",
        // File picker (episode selector in ready torrent)
        ".em-file-list{max-height:60vh;overflow-y:auto}",
        ".em-file-item{display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;padding:.7em 1em;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.08)}",
        ".em-file-item.focus,.em-file-item:hover{background:rgba(255,255,255,.1)}",
        ".em-file-name{-webkit-box-flex:1;flex:1;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;white-space:nowrap;font-size:.95em}",
        ".em-file-size{font-size:.8em;opacity:.6;margin-left:1em;white-space:nowrap}",
        ".em-file-quality{margin-left:.7em;font-size:.8em;font-weight:700;color:#4caf50}",
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
        // Online provider (Rezka, Kinogo, etc.) card highlight
        ".online-variant{border-left:4px solid #00c853;background:rgba(0,200,83,.08)}",
        ".online-variant.focus{background:rgba(0,200,83,.18)}",
        ".em-online-badge{position:absolute;top:.5em;left:.5em;background:#00c853;color:#fff;padding:.15em .5em;border-radius:.3em;font-size:.75em;font-weight:700}",
        // Section headers (Online vs Easy-Mod dividers)
        ".em-section-header{display:-webkit-box;display:flex;-webkit-box-align:center;align-items:center;gap:.6em;padding:.5em 0 .7em;font-size:1em;font-weight:700;opacity:.9;margin-top:.5em}",
        ".em-section-header:first-child{margin-top:0}",
        ".em-section-header__line{-webkit-box-flex:1;flex:1;height:1px;background:rgba(255,255,255,.15)}",
        ".em-section-online .em-section-header{color:#00c853}",
        ".em-section-torrent .em-section-header{color:#168FDF}",
        // Source tab selector (modss-style source picker)
        ".em-source-tabs{display:-webkit-box;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;gap:.4em;padding:.4em 0 1.1em;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:.6em}",
        ".em-source-tab--online.active{background:rgba(0,200,83,.25)!important;border-color:#00c853!important;color:#00c853!important}",
        ".em-source-tab--torrent.active{background:rgba(22,143,223,.25)!important;border-color:#168FDF!important;color:#168FDF!important}",
        ".em-source-tab--online.focus,.em-source-tab--online.active.focus{background:#00c853!important;color:#000!important}",
        ".em-source-tab--torrent.focus,.em-source-tab--torrent.active.focus{background:#168FDF!important;color:#000!important}",
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
            var item = { title: title, url: url };
            if (poster) { item.poster = poster; }
            Lampa.Player.play(item);
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
        // Online badge (top-left) — shown for online providers like Rezka/Kinogo
        var _ONLINE_SRC = { rezka: 1, kinogo: 1, videocdn: 1, kodik: 1 };
        var _onlineSrc = v.source && _ONLINE_SRC[v.source];
        if (_onlineSrc) {
            card.addClass('online-variant');
            imgWrap.append(jq('<div class="em-online-badge">').text('Online'));
        } else if (v.is_cached) {
            // ⚡ Cached badge (instant play) — only for torrent-based variants
            imgWrap.append(jq('<div class="em-cached-badge">').text('\u26a1 \u041c\u0433\u043d\u043e\u0432\u0435\u043d\u043d\u043e'));
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
    function buildFilters(variants, activeVoice, activeQuality, activeSeason, seasons, activeEpisode, episodeCounts, activeLang, onChange) {
        var voices = [], qualities = [], langs = [], voiceSeen = {}, qualSeen = {}, langSeen = {};
        for (var i = 0; i < variants.length; i++) {
            var vc = variants[i].voice || '';
            var qc = (variants[i].quality || '').toLowerCase();
            var lc = (variants[i].language || '').toLowerCase();
            if (vc && !voiceSeen[vc]) { voiceSeen[vc] = true; voices.push(vc); }
            if (qc && !qualSeen[qc]) { qualSeen[qc] = true; qualities.push(qc); }
            if (lc && !langSeen[lc]) { langSeen[lc] = true; langs.push(lc); }
        }
        var hasSeason  = seasons && seasons.length > 0;
        // Build episode list for the active season
        var episodes = [];
        if (hasSeason && activeSeason) {
            var epCount = (episodeCounts && episodeCounts[activeSeason]) || 0;
            for (var e = 1; e <= epCount; e++) { episodes.push(e); }
        }
        var hasEpisode = episodes.length > 0;
        // Always show quality/voice rows when there is at least 1 distinct value
        // (consistent with modss which always shows its filter bar)
        var hasQual  = qualities.length >= 1;
        var hasVoice = voices.length >= 1;
        var hasLang  = langs.length >= 1;  // show language filter whenever at least 1 distinct language found
        if (!hasSeason && !hasQual && !hasVoice && !hasLang) { return null; }

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

        // Episode group (shown only when a season is selected and we know the episode count)
        if (hasEpisode) {
            var eg = jq('<div class="em-filter-group">');
            eg.append(jq('<span class="em-filter-label">').text('\u0421\u0435\u0440\u0438\u044f:'));
            var eAll = jq('<div class="em-filter-btn selector">').text('\u0412\u0441\u0435');
            if (!activeEpisode) { eAll.addClass('active'); }
            eAll.on('hover:enter click', function () { onChange('episode', 0); });
            eg.append(eAll);
            for (var ei = 0; ei < episodes.length; ei++) {
                (function (ep) {
                    var ebtn = jq('<div class="em-filter-btn selector">').text('\u0421\u0435\u0440\u0438\u044f ' + ep);
                    if (activeEpisode === ep) { ebtn.addClass('active'); }
                    ebtn.on('hover:enter click', function () { onChange('episode', ep); });
                    eg.append(ebtn);
                })(episodes[ei]);
            }
            wrap.append(eg);
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

        // Language group (shown when there are 2+ distinct languages)
        if (hasLang) {
            var lg = jq('<div class="em-filter-group">');
            lg.append(jq('<span class="em-filter-label">').text('\u042f\u0437\u044b\u043a:'));
            var lAll = jq('<div class="em-filter-btn selector">').text('\u0412\u0441\u0435');
            if (!activeLang) { lAll.addClass('active'); }
            lAll.on('hover:enter click', function () { onChange('lang', ''); });
            lg.append(lAll);
            for (var li = 0; li < langs.length; li++) {
                (function (lc) {
                    var btn = jq('<div class="em-filter-btn selector">').text(langLabel(lc));
                    if (activeLang === lc) { btn.addClass('active'); }
                    btn.on('hover:enter click', function () { onChange('lang', lc); });
                    lg.append(btn);
                })(langs[li]);
            }
            wrap.append(lg);
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
    // Source tab selector (modss-style: one tab per provider)
    // Shows only sources that have at least one variant.
    // Returns null when there is only one source (no tabs needed).
    // -------------------------------------------------------
    var _ONLINE_SOURCE_KEYS = { rezka: 1, kinogo: 1, videocdn: 1, kodik: 1 };
    var _SOURCE_KEY_TORRENT = 'torrent';
    var _SOURCE_LABELS = { rezka: 'HDRezka', kinogo: 'Kinogo', videocdn: 'VideoCDN', kodik: 'Kodik', torrent: 'Easy-Mod' };
    var _LABEL_ALL         = '\u0412\u0441\u0435';          // "Все"
    var _HEADER_ONLINE     = '\uD83C\uDF10 \u041e\u043d\u043b\u0430\u0439\u043d \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0438';
    var _HEADER_EASYMOD    = '\u26A1 Easy-Mod';

    function buildSourceTabs(allVariants, activeSource, onChange) {
        // Collect unique source keys in order of first appearance
        var seen = {}, sources = [];
        for (var i = 0; i < allVariants.length; i++) {
            var sv = allVariants[i];
            var key = _ONLINE_SOURCE_KEYS[sv.source] ? sv.source : _SOURCE_KEY_TORRENT;
            if (!seen[key]) {
                seen[key] = true;
                sources.push({ key: key, type: _ONLINE_SOURCE_KEYS[sv.source] ? 'online' : _SOURCE_KEY_TORRENT });
            }
        }
        // No tab bar needed when only one source type
        if (sources.length <= 1) { return null; }

        var wrap = jq('<div class="em-source-tabs">');

        // "Все" (All) tab
        var allBtn = jq('<div class="em-filter-btn selector">').text(_LABEL_ALL);
        if (!activeSource) { allBtn.addClass('active'); }
        allBtn.on('hover:enter click', function () { onChange(''); });
        wrap.append(allBtn);

        for (var si = 0; si < sources.length; si++) {
            (function (src) {
                var btn = jq('<div class="em-filter-btn em-source-tab--' + src.type + ' selector">')
                    .text(_SOURCE_LABELS[src.key] || src.key);
                if (activeSource === src.key) { btn.addClass('active'); }
                btn.on('hover:enter click', function () { onChange(src.key); });
                wrap.append(btn);
            })(sources[si]);
        }
        return wrap;
    }

    // -------------------------------------------------------
    // Source selector row (modss-style: always 3 buttons shown upfront)
    // Always shows [Все | TorBox | HDRezka], regardless of loaded results.
    // activeSource: 'all'|'torbox'|'rezka'
    // -------------------------------------------------------
    function buildSourceSelector(activeSource, onChange) {
        var wrap = jq('<div class="em-source-tabs">');
        var defs = [
            { key: 'all',    label: '\u0412\u0441\u0435',  type: '' },
            { key: 'torbox', label: 'TorBox',    type: 'torrent' },
            { key: 'rezka',  label: 'HDRezka',   type: 'online' },
        ];
        for (var i = 0; i < defs.length; i++) {
            (function (d) {
                var cls = 'em-filter-btn selector';
                if (d.type) { cls += ' em-source-tab--' + d.type; }
                var btn = jq('<div class="' + cls + '">').text(d.label);
                if (activeSource === d.key) { btn.addClass('active'); }
                btn.on('hover:enter click', function () {
                    if (d.key === activeSource) { return; }  // already selected
                    onChange(d.key);
                });
                wrap.append(btn);
            })(defs[i]);
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
        this._filterLang    = '';
        this._filterSource  = '';  // '' = all; 'rezka'|'kinogo'|'videocdn'|'kodik' = online source; 'torrent' = Easy-Mod
        this._activeSource  = 'all'; // 'all' | 'torbox' | 'rezka' — pre-selected source (shown upfront)
        this._filterSeason  = 0;   // 0 = no season filter (all seasons)
        this._filterEpisode = 0;   // 0 = no episode filter
        this._isSeries      = false;
        this._seriesSeasons = [];
        this._episodeCounts = {};  // season_number → episode_count
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
            var epCounts = {};
            if (m.seasons && m.seasons.length) {
                m.seasons.forEach(function (s) {
                    if ((s.season_number || 0) > 0) {
                        seasons.push(s.season_number);
                        if (s.episode_count) {
                            epCounts[s.season_number] = s.episode_count;
                        }
                    }
                });
            }
            if (!seasons.length) {
                var ns = (m.number_of_seasons && parseInt(m.number_of_seasons, 10)) || 3;
                for (var i = 1; i <= ns; i++) { seasons.push(i); }
            }
            self._seriesSeasons  = seasons;
            self._episodeCounts  = epCounts;
        } else {
            self._seriesSeasons  = [];
            self._episodeCounts  = {};
        }

        // ── Enrich movie object with IMDB ID if not already present ────────
        // Without imdb_id, Jackett falls back to unreliable text search and may
        // return wrong films.  The TMDB /external_ids endpoint is fast (~200 ms)
        // and gives us the exact IMDB ID needed for t=movie/tvsearch&imdbid= queries.
        var _enrichTmdb = (m.id || m.tmdb_id || '') + '';
        var _enrichImdb = m.imdb_id || (m.external_ids && m.external_ids.imdb_id) || '';
        if (_enrichTmdb && !_enrichImdb && typeof fetch !== 'undefined') {
            var _enrichType = self._isSeries ? 'tv' : 'movie';
            // Use Lampa's own TMDB API key first; fall back to the same public key
            // that Lampa itself ships with (hardcoded in Lampa's source).
            var _enrichKey  = '4ef0d7355d9ffb5151e987764708ce96';
            try {
                var _lk = (Lampa.Api && Lampa.Api.key && Lampa.Api.key()) ||
                          (Lampa.Storage && (Lampa.Storage.get('tmdb_api') || Lampa.Storage.get('tmdb_key') || ''));
                if (_lk) { _enrichKey = _lk; }
            } catch (e) {}
            var _enrichUrl = 'https://api.themoviedb.org/3/' + _enrichType + '/' +
                             _enrichTmdb + '/external_ids?api_key=' + _enrichKey;
            log('fetching imdb_id for tmdb=' + _enrichTmdb);
            fetch(_enrichUrl, { mode: 'cors' })
                .then(function (r) { return r.json(); })
                .then(function (d) { if (d && d.imdb_id) { self._movie.imdb_id = d.imdb_id; log('imdb_id=' + d.imdb_id); } })
                .catch(function () {})
                .then(function () { self._fetchVariants(); });
        } else {
            self._fetchVariants();
        }
    };

    EasyModVariants.prototype._fetchVariants = function () {
        var self  = this;
        var m     = self._movie || {};
        var title = m.title || m.name || m.original_title || m.original_name || '';
        var year  = m.year  || (m.release_date ? m.release_date.slice(0, 4) : '')
                            || (m.first_air_date ? m.first_air_date.slice(0, 4) : '');
        var tmdb  = m.id    || m.tmdb_id || '';
        var orig  = m.original_title || m.original_name || '';
        // IMDB ID — Lampa exposes it as m.imdb_id (e.g. "tt0111161") or
        // nested in m.external_ids.imdb_id from TMDB enrichment
        var imdb  = m.imdb_id || (m.external_ids && m.external_ids.imdb_id) || '';

        var loadingLabel = title
            ? '\u041f\u043e\u0438\u0441\u043a \u0434\u043b\u044f \u00ab' + title + '\u00bb' +
              (self._filterSeason ? ' \u2022 \u0421\u0435\u0437\u043e\u043d ' + self._filterSeason : '') +
              (self._filterEpisode ? ' \u2022 \u0421\u0435\u0440\u0438\u044f ' + self._filterEpisode : '') + '\u2026'
            : '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026';

        // ── Rebuild UI: source selector + season bar FLAT, then loading spinner ──
        // Destroy any existing scroll first to avoid detached-DOM leaks.
        try { if (self._scroll && self._scroll.destroy) { self._scroll.destroy(); } } catch (e) { log('scroll destroy', e.message); }
        self._scroll = null;
        self._render.empty();

        // 1. Source selector [Все | TorBox | HDRezka] — always visible, even during loading
        var srcSel = buildSourceSelector(self._activeSource, function (key) {
            self._activeSource  = key;
            // Map selector key to result source filter:
            //   'torbox' → show only torrent variants
            //   'rezka'  → show only rezka online variants
            //   'all'    → show all
            self._filterSource  = (key === 'torbox') ? _SOURCE_KEY_TORRENT : (key === 'rezka') ? 'rezka' : '';
            self._allVariants   = [];
            self._filterVoice   = '';
            self._filterQuality = '';
            self._filterLang    = '';
            self._fetchVariants();
        });
        self._render.append(srcSel);

        // 2. Season/episode bar — shown immediately (not inside scroll) so it's always accessible
        if (self._isSeries && self._seriesSeasons.length > 0) {
            var earlyBar = buildFilters(
                [], '', '', self._filterSeason, self._seriesSeasons,
                self._filterEpisode, self._episodeCounts, '',
                function (type, val) {
                    if (type === 'season') {
                        self._filterSeason  = val;
                        self._filterEpisode = 0;
                        self._allVariants   = [];
                        self._filterVoice   = '';
                        self._filterQuality = '';
                        self._filterLang    = '';
                        self._fetchVariants();
                    } else if (type === 'episode') {
                        self._filterEpisode = val;
                        self._allVariants   = [];
                        self._filterVoice   = '';
                        self._filterQuality = '';
                        self._filterLang    = '';
                        self._fetchVariants();
                    }
                }
            );
            if (earlyBar) { self._render.append(earlyBar); }
        }

        // 3. Loading spinner (below selector + season bar)
        var spinnerWrap = jq('<div class="em-cards-area">');
        spinnerWrap.html(loadingHtml(loadingLabel));
        self._render.append(spinnerWrap);

        var params = {};
        if (title) { params.title = title; }
        if (year)  { params.year  = year; }
        if (tmdb)  { params.tmdb_id = tmdb; }
        if (imdb)  { params.imdb_id = imdb; }
        if (orig)  { params.original_title = orig; }
        if (self._filterSeason)  { params.season  = self._filterSeason; }
        if (self._filterEpisode) { params.episode = self._filterEpisode; }

        // ── Fetch only the APIs relevant to the selected source ──────────────────
        var wantTorbox = (self._activeSource === 'all' || self._activeSource === 'torbox');
        var wantRezka  = (self._activeSource === 'all' || self._activeSource === 'rezka');

        var variantsDone  = !wantTorbox;  // skip if not needed
        var hdrezkaDone   = !wantRezka;   // skip if not needed
        var variantsData  = [];
        var hdrezkaData   = [];
        var torboxFastPath = false;

        function _mergeAndRender() {
            if (!variantsDone || !hdrezkaDone) { return; }
            if (self._dead) { return; }
            try {
                var all = variantsData.concat(hdrezkaData);
                log('merged variants N=' + all.length + ' (torrent=' + variantsData.length +
                    ' hdrezka=' + hdrezkaData.length + ')');
                self._allVariants  = all;
                self._filterVoice  = '';
                self._filterQuality = '';
                self._filterLang    = '';
                if (torboxFastPath) {
                    try { Lampa.Noty.show('\u26a1 \u0412\u0430\u0440\u0438\u0430\u043d\u0442\u044b \u0438\u0437 \u043a\u044d\u0448\u0430 TorBox \u2014 \u043c\u0433\u043d\u043e\u0432\u0435\u043d\u043d\u044b\u0439 \u0437\u0430\u043f\u0443\u0441\u043a!'); } catch (e) {}
                }
                self._renderVariants();
            } catch (e) {
                log('variants render error', e.message);
                spinnerWrap.html('<div class="online-empty"><div class="online-empty__title">\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f</div></div>');
            }
        }

        if (wantTorbox) {
            apiGet('/variants', params, function (data) {
                if (self._dead) { return; }
                variantsDone = true;
                variantsData = (data && data.variants && data.variants.length) ? data.variants : [];
                log('variants loaded N=' + variantsData.length + (data && data.source ? ' source=' + data.source : ''));
                if (data && data.source === 'torbox_direct') { torboxFastPath = true; }
                _mergeAndRender();
            }, function (err) {
                if (self._dead) { return; }
                log('variants error', err);
                variantsDone = true;
                _mergeAndRender();
            });
        }

        if (wantRezka) {
            var hdParams = {};
            if (title) { hdParams.title = title; }
            if (year)  { hdParams.year  = year; }
            if (self._filterSeason)  { hdParams.season  = self._filterSeason; }
            if (self._filterEpisode) { hdParams.episode = self._filterEpisode; }

            apiGet('/hdrezka', hdParams, function (data) {
                if (self._dead) { return; }
                hdrezkaDone = true;
                var files = (data && data.files) ? data.files : [];
                hdrezkaData = [];
                for (var fi = 0; fi < files.length; fi++) {
                    var f = files[fi];
                    if (!f.url) { continue; }
                    hdrezkaData.push({
                        id:        'hdrezka_api_' + (f.quality || 'unknown'),
                        label:     'HDRezka \u2022 RU \u2022 ' + (f.quality || '?').toUpperCase() + ' (Online)',
                        quality:   f.quality   || 'unknown',
                        url:       f.url,
                        source:    'rezka',
                        language:  'ru',
                        voice:     '',
                        is_cached: true,
                        seeders:   0,
                        size_mb:   0,
                        codec:     '',
                        magnet:    ''
                    });
                }
                log('hdrezka loaded N=' + hdrezkaData.length);
                _mergeAndRender();
            }, function (err) {
                if (self._dead) { return; }
                log('hdrezka error (non-fatal)', err);
                hdrezkaDone = true;
                _mergeAndRender();
            });
        }
    };

    EasyModVariants.prototype._renderVariants = function () {
        var self     = this;
        var m        = self._movie || {};
        var variants = self._allVariants || [];
        var fv       = self._filterVoice   || '';
        var fq       = self._filterQuality || '';
        var fl       = self._filterLang    || '';
        var fs       = self._filterSource  || '';

        // Destroy previous scroll
        try { if (self._scroll && self._scroll.destroy) { self._scroll.destroy(); } } catch (e) {}
        self._scroll = null;

        // Build source tabs from the FULL (unfiltered) variant list so all available
        // sources always appear in the tab bar, even after applying voice/quality filters.
        // Apply source pre-filter based on _filterSource (set by upfront source selector)
        var sourceFiltered = [];
        for (var sf = 0; sf < variants.length; sf++) {
            var vsf = variants[sf];
            if (!fs) {
                sourceFiltered.push(vsf);
            } else if (fs === _SOURCE_KEY_TORRENT) {
                if (!_ONLINE_SOURCE_KEYS[vsf.source]) { sourceFiltered.push(vsf); }
            } else {
                if (vsf.source === fs) { sourceFiltered.push(vsf); }
            }
        }

        // Separate online variants from torrent-based variants.
        var shownOnline = [];
        var torrentVariants = [];
        for (var k = 0; k < sourceFiltered.length; k++) {
            var v = sourceFiltered[k];
            if (_ONLINE_SOURCE_KEYS[v.source]) {
                shownOnline.push(v);
            } else {
                torrentVariants.push(v);
            }
        }
        // Apply voice/quality/lang filters only to torrent variants
        var shownTorrents = [];
        for (var k2 = 0; k2 < torrentVariants.length; k2++) {
            var vt = torrentVariants[k2];
            if (fv && (vt.voice || '') !== fv) { continue; }
            if (fq && (vt.quality || '').toLowerCase() !== fq) { continue; }
            if (fl && (vt.language || '').toLowerCase() !== fl) { continue; }
            shownTorrents.push(vt);
        }

        // Filter bar for quality/voice/lang (season/episode already shown above by _fetchVariants upfront)
        var filterBarOnChange = function (type, val) {
            if (type === 'quality') {
                self._filterQuality = val;
                self._renderVariants();
            } else if (type === 'voice') {
                self._filterVoice = val;
                self._renderVariants();
            } else if (type === 'lang') {
                self._filterLang = val;
                self._renderVariants();
            } else if (type === 'season') {
                self._filterSeason  = val;
                self._filterEpisode = 0;
                self._allVariants   = [];
                self._filterVoice   = '';
                self._filterQuality = '';
                self._filterLang    = '';
                self._fetchVariants();
            } else if (type === 'episode') {
                self._filterEpisode = val;
                self._allVariants   = [];
                self._filterVoice   = '';
                self._filterQuality = '';
                self._filterLang    = '';
                self._fetchVariants();
            }
        };
        var filterBar = buildFilters(
            torrentVariants, fv, fq,
            self._filterSeason, self._seriesSeasons || [],
            self._filterEpisode, self._episodeCounts || {},
            fl,
            filterBarOnChange
        );

        // ── Rebuild page: source selector + filter bar FLAT, then cards in Scroll ──
        // Destroy previous scroll
        try { if (self._scroll && self._scroll.destroy) { self._scroll.destroy(); } } catch (e) { log('scroll destroy', e.message); }
        self._scroll = null;
        self._render.empty();

        // 1. Source selector (always shown flat, not inside scroll)
        var srcSel2 = buildSourceSelector(self._activeSource, function (key) {
            self._activeSource  = key;
            self._filterSource  = (key === 'torbox') ? _SOURCE_KEY_TORRENT : (key === 'rezka') ? 'rezka' : '';
            self._allVariants   = [];
            self._filterVoice   = '';
            self._filterQuality = '';
            self._filterLang    = '';
            self._fetchVariants();
        });
        self._render.append(srcSel2);

        // 2. Filter bar (season/episode/quality/voice/lang) FLAT — NOT inside scroll.
        // This fixes the TV-remote navigation bug where season/episode buttons were
        // invisible because they were clipped inside Lampa.Scroll.
        if (filterBar) { self._render.append(filterBar); }

        var totalShown = shownOnline.length + shownTorrents.length;
        if (!totalShown) {
            self._render.append(
                '<div class="online-empty" style="padding:1em 0">' +
                '<div class="online-empty__title">\u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e</div>' +
                '</div>'
            );
            try { Lampa.Controller.toggle('content'); } catch (e) {}
            return;
        }

        // Helper: build a section header element
        function buildSectionHeader(label) {
            return jq('<div class="em-section-header">').html(
                '<span class="em-section-header__line"></span>' +
                '<span>' + label + '</span>' +
                '<span class="em-section-header__line"></span>'
            );
        }

        // 3. Cards list — inside Lampa.Scroll (only the cards, not the filter UI)
        try {
            var sc = new Lampa.Scroll({ mask: true, over: true });
            sc.render().addClass('layer--wheight');

            // ── Online sources section ──────────────────────────────────────────
            if (shownOnline.length > 0) {
                var onlineSec = jq('<div class="em-section-online">');
                if (shownTorrents.length > 0) { onlineSec.append(buildSectionHeader(_HEADER_ONLINE)); }
                for (var i = 0; i < shownOnline.length; i++) {
                    (function (vo) {
                        onlineSec.append(buildCard(vo, m, function (sel) { self._startStream(sel); }));
                    })(shownOnline[i]);
                }
                sc.body().append(onlineSec);
            }

            // ── Easy-Mod (torrent) section ──────────────────────────────────────
            if (shownTorrents.length > 0) {
                var torrentSec = jq('<div class="em-section-torrent">');
                if (shownOnline.length > 0) { torrentSec.append(buildSectionHeader(_HEADER_EASYMOD)); }
                for (var j = 0; j < shownTorrents.length; j++) {
                    (function (vt2) {
                        torrentSec.append(buildCard(vt2, m, function (sel) { self._startStream(sel); }));
                    })(shownTorrents[j]);
                }
                sc.body().append(torrentSec);
            }

            self._render.append(sc.render());
            sc.start();
            self._scroll = sc;
        } catch (scrollErr) {
            log('Lampa.Scroll error:', scrollErr.message);
            var list = jq('<div style="padding:0 1em">');
            if (shownOnline.length > 0) {
                if (shownTorrents.length > 0) { list.append(buildSectionHeader(_HEADER_ONLINE)); }
                for (var i2 = 0; i2 < shownOnline.length; i2++) {
                    (function (vo2) {
                        list.append(buildCard(vo2, m, function (sel) { self._startStream(sel); }));
                    })(shownOnline[i2]);
                }
            }
            if (shownTorrents.length > 0) {
                if (shownOnline.length > 0) { list.append(buildSectionHeader(_HEADER_EASYMOD)); }
                for (var j2 = 0; j2 < shownTorrents.length; j2++) {
                    (function (vt3) {
                        list.append(buildCard(vt3, m, function (sel) { self._startStream(sel); }));
                    })(shownTorrents[j2]);
                }
            }
            self._render.append(list);
        }

        try { Lampa.Controller.toggle('content'); } catch (e) {}
    };

    EasyModVariants.prototype._startStream = function (variant) {
        var self  = this;
        var m     = self._movie || {};

        // Online variants (Rezka/Kinogo/etc.) have a direct player URL — play instantly.
        if (variant.url) {
            log('online variant — play direct:', variant.url.slice(0, 80));
            playDirect(variant.url, m);
            return;
        }

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
                        season:    self._filterSeason  || 0,
                        episode:   self._filterEpisode || 0,
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
        this._episode = (object && object.episode) || 0;  // requested episode number (0 = none)
        this._season  = (object && object.season)  || 0;  // requested season number (0 = none)
        this._render  = jq('<div class="easy-mod-page em-wait" style="padding:2em;min-height:10em">');
        this._dead    = false;
        this._timer   = null;
        this._ticks        = 0;
        this._statusErrors = 0;
        this._FAST_TICKS   = 30;
        this._FAST_INTERVAL= 800;
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
                    self._dead = 'playing';
                    clearTimeout(self._timer);
                    // Check if this torrent has multiple video files (whole-season pack)
                    // If so, show a file picker before playing
                    self._maybeShowFilePicker(resp.direct_url, self._jobId);
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

    EasyModWait.prototype._maybeShowFilePicker = function (defaultUrl, jobId) {
        var self = this;
        var m = self._movie || {};
        var wantEp     = self._episode || 0;
        var wantSeason = self._season  || 0;
        // Fetch file list from /stream/files
        apiGet('/stream/files', { job_id: jobId }, function (data) {
            if (self._dead && self._dead !== 'picker' && self._dead !== 'playing') { return; }
            var files = (data && data.files) || [];
            var videoFiles = files.filter(function (f) { return f.is_video; });
            // If only one video file (or none), play the default URL directly
            if (videoFiles.length <= 1) {
                playDirect(defaultUrl, m);
                return;
            }
            // _showFilePicker handles episode matching, auto-play and filtered picker display
            self._showFilePicker(videoFiles, jobId, defaultUrl, m, wantSeason, wantEp);
        }, function () {
            // Error fetching files — fall back to default URL
            playDirect(defaultUrl, m);
        });
    };

    // Extract episode number from a filename (client-side mirror of _episode_num() in app/routers/stream.py).
    // NOTE: Keep this in sync with the Python implementation when changing episode-detection patterns.
    function _fileEpNum(name) {
        var basename = (name || '').split(/[\\/]/).pop();
        // SxxExx (highest priority — most explicit)
        var m = basename.match(/[Ss]\d{1,2}[Ee](\d{1,3})/);
        if (m) { return parseInt(m[1], 10); }
        // Exx or EPxx
        m = basename.match(/[Ee][Pp]?(\d{1,3})/);
        if (m) { return parseInt(m[1], 10); }
        // episode N
        m = basename.match(/episode\s*(\d{1,3})/i);
        if (m) { return parseInt(m[1], 10); }
        return 0;
    }

    // Extract season number from a filename.
    function _fileSeasonNum(name) {
        var basename = (name || '').split(/[\\/]/).pop();
        // SxxExx or Sxx standalone
        var m = basename.match(/[Ss](\d{1,2})[Ee]\d{1,3}/);
        if (m) { return parseInt(m[1], 10); }
        m = basename.match(/(?:season|сезон)\s*(\d{1,2})/i);
        if (m) { return parseInt(m[1], 10); }
        return 0;
    }

    // Build a human-readable file label: "Сезон N • Серия M" when both are detectable,
    // "Серия N" when only episode, raw basename otherwise.
    function _fileLabel(name) {
        var s = _fileSeasonNum(name);
        var e = _fileEpNum(name);
        if (s && e) { return '\u0421\u0435\u0437\u043e\u043d ' + s + ' \u2022 \u0421\u0435\u0440\u0438\u044f ' + e; }
        if (e)      { return '\u0421\u0435\u0440\u0438\u044f ' + e; }
        return (name || '').split(/[\\/]/).pop();
    }

    // wantSeason/wantEp: 0 = no filter; > 0 = pre-filter and auto-play if single match.
    EasyModWait.prototype._showFilePicker = function (files, jobId, defaultUrl, m, wantSeason, wantEp) {
        var self = this;
        wantSeason = wantSeason || 0;
        wantEp     = wantEp     || 0;

        // When a specific episode (and optionally season) is requested, filter the list.
        // Season filter is applied only when filenames carry season info to avoid
        // accidentally hiding files from flat torrent packs (e.g. single-season torrents
        // that don't embed the season number in each filename).
        var filtered = files;
        if (wantEp) {
            var byEp = files.filter(function (f) { return _fileEpNum(f.name) === wantEp; });
            if (byEp.length > 0) {
                // Further narrow by season when season info is available in the filenames
                if (wantSeason) {
                    var bySeason = byEp.filter(function (f) {
                        var s = _fileSeasonNum(f.name);
                        return s === 0 || s === wantSeason;  // 0 = season unknown — keep
                    });
                    if (bySeason.length > 0) { byEp = bySeason; }
                }
                if (byEp.length === 1) {
                    // Exactly one match — auto-play without showing the picker
                    apiGet('/stream/play_file', { job_id: jobId, file_id: String(byEp[0].file_id) }, function (resp) {
                        if (resp && resp.direct_url) { playDirect(resp.direct_url, m); }
                        else { playDirect(defaultUrl, m); }
                    }, function () { playDirect(defaultUrl, m); });
                    return;
                }
                filtered = byEp;
            }
            // If no files match the requested episode at all, show all files with a note
        }

        self._render.empty();
        var wrap = jq('<div class="em-wait" style="padding:1em 1.5em">');
        // Header: contextualise by season+episode when requested
        var hdr;
        if (wantSeason && wantEp) {
            hdr = '\u0421\u0435\u0437\u043e\u043d ' + wantSeason + ' \u2022 \u0421\u0435\u0440\u0438\u044f ' + wantEp + ' \u2014 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0430\u0439\u043b:';
        } else if (wantEp) {
            hdr = '\u0421\u0435\u0440\u0438\u044f ' + wantEp + ' \u2014 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u0430\u0439\u043b:';
        } else {
            hdr = '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0435\u0440\u0438\u044e:';
        }
        wrap.append(jq('<div class="em-wait__msg" style="margin-bottom:.7em">').text(hdr));
        var listEl = jq('<div class="em-file-list">');
        // files arrive pre-sorted by episode number ascending from the backend
        for (var fi = 0; fi < filtered.length; fi++) {
            (function (f) {
                var item = jq('<div class="em-file-item selector">');
                var name = f.name || String(f.file_id);
                var label = _fileLabel(name);
                item.append(jq('<span class="em-file-name">').text(label));
                if (f.quality) {
                    item.append(jq('<span class="em-file-quality">').text(f.quality.toUpperCase()));
                }
                if (f.size_mb > 0) {
                    item.append(jq('<span class="em-file-size">').text(fmtSize(f.size_mb)));
                }
                item.on('hover:enter click', function () {
                    // Request direct link for the chosen file
                    apiGet('/stream/play_file', { job_id: jobId, file_id: String(f.file_id) }, function (resp) {
                        if (resp && resp.direct_url) {
                            playDirect(resp.direct_url, m);
                        } else {
                            playDirect(defaultUrl, m);
                        }
                    }, function () {
                        playDirect(defaultUrl, m);
                    });
                });
                listEl.append(item);
            })(filtered[fi]);
        }
        wrap.append(listEl);
        self._render.append(wrap);
        try { Lampa.Controller.toggle('content'); } catch (e) {}
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
