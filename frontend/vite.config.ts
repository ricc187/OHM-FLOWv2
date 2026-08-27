import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            // We register manually in main.tsx (via virtual:pwa-register) so we can
            // force an already-open tab/installed PWA to pick up new deploys instead
            // of silently sitting on a stale cached build — don't also inject the
            // bare auto-generated register script, it would register twice.
            injectRegister: false,
            includeAssets: ['favicon-16.png', 'favicon-32.png', 'icons/apple-touch-icon.png'],
            manifest: {
                name: 'OHM-FLOW',
                short_name: 'OHM-FLOW',
                description: 'Gestion de chantiers — heures, matériel, congés',
                theme_color: '#2563EB',
                background_color: '#F8FAFC',
                display: 'standalone',
                start_url: '/',
                scope: '/',
                lang: 'fr',
                icons: [
                    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                    { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
                    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
                    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
            },
            workbox: {
                // Precache the JS/CSS/icons app shell so the PWA still opens with zero
                // signal on site — chantiers often have weak/no mobile coverage. HTML is
                // deliberately NOT precached/globbed here: see the navigation runtimeCaching
                // rule below for why.
                globPatterns: ['**/*.{js,css,png,svg,ico}'],
                runtimeCaching: [
                    {
                        // Every page navigation (including a plain refresh) — NetworkFirst,
                        // not the precached-HTML cache-first fallback workbox defaults to.
                        // Cache-first here was the actual bug behind "I refresh and don't
                        // get the update": it kept serving the last-installed HTML (which
                        // points at the old hashed JS/CSS bundle) until the service worker
                        // itself finished a separate background update cycle. NetworkFirst
                        // fetches fresh on every refresh while online (the common case) and
                        // only falls back to the last-seen page when genuinely offline.
                        urlPattern: ({ request }) => request.mode === 'navigate',
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'ohm-html-cache',
                            networkTimeoutSeconds: 4,
                            expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 7 },
                            cacheableResponse: { statuses: [200] },
                        },
                    },
                    {
                        // Read endpoints: try the network (fresh data), fall back to the
                        // last-seen response when offline/slow instead of a blank error.
                        // Excludes /api/export, /api/backup, /pdf (file downloads) and
                        // any non-GET (those must never be served from cache).
                        urlPattern: ({ url, request }) =>
                            request.method === 'GET' &&
                            url.pathname.startsWith('/api/') &&
                            !['/api/export', '/api/backup'].some(p => url.pathname.startsWith(p)) &&
                            !url.pathname.endsWith('/pdf'),
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'ohm-api-cache',
                            networkTimeoutSeconds: 6,
                            expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }, // 1 day
                            cacheableResponse: { statuses: [200] },
                        },
                    },
                ],
            },
        }),
    ],
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:5000',
                changeOrigin: true,
                secure: false
            }
        }
    }
})
