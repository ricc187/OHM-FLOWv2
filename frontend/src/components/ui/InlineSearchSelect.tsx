import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export interface InlineSearchSelectOption {
    value: string;
    label: string;
}

interface InlineSearchSelectProps {
    value?: string;
    onChange: (val: string) => void;
    options: InlineSearchSelectOption[];
    placeholder?: string;
    icon?: React.ReactNode;
}

// Search bar that IS the input — click it and type right away, dropdown
// opens anchored underneath (already showing the full list), no fullscreen
// popup like AwesomeSelect. Kept separate from AwesomeSelect on purpose:
// AwesomeSelect's modal pattern is used as a generic form select in 6 other
// places and shouldn't change behavior there.
export const InlineSearchSelect: React.FC<InlineSearchSelectProps> = ({ value, onChange, options, placeholder = 'Rechercher...', icon }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(o => o.value === value);

    const filteredOptions = useMemo(() => {
        if (!query) return options;
        const q = query.toLowerCase();
        return options.filter(o => o.label.toLowerCase().includes(q));
    }, [options, query]);

    const openDropdown = () => {
        setQuery('');
        setIsOpen(true);
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

    return (
        <div ref={containerRef} className="relative">
            <div className="w-full flex items-center bg-white/80 border border-slate-300 focus-within:border-blue-500 text-blue-600 font-mono px-4 py-3 rounded-xl transition-all shadow-[inset_0_0_8px_rgba(37,99,235,0.1)] focus-within:shadow-[0_0_12px_rgba(37,99,235,0.2)] gap-3">
                {icon && <span className="opacity-70 text-blue-600 shrink-0">{icon}</span>}
                <input
                    type="text"
                    value={isOpen ? query : (selectedOption?.label ?? '')}
                    onFocus={openDropdown}
                    onClick={openDropdown}
                    onChange={e => { setQuery(e.target.value); if (!isOpen) setIsOpen(true); }}
                    placeholder={placeholder}
                    className="flex-1 min-w-0 bg-transparent outline-none placeholder-slate-500 text-blue-600 font-bold"
                />
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
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 right-0 mt-2 z-30 bg-white border border-blue-500/50 rounded-2xl shadow-[0_10px_40px_rgba(37,99,235,0.25)] overflow-hidden flex flex-col max-h-80"
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
