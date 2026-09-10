import { useState } from 'react';
import type { ReactNode } from 'react';

// Options for one confirmation request — see components/ConfirmDialog.tsx
// for how each is rendered.
export interface ConfirmOptions {
    title: string;
    message: ReactNode;
    confirmLabel?: string; // default 'Supprimer'
    cancelLabel?: string;  // default 'Annuler'
    danger?: boolean;      // default true — red styling; false = amber (e.g. reject, not delete)
    // Second-step engagement level (see prompt discussion — a plain
    // window.confirm()-style single step is never enough for a destructive
    // action, but not every deletion deserves the same amount of friction):
    //   - false (default) : a checkbox "Je comprends que cette action est
    //     irréversible" must be ticked before the confirm button activates.
    //     Fast (one click), but breaks the reflex double-click-through that
    //     a bare confirm() dialog invites.
    //   - true : the user must type `confirmText` exactly (e.g. the
    //     chantier's name) before the button activates. Reserved for
    //     genuinely irreversible cascade actions (full chantier delete from
    //     the Pot, user delete) — a checkbox is not enough friction there.
    strict?: boolean;
    confirmText?: string; // required when strict — the exact text the user must type
}

interface PendingConfirm {
    options: ConfirmOptions;
    resolve: (result: boolean) => void;
}

// Promise-based confirmation, so a delete handler reads as:
//   const ok = await confirm({ title: '...', message: '...' });
//   if (!ok) return;
//   ... proceed with the actual delete call ...
// Render `confirmDialogProps` (via <ConfirmDialog {...confirmDialogProps} />,
// only when non-null) once anywhere in the component's JSX — one hook call,
// one render site, regardless of how many different delete/close actions
// that component has.
export function useConfirm() {
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const confirm = (options: ConfirmOptions): Promise<boolean> =>
        new Promise(resolve => setPending({ options, resolve }));

    const confirmDialogProps = pending
        ? {
            ...pending.options,
            onConfirm: () => { pending.resolve(true); setPending(null); },
            onCancel: () => { pending.resolve(false); setPending(null); },
        }
        : null;

    return { confirm, confirmDialogProps };
}
