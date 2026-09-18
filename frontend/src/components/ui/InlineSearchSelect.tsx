import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export interface InlineSearchSelectOption {
    value: string;
    label: string;
    // Texte additionnel filtré mais jamais affiché — permet de chercher sur
    // un champ absent du label visible (ex: le référent d'un chantier, voir
    // Dashboard.tsx) sans changer ce qui s'affiche dans la liste.
    keywords?: string;
}

interface InlineSearchSelectProps {
    value?: string;
    onChange: (val: string) => void;
    options: InlineSearchSelectOption[];
    placeholder?: string;
    icon?: React.ReactNode;
    // Raccourci clavier global "/" qui met le focus sur ce champ depuis
    // n'importe où sur la page (façon GitHub/Slack/Reddit) — désactivé par
    // défaut : à activer explicitement là où une seule barre de recherche
    // principale doit réagir (voir Dashboard.tsx), pas sur chaque instance
    // du composant (AgendaForm.tsx en a une autre, plus locale).
    focusShortcut?: boolean;
    // Style plus marqué (bordure/ombre bleues, champ plus généreux) — opt-in
    // pour la barre de recherche principale du Dashboard, sans changer le
    // look standard des autres usages (AgendaForm.tsx).
    emphasized?: boolean;
}

// Search bar that IS the input — click it and type right away, dropdown
// opens anchored underneath (already showing the full list), no fullscreen
// popup like AwesomeSelect. Kept separate from AwesomeSelect on purpose:
// AwesomeSelect's modal pattern is used as a generic form select in 6 other
// places and shouldn't change behavior there.
export const InlineSearchSelect: React.FC<InlineSearchSelectProps> = ({ value, onChange, options, placeholder = 'Rechercher...', icon, focusShortcut = false, emphasized = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // Responsive fix: this popover always opened downward with a fixed
    // max-h-80 (320px), regardless of how much viewport space was actually
    // below it — on mobile, a field near the bottom of a scrolled form (or
    // one pushed up by the virtual keyboard) got its list clipped with no
    // way to reach the rest. Measured once on open, not tracked live — same
    // bounded-measurement approach as the rest of this app's popovers
    // (AwesomeSelect doesn't need this at all, it's a centered full-screen
    // modal instead of an anchored popover).
    const [dropUp, setDropUp] = useState(false);
    const [maxListHeight, setMaxListHeight] = useState(320);

    const selectedOption = options.find(o => o.value === value);

    const filteredOptions = useMemo(() => {
        if (!query) return options;
        const q = query.toLowerCase();
        return options.filter(o => `${o.label} ${o.keywords ?? ''}`.toLowerCase().includes(q));
    }, [options, query]);

    const openDropdown = () => {
        setQuery('');
        setIsOpen(true);
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            const spaceBelow = window.innerHeight - rect.bottom - 8;
            const spaceAbove = rect.top - 8;
            const flip = spaceBelow < 320 && spaceAbove > spaceBelow;
            setDropUp(flip);
            setMaxListHeight(Math.max(160, Math.min(320, flip ? spaceAbove : spaceBelow)));
        }
    };

    const handleSelect = (val: string) => {
        onChange(val);
        setIsOpen(false);
        setQuery('');
    };

    const close = () => setIsOpen(false);

    useEscapeKey(isOpen, close);

    // Click outside closes without needing a fullscreen backdrop.
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    // Raccourci "/" (façon GitHub/Slack) : focus ce champ depuis n'importe
    // où sur la page. Ignoré si on est déjà en train de taper ailleurs (un
    // autre champ/textarea/select focus — couvre aussi le cas où une modale
    // avec un champ autoFocus est ouverte par-dessus) pour ne jamais voler
    // le "/" d'une saisie en cours.
    useEffect(() => {
        if (!focusShortcut) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== '/') return;
            const active = document.activeElement;
            const isTyping = active instanceof HTMLElement && (
                active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable
            );
            if (isTyping) return;
            e.preventDefault();
            inputRef.current?.focus();
            openDropdown();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusShortcut]);

    return (
        <div ref={containerRef} className="relative">
            <div className={emphasized
                ? "w-full flex items-center bg-white border border-primary/30 focus-within:border-primary text-primary font-mono px-5 py-3.5 rounded-xl transition-all shadow-md focus-within:shadow-glow gap-3"
                : "w-full flex items-center bg-white/80 border border-slate-300 focus-within:border-blue-500 text-blue-600 font-mono px-4 py-3 rounded-xl transition-all shadow-[inset_0_0_8px_rgba(37,99,235,0.1)] focus-within:shadow-[0_0_12px_rgba(37,99,235,0.2)] gap-3"
            }>
                {icon && <span className="opacity-70 text-blue-600 shrink-0">{icon}</span>}
                <input
                    ref={inputRef}
                    type="text"
                    value={isOpen ? query : (selectedOption?.label ?? '')}
                    onFocus={openDropdown}
                    onClick={openDropdown}
                    onChange={e => { setQuery(e.target.value); if (!isOpen) setIsOpen(true); }}
                    placeholder={placeholder}
                    className="flex-1 min-w-0 bg-transparent outline-none placeholder-slate-500 text-blue-600 font-bold"
                />
                {/* Indice de raccourci — visible seulement au repos (pas focus,
                    rien de sélectionné), disparaît dès qu'on interagit avec le champ. */}
                {focusShortcut && !isOpen && !selectedOption && (
                    <kbd className="shrink-0 px-1.5 py-0.5 rounded-md border border-slate-300 bg-slate-50 text-slate-400 text-xs font-mono font-bold">/</kbd>
                )}
                {selectedOption && !isOpen && (
                    <button
                        type="button"
                        onClick={() => handleSelect('')}
                        className="shrink-0 text-slate-400 hover:text-red-400 transition-colors"
                        aria-label="Effacer"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: dropUp ? 6 : -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: dropUp ? 6 : -6 }}
                        transition={{ duration: 0.15 }}
                        className={`absolute left-0 right-0 z-30 bg-white border border-blue-500/50 rounded-2xl shadow-[0_10px_40px_rgba(37,99,235,0.25)] overflow-hidden flex flex-col ${dropUp ? 'bottom-full mb-2' : 'top-full mt-2'}`}
                        style={{ maxHeight: maxListHeight }}
                    >
                        <div className="p-2 overflow-y-auto flex-1">
                            {filteredOptions.length === 0 ? (
                                <div className="p-6 text-center text-slate-500 italic text-sm">Aucun résultat trouvé</div>
                            ) : (
                                <div className="space-y-1">
                                    {filteredOptions.map(opt => {
                                        const isSelected = value === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                // onMouseDown (not onClick) fires before the input's onBlur-driven
                                                // outside-click close, so the pick registers instead of the list
                                                // vanishing first.
                                                onMouseDown={e => { e.preventDefault(); handleSelect(opt.value); }}
                                                className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all font-medium ${isSelected
                                                    ? 'bg-blue-600/20 border border-blue-500 text-blue-600'
                                                    : 'hover:bg-slate-50 text-slate-600 border border-transparent hover:border-slate-300 hover:text-blue-600'
                                                    }`}
                                            >
                                                <span className="truncate">{opt.label}</span>
                                                {isSelected && <Check size={16} className="text-blue-600 shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
