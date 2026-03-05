/**
 * KoroT — Kinogo + Rezka + Easy Mod (TorBox)
 * Lampa plugin v2.0 for Lampa 3.1.6
 * Source ID : koroT
 * Backend   : http://46.225.222.255:8000
 *
 * Adds a "TorBox" button to every film detail page.
 * Button flow:
 *   1. Search /torbox/search?q=<title>
 *   2. User picks a variant (or enters magnet manually)
 *   3. Call /torbox/get?magnet=<magnet>  — backend adds to TorBox, polls, returns files
 *   4. User picks a file quality → Lampa player starts
 */
(function () {
    'use strict';

    console.log('[TorBox] Plugin v2.0 loaded for Lampa 3.1.6');

    var api_url = 'http://46.225.222.255:8000';

    // ------------------------------------------------------------------
    // Manifest
    // ------------------------------------------------------------------
    var MANIFEST = {
        type:        'plugin',
        name:        'KoroT \u2014 Kinogo + Rezka + Easy Mod (TorBox)',
        description: '\u041f\u0440\u044f\u043c\u044b\u0435 \u0441\u0441\u044b\u043b\u043a\u0438 \u0447\u0435\u0440\u0435\u0437 TorBox \u0431\u0435\u0437 \u0442\u043e\u0440\u0440\u0435\u043d\u0442-\u043a\u043b\u0438\u0435\u043d\u0442\u0430',
        version:     '2.0',
        author:      'KoroT',
        homepage:    api_url,
        id:          'koroT'
    };

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
            var url = api_url + path + buildQs(params || {});
            console.log('[TorBox] GET ' + url);

            var req = new Lampa.Request();
            req.silent(url, function (data) {
                try {
                    var json = (typeof data === 'string') ? JSON.parse(data) : data;
                    console.log('[TorBox] GET OK: ' + url);
                    onSuccess(json);
                } catch (e) {
                    console.log('[TorBox] ERROR: parse error:', e.message, '| url:', url);
                    if (onError) { onError(e); }
                }
            }, function (err) {
                console.log('[TorBox] ERROR: network error:', err, '| url:', url);
                if (onError) { onError(err); }
            });
        } catch (e) {
            console.log('[TorBox] ERROR: apiGet exception:', e.message);
            if (onError) { onError(e); }
        }
    }

    // ------------------------------------------------------------------
    // Step 3 — fetch files from TorBox for a magnet and show player
    // ------------------------------------------------------------------
    function fetchFilesAndPlay(magnet, movie) {
        try {
            console.log('[TorBox] fetchFilesAndPlay magnet:', magnet.substring(0, 60));

            Lampa.Loading.start('\u0414\u043e\u0431\u0430\u0432\u043b\u044f\u0435\u043c \u0432 TorBox\u2026');

            apiGet('/torbox/get', { magnet: magnet }, function (data) {
                try {
                    Lampa.Loading.stop();

                    var status = (data && data.status) ? data.status : 'unknown';
                    var files  = (data && Array.isArray(data.files)) ? data.files : [];

                    console.log('[TorBox] fetchFilesAndPlay status:', status, 'files:', files.length);

                    if (!files.length) {
                        if (status === 'processing') {
                            Lampa.Noty.show('\u0422\u043e\u0440\u0440\u0435\u043d\u0442 \u0435\u0449\u0451 \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u0441\u044f. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 \u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u043c\u0438\u043d\u0443\u0442.');
                        } else {
                            Lampa.Noty.show('[TorBox] \u041d\u0435\u0442 \u0444\u0430\u0439\u043b\u043e\u0432 \u0434\u043b\u044f \u0432\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u044f.');
                        }
                        return;
                    }

                    // Build select items
                    var items = [];
                    var i;
                    for (i = 0; i < files.length; i++) {
                        (function (f) {
                            items.push({
                                title:    (f.title || f.name || '\u0424\u0430\u0439\u043b ' + (i + 1)),
                                subtitle: (f.quality || 'unknown'),
                                file:     f
                            });
                        })(files[i]);
                    }

                    Lampa.Select.show({
                        title:    'TorBox \u2014 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u043e',
                        items:    items,
                        onSelect: function (selected) {
                            try {
                                playFile(selected.file, movie);
                            } catch (e) {
                                console.log('[TorBox] ERROR: onSelect file:', e.message);
                            }
                        }
                    });
                } catch (e) {
                    Lampa.Loading.stop();
                    console.log('[TorBox] ERROR: fetchFilesAndPlay handler:', e.message);
                    Lampa.Noty.show('[TorBox] \u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message);
                }
            }, function (err) {
                Lampa.Loading.stop();
                console.log('[TorBox] ERROR: fetchFilesAndPlay request:', err);
                Lampa.Noty.show('[TorBox] \u041e\u0448\u0438\u0431\u043a\u0430 TorBox API.');
            });
        } catch (e) {
            console.log('[TorBox] ERROR: fetchFilesAndPlay exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Step 4 — start playback
    // ------------------------------------------------------------------
    function playFile(file, movie) {
        try {
            var url = (file && (file.url || file.direct_url)) ? (file.url || file.direct_url) : '';
            if (!url) {
                Lampa.Noty.show('[TorBox] \u041d\u0435\u0442 \u0441\u0441\u044b\u043b\u043a\u0438 \u0434\u043b\u044f \u0432\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u044f');
                return;
            }

            console.log('[TorBox] playFile:', url.substring(0, 80));

            var title  = (movie && movie.title) ? movie.title : (file.title || 'TorBox');
            var poster = (movie && movie.poster) ? movie.poster : '';

            Lampa.Player.play({
                title:     title,
                url:       url,
                poster:    poster,
                subtitles: []
            });

            Lampa.Player.playlist([{
                title: file.title || title,
                url:   url
            }]);
        } catch (e) {
            console.log('[TorBox] ERROR: playFile exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Step 1-2 — open TorBox: search, then pick / enter magnet
    // ------------------------------------------------------------------
    function openTorBox(movie) {
        try {
            var title = (movie && movie.title) ? movie.title : '';
            var origTitle = (movie && movie.original_title) ? movie.original_title : '';
            var year = (movie && (movie.year || movie.release_date)) ?
                String(movie.year || movie.release_date).slice(0, 4) : '';
            var tmdbId = (movie && movie.id) ? String(movie.id) : '';
            console.log('[TorBox] openTorBox for:', title, '(orig:', origTitle, 'year:', year, ')');

            Lampa.Loading.start('\u041f\u043e\u0438\u0441\u043a TorBox\u2026');

            var searchParams = { q: title };
            if (year)      { searchParams.year = year; }
            if (tmdbId)    { searchParams.tmdb_id = tmdbId; }
            if (origTitle && origTitle !== title) { searchParams.original_title = origTitle; }

            apiGet('/torbox/search', searchParams, function (data) {
                try {
                    Lampa.Loading.stop();

                    var results = (data && Array.isArray(data.results)) ? data.results : [];
                    console.log('[TorBox] search results:', results.length);

                    if (!results.length) {
                        // No results — ask for manual magnet
                        showMagnetInput(title, movie);
                        return;
                    }

                    // Show result list
                    var items = [];
                    var i;
                    for (i = 0; i < results.length; i++) {
                        (function (r) {
                            items.push({
                                title:    r.title || title,
                                subtitle: [(r.quality || ''), (r.year ? '\u00b7 ' + r.year : '')].join(' ').trim(),
                                result:   r
                            });
                        })(results[i]);
                    }
                    // Always add "manual magnet" option at the bottom
                    items.push({
                        title:    '\u0412\u0432\u0435\u0441\u0442\u0438 magnet \u0432\u0440\u0443\u0447\u043d\u0443\u044e\u2026',
                        subtitle: '',
                        manual:   true
                    });

                    Lampa.Select.show({
                        title:    'TorBox \u2014 ' + title,
                        items:    items,
                        onSelect: function (selected) {
                            try {
                                if (selected.manual) {
                                    showMagnetInput(title, movie);
                                    return;
                                }
                                var magnet = (selected.result && (selected.result.magnet || selected.result.url)) || '';
                                if (!magnet) {
                                    Lampa.Noty.show('[TorBox] \u041d\u0435\u0442 magnet-\u0441\u0441\u044b\u043b\u043a\u0438');
                                    return;
                                }
                                fetchFilesAndPlay(magnet, movie);
                            } catch (e) {
                                console.log('[TorBox] ERROR: result onSelect:', e.message);
                            }
                        }
                    });
                } catch (e) {
                    Lampa.Loading.stop();
                    console.log('[TorBox] ERROR: openTorBox handler:', e.message);
                    showMagnetInput(title, movie);
                }
            }, function (err) {
                Lampa.Loading.stop();
                console.log('[TorBox] ERROR: openTorBox search failed:', err);
                showMagnetInput(title, movie);
            });
        } catch (e) {
            console.log('[TorBox] ERROR: openTorBox exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Manual magnet input (Lampa.Input.show)
    // ------------------------------------------------------------------
    function showMagnetInput(title, movie) {
        try {
            console.log('[TorBox] showMagnetInput for:', title);

            if (Lampa.Input && typeof Lampa.Input.show === 'function') {
                Lampa.Input.show({
                    title:       'TorBox \u2014 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 magnet',
                    placeholder: 'magnet:?xt=urn:btih:...',
                    value:       '',
                    onEnter: function (value) {
                        try {
                            if (value && value.indexOf('magnet:') === 0) {
                                fetchFilesAndPlay(value, movie);
                            } else {
                                Lampa.Noty.show('[TorBox] \u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 magnet. \u0414\u043e\u043b\u0436\u0435\u043d \u043d\u0430\u0447\u0438\u043d\u0430\u0442\u044c\u0441\u044f \u0441 magnet:');
                            }
                        } catch (e) {
                            console.log('[TorBox] ERROR: Input onEnter:', e.message);
                        }
                    }
                });
            } else {
                // Fallback — Select with single "enter magnet" hint item
                Lampa.Noty.show('[TorBox] \u041f\u043e\u0438\u0441\u043a \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 /torbox/get?magnet=... \u043d\u0430\u043f\u0440\u044f\u043c\u0443\u044e.');
            }
        } catch (e) {
            console.log('[TorBox] ERROR: showMagnetInput exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Inject TorBox button into the film detail page
    // ------------------------------------------------------------------
    function injectButton(component, movie) {
        try {
            // Resolve the rendered DOM element of the film page
            var render;
            if (component && component.activity && typeof component.activity.render === 'function') {
                render = component.activity.render();
            } else if (component && typeof component.render === 'function') {
                render = component.render();
            } else if (component && component.$el) {
                render = component.$el;
            }

            if (!render || !render.length) {
                console.log('[TorBox] injectButton: no render element');
                return;
            }

            // Find the watch/play buttons container
            var container = render.find('.full-start__buttons');
            if (!container.length) { container = render.find('.full-start'); }
            if (!container.length) { container = render.find('.view--start'); }

            if (!container.length) {
                console.log('[TorBox] injectButton: no buttons container found');
                return;
            }

            // Remove any stale button (it may belong to a previously viewed film's closure)
            container.find('.torbox-btn').remove();

            var btn = $('<div>')
                .addClass('full-start__button selector torbox-btn')
                .append(
                    $('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">')
                        .html('<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>')
                )
                .append($('<span>').text('TorBox'));

            btn.on('hover:enter click', function () {
                try {
                    console.log('[TorBox] button activated for:', movie.title);
                    openTorBox(movie);
                } catch (e) {
                    console.log('[TorBox] ERROR: button handler:', e.message);
                }
            });

            container.append(btn);
            console.log('[TorBox] button injected for:', (movie && movie.title) || 'unknown');
        } catch (e) {
            console.log('[TorBox] ERROR: injectButton:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Hook into Lampa "full" event (fires when film detail page opens)
    // ------------------------------------------------------------------
    function hookFilmPage() {
        try {
            if (!Lampa.Listener || typeof Lampa.Listener.follow !== 'function') {
                console.log('[TorBox] ERROR: Lampa.Listener not available');
                return;
            }

            Lampa.Listener.follow('full', function (e) {
                try {
                    var component = (e && e.object) ? e.object : e;

                    // Resolve movie object from various Lampa versions
                    var movie = null;
                    if (component && component.movie) {
                        movie = component.movie;
                    } else if (component && component.card) {
                        movie = component.card;
                    } else if (component && component.data) {
                        movie = component.data;
                    }

                    if (!movie) {
                        console.log('[TorBox] full event: could not resolve movie');
                        return;
                    }

                    console.log('[TorBox] full event for:', movie.title);

                    // Delay slightly to let Lampa finish rendering the page DOM
                    setTimeout(function () {
                        try {
                            injectButton(component, movie);
                        } catch (err) {
                            console.log('[TorBox] ERROR: delayed injectButton:', err.message);
                        }
                    }, 300);
                } catch (err) {
                    console.log('[TorBox] ERROR: full event handler:', err.message);
                }
            });

            console.log('[TorBox] film page hook registered');
        } catch (e) {
            console.log('[TorBox] ERROR: hookFilmPage:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Source constructor (Lampa.Source.register pattern for 3.1.6)
    // ------------------------------------------------------------------
    function Source(object) {
        this._object = object || {};
        console.log('[TorBox] Source constructor');
    }

    Source.prototype.create = function () {
        try {
            console.log('[TorBox] Source.create()');
            this._content = $('<div class="torbox-source">');
            return this._content;
        } catch (e) {
            console.log('[TorBox] ERROR: Source.create():', e.message);
            return $('<div>');
        }
    };

    Source.prototype.start = function () {
        try {
            console.log('[TorBox] Source.start()');
            Lampa.Controller.enable('content');
        } catch (e) {
            console.log('[TorBox] ERROR: Source.start():', e.message);
        }
    };

    Source.prototype.pause   = function () {};
    Source.prototype.stop    = function () {};

    Source.prototype.destroy = function () {
        try {
            console.log('[TorBox] Source.destroy()');
            if (this._content) { this._content.remove(); }
        } catch (e) {
            console.log('[TorBox] ERROR: Source.destroy():', e.message);
        }
    };

    /** search(params, callback) — called by Lampa source panel */
    Source.prototype.search = function (params, callback) {
        try {
            var query = (params && params.query) ? String(params.query) : '';
            console.log('[TorBox] Source.search():', query);

            if (!query) {
                if (callback) { callback([]); }
                return;
            }

            apiGet('/torbox/search', { q: query }, function (data) {
                try {
                    var results = (data && Array.isArray(data.results)) ? data.results : [];
                    // Map to Lampa card format
                    var list = [];
                    var i;
                    for (i = 0; i < results.length; i++) {
                        var r = results[i];
                        list.push({
                            id:               'koroT_' + i,
                            title:            r.title            || '',
                            original_title:   r.title            || '',
                            year:             r.year             || '',
                            poster:           r.poster           || '',
                            poster_small:     r.poster           || '',
                            background_image: r.poster           || '',
                            type:             'movie',
                            source:           'koroT',
                            korot_magnet:     r.magnet           || r.url || '',
                            korot_source:     r.source           || 'torbox'
                        });
                    }
                    if (callback) { callback(list); }
                } catch (e) {
                    console.log('[TorBox] ERROR: Source.search result parse:', e.message);
                    if (callback) { callback([]); }
                }
            }, function (err) {
                console.log('[TorBox] ERROR: Source.search request:', err);
                if (callback) { callback([]); }
            });
        } catch (e) {
            console.log('[TorBox] ERROR: Source.search exception:', e.message);
            if (callback) { callback([]); }
        }
    };

    /** full(item, callback) — called when user selects a card */
    Source.prototype.full = function (item, callback) {
        try {
            var magnet = (item && item.korot_magnet) ? item.korot_magnet : '';
            console.log('[TorBox] Source.full() magnet:', magnet ? magnet.substring(0, 50) : 'none');

            if (!magnet) {
                if (callback) { callback({ movie: item, torrents: [], episodes: {} }); }
                return;
            }

            apiGet('/torbox/get', { magnet: magnet }, function (data) {
                try {
                    var files = (data && Array.isArray(data.files)) ? data.files : [];
                    if (callback) { callback({ movie: item, torrents: files, episodes: {} }); }
                } catch (e) {
                    console.log('[TorBox] ERROR: Source.full result parse:', e.message);
                    if (callback) { callback({ movie: item, torrents: [], episodes: {} }); }
                }
            }, function (err) {
                console.log('[TorBox] ERROR: Source.full request:', err);
                if (callback) { callback({ movie: item, torrents: [], episodes: {} }); }
            });
        } catch (e) {
            console.log('[TorBox] ERROR: Source.full exception:', e.message);
            if (callback) { callback({ movie: item, torrents: [], episodes: {} }); }
        }
    };

    Source.prototype.list = function (params, callback) {
        try {
            console.log('[TorBox] Source.list()');
            if (callback) { callback([]); }
        } catch (e) {
            console.log('[TorBox] ERROR: Source.list():', e.message);
            if (callback) { callback([]); }
        }
    };

    // ------------------------------------------------------------------
    // Register source with Lampa 3.1.6
    // ------------------------------------------------------------------
    function registerSource() {
        try {
            console.log('[TorBox] registerSource()');

            if (typeof Lampa === 'undefined') {
                console.log('[TorBox] ERROR: Lampa undefined — cannot register source');
                return;
            }

            // Primary: Lampa 3.1.6 constructor-based registration
            if (Lampa.Source && typeof Lampa.Source.register === 'function') {
                Lampa.Source.register('koroT', Source);
                console.log('[TorBox] Source registered via Lampa.Source.register()');
                return;
            }

            // Fallback: older .add() API
            if (Lampa.Source && typeof Lampa.Source.add === 'function') {
                var inst = new Source({});
                Lampa.Source.add('koroT', {
                    name:       'KoroT',
                    short_name: 'KoroT',
                    source:     'koroT',
                    search: function (params, resolve, reject) {
                        inst.search(params, function (res) { if (resolve) { resolve(res); } });
                    },
                    full: function (item, resolve, reject) {
                        inst.full(item, function (res) { if (resolve) { resolve(res); } });
                    },
                    list: function (params, resolve, reject) {
                        inst.list(params, function (res) { if (resolve) { resolve(res); } });
                    },
                    clear: function () { inst.destroy(); }
                });
                console.log('[TorBox] Source registered via Lampa.Source.add() (fallback)');
                return;
            }

            // Last resort
            if (Lampa.Torrents && typeof Lampa.Torrents.add === 'function') {
                Lampa.Torrents.add({ name: 'KoroT', source: 'koroT' });
                console.log('[TorBox] Source registered via Lampa.Torrents.add() (last resort)');
                return;
            }

            console.log('[TorBox] ERROR: no source registration API found');
        } catch (e) {
            console.log('[TorBox] ERROR: registerSource():', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Add left-menu button
    // ------------------------------------------------------------------
    function addMenuButton() {
        try {
            console.log('[TorBox] addMenuButton()');

            if (typeof Lampa === 'undefined') {
                console.log('[TorBox] ERROR: Lampa undefined — skipping menu button');
                return;
            }

            if (Lampa.Menu && typeof Lampa.Menu.add === 'function') {
                Lampa.Menu.add({
                    title:    'TorBox',
                    subtitle: 'KoroT \u2014 Kinogo + Rezka + TorBox',
                    icon:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>',
                    action: function () {
                        try {
                            console.log('[TorBox] menu button pressed');
                            if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                                Lampa.Activity.push({
                                    url:       '',
                                    title:     'TorBox',
                                    component: 'search',
                                    source:    'koroT',
                                    page:      1
                                });
                            }
                        } catch (e) {
                            console.log('[TorBox] ERROR: menu action:', e.message);
                        }
                    }
                });
                console.log('[TorBox] menu button added via Lampa.Menu.add()');
                return;
            }

            // Fallback: Events-based menu injection
            if (Lampa.Events && typeof Lampa.Events.follow === 'function') {
                Lampa.Events.follow('menu:build', function (items) {
                    try {
                        items.push({
                            title: 'TorBox',
                            action: function () {
                                try {
                                    if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                                        Lampa.Activity.push({
                                            url: '', title: 'TorBox',
                                            component: 'search', source: 'koroT', page: 1
                                        });
                                    }
                                } catch (e) {
                                    console.log('[TorBox] ERROR: events menu action:', e.message);
                                }
                            }
                        });
                    } catch (e) {
                        console.log('[TorBox] ERROR: menu:build handler:', e.message);
                    }
                });
                return;
            }

            console.log('[TorBox] WARNING: no menu API available');
        } catch (e) {
            console.log('[TorBox] ERROR: addMenuButton():', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Initialise everything
    // ------------------------------------------------------------------
    function init() {
        try {
            console.log('[TorBox] init()');
            registerSource();
            addMenuButton();
            hookFilmPage();
            console.log('[TorBox] init() done');
        } catch (e) {
            console.log('[TorBox] ERROR: init():', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Boot — retry until Lampa is available, then hook ready event
    // ------------------------------------------------------------------
    function boot() {
        try {
            if (typeof Lampa === 'undefined') {
                console.log('[TorBox] Lampa not ready, retrying in 500ms...');
                setTimeout(boot, 500);
                return;
            }

            console.log('[TorBox] boot() — Lampa found');

            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('ready', function () {
                    try {
                        console.log('[TorBox] Lampa "ready" event received');
                        init();
                    } catch (e) {
                        console.log('[TorBox] ERROR: ready handler:', e.message);
                    }
                });
            }

            // Also call init() right away in case 'ready' has already fired
            init();

            console.log('[TorBox] boot() complete');
        } catch (e) {
            console.log('[TorBox] ERROR: boot():', e.message);
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
        console.log('[TorBox] ERROR: entry point:', e.message);
        try { boot(); } catch (e2) { /* intentionally silent */ }
    }

})();
