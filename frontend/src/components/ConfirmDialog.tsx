import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { ConfirmOptions } from '../hooks/useConfirm';

interface Props extends ConfirmOptions {
    onConfirm: () => void;
    onCancel: () => void;
}

// Single reusable double-confirmation modal — see useConfirm.ts for the
// promise-based controller every delete/close action in the app goes
// through. Unlike WeeklyKmPrompt.tsx, this one IS dismissible (Escape,
// backdrop click, Annuler) — the friction here is on confirming, not on
// escaping; a confirmation the user can't back out of would be worse, not safer.
export const ConfirmDialog: React.FC<Props> = ({
    title, message, confirmLabel = 'Supprimer', cancelLabel = 'Annuler',
    danger = true, strict = false, confirmText, onConfirm, onCancel,
}) => {
    const [checked, setChecked] = useState(false);
    const [typed, setTyped] = useState('');

    useEscapeKey(true, onCancel);

    const ready = strict ? typed.trim() === (confirmText ?? '').trim() && typed.trim() !== '' : checked;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={onCancel} />
            <div className="relative w-full max-w-md bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                <div className="p-6 space-y-5">
                    <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-600'}`}>
                            <AlertTriangle size={20} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-black text-slate-900 text-lg">{title}</h3>
                            <div className="text-slate-500 text-sm mt-1">{message}</div>
                        </div>
                    </div>

                    {strict ? (
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                                Tapez « {confirmText} » pour confirmer
                            </label>
                            <input
                                type="text"
                                autoFocus
                                className="input-field font-mono"
                                value={typed}
                                onChange={e => setTyped(e.target.value)}
                                placeholder={confirmText}
                            />
                        </div>
                    ) : (
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                            <input
                                type="checkbox" checked={checked}
                                onChange={e => setChecked(e.target.checked)}
                                className="mt-1 w-4 h-4 accent-red-500 shrink-0"
                            />
                            <span className="text-sm text-slate-700">Je comprends que cette action est irréversible.</span>
                        </label>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all text-sm font-bold">
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={!ready}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${danger ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-ohm-primary text-ohm-bg hover:bg-yellow-300'}`}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
