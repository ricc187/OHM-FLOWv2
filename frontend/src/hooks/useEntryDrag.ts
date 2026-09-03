import React, { useRef, useState } from 'react';
import { CalendarItem } from '../types';

export interface DropTarget {
    date: string; // YYYY-MM-DD
    userId?: number; // undefined in grids with no per-employee rows (Mois)
}

export interface DragVisual {
    item: CalendarItem;
    x: number; // viewport px — ghost's current top-left
    y: number;
    width: number;
    over: DropTarget | null;
    valid: boolean;
}

const MOVE_THRESHOLD = 8; // px
const LONG_PRESS_MS = 300;

// Custom pointer-based drag&drop — not native HTML5 DnD, which doesn't fire
// reliably on touch. Pointer Events unify mouse/touch/pen, but activation
// differs by pointer type:
//  - mouse/pen: movement past MOVE_THRESHOLD activates the drag immediately,
//    no delay — a mouse drag over a grid doesn't fight page scroll, so
//    there's nothing to disambiguate from.
//  - touch: a 300ms long-press with the finger held still is required
//    before ANY movement counts as a drag — that's what disambiguates a
//    drag from a scroll/swipe. Movement past the threshold before that
//    fires -> treated as a scroll, gesture aborted.
//
// Tap/click handling is DELIBERATELY NOT done by this hook — a first cut
// had it call an `onTap(item)` callback itself from the pointerup handler,
// routed through a `gestureRef`/`dragRef` pair of mutable refs. That's extra
// indirection for something a plain React `onClick` on the chip already
// does correctly and unambiguously (the item is a literal prop on that one
// element, not something reconstructed from ref state at release time).
// This hook now does exactly one job — recognize when a gesture crossed
// into "this is a drag", and if so, suppress the click that follows so it
// doesn't ALSO open the detail panel (or, worse, bubble into the day cell
// underneath and pop the create-entry form — the browser fires that click
// on whatever's under the pointer at release, regardless of pointer
// capture). See guardClick below.
//
// Drop targets are found by DOM lookup (`document.elementFromPoint` +
// closest('[data-drop-date]')), not by tracking rects in JS — the caller
// marks any droppable cell with `data-drop-date` (and `data-drop-user` for
// grids with employee rows). The chip being dragged must go
// `pointer-events: none` (see the `dragging` flag returned per-item below)
// so that lookup can see through it to the cell/bar underneath.
//
// Simplification: a drop places the entry's date_debut at the released
// cell's date (date_fin shifts to preserve the original span) — it does not
// preserve the pixel offset where you originally grabbed the block.
export function useEntryDrag(onDrop: (item: CalendarItem, target: DropTarget) => void) {
    const [drag, setDrag] = useState<DragVisual | null>(null);
    const dragRef = useRef<DragVisual | null>(null);
    const setDragBoth = (v: DragVisual | null) => { dragRef.current = v; setDrag(v); };

    const gestureRef = useRef<{
        item: CalendarItem;
        pointerType: string;
        startX: number; startY: number;
        offsetX: number; offsetY: number;
        width: number;
        started: boolean;
        timer: ReturnType<typeof setTimeout>;
    } | null>(null);

    const findDropTarget = (x: number, y: number): DropTarget | null => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        const cell = el?.closest<HTMLElement>('[data-drop-date]');
        if (!cell) return null;
        const userIdAttr = cell.dataset.dropUser;
        return { date: cell.dataset.dropDate!, userId: userIdAttr ? parseInt(userIdAttr, 10) : undefined };
    };

    // A leave stays with its owner — dropping it on another employee's row
    // is not a valid target, only its date can change.
    const isValidTarget = (item: CalendarItem, target: DropTarget | null) => {
        if (!target) return false;
        if (item.source === 'leave' && target.userId !== undefined && target.userId !== item.user_id) return false;
        return true;
    };

    // Marks the gesture active and shows the ghost at (x, y) — called either
    // by the long-press timer (touch, or a mouse held still) or immediately
    // on a mouse move past the threshold.
    const activate = (x: number, y: number) => {
        const g = gestureRef.current;
        if (!g || g.started) return;
        clearTimeout(g.timer);
        g.started = true;
        const target = findDropTarget(x, y);
        setDragBoth({
            item: g.item, x: x - g.offsetX, y: y - g.offsetY, width: g.width,
            over: target, valid: isValidTarget(g.item, target),
        });
    };

    const onPointerDown = (item: CalendarItem) => (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
        gestureRef.current = {
            item, pointerType: e.pointerType, startX: e.clientX, startY: e.clientY,
            offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
            width: rect.width, started: false,
            timer: setTimeout(() => activate(e.clientX, e.clientY), LONG_PRESS_MS),
        };
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const g = gestureRef.current;
        if (!g) return;
        if (!g.started) {
            const moved = Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > MOVE_THRESHOLD;
            if (!moved) return;
            if (g.pointerType === 'mouse' || g.pointerType === 'pen') {
                activate(e.clientX, e.clientY);
            } else {
                clearTimeout(g.timer);
                gestureRef.current = null; // touch scrolled before the long-press fired
            }
            return;
        }
        e.preventDefault();
        const target = findDropTarget(e.clientX, e.clientY);
        setDragBoth({
            item: g.item, x: e.clientX - g.offsetX, y: e.clientY - g.offsetY, width: g.width,
            over: target, valid: isValidTarget(g.item, target),
        });
    };

    // Set the instant a real drag completes, read (and cleared) by
    // guardClick on the `click` the browser fires right after — pointer
    // capture doesn't stop that native click from bubbling to whatever's
    // under the release point.
    const dragJustEndedRef = useRef(false);

    const endGesture = () => {
        const g = gestureRef.current;
        if (!g) { setDragBoth(null); return; }
        clearTimeout(g.timer);
        if (g.started) {
            dragJustEndedRef.current = true;
            const d = dragRef.current;
            if (d && d.over && d.valid) onDrop(g.item, d.over);
        }
        gestureRef.current = null;
        setDragBoth(null);
    };

    // Wrap a chip's real tap action (e.g. `() => onBlockClick(item)`) with
    // this. Always stops the click from bubbling to the day cell underneath
    // (which would otherwise open the create-entry form); on top of that,
    // swallows exactly the one click that follows a real drag so a
    // completed drop doesn't ALSO trigger the tap action.
    const guardClick = (tap: () => void) => (e: React.MouseEvent) => {
        e.stopPropagation();
        if (dragJustEndedRef.current) { dragJustEndedRef.current = false; return; }
        tap();
    };

    // For a day cell's own onClick (create-entry): a drag that ends by
    // dropping on EMPTY space in a cell (not on top of another chip) never
    // reaches guardClick above — the click's target IS the cell, nothing to
    // stopPropagation from. Same underlying flag, so whichever of the two
    // (a chip's guardClick or a cell's shouldIgnoreClick) the browser
    // actually targets consumes it.
    const shouldIgnoreClick = () => {
        if (!dragJustEndedRef.current) return false;
        dragJustEndedRef.current = false;
        return true;
    };

    // Spread onto a chip's wrapping element. `touchAction: none` stops the
    // browser's own touch-scroll from fighting the gesture once picked up.
    const chipHandlers = (item: CalendarItem) => ({
        onPointerDown: onPointerDown(item),
        onPointerMove,
        onPointerUp: endGesture,
        onPointerCancel: endGesture,
        style: { touchAction: 'none' as const },
    });

    const isDragging = (item: CalendarItem) => !!drag && drag.item.source === item.source && drag.item.id === item.id;

    return { drag, chipHandlers, isDragging, guardClick, shouldIgnoreClick };
}
