import { useEffect, useRef } from 'react';

// Any of these resets the idle timer. Attached with `capture: true` — plain
// `scroll` events don't bubble to window, only mousemove/keydown/click/etc
// do, and the app has several nested overflow-auto scroll containers
// (ChantierDetail, DocumentExplorer, Layout, AwesomeSelect) — a user who
// only scrolls one of those for the whole idle window would otherwise never
// reset the timer. A capture-phase listener on window sees every event on
// its way down to the target regardless of whether it later bubbles back up.
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

// Auto-logs out after `minutes` of no interaction anywhere in the app —
// the session cookie itself stays valid for 24h, this is a separate
// "someone walked away from an unlocked device" protection. Purely
// client-side (no server round-trip on activity — only the eventual
// logout call), so it resets cleanly on every navigation without needing
// server state.
export function useInactivityLogout(onTimeout: () => void, minutes = 20, enabled = true) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onTimeoutRef = useRef(onTimeout);
    onTimeoutRef.current = onTimeout;

    useEffect(() => {
        if (!enabled) return;
        const ms = minutes * 60 * 1000;
        // mousemove/scroll can fire dozens of times a second — no need to
        // re-arm the timeout on every single one, just often enough that
        // continuous activity never times out.
        const THROTTLE_MS = 1000;
        let lastReset = 0;

        const reset = () => {
            const now = Date.now();
            if (now - lastReset < THROTTLE_MS) return;
            lastReset = now;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => onTimeoutRef.current(), ms);
        };

        reset();
        ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true, capture: true }));
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, reset, { capture: true }));
        };
    }, [minutes, enabled]);
}
