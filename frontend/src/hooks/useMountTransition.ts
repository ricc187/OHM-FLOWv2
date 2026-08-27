import { useEffect, useState } from 'react';

/** Keeps an element mounted long enough to play its close animation instead
 * of vanishing instantly, and delays the "open" class by one frame after
 * mount so the enter transition actually plays (mounting already in the
 * open state skips the tween). Used by the transitions-dev modal/toast
 * snippets, which both toggle a single class and expect the caller to
 * handle the mount/unmount timing themselves. */
export function useMountTransition(open: boolean, closeDurMs: number) {
    const [mounted, setMounted] = useState(open);
    const [active, setActive] = useState(false);

    useEffect(() => {
        let raf: number;
        let closeTimer: ReturnType<typeof setTimeout>;
        if (open) {
            setMounted(true);
            raf = requestAnimationFrame(() => setActive(true));
        } else {
            setActive(false);
            closeTimer = setTimeout(() => setMounted(false), closeDurMs);
        }
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(closeTimer);
        };
    }, [open, closeDurMs]);

    return { mounted, active };
}
