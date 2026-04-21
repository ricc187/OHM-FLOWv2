import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface AwesomeDatePickerProps {
    value: string;
    onChange: (val: string) => void;
    minDate?: string;
    maxDate?: string;
    placeholder?: string;
}

const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

const toLocalStr = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

export const AwesomeDatePicker: React.FC<AwesomeDatePickerProps> = ({ value, onChange, minDate, maxDate, placeholder = "Sélectionner une date" }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    const parseLocal = (dateStr: string) => {
        if (!dateStr) return new Date();
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    };
    
    const [viewDate, setViewDate] = useState(() => parseLocal(value));

    const handleOpen = () => {
        setViewDate(parseLocal(value));
        setIsOpen(true);
    };

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const minD = minDate ? parseLocal(minDate) : null;
    const maxD = maxDate ? parseLocal(maxDate) : null;
    if (minD) minD.setHours(0,0,0,0);
    if (maxD) maxD.setHours(0,0,0,0);

    const prevMonth = (e: React.MouseEvent) => { e.stopPropagation(); setViewDate(new Date(year, month - 1, 1)); };
    const nextMonth = (e: React.MouseEvent) => { e.stopPropagation(); setViewDate(new Date(year, month + 1, 1)); };

    const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

    // Render 42 days grid
    const renderGrid = () => {
        const daysInMonth = getDaysInMonth(year, month);
        const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun, 1=Mon
        const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
        
        const days = [];
        
        // Previous month days
        const prevMonthDays = getDaysInMonth(year, month - 1);
        for (let i = 0; i < startOffset; i++) {
            const d = prevMonthDays - startOffset + i + 1;
            days.push(
                <div key={`prev-${i}`} className="p-2 text-center text-slate-700 font-mono text-sm line-through opacity-50">
                    {d}
                </div>
            );
        }

        const todayLocalStr = toLocalStr(new Date());

        for (let d = 1; d <= daysInMonth; d++) {
            const cellDate = new Date(year, month, d);
            const cellStr = toLocalStr(cellDate);
            cellDate.setHours(0,0,0,0);
            
            let disabled = false;
            if (minD && cellDate.getTime() < minD.getTime()) disabled = true;
            if (maxD && cellDate.getTime() > maxD.getTime()) disabled = true;

            const isSelected = value === cellStr;
            const isToday = todayLocalStr === cellStr;

            let className = "p-2 text-center font-mono text-sm rounded-lg transition-all border-2 cursor-pointer ";
            if (disabled) {
                className += "text-slate-600 border-transparent cursor-not-allowed opacity-50";
            } else if (isSelected) {
                className += "bg-blue-600 text-black border-blue-500 shadow-[0_0_15px_rgba(34,211,238,0.5)] font-black transform scale-110";
            } else {
                className += "text-slate-600 border-transparent hover:border-blue-500 hover:text-blue-600 hover:bg-slate-50";
            }

            if (isToday && !isSelected) {
                className += " underline decoration-cyan-500 underline-offset-4 decoration-2";
            }

            days.push(
                <button 
                    type="button"
                    key={d} 
                    disabled={disabled}
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        if(!disabled) { onChange(cellStr); setIsOpen(false); } 
                    }}
                    className={className}
                >
                    {d}
                </button>
            );
        }

        const totalItems = startOffset + daysInMonth;
        const trailingDays = 42 - totalItems;
        for (let i = 1; i <= trailingDays; i++) {
            days.push(
                <div key={`next-${i}`} className="p-2 text-center text-slate-700 font-mono text-sm line-through opacity-50">
                    {i}
                </div>
            );
        }

        return days;
    };

    // Format value for display
    let displayValue = placeholder;
    if (value) {
        const d = parseLocal(value);
        displayValue = `${String(d.getDate()).padStart(2, '0')} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    }

    return (
        <>
            <button
                type="button"
                onClick={handleOpen}
                className="w-full flex items-center bg-white/80 border border-slate-300 focus:border-blue-500 text-blue-600 font-mono px-4 py-2 rounded-lg transition-all shadow-[inset_0_0_8px_rgba(34,211,238,0.1)] hover:shadow-[0_0_8px_rgba(34,211,238,0.2)] justify-between"
            >
                <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                    <Calendar size={16} className="text-blue-600 shrink-0" />
                    <span className={value ? "text-blue-600" : "text-slate-500"}>{displayValue}</span>
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div 
                        initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
                        animate={{ opacity: 1, backdropFilter: "blur(8px)" }}
                        exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
                        className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/60 p-4"
                        onClick={() => setIsOpen(false)}
                    >
                        <motion.div 
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            className="bg-white border border-blue-500/50 rounded-2xl shadow-[0_0_30px_rgba(34,211,238,0.3)] w-full max-w-sm overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="bg-slate-50 p-4 border-b border-slate-300 flex items-center justify-between">
                                <button type="button" onClick={prevMonth} className="p-2 bg-slate-100 hover:bg-blue-600/20 hover:text-blue-600 rounded-full transition-colors"><ChevronLeft size={20} /></button>
                                <div className="font-bold text-center">
                                    <div className="text-blue-600 uppercase tracking-widest text-lg">{monthNames[month]}</div>
                                    <div className="text-sm text-slate-400 font-mono">{year}</div>
                                </div>
                                <button type="button" onClick={nextMonth} className="p-2 bg-slate-100 hover:bg-blue-600/20 hover:text-blue-600 rounded-full transition-colors"><ChevronRight size={20} /></button>
                            </div>

                            {/* Days Header */}
                            <div className="grid grid-cols-7 bg-slate-100 p-2 border-b border-slate-200 gap-1">
                                {['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'].map(d => (
                                    <div key={d} className="text-center text-xs font-bold text-slate-500">{d}</div>
                                ))}
                            </div>

                            {/* Calendar Grid */}
                            <div className="grid grid-cols-7 p-2 gap-1 bg-white">
                                {renderGrid()}
                            </div>

                            {/* Footer */}
                            <div className="p-2 bg-slate-100 border-t border-slate-200 flex justify-between">
                                <button 
                                    type="button" 
                                    onClick={() => { onChange(toLocalStr(new Date())); setIsOpen(false); }} 
                                    className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-blue-600 hover:bg-blue-600/10 rounded transition-colors"
                                >
                                    Aujourd'hui
                                </button>
                                <button 
                                    type="button" 
                                    onClick={() => setIsOpen(false)} 
                                    className="p-2 text-slate-500 hover:text-slate-900 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};
