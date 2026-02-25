/**
 * KoroT — Kinogo + Rezka + Easy Mod (TorBox)
 * Lampa plugin v1.0 — written for Lampa 3.1.6
 * Source ID : koroT
 * Backend   : http://46.225.222.255:8000
 */
(function () {
    'use strict';

    console.log('[KoroT] Plugin v1.0 loaded for Lampa 3.1.6');

    var api_url = 'http://46.225.222.255:8000';

    // ------------------------------------------------------------------
    // Manifest (displayed in Lampa plugin manager)
    // ------------------------------------------------------------------
    var MANIFEST = {
        type: 'plugin',
        name: 'KoroT \u2014 Kinogo + Rezka + Easy Mod (TorBox)',
        description: '\u041f\u043e\u0438\u0441\u043a \u0447\u0435\u0440\u0435\u0437 Kinogo, Rezka \u0438 TorBox Easy Mod',
        version: '1.0',
        author: 'KoroT',
        homepage: api_url,
        id: 'koroT'
    };

    // ------------------------------------------------------------------
    // HTTP helper using Lampa.Request().silent() — correct for 3.1.6
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
            console.log('[KoroT] apiGet ->', url);

            var req = new Lampa.Request();

            // silent() — suppresses Lampa's global loading spinner (3.1.6 pattern)
            req.silent(url, function (data) {
                try {
                    var json = (typeof data === 'string') ? JSON.parse(data) : data;
                    console.log('[KoroT] apiGet OK:', url);
                    onSuccess(json);
                } catch (e) {
                    console.log('[KoroT] ERROR: apiGet parse error:', e.message, '| url:', url);
                    if (onError) { onError(e); }
                }
            }, function (err) {
                console.log('[KoroT] ERROR: apiGet network error:', err, '| url:', url);
                if (onError) { onError(err); }
            });
        } catch (e) {
            console.log('[KoroT] ERROR: apiGet exception:', e.message);
            if (onError) { onError(e); }
        }
    }

    // ------------------------------------------------------------------
    // Source constructor  (called by Lampa.Source.register)
    // ------------------------------------------------------------------
    function Source(object) {
        console.log('[KoroT] Source constructor called');
        // `object` is the activity/params object passed by Lampa
        this._object = object || {};
    }

    /**
     * search(params, callback)
     * params.query — the string the user typed
     * callback(results)  — results is an array of card objects
     */
    Source.prototype.search = function (params, callback) {
        try {
            var query = (params && params.query) ? String(params.query) : '';
            console.log('[KoroT] search() query:', query);

            if (!query) {
                console.log('[KoroT] search() empty query — returning []');
                if (callback) { callback([]); }
                return;
            }

            apiGet('/search', { q: query }, function (data) {
                try {
                    // Backend returns { results: [...] } OR plain array
                    var raw = [];
                    if (data && Array.isArray(data.results)) {
                        raw = data.results;
                    } else if (Array.isArray(data)) {
                        raw = data;
                    }

                    var list = [];
                    var i, item;
                    for (i = 0; i < raw.length; i++) {
                        item = raw[i];
                        list.push({
                            id:               'koroT_' + i,
                            title:            item.title            || '',
                            original_title:   item.title            || '',
                            year:             item.year             || '',
                            poster:           item.poster           || '',
                            poster_small:     item.poster           || '',
                            background_image: item.poster           || '',
                            type:             'movie',
                            source:           'koroT',
                            // extra fields consumed by Source.prototype.full()
                            korot_url:        item.url              || '',
                            korot_source:     item.source           || ''
                        });
                    }

                    console.log('[KoroT] search() results count:', list.length);
                    if (callback) { callback(list); }
                } catch (e) {
                    console.log('[KoroT] ERROR: search() result parse:', e.message);
                    if (callback) { callback([]); }
                }
            }, function (err) {
                console.log('[KoroT] ERROR: search() request failed:', err);
                if (callback) { callback([]); }
            });
        } catch (e) {
            console.log('[KoroT] ERROR: search() exception:', e.message);
            if (callback) { callback([]); }
        }
    };

    /**
     * full(item, callback)
     * item — the card object selected by the user (contains korot_url, korot_source)
     * callback({ movie, torrents, episodes })
     */
    Source.prototype.full = function (item, callback) {
        try {
            var korot_url    = (item && item.korot_url)    ? item.korot_url    : '';
            var korot_source = (item && item.korot_source) ? item.korot_source : '';

            console.log('[KoroT] full() url:', korot_url, '| source:', korot_source);

            if (!korot_url) {
                console.log('[KoroT] full() — no korot_url, returning empty');
                if (callback) { callback({ movie: item, torrents: [], episodes: {} }); }
                return;
            }

            apiGet('/get', { url: korot_url, source: korot_source }, function (data) {
                try {
                    var files   = (data && Array.isArray(data.files)) ? data.files : [];
                    var streams = [];
                    var i, f, entry;

                    for (i = 0; i < files.length; i++) {
                        f = files[i];
                        entry = {
                            title:   (f.title || ('File ' + (i + 1))) + (f.quality ? ' [' + f.quality + ']' : ''),
                            quality: f.quality  || 'unknown',
                            url:     f.url      || '',
                            magnet:  f.magnet   || ''
                        };
                        // prefer direct URL, fall back to magnet
                        if (!entry.url && entry.magnet) {
                            entry.url = entry.magnet;
                        }
                        if (entry.url) {
                            streams.push(entry);
                        }
                    }

                    // merge fresh metadata back into the card
                    var movie = {};
                    var k;
                    for (k in item) {
                        if (Object.prototype.hasOwnProperty.call(item, k)) {
                            movie[k] = item[k];
                        }
                    }
                    if (data.title)       { movie.title            = data.title; }
                    if (data.poster)      { movie.poster = movie.poster_small = data.poster; }
                    if (data.description) { movie.overview         = data.description; }
                    if (data.orig_title)  { movie.original_title   = data.orig_title; }

                    console.log('[KoroT] full() streams:', streams.length);
                    if (callback) { callback({ movie: movie, torrents: streams, episodes: {} }); }
                } catch (e) {
                    console.log('[KoroT] ERROR: full() parse:', e.message);
                    if (callback) { callback({ movie: item, torrents: [], episodes: {} }); }
                }
            }, function (err) {
                console.log('[KoroT] ERROR: full() request failed:', err);
                if (callback) { callback({ movie: item, torrents: [], episodes: {} }); }
            });
        } catch (e) {
            console.log('[KoroT] ERROR: full() exception:', e.message);
            if (callback) { callback({ movie: item, torrents: [], episodes: {} }); }
        }
    };

    /**
     * list(params, callback)
     * Called when the source panel is opened without a search query.
     */
    Source.prototype.list = function (params, callback) {
        try {
            console.log('[KoroT] list() called');
            if (callback) { callback([]); }
        } catch (e) {
            console.log('[KoroT] ERROR: list() exception:', e.message);
            if (callback) { callback([]); }
        }
    };

    /** destroy() — clean up when source is unloaded */
    Source.prototype.destroy = function () {
        try {
            console.log('[KoroT] destroy()');
        } catch (e) {
            console.log('[KoroT] ERROR: destroy() exception:', e.message);
        }
    };

    // ------------------------------------------------------------------
    // Register source with Lampa 3.1.6
    // ------------------------------------------------------------------
    function registerSource() {
        try {
            console.log('[KoroT] registerSource() start');

            if (typeof Lampa === 'undefined') {
                console.log('[KoroT] ERROR: Lampa not defined, cannot register source');
                return;
            }

            // ---- PRIMARY: Lampa 3.1.6 API ----
            if (Lampa.Source && typeof Lampa.Source.register === 'function') {
                Lampa.Source.register('koroT', Source);
                console.log('[KoroT] Source registered via Lampa.Source.register()');
                return;
            }

            // ---- FALLBACK: Lampa.Source.add (older builds) ----
            if (Lampa.Source && typeof Lampa.Source.add === 'function') {
                var inst = new Source({});
                Lampa.Source.add('koroT', {
                    name:       'KoroT',
                    short_name: 'KoroT',
                    source:     'koroT',
                    search: function (params, resolve, reject) {
                        inst.search(params, function (res) {
                            if (resolve) { resolve(res); }
                        });
                    },
                    full: function (item, resolve, reject) {
                        inst.full(item, function (res) {
                            if (resolve) { resolve(res); }
                        });
                    },
                    list: function (params, resolve, reject) {
                        inst.list(params, function (res) {
                            if (resolve) { resolve(res); }
                        });
                    },
                    clear: function () { inst.destroy(); }
                });
                console.log('[KoroT] Source registered via Lampa.Source.add() (fallback)');
                return;
            }

            // ---- LAST RESORT: Lampa.Torrents.add ----
            if (Lampa.Torrents && typeof Lampa.Torrents.add === 'function') {
                Lampa.Torrents.add({ name: 'KoroT', source: 'koroT' });
                console.log('[KoroT] Source registered via Lampa.Torrents.add() (last resort)');
                return;
            }

            console.log('[KoroT] ERROR: No suitable Source registration API found');
        } catch (e) {
            console.log('[KoroT] ERROR: registerSource() exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Left-menu button
    // ------------------------------------------------------------------
    function addMenuButton() {
        try {
            console.log('[KoroT] addMenuButton() start');

            if (typeof Lampa === 'undefined') {
                console.log('[KoroT] ERROR: Lampa not defined, skipping menu button');
                return;
            }

            // Lampa 3.1.6 — Lampa.Menu.add(item)
            if (Lampa.Menu && typeof Lampa.Menu.add === 'function') {
                Lampa.Menu.add({
                    title:    'KoroT',
                    subtitle: 'Kinogo + Rezka + TorBox',
                    icon:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
                              + '<text y="18" font-size="16">&#x1F525;</text></svg>',
                    action: function () {
                        try {
                            console.log('[KoroT] Menu button pressed — opening search');
                            openKoroTSearch();
                        } catch (e) {
                            console.log('[KoroT] ERROR: menu action exception:', e.message);
                        }
                    }
                });
                console.log('[KoroT] Menu button added via Lampa.Menu.add()');
                return;
            }

            // Fallback: append item to an existing side-menu list via Events
            if (Lampa.Events && typeof Lampa.Events.follow === 'function') {
                Lampa.Events.follow('menu:build', function (items) {
                    try {
                        items.push({
                            title: 'KoroT',
                            subtitle: 'Kinogo + Rezka + TorBox',
                            action: function () {
                                try { openKoroTSearch(); } catch (e) {
                                    console.log('[KoroT] ERROR: events menu action:', e.message);
                                }
                            }
                        });
                        console.log('[KoroT] Menu button injected via Lampa.Events menu:build');
                    } catch (e) {
                        console.log('[KoroT] ERROR: menu:build handler:', e.message);
                    }
                });
                return;
            }

            console.log('[KoroT] WARNING: No menu API available — button not added');
        } catch (e) {
            console.log('[KoroT] ERROR: addMenuButton() exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Open KoroT search — multiple fallback strategies for 3.1.6
    // ------------------------------------------------------------------
    function openKoroTSearch() {
        try {
            console.log('[KoroT] openKoroTSearch()');

            // Strategy 1 — Lampa 3.1.6 Activity.push with component:'search'
            if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                Lampa.Activity.push({
                    url:       '',
                    title:     'KoroT',
                    component: 'search',
                    source:    'koroT',
                    page:      1
                });
                console.log('[KoroT] openKoroTSearch via Activity.push');
                return;
            }

            // Strategy 2 — Lampa.Search.open
            if (Lampa.Search && typeof Lampa.Search.open === 'function') {
                Lampa.Search.open({ source: 'koroT' });
                console.log('[KoroT] openKoroTSearch via Search.open');
                return;
            }

            // Strategy 3 — Lampa.Controller.toggle to search component
            if (Lampa.Controller && typeof Lampa.Controller.toggle === 'function') {
                Lampa.Controller.toggle('search');
                console.log('[KoroT] openKoroTSearch via Controller.toggle(search)');
                return;
            }

            // Strategy 4 — Select dialog (last resort)
            if (Lampa.Select && typeof Lampa.Select.show === 'function') {
                Lampa.Select.show({
                    title: 'KoroT',
                    items: [{ title: '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u043e\u0438\u0441\u043a' }],
                    onSelect: function () {
                        try {
                            if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                                Lampa.Activity.push({
                                    url: '', title: 'KoroT',
                                    component: 'search', source: 'koroT', page: 1
                                });
                            }
                        } catch (e) {
                            console.log('[KoroT] ERROR: Select onSelect:', e.message);
                        }
                    }
                });
                return;
            }

            console.log('[KoroT] ERROR: openKoroTSearch — no navigation API available');
        } catch (e) {
            console.log('[KoroT] ERROR: openKoroTSearch() exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Boot — waits for Lampa to initialise, then sets everything up
    // ------------------------------------------------------------------
    function init() {
        try {
            console.log('[KoroT] init() — registering source and menu button');
            registerSource();
            addMenuButton();
            console.log('[KoroT] init() done');
        } catch (e) {
            console.log('[KoroT] ERROR: init() exception:', e.message);
        }
    }

    function boot() {
        try {
            if (typeof Lampa === 'undefined') {
                console.log('[KoroT] Lampa not ready, retrying in 500ms...');
                setTimeout(boot, 500);
                return;
            }

            console.log('[KoroT] boot() — Lampa found');

            // Lampa 3.1.6 fires 'ready' when the UI is fully initialised
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('ready', function () {
                    try {
                        console.log('[KoroT] Lampa "ready" event received');
                        init();
                    } catch (e) {
                        console.log('[KoroT] ERROR: ready handler:', e.message);
                    }
                });
            }

            // Also call init() immediately — if 'ready' already fired we must not miss it
            init();

            console.log('[KoroT] boot() complete');
        } catch (e) {
            console.log('[KoroT] ERROR: boot() exception:', e.message);
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
        console.log('[KoroT] ERROR: entry point exception:', e.message);
        try { boot(); } catch (e2) { /* intentionally silent */ }
    }

})();
