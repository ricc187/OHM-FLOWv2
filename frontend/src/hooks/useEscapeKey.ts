import { useEffect } from 'react';

// Lets a modal close on Escape without every modal re-wiring its own
// listener/cleanup. `active` gates it so it's only listening while open.
export function useEscapeKey(active: boolean, onEscape: () => void) {
    useEffect(() => {
        if (!active) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onEscape();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [active, onEscape]);
}
