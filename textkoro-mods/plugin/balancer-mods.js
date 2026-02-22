/**
 * balancer-mods.js - Easy-Mods Lampa plugin v3.0
 * Adds an "Easy-Mods" button to every movie/series card.
 * Clicking it shows a balancer picker -> results sorted by quality -> player.
 * ES5-compatible. No emoji (max compatibility with old Smart TV WebViews).
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Guard: Lampa must be available                                      */
    /* ------------------------------------------------------------------ */
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

    /* No emoji - use plain ASCII labels for old Smart TV compatibility */
    var BALANCERS = [
        { id: 'hdrezka',  name: 'HDRezka',  quality: '4K / 1080p / 720p',  voices: true,  series: true  },
        { id: 'zetflix',  name: 'Zetflix',  quality: '4K / 1080p',          voices: false, series: true  },
        { id: 'alloha',   name: 'Alloha',   quality: '4K HDR / 1080p',      voices: false, series: false },
        { id: 'videocdn', name: 'VideoCDN', quality: '1080p / 720p',         voices: false, series: true  },
        { id: 'kodik',    name: 'Kodik',    quality: '1080p / 720p',         voices: true,  series: true  },
        { id: 'ashdi',    name: 'Ashdi',    quality: '1080p / 720p (UA)',    voices: false, series: true  },
        { id: 'filmix',   name: 'Filmix',   quality: '4K / 1080p',           voices: true,  series: true  }
    ];

    /* ------------------------------------------------------------------ */
    /*  Language strings (nb557 pattern)                                   */
    /* ------------------------------------------------------------------ */

    var LANG = {
        'easy_mods_watch': {
            ru: 'Easy-Mods',
            uk: 'Easy-Mods',
            en: 'Easy-Mods'
        }
    };

    /* Button HTML - must NOT contain #{} keys (we use plain text) */
    var BTN_HTML = [
        '<div class="full-start__button selector view--' + PLUGIN_ID + '" data-subtitle="' + PLUGIN_NAME + '">',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 244 260" width="44" height="44">',
        '<path d="M242,88v170H10V88h41l-38,38h37.1l38-38h38.4l-38,38h38.4l38-38h38.3l-38,38H204L242,88z',
        'M228.9,2l8,37.7L191.2,10L228.9,2z M160.6,56l-45.8-29.7 38-8.1 45.8,29.7L160.6,56z',
        'M84.5,72.1L38.8,42.4l38-8.1 45.8,29.7L84.5,72.1z M10,88L2,50.2 47.8,80 10,88z"',
        'fill="currentColor"/>',
        '</svg>',
        '<span>#{easy_mods_watch}</span>',
        '</div>'
    ].join('');

    /* ------------------------------------------------------------------ */
    /*  State                                                               */
    /* ------------------------------------------------------------------ */

    var State = {
        inited: false,
        cache:  {}
    };

    /* ------------------------------------------------------------------ */
    /*  Storage helpers                                                     */
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
            if (Lampa.Noty && Lampa.Noty.show)   return Lampa.Noty.show(text);
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
    /*  Network                                                             */
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
                        var msg = (net.errorDecode ? net.errorDecode(a, c) : 'network error');
                        reject(new Error(msg));
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
        return Promise.reject(new Error('no network method available'));
    }

    /* ------------------------------------------------------------------ */
    /*  Card -> meta                                                        */
    /* ------------------------------------------------------------------ */

    function cardToMeta(card) {
        if (!card) return null;
        var title = card.original_title || card.title || card.name || '';
        if (!title) return null;
        var year = '';
        if (card.release_date)    year = String(card.release_date).slice(0, 4);
        else if (card.first_air_date) year = String(card.first_air_date).slice(0, 4);
        else if (card.year)        year = String(card.year);
        return {
            title:   title,
            year:    year,
            kp_id:   card.kinopoisk_id || card.kp_id || null,
            tmdb_id: card.id || card.tmdb_id || null,
            imdb_id: card.imdb_id || null,
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
    /*  Lampa.Select wrapper                                                */
    /* ------------------------------------------------------------------ */

    function showSelect(data) {
        try {
            if (Lampa.Select && Lampa.Select.show) {
                Lampa.Select.show(data);
            } else {
                notice(PLUGIN_NAME + ': Select unavailable');
            }
        } catch (e) {
            notice(PLUGIN_NAME + ': showSelect error - ' + e.message);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Playback                                                            */
    /* ------------------------------------------------------------------ */

    function playUrl(item, card) {
        var url = item.url || item.streamUrl || item.link || '';
        if (!url) { notice(PLUGIN_NAME + ': no stream URL'); return; }
        var title = (card && (card.title || card.name || card.original_title)) || item.title || '';
        try {
            if (Lampa.Player && typeof Lampa.Player.play === 'function') {
                Lampa.Player.play({ title: title, url: url, quality: item.quality || '' });
            }
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
    /*  Stream list (quality-sorted, 4K first)                             */
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
                        clone.url   = (voice && voice.url) ? voice.url : item.url;
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
    /*  Balancer picker                                                     */
    /* ------------------------------------------------------------------ */

    function openBalancerSelect(card) {
        var meta = cardToMeta(card);
        if (!meta) { notice(PLUGIN_NAME + ': could not get movie info'); return; }

        var enabled = BALANCERS.filter(function (b) { return isEnabled(b.id); });
        if (!enabled.length) { notice(PLUGIN_NAME + ': all sources disabled'); return; }

        var items = [{ title: '[ All sources ]', balancer: null }].concat(
            enabled.map(function (b) {
                return {
                    title: b.name + ' - ' + b.quality,
                    balancer: b
                };
            })
        );

        showSelect({
            title: PLUGIN_NAME + ' - ' + (meta.title || 'Select source'),
            items: items,
            onSelect: function (selected) {
                if (!selected.balancer) {
                    notice(PLUGIN_NAME + ': searching all sources...');
                    var tasks = enabled.map(function (b) {
                        return fetchBalancer(b.id, meta).then(function (items) {
                            return items.map(function (item) {
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
                    fetchBalancer(selected.balancer.id, meta).then(function (items) {
                        items.forEach(function (item) {
                            item.balancer = item.balancer || selected.balancer.name;
                        });
                        openStreamList(items, card);
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
                          description: 'Backend proxy URL, e.g. https://mods.example.com/api/balancers' },
                onChange: function (v) { set('easy_mods_proxy', v); State.cache = {}; }
            });
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param:  { name: 'easy_mods_filmix_token', type: 'input', default: '' },
                field:  { name: PLUGIN_NAME + ': Filmix token',
                          description: 'Token for Filmix 4K access (optional)' },
                onChange: function (v) { set('easy_mods_filmix_token', v); State.cache = {}; }
            });
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param:  { name: 'easy_mods_manage', type: 'trigger', default: false },
                field:  { name: PLUGIN_NAME + ': Manage sources',
                          description: 'Enable / disable individual balancers' },
                onChange: function () { openSourceManager(); }
            });
        } catch (e) {}
    }

    /* ------------------------------------------------------------------ */
    /*  Inject button into the full movie card (nb557 pattern)              */
    /* ------------------------------------------------------------------ */

    function injectButton(e) {
        try {
            if (!e || !e.object || !e.object.activity) return;

            /* render() can return DOM element OR jQuery - wrap with $() to be safe */
            var render = $(e.object.activity.render());
            if (!render || !render.length) return;

            /* Don't inject twice */
            if (render.find('.view--' + PLUGIN_ID).length) return;

            /* Capture movie reference for the button click handler */
            var movie = (e.data && e.data.movie) || null;

            /* Create button using Lampa.Lang.translate (nb557 pattern) */
            var btn = $(Lampa.Lang.translate(BTN_HTML));
            btn.on('hover:enter', function () {
                openBalancerSelect(movie);
            });

            /* Placement priority (nb557 places after .view--torrent) */
            var anchor = render.find('.view--torrent').first();
            if (anchor.length) {
                anchor.after(btn);
                return;
            }
            anchor = render.find('.view--online_mod, .view--online').first();
            if (anchor.length) {
                anchor.after(btn);
                return;
            }
            var btnsRow = render.find('.full-start__buttons');
            if (btnsRow.length) {
                btnsRow.append(btn);
                return;
            }
            /* Last resort: find .full-start or any container */
            var fullStart = render.find('.full-start').first();
            if (fullStart.length) {
                fullStart.append(btn);
                return;
            }
            render.append(btn);
        } catch (err) {
            /* Button injection failed - do not throw, plugin must not break Lampa */
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Init                                                                */
    /* ------------------------------------------------------------------ */

    function init() {
        if (State.inited) return;
        State.inited = true;

        try { Lampa.Lang.add(LANG); } catch (e) {}

        installSettings();

        try {
            Lampa.Listener.follow('full', function (e) {
                /* NOTE: 'complite' is Lampa's intentional internal event name */
                if (e && e.type == 'complite') injectButton(e);
            });
        } catch (e) {}

        notice(PLUGIN_NAME + ' active');
    }

    /* ------------------------------------------------------------------ */
    /*  Bootstrap (nb557 pattern)                                           */
    /* ------------------------------------------------------------------ */

    if (window.appready) {
        init();
    } else {
        try {
            Lampa.Listener.follow('app', function (e) {
                if (e && e.type == 'ready') init();
            });
        } catch (e) {}
    }

})();
