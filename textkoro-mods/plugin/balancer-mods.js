/**
 * balancer-mods.js - Easy-Mods Lampa plugin v4.0
 *
 * Studied reference plugins:
 *   - nb557/plugins/online_mod.js
 *   - bennington111/uaonline/on_full.js
 *   - ipavlin98/lmp-plugins/huyfix-full.js
 *
 * Fixes applied in v4:
 *   1. BTN_HTML: broken SVG ("fill= missing space) fixed - single clean string
 *   2. Button injection: follows nb557/huyfix pattern (.view--torrent + .after())
 *   3. Active-card fallback: handles Lampa.Activity.active() (bennington pattern)
 *   4. Lampa.Controller.toggle('content') before Select.show (huyfix pattern)
 *   5. No #{} lang keys needed - removed LANG/Lang.add dependency
 *
 * ES5-compatible. No emoji. All errors caught.
 */
(function () {
    'use strict';

    if (typeof Lampa === 'undefined') return;

    /* ------------------------------------------------------------------ */
    /*  Constants                                                           */
    /* ------------------------------------------------------------------ */

    var PLUGIN_ID   = 'easy_mods';
    var PLUGIN_NAME = 'Easy-Mods';
    var PROXY_DEFAULT = 'https://your-proxy-domain.com/api/balancers';
    var CACHE_TTL = 12 * 60 * 1000;

    var QUALITY_ORDER = [
        '4K HDR10+', '4K HDR', '4K SDR', '4K', 'Ultra HD', 'UHD',
        '2160p',
        '1080p Ultra', '1080p', 'FullHD', 'Full HD', 'FHD',
        '720p', 'HD',
        '480p', '360p', 'Auto'
    ];

    var BALANCERS = [
        { id: 'hdrezka',  name: 'HDRezka',  quality: '4K / 1080p / 720p' },
        { id: 'zetflix',  name: 'Zetflix',  quality: '4K / 1080p'         },
        { id: 'alloha',   name: 'Alloha',   quality: '4K HDR / 1080p'     },
        { id: 'videocdn', name: 'VideoCDN', quality: '1080p / 720p'        },
        { id: 'kodik',    name: 'Kodik',    quality: '1080p / 720p'        },
        { id: 'ashdi',    name: 'Ashdi',    quality: '1080p / 720p (UA)'   },
        { id: 'filmix',   name: 'Filmix',   quality: '4K / 1080p'          }
    ];

    /* ------------------------------------------------------------------ */
    /*  Button HTML - single valid string (no multi-part join that breaks  */
    /*  SVG attribute spacing).  Uses nb557 broadcast icon SVG path.      */
    /* ------------------------------------------------------------------ */
    var BTN_HTML = '<div class="full-start__button selector view--easy_mods" data-subtitle="Easy-Mods"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 244 260" width="44" height="44"><path d="M242,88v170H10V88h41l-38,38h37.1l38-38h38.4l-38,38h38.4l38-38h38.3l-38,38H204L242,88L242,88z M228.9,2l8,37.7l0,0 L191.2,10L228.9,2z M160.6,56l-45.8-29.7l38-8.1l45.8,29.7L160.6,56z M84.5,72.1L38.8,42.4l38-8.1l45.8,29.7L84.5,72.1z M10,88 L2,50.2L47.8,80L10,88z" fill="currentColor"/></svg><span>Easy-Mods</span></div>';

    /* ------------------------------------------------------------------ */
    /*  State                                                               */
    /* ------------------------------------------------------------------ */

    var State = {
        inited: false,
        cache:  {}
    };

    /* ------------------------------------------------------------------ */
    /*  Storage                                                             */
    /* ------------------------------------------------------------------ */

    function get(key, fallback) {
        try { return Lampa.Storage.get(key, fallback); } catch (e) { return fallback; }
    }

    function set(key, value) {
        try { Lampa.Storage.set(key, value); } catch (e) {}
    }

    function readCfg() {
        return {
            proxyUrl:    String(get('easy_mods_proxy', PROXY_DEFAULT) || PROXY_DEFAULT).replace(/\/+$/, ''),
            filmixToken: String(get('easy_mods_filmix_token', '') || '').trim(),
            enabledMap:  get('easy_mods_enabled', {}) || {}
        };
    }

    function isEnabled(id) {
        var map = readCfg().enabledMap;
        if (!map || typeof map !== 'object') return true;
        if (typeof map[id] === 'boolean') return map[id];
        return true;
    }

    function setEnabled(id, val) {
        var map = readCfg().enabledMap || {};
        map[id] = !!val;
        set('easy_mods_enabled', map);
    }

    /* ------------------------------------------------------------------ */
    /*  Notifications                                                       */
    /* ------------------------------------------------------------------ */

    function notice(text) {
        try {
            if (Lampa.Noty && Lampa.Noty.show) return Lampa.Noty.show(text);
            if (Lampa.Notice && Lampa.Notice.show) return Lampa.Notice.show(text, 'info');
        } catch (e) {}
    }

    /* ------------------------------------------------------------------ */
    /*  Cache                                                               */
    /* ------------------------------------------------------------------ */

    function cacheRead(key) {
        var entry = State.cache[key];
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) { delete State.cache[key]; return null; }
        return entry.data;
    }

    function cacheWrite(key, data) {
        State.cache[key] = { data: data, expiresAt: Date.now() + CACHE_TTL };
    }

    /* ------------------------------------------------------------------ */
    /*  Network (Lampa.Reguest first, fetch fallback)                      */
    /* ------------------------------------------------------------------ */

    function doFetch(url) {
        if (typeof Lampa.Reguest === 'function') {
            return new Promise(function (resolve, reject) {
                var net = new Lampa.Reguest();
                net.timeout(15000);
                net.silent(
                    url,
                    function (json) { resolve(json); },
                    function (a, c) {
                        reject(new Error(net.errorDecode ? net.errorDecode(a, c) : 'network error'));
                    },
                    false,
                    { dataType: 'json' }
                );
            });
        }
        if (typeof fetch === 'function') {
            return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
                if (!res.ok) { throw new Error('HTTP ' + res.status); }
                return res.json();
            });
        }
        return Promise.reject(new Error('no network method'));
    }

    /* ------------------------------------------------------------------ */
    /*  Card -> meta                                                        */
    /* ------------------------------------------------------------------ */

    function cardToMeta(card) {
        if (!card) return null;
        var title = card.original_title || card.title || card.name || '';
        if (!title) return null;
        var year = '';
        if (card.release_date)       year = String(card.release_date).slice(0, 4);
        else if (card.first_air_date) year = String(card.first_air_date).slice(0, 4);
        else if (card.year)           year = String(card.year);
        return {
            title:   title,
            year:    year,
            kp_id:   card.kinopoisk_id || card.kp_id   || null,
            tmdb_id: card.id           || card.tmdb_id  || null,
            imdb_id: card.imdb_id                       || null,
            type:    (card.seasons || card.number_of_seasons) ? 'tv' : 'movie'
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Quality sort                                                        */
    /* ------------------------------------------------------------------ */

    function qualityRank(q) {
        var label = String(q || '').toLowerCase();
        for (var i = 0; i < QUALITY_ORDER.length; i++) {
            if (label.indexOf(QUALITY_ORDER[i].toLowerCase()) !== -1) return i;
        }
        return QUALITY_ORDER.length;
    }

    function sortByQuality(items) {
        return items.slice().sort(function (a, b) {
            return qualityRank(a.quality) - qualityRank(b.quality);
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Proxy fetch                                                         */
    /* ------------------------------------------------------------------ */

    function fetchBalancer(balancerId, meta) {
        var cfg = readCfg();
        var qs = [
            'balancer='  + encodeURIComponent(balancerId),
            'title='     + encodeURIComponent(meta.title  || ''),
            'year='      + encodeURIComponent(meta.year   || ''),
            'type='      + encodeURIComponent(meta.type   || 'movie')
        ];
        if (meta.kp_id)   qs.push('kp_id='   + encodeURIComponent(meta.kp_id));
        if (meta.tmdb_id) qs.push('tmdb_id=' + encodeURIComponent(meta.tmdb_id));
        if (meta.imdb_id) qs.push('imdb_id=' + encodeURIComponent(meta.imdb_id));
        if (balancerId === 'filmix' && cfg.filmixToken) {
            qs.push('filmix_token=' + encodeURIComponent(cfg.filmixToken));
        }

        var url = cfg.proxyUrl + '/search?' + qs.join('&');
        var cached = cacheRead(url);
        if (cached) return Promise.resolve(cached);

        return doFetch(url)
            .then(function (payload) {
                var items = (payload && Array.isArray(payload.items)) ? payload.items : [];
                cacheWrite(url, items);
                return items;
            })
            .catch(function (err) {
                notice(PLUGIN_NAME + ' [' + balancerId + ']: ' + (err.message || 'error'));
                return [];
            });
    }

    /* ------------------------------------------------------------------ */
    /*  Select helper (huyfix: toggle content controller first)            */
    /* ------------------------------------------------------------------ */

    function showSelect(data) {
        try {
            if (Lampa.Select && Lampa.Select.show) {
                Lampa.Select.show(data);
            } else {
                notice(PLUGIN_NAME + ': Select unavailable');
            }
        } catch (e) {}
    }

    /* ------------------------------------------------------------------ */
    /*  Playback                                                            */
    /* ------------------------------------------------------------------ */

    function playUrl(item, card) {
        var url = item.url || item.streamUrl || item.link || '';
        if (!url) { notice(PLUGIN_NAME + ': no stream URL'); return; }
        var title = (card && (card.title || card.name || card.original_title)) || item.title || '';
        try {
            Lampa.Player.play({ title: title, url: url, quality: item.quality || '' });
        } catch (e) {
            try { Lampa.Player.play(url); } catch (e2) {
                notice(PLUGIN_NAME + ': player error');
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Episode picker                                                      */
    /* ------------------------------------------------------------------ */

    function openEpisodeMenu(seasons, card, onEp) {
        var keys = Object.keys(seasons || {}).sort(function (a, b) { return +a - +b; });
        showSelect({
            title: PLUGIN_NAME + ' - Seasons',
            items: keys.map(function (s) { return { title: 'Season ' + s, skey: s }; }),
            onSelect: function (row) {
                var eps = seasons[row.skey] || [];
                showSelect({
                    title: PLUGIN_NAME + ' - Season ' + row.skey,
                    items: eps.map(function (ep) {
                        return { title: 'Ep ' + ep.episode + (ep.title ? ' - ' + ep.title : ''), data: ep };
                    }),
                    onSelect: function (epRow) { onEp(epRow.data); }
                });
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Voice picker                                                        */
    /* ------------------------------------------------------------------ */

    function openVoiceMenu(voices, onVoice) {
        showSelect({
            title: PLUGIN_NAME + ' - Voice',
            items: voices.map(function (v) {
                return { title: v.name || v.title || String(v), vdata: v };
            }),
            onSelect: function (row) { onVoice(row.vdata); }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Stream list (4K first)                                             */
    /* ------------------------------------------------------------------ */

    function openStreamList(rawItems, card) {
        var sorted = sortByQuality(rawItems || []).filter(function (x) { return !x.broken; });
        if (!sorted.length) { notice(PLUGIN_NAME + ': no results'); return; }

        var menuItems = sorted.map(function (item) {
            var parts = [];
            if (item.balancer) parts.push(item.balancer);
            if (item.quality)  parts.push(item.quality);
            if (item.voice)    parts.push(item.voice);
            return { title: parts.join(' - ') || item.title || 'Unknown', data: item };
        });

        showSelect({
            title: PLUGIN_NAME + ' - Quality (' + menuItems.length + ')',
            items: menuItems,
            onSelect: function (row) {
                var item = row.data;
                if (item.voices && item.voices.length > 1) {
                    return openVoiceMenu(item.voices, function (voice) {
                        var clone = {};
                        for (var k in item) {
                            if (Object.prototype.hasOwnProperty.call(item, k)) clone[k] = item[k];
                        }
                        clone.url   = (voice && voice.url)  ? voice.url  : item.url;
                        clone.voice = (voice && (voice.name || String(voice))) || item.voice;
                        playUrl(clone, card);
                    });
                }
                if (item.seasons && typeof item.seasons === 'object') {
                    return openEpisodeMenu(item.seasons, card, function (ep) { playUrl(ep, card); });
                }
                playUrl(item, card);
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Balancer picker -> search -> results                               */
    /* ------------------------------------------------------------------ */

    function openBalancerSelect(card) {
        var meta = cardToMeta(card);
        if (!meta) { notice(PLUGIN_NAME + ': could not get movie info'); return; }

        var enabled = BALANCERS.filter(function (b) { return isEnabled(b.id); });
        if (!enabled.length) { notice(PLUGIN_NAME + ': all sources disabled'); return; }

        /* Toggle focus to content before showing Select (huyfix pattern) */
        try { if (Lampa.Controller && Lampa.Controller.toggle) Lampa.Controller.toggle('content'); } catch (e) {}

        var items = [{ title: '[ All sources ]', balancer: null }].concat(
            enabled.map(function (b) {
                return { title: b.name + ' - ' + b.quality, balancer: b };
            })
        );

        showSelect({
            title: PLUGIN_NAME + ' - ' + (meta.title || 'Select source'),
            items: items,
            onSelect: function (selected) {
                if (!selected.balancer) {
                    notice(PLUGIN_NAME + ': searching all sources...');
                    var tasks = enabled.map(function (b) {
                        return fetchBalancer(b.id, meta).then(function (itms) {
                            return itms.map(function (item) {
                                item.balancer = item.balancer || b.name;
                                return item;
                            });
                        });
                    });
                    Promise.all(tasks).then(function (results) {
                        var all = [];
                        results.forEach(function (arr) { all = all.concat(arr || []); });
                        openStreamList(all, card);
                    }).catch(function (err) {
                        notice(PLUGIN_NAME + ': search error - ' + (err && err.message || ''));
                    });
                } else {
                    notice(PLUGIN_NAME + ': searching ' + selected.balancer.name + '...');
                    fetchBalancer(selected.balancer.id, meta).then(function (itms) {
                        itms.forEach(function (item) {
                            item.balancer = item.balancer || selected.balancer.name;
                        });
                        openStreamList(itms, card);
                    });
                }
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Source manager                                                      */
    /* ------------------------------------------------------------------ */

    function openSourceManager() {
        showSelect({
            title: PLUGIN_NAME + ' - Sources',
            items: BALANCERS.map(function (b) {
                return {
                    title: (isEnabled(b.id) ? '[ON] ' : '[OFF] ') + b.name,
                    subtitle: b.quality,
                    bid: b.id
                };
            }),
            onSelect: function (row) {
                setEnabled(row.bid, !isEnabled(row.bid));
                openSourceManager();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Settings                                                            */
    /* ------------------------------------------------------------------ */

    function installSettings() {
        try {
            if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param:  { name: 'easy_mods_proxy', type: 'input', default: PROXY_DEFAULT },
                field:  { name: PLUGIN_NAME + ': Proxy URL',
                          description: 'Backend proxy, e.g. https://mods.example.com/api/balancers' },
                onChange: function (v) { set('easy_mods_proxy', v); State.cache = {}; }
            });
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param:  { name: 'easy_mods_filmix_token', type: 'input', default: '' },
                field:  { name: PLUGIN_NAME + ': Filmix token',
                          description: 'Token for Filmix 4K (optional)' },
                onChange: function (v) { set('easy_mods_filmix_token', v); State.cache = {}; }
            });
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param:  { name: 'easy_mods_manage', type: 'trigger', default: false },
                field:  { name: PLUGIN_NAME + ': Manage sources',
                          description: 'Enable/disable individual balancers' },
                onChange: function () { openSourceManager(); }
            });
        } catch (e) {}
    }

    /* ------------------------------------------------------------------ */
    /*  Button injection (bennington + nb557 + huyfix combined pattern)    */
    /*                                                                      */
    /*  All 3 reference plugins use:                                        */
    /*   1. find('.view--torrent')  as anchor                              */
    /*   2. $(Lampa.Lang.translate(html)) to create the button             */
    /*   3. btn.on('hover:enter', fn) for TV remote                        */
    /*   4. anchor.before(btn) OR anchor.after(btn)                        */
    /* ------------------------------------------------------------------ */

    function addButton(torrentEl, movie) {
        /* torrentEl = jQuery element pointing at .view--torrent */
        if (!torrentEl || !torrentEl.length) return;
        /* Avoid double injection */
        if (torrentEl.parent().find('.view--easy_mods').length) return;

        var btn = $(Lampa.Lang.translate(BTN_HTML));
        btn.on('hover:enter', function () {
            openBalancerSelect(movie);
        });

        /* Place the button after the torrent button (nb557 pattern) */
        torrentEl.after(btn);
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                                */
    /* ------------------------------------------------------------------ */

    function init() {
        if (State.inited) return;
        State.inited = true;

        installSettings();

        /* Listen for future card opens */
        Lampa.Listener.follow('full', function (e) {
            /* 'complite' is Lampa's intentional internal event name */
            if (e && e.type == 'complite') {
                try {
                    addButton(
                        e.object.activity.render().find('.view--torrent'),
                        e.data.movie
                    );
                } catch (err) {}
            }
        });

        /* Handle already-open card (bennington pattern) */
        try {
            if (Lampa.Activity.active && Lampa.Activity.active().component == 'full') {
                addButton(
                    Lampa.Activity.active().activity.render().find('.view--torrent'),
                    Lampa.Activity.active().card
                );
            }
        } catch (e) {}

        notice(PLUGIN_NAME + ' ready');
    }

    /* ------------------------------------------------------------------ */
    /*  Bootstrap                                                           */
    /* ------------------------------------------------------------------ */

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e && e.type == 'ready') init();
        });
    }

})();
