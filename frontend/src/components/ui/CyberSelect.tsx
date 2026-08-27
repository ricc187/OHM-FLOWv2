import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

interface Option {
    value: string;
    label: string;
}

interface CyberSelectProps {
    value: string;
    options: Option[];
    onChange: (val: string) => void;
    placeholder?: string;
}

export const CyberSelect: React.FC<CyberSelectProps> = ({ value, options, onChange, placeholder = "Sélectionner..." }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(o => o.value === value);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative w-full text-sm font-mono" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between bg-white/80 border border-slate-300 hover:border-yellow-400 text-slate-600 px-4 py-2 rounded-lg transition-all focus:outline-none focus:ring-1 focus:ring-yellow-400 shadow-inner"
            >
                <span className={selectedOption ? 'text-slate-900' : 'text-slate-400'}>
                    {selectedOption?.label || placeholder}
                </span>
                <ChevronDown className={`text-blue-600 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} size={16} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -10, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="absolute z-50 w-full mt-2 bg-slate-50 border border-slate-300 rounded-xl shadow-[0_0_15px_rgba(250,204,21,0.2)] overflow-hidden"
                    >
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => { onChange(option.value); setIsOpen(false); }}
                                className={`w-full text-left px-4 py-3 hover:bg-slate-100 transition-colors border-l-2 ${value === option.value ? 'bg-slate-100/80 border-yellow-400 text-blue-600 font-bold' : 'border-transparent text-slate-600'}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
