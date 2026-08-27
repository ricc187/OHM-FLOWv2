import React, { useLayoutEffect, useRef } from 'react';

interface Tab<T extends string> {
    id: T;
    label: React.ReactNode;
    icon?: React.ReactNode;
}

interface Props<T extends string> {
    tabs: Tab<T>[];
    active: T;
    onChange: (id: T) => void;
    className?: string;
}

// transitions-dev "16-tabs-sliding": a pill slides between tabs instead of
// each button just swapping its own background instantly. JS measures the
// active tab's offsetLeft/offsetWidth and writes them onto the pill; CSS
// (see .t-tabs* in index.css) owns the tween.
export function SlidingTabs<T extends string>({ tabs, active, onChange, className = '' }: Props<T>) {
    const pillRef = useRef<HTMLSpanElement>(null);
    const tabRefs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
    const isFirstRender = useRef(true);

    const moveTo = (id: T, animate: boolean) => {
        const tab = tabRefs.current[id];
        const pill = pillRef.current;
        if (!tab || !pill) return;
        if (!animate) {
            const prev = pill.style.transition;
            pill.style.transition = 'none';
            pill.style.transform = `translateX(${tab.offsetLeft}px)`;
            pill.style.width = `${tab.offsetWidth}px`;
            void pill.offsetWidth; // force reflow before restoring the transition
            pill.style.transition = prev;
        } else {
            pill.style.transform = `translateX(${tab.offsetLeft}px)`;
            pill.style.width = `${tab.offsetWidth}px`;
        }
    };

    // Animated move on every subsequent tab change...
    useLayoutEffect(() => {
        if (isFirstRender.current) return; // first paint is handled below, without animating in from 0
        moveTo(active, true);
    }, [active]);

    // ...but snap into place with no transition on first paint/resize, so the
    // pill doesn't animate in from translateX(0)/width:0 on mount.
    useLayoutEffect(() => {
        moveTo(active, false);
        isFirstRender.current = false;
        const onResize = () => moveTo(active, false);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className={`t-tabs ${className}`} role="tablist">
            <span ref={pillRef} className="t-tabs-pill" aria-hidden="true" />
            {tabs.map(t => (
                <button
                    key={t.id}
                    ref={el => { tabRefs.current[t.id] = el; }}
                    role="tab"
                    aria-selected={active === t.id}
                    onClick={() => onChange(t.id)}
                    className="t-tab flex items-center gap-2 whitespace-nowrap"
                >
                    {t.icon}{t.label}
                </button>
            ))}
        </div>
    );
}
