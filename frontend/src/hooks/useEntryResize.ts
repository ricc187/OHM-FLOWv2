import { useEffect, useRef, useState } from 'react';
import { CalendarItem } from '../types';

export interface ResizeState {
    item: CalendarItem;
    edge: 'start' | 'end'; // 'start' drags date_debut, 'end' drags date_fin
    overDate: string | null; // YYYY-MM-DD under the pointer right now
}

const LONG_PRESS_MS = 300; // touch: same disambiguation delay as useEntryDrag
const MOVE_THRESHOLD = 6; // px, mouse/pen: activates immediately past this

// Sibling hook to useEntryDrag (whole-block move) — this one only ever
// drags a SINGLE edge of an entry (its left/right resize handle, see
// Agenda.tsx's EntryChip), changing date_debut ('start') or date_fin
// ('end'), never the employee row.
//
// Deliberately NOT built on setPointerCapture on the handle's own DOM node
// like useEntryDrag is: Agenda.tsx renders a live preview of the resize by
// temporarily swapping the item's dates before the single-day/multi-day
// split that decides whether it renders as a day-cell chip or a spanning
// bar (see previewResizedItems) — so the exact DOM node under the pointer
// at gesture start can get unmounted (and a different one, e.g. the bar
// it just turned into, mounted elsewhere) mid-gesture. Pointer capture set
// on a node that's removed from the DOM is silently released by the
// browser, which would abort the drag. Tracking with plain window-level
// pointermove/up listeners instead sidesteps that entirely — it doesn't
// care which node is currently under the pointer.
export function useEntryResize(onResize: (item: CalendarItem, edge: 'start' | 'end', newDate: string) => void) {
    const [resize, setResize] = useState<ResizeState | null>(null);
    const resizeRef = useRef<ResizeState | null>(null);
    const setBoth = (v: ResizeState | null) => { resizeRef.current = v; setResize(v); };

    const findDropDate = (x: number, y: number): string | null => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        return el?.closest<HTMLElement>('[data-drop-date]')?.dataset.dropDate ?? null;
    };

    // Active-gesture tracking — window-level, only attached once a resize
    // has actually been activated (see onHandlePointerDown's pre-activation
    // disambiguation below, which doesn't use this effect at all).
    useEffect(() => {
        if (!resize) return;
        const onMove = (e: PointerEvent) => {
            const r = resizeRef.current;
            if (!r) return;
            setBoth({ ...r, overDate: findDropDate(e.clientX, e.clientY) });
        };
        const onUp = () => {
            const r = resizeRef.current;
            setBoth(null);
            if (r?.overDate) onResize(r.item, r.edge, r.overDate);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
        // Only the presence of an active resize matters here, not its
        // changing `overDate` — re-subscribing on every pointermove would
        // be pointless churn.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!!resize]);

    const onHandlePointerDown = (item: CalendarItem, edge: 'start' | 'end') => (e: React.PointerEvent) => {
        // Never let this bubble to the chip's own onPointerDown (useEntryDrag's
        // whole-block move gesture) — grabbing the edge must only ever resize.
        e.stopPropagation();
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const pointerType = e.pointerType;
        let cleanup: () => void;

        const activate = (x: number, y: number) => {
            cleanup();
            setBoth({ item, edge, overDate: findDropDate(x, y) });
        };

        if (pointerType === 'mouse' || pointerType === 'pen') {
            const onFirstMove = (ev: PointerEvent) => {
                if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_THRESHOLD) activate(ev.clientX, ev.clientY);
            };
            const onFirstUp = () => cleanup();
            cleanup = () => {
                window.removeEventListener('pointermove', onFirstMove);
                window.removeEventListener('pointerup', onFirstUp);
            };
            window.addEventListener('pointermove', onFirstMove);
            window.addEventListener('pointerup', onFirstUp);
        } else {
            // Touch: a still-held long-press before any movement counts as a
            // resize — movement before that reads as a scroll instead.
            const timer = setTimeout(() => activate(startX, startY), LONG_PRESS_MS);
            const onEarlyMove = (ev: PointerEvent) => {
                if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_THRESHOLD) cleanup();
            };
            const onEarlyUp = () => cleanup();
            cleanup = () => {
                clearTimeout(timer);
                window.removeEventListener('pointermove', onEarlyMove);
                window.removeEventListener('pointerup', onEarlyUp);
            };
            window.addEventListener('pointermove', onEarlyMove);
            window.addEventListener('pointerup', onEarlyUp);
        }
    };

    // Spread onto a chip's left/right edge handle. A plain onClick={e =>
    // e.stopPropagation()} alongside this (see Agenda.tsx) keeps a tap that
    // never turned into a real resize from also bubbling into the chip's
    // own onClick (which would open the detail panel).
    const handleProps = (item: CalendarItem, edge: 'start' | 'end') => ({
        onPointerDown: onHandlePointerDown(item, edge),
        style: { touchAction: 'none' as const },
    });

    const isResizingEdge = (item: CalendarItem, edge: 'start' | 'end') =>
        !!resize && resize.item.source === item.source && resize.item.id === item.id && resize.edge === edge;

    return { resize, handleProps, isResizingEdge };
}
