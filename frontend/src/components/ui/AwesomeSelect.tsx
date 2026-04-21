import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search, X, Check } from 'lucide-react';

export interface AwesomeSelectOption {
    value: string;
    label: string | React.ReactNode;
    searchLabel?: string; // Optional raw string for search if label is a component
}

interface AwesomeSelectProps {
    value?: string;
    onChange: (val: string) => void;
    options: AwesomeSelectOption[];
    placeholder?: string;
    icon?: React.ReactNode;
}

export const AwesomeSelect: React.FC<AwesomeSelectProps> = ({ value, onChange, options, placeholder = "Sélectionner...", icon }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const selectedOption = options.find(o => o.value === value);
    
    const showSearch = options.length > 5;

    const filteredOptions = useMemo(() => {
        if (!searchQuery) return options;
        const q = searchQuery.toLowerCase();
        return options.filter(o => {
            const textToSearch = o.searchLabel || (typeof o.label === 'string' ? o.label : '');
            return textToSearch.toLowerCase().includes(q);
        });
    }, [options, searchQuery]);

    const handleSelect = (val: string) => {
        onChange(val);
        setIsOpen(false);
        setSearchQuery('');
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="w-full flex items-center bg-white/80 border border-slate-300 focus:border-blue-500 text-blue-600 font-mono px-4 py-3 rounded-xl transition-all shadow-[inset_0_0_8px_rgba(34,211,238,0.1)] hover:shadow-[0_0_12px_rgba(34,211,238,0.2)] justify-between"
            >
                <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap">
                    {icon && <span className="opacity-70 text-blue-600">{icon}</span>}
                    <span className={selectedOption ? "text-blue-600 font-bold" : "text-slate-500"}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                </div>
                <ChevronDown size={18} className="text-blue-600 shrink-0 ml-2" />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div 
                        initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
                        animate={{ opacity: 1, backdropFilter: "blur(8px)" }}
                        exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
                        className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/70 p-4"
                        onClick={() => setIsOpen(false)}
                    >
                        <motion.div 
                            initial={{ scale: 0.9, y: 20, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.9, y: 20, opacity: 0 }}
                            className="bg-white border border-blue-500/50 rounded-2xl shadow-[0_0_40px_rgba(34,211,238,0.3)] w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="bg-slate-100 p-4 border-b border-slate-200 flex items-center justify-between shrink-0 shadow-lg">
                                <h3 className="font-black text-slate-900 tracking-widest text-lg uppercase pl-2 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-blue-600 shadow-[0_0_10px_rgba(34,211,238,1)]"></span>
                                    {placeholder}
                                </h3>
                                <button type="button" onClick={() => setIsOpen(false)} className="p-2 bg-slate-50 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-full transition-colors">
                                    <X size={20} className="drop-shadow-glow" />
                                </button>
                            </div>

                            {/* Search bar */}
                            {showSearch && (
                                <div className="p-4 bg-white border-b border-slate-200 shrink-0">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-600" size={18} />
                                        <input 
                                            type="text"
                                            autoFocus
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            placeholder="Rechercher..."
                                            className="w-full bg-white/50 border border-slate-300 focus:border-blue-500 rounded-lg py-3 pr-4 pl-10 text-slate-900 placeholder-slate-500 outline-none transition-all shadow-inner"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Options List */}
                            <div className="p-2 overflow-y-auto custom-scrollbar flex-1">
                                {filteredOptions.length === 0 ? (
                                    <div className="p-8 text-center text-slate-500 italic">Aucun résultat trouvé</div>
                                ) : (
                                    <div className="space-y-1">
                                        {filteredOptions.map((opt) => {
                                            const isSelected = value === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    onClick={() => handleSelect(opt.value)}
                                                    className={`w-full text-left px-4 py-4 rounded-xl flex items-center justify-between transition-all font-medium ${
                                                        isSelected 
                                                        ? 'bg-blue-600/20 border border-blue-500 text-blue-600 shadow-[0_0_15px_rgba(34,211,238,0.2)]' 
                                                        : 'hover:bg-slate-50 text-slate-600 border border-transparent hover:border-slate-300 hover:text-blue-600'
                                                    }`}
                                                >
                                                    <span className="truncate">{opt.label}</span>
                                                    {isSelected && <Check size={18} className="text-blue-600 shrink-0 shadow-[0_0_10px_rgba(34,211,238,0.8)] rounded-full" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};
