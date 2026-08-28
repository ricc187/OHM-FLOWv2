import { useEffect, useRef } from 'react';

// Keeps a screen honest while it's left open, so two people never see one of
// them stuck on stale data without a manual reload: re-runs `refetch` on a
// timer AND whenever the tab/window regains focus (switched back from
// another app, another browser tab, or the phone's lock screen).
//
// Pass `enabled = false` to pause it (e.g. while the user is mid-edit on
// this screen) — a background refetch overwriting fields someone is
// actively typing into would be worse than a few stale seconds.
export function useAutoRefresh(refetch: () => void, intervalMs = 20000, enabled = true) {
    const refetchRef = useRef(refetch);
    refetchRef.current = refetch;

    useEffect(() => {
        if (!enabled) return;
        const interval = setInterval(() => refetchRef.current(), intervalMs);
        const onVisibility = () => { if (document.visibilityState === 'visible') refetchRef.current(); };
        const onFocus = () => refetchRef.current();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onFocus);
        };
    }, [intervalMs, enabled]);
}
