/**
 * Easy-Mod Diagnostic Test Plugin
 * Adds an «Easy-Mod Test» button and runs a quick health check.
 * Load this if the main easy-mod.js is not working.
 */
(function () {
    'use strict';

    console.log('[Easy-Mod Test] Plugin loaded');

    var API_URL = 'http://46.225.222.255:8000';

    function runHealthCheck() {
        try {
            console.log('[Easy-Mod Test] GET /health');
            var req = new Lampa.Request();
            req.silent(
                API_URL + '/health',
                function (data) {
                    try {
                        var json = (typeof data === 'string') ? JSON.parse(data) : data;
                        var status = (json && json.status) ? json.status : 'unknown';
                        console.log('[Easy-Mod Test] /health response:', JSON.stringify(json));
                        Lampa.Noty.show('[Easy-Mod] health: ' + status);
                    } catch (e) {
                        console.log('[Easy-Mod Test] ERROR parse:', e.message);
                        Lampa.Noty.show('[Easy-Mod] parse error: ' + e.message);
                    }
                },
                function (err) {
                    console.log('[Easy-Mod Test] ERROR /health:', err);
                    Lampa.Noty.show('[Easy-Mod] network error: ' + String(err));
                }
            );
        } catch (e) {
            console.log('[Easy-Mod Test] ERROR runHealthCheck:', e.message);
        }
    }

    function addMenuButton() {
        try {
            if (!Lampa.Menu || typeof Lampa.Menu.add !== 'function') {
                console.log('[Easy-Mod Test] Lampa.Menu.add not available');
                return;
            }
            Lampa.Menu.add({
                title:   'Easy-Mod Test',
                subtitle: 'Diagnostic',
                icon:    'like',
                order:   200,
                action:  function () {
                    try {
                        console.log('[Easy-Mod Test] menu button pressed');
                        runHealthCheck();
                    } catch (e) {
                        console.log('[Easy-Mod Test] ERROR menu action:', e.message);
                    }
                }
            });
            console.log('[Easy-Mod Test] menu button added');
        } catch (e) {
            console.log('[Easy-Mod Test] ERROR addMenuButton:', e.message);
        }
    }

    function boot() {
        try {
            if (typeof Lampa === 'undefined') {
                setTimeout(boot, 500);
                return;
            }
            console.log('[Easy-Mod Test] boot() — Lampa found');
            if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
                Lampa.Listener.follow('ready', function () {
                    try { addMenuButton(); } catch (e) {
                        console.log('[Easy-Mod Test] ERROR ready handler:', e.message);
                    }
                });
            }
            addMenuButton();
        } catch (e) {
            console.log('[Easy-Mod Test] ERROR boot():', e.message);
        }
    }

    try {
        if (typeof document !== 'undefined' && document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    } catch (e) {
        console.log('[Easy-Mod Test] ERROR entry point:', e.message);
        try { boot(); } catch (e2) { /* silent */ }
    }

})();
