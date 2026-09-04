import { useEffect, useState } from 'react';

// Mirrors Layout.tsx's own inline matchMedia pattern for its drawer
// breakpoint — extracted here since Agenda needs the same kind of reactive
// viewport check to switch its grid to a swipeable narrow-column layout.
export function useIsMobile(breakpoint = 767): boolean {
    const query = `(max-width: ${breakpoint}px)`;
    const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = () => setIsMobile(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [query]);
    return isMobile;
}
