// Tiny event bus letting any page-level modal (e.g. ChantierDetail's entry
// modal) tell the app shell (Layout) to hide its own nav chrome while open —
// without wiring modal state through props/context across the whole tree.
export const MODAL_STATE_EVENT = 'app:modal-state';

export function setAppModalOpen(open: boolean) {
    window.dispatchEvent(new CustomEvent<boolean>(MODAL_STATE_EVENT, { detail: open }));
}
