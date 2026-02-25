/**
 * KoroT — Kinogo + Rezka + TorBox
 * Lampa plugin v1.0
 * Source ID: koroT
 * Backend: http://46.225.222.255:8000
 */
(function () {
    'use strict';

    console.log('[KoroT] Plugin loaded v1.0');

    var api_url = 'http://46.225.222.255:8000';

    // ------------------------------------------------------------------
    // Manifest
    // ------------------------------------------------------------------
    var MANIFEST = {
        type: 'plugin',
        name: 'KoroT \u2014 Kinogo + Rezka + TorBox',
        description: '\u041f\u043e\u0438\u0441\u043a \u0447\u0435\u0440\u0435\u0437 Kinogo, Rezka \u0438 TorBox',
        version: '1.0',
        author: 'KoroT',
        homepage: api_url,
        id: 'koroT'
    };

    // ------------------------------------------------------------------
    // Helper: safe HTTP GET via Lampa.Request
    // ------------------------------------------------------------------
    function apiGet(path, params, onSuccess, onError) {
        try {
            var qs = '';
            if (params) {
                var parts = [];
                for (var key in params) {
                    if (Object.prototype.hasOwnProperty.call(params, key)) {
                        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
                    }
                }
                if (parts.length) {
                    qs = '?' + parts.join('&');
                }
            }

            var url = api_url + path + qs;
            console.log('[KoroT] apiGet:', url);

            var req = new Lampa.Request();
            req.timeout(15000);

            req.native(url, function (data) {
                try {
                    var json = (typeof data === 'string') ? JSON.parse(data) : data;
                    console.log('[KoroT] apiGet success:', url);
                    onSuccess(json);
                } catch (e) {
                    console.log('[KoroT] apiGet parse error:', e.message, 'url:', url);
                    if (onError) onError(e);
                }
            }, function (err) {
                console.log('[KoroT] apiGet network error:', err, 'url:', url);
                if (onError) onError(err);
            });
        } catch (e) {
            console.log('[KoroT] apiGet exception:', e.message);
            if (onError) onError(e);
        }
    }

    // ------------------------------------------------------------------
    // Source component
    // ------------------------------------------------------------------
    function KoroTSource() {
        var self = this;
        this._data = {};
    }

    /**
     * search(params, resolve, reject)
     * params.query — search string
     */
    KoroTSource.prototype.search = function (params, resolve, reject) {
        try {
            var query = (params && params.query) ? params.query : '';
            console.log('[KoroT] search:', query);

            if (!query) {
                resolve([]);
                return;
            }

            apiGet('/search', { q: query }, function (data) {
                try {
                    var list = [];

                    // Backend returns { results: [...] } OR plain array
                    var raw = (data && data.results) ? data.results : (Array.isArray(data) ? data : []);

                    for (var i = 0; i < raw.length; i++) {
                        var item = raw[i];
                        list.push({
                            id: 'koroT_' + i,
                            title: item.title || '',
                            original_title: item.title || '',
                            year: item.year || '',
                            poster: item.poster || '',
                            poster_small: item.poster || '',
                            background_image: item.poster || '',
                            type: 'movie',
                            source: 'koroT',
                            // Store extra data for /get call
                            korot_url: item.url || '',
                            korot_source: item.source || ''
                        });
                    }

                    console.log('[KoroT] search results:', list.length);
                    resolve(list);
                } catch (e) {
                    console.log('[KoroT] search parse error:', e.message);
                    resolve([]);
                }
            }, function (err) {
                console.log('[KoroT] search failed:', err);
                resolve([]);
            });
        } catch (e) {
            console.log('[KoroT] search exception:', e.message);
            resolve([]);
        }
    };

    /**
     * full(item, resolve, reject)
     * Fetch detail + files for a selected card
     */
    KoroTSource.prototype.full = function (item, resolve, reject) {
        try {
            var korot_url = item.korot_url || '';
            var korot_source = item.korot_source || '';

            console.log('[KoroT] full:', korot_url, 'source:', korot_source);

            if (!korot_url) {
                console.log('[KoroT] full: no korot_url, aborting');
                resolve({ movie: item, torrents: [], episodes: {} });
                return;
            }

            apiGet('/get', { url: korot_url, source: korot_source }, function (data) {
                try {
                    var files = (data && data.files) ? data.files : [];

                    // Build Lampa-compatible torrent/stream list
                    var streams = [];
                    for (var i = 0; i < files.length; i++) {
                        var f = files[i];
                        var entry = {
                            title: (f.title || ('File ' + (i + 1))) + (f.quality ? ' [' + f.quality + ']' : ''),
                            quality: f.quality || 'unknown',
                            url: f.url || '',
                            magnet: f.magnet || ''
                        };

                        // Prefer direct URL; fall back to magnet
                        if (!entry.url && entry.magnet) {
                            entry.url = entry.magnet;
                        }

                        if (entry.url) {
                            streams.push(entry);
                        }
                    }

                    // Merge metadata into item
                    var movie = Lampa.Utils.extend({}, item);
                    if (data.title) movie.title = data.title;
                    if (data.poster) { movie.poster = data.poster; movie.poster_small = data.poster; }
                    if (data.description) movie.overview = data.description;
                    if (data.orig_title) movie.original_title = data.orig_title;

                    console.log('[KoroT] full streams:', streams.length);
                    resolve({ movie: movie, torrents: streams, episodes: {} });
                } catch (e) {
                    console.log('[KoroT] full parse error:', e.message);
                    resolve({ movie: item, torrents: [], episodes: {} });
                }
            }, function (err) {
                console.log('[KoroT] full request failed:', err);
                resolve({ movie: item, torrents: [], episodes: {} });
            });
        } catch (e) {
            console.log('[KoroT] full exception:', e.message);
            resolve({ movie: item, torrents: [], episodes: {} });
        }
    };

    /**
     * list(params, resolve, reject)
     * Called when opening the source directly (menu button).
     * We re-use search with an empty query trigger, or show a prompt.
     */
    KoroTSource.prototype.list = function (params, resolve, reject) {
        try {
            console.log('[KoroT] list called');
            // Return empty — the source will show "search" interface
            resolve([]);
        } catch (e) {
            console.log('[KoroT] list exception:', e.message);
            resolve([]);
        }
    };

    /**
     * clear()  — clean up when source is unloaded
     */
    KoroTSource.prototype.clear = function () {
        try {
            console.log('[KoroT] clear');
        } catch (e) {
            console.log('[KoroT] clear exception:', e.message);
        }
    };

    // ------------------------------------------------------------------
    // Register source
    // ------------------------------------------------------------------
    function registerSource() {
        try {
            if (typeof Lampa === 'undefined') {
                console.log('[KoroT] Lampa not found, aborting source registration');
                return;
            }

            var source = new KoroTSource();

            // Lampa source descriptor
            var descriptor = {
                name: 'KoroT',
                short_name: 'KoroT',
                source: 'koroT',
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
                    + '<text y="18" font-size="16">&#x1F525;</text></svg>',
                search: function (params, resolve, reject) {
                    source.search(params, resolve, reject);
                },
                full: function (item, resolve, reject) {
                    source.full(item, resolve, reject);
                },
                list: function (params, resolve, reject) {
                    source.list(params, resolve, reject);
                },
                clear: function () {
                    source.clear();
                }
            };

            if (Lampa.Source && typeof Lampa.Source.add === 'function') {
                Lampa.Source.add('koroT', descriptor);
                console.log('[KoroT] Source registered via Lampa.Source.add');
            } else if (Lampa.Torrents && typeof Lampa.Torrents.add === 'function') {
                Lampa.Torrents.add(descriptor);
                console.log('[KoroT] Source registered via Lampa.Torrents.add (fallback)');
            } else {
                console.log('[KoroT] WARNING: Could not find Source.add or Torrents.add — trying Component.add');
                // Last-resort: register as a component-style source
                try {
                    Lampa.Component.add('koroT', descriptor);
                } catch (ce) {
                    console.log('[KoroT] Component.add failed:', ce.message);
                }
            }
        } catch (e) {
            console.log('[KoroT] registerSource exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Left-menu button
    // ------------------------------------------------------------------
    function addMenuButton() {
        try {
            if (typeof Lampa === 'undefined' || !Lampa.Menu) {
                console.log('[KoroT] Lampa.Menu not available, skipping menu button');
                return;
            }

            var btn = {
                title: 'KoroT',
                subtitle: 'Kinogo + Rezka + TorBox',
                icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">'
                    + '<text y="18" font-size="16">&#x1F525;</text></svg>',
                action: function () {
                    try {
                        console.log('[KoroT] Menu button clicked — opening search');
                        openKoroTSearch();
                    } catch (e) {
                        console.log('[KoroT] menu action exception:', e.message);
                    }
                }
            };

            if (typeof Lampa.Menu.add === 'function') {
                Lampa.Menu.add(btn);
                console.log('[KoroT] Menu button added via Lampa.Menu.add');
            } else {
                console.log('[KoroT] Lampa.Menu.add not available');
            }
        } catch (e) {
            console.log('[KoroT] addMenuButton exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Open KoroT search
    // ------------------------------------------------------------------
    function openKoroTSearch() {
        try {
            console.log('[KoroT] openKoroTSearch');

            // Use Lampa.Search if available
            if (Lampa.Search && typeof Lampa.Search.open === 'function') {
                Lampa.Search.open({ source: 'koroT' });
                return;
            }

            // Fallback: push a search activity
            if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                Lampa.Activity.push({
                    url: '',
                    title: 'KoroT',
                    component: 'search',
                    source: 'koroT',
                    page: 1
                });
                return;
            }

            // Fallback 2: open via Lampa.Select
            if (Lampa.Select && typeof Lampa.Select.show === 'function') {
                Lampa.Select.show({
                    title: 'KoroT',
                    items: [{ title: '\u041f\u043e\u0438\u0441\u043a...', action: 'search' }],
                    onSelect: function (item) {
                        try {
                            if (Lampa.Activity && typeof Lampa.Activity.push === 'function') {
                                Lampa.Activity.push({
                                    url: '',
                                    title: 'KoroT',
                                    component: 'search',
                                    source: 'koroT',
                                    page: 1
                                });
                            }
                        } catch (e) {
                            console.log('[KoroT] Select onSelect exception:', e.message);
                        }
                    }
                });
                return;
            }

            console.log('[KoroT] No navigation API available to open search');
        } catch (e) {
            console.log('[KoroT] openKoroTSearch exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Boot: wait for Lampa to be ready, then register
    // ------------------------------------------------------------------
    function boot() {
        try {
            if (typeof Lampa === 'undefined') {
                console.log('[KoroT] Lampa not defined yet, retrying in 500ms');
                setTimeout(boot, 500);
                return;
            }

            // Wait for Lampa.Listener / ready event if available
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('ready', function () {
                    try {
                        console.log('[KoroT] Lampa ready event — initialising');
                        registerSource();
                        addMenuButton();
                    } catch (e) {
                        console.log('[KoroT] ready handler exception:', e.message);
                    }
                });
                // Also call immediately in case 'ready' already fired
                registerSource();
                addMenuButton();
            } else {
                // No listener — just initialise now
                registerSource();
                addMenuButton();
            }

            console.log('[KoroT] Boot complete');
        } catch (e) {
            console.log('[KoroT] boot exception:', e.message);
        }
    }

    // ------------------------------------------------------------------
    // Entry point
    // ------------------------------------------------------------------
    try {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    } catch (e) {
        console.log('[KoroT] Entry point exception:', e.message);
        // Last resort
        try { boot(); } catch (e2) { /* silent */ }
    }

})();
