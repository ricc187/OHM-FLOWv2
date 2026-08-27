import { registerSW } from 'virtual:pwa-register';

// The default injected register script only ever installs a new service
// worker in the background — it never activates it, so an already-open tab
// (or an installed home-screen icon) keeps serving the OLD cached build
// until fully killed and reopened. Force it to take over and reload instead,
// so every deploy actually reaches devices without a manual cache dance.
export const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
        updateSW(true); // tell the waiting worker to activate, then reload once it does
    },
    onRegisteredSW(_url, registration) {
        if (!registration) return;
        // Browsers throttle their own SW-update checks (up to 24h) — too slow
        // while we're actively redeploying several times an hour. Poll for a
        // new version ourselves while the app is open.
        setInterval(() => registration.update(), 20000);
    },
});
