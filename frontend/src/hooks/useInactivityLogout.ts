import { useEffect, useRef } from 'react';

// Any of these resets the idle timer — deliberately passive listeners so
// they never block scrolling/typing while doing it.
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

        const reset = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => onTimeoutRef.current(), ms);
        };

        reset();
        ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }));
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, reset));
        };
    }, [minutes, enabled]);
}
