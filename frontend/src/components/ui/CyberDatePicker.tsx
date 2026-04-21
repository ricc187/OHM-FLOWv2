import React from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { fr } from 'date-fns/locale/fr';
import 'react-datepicker/dist/react-datepicker.css';
import { Calendar as CalendarIcon } from 'lucide-react';

// Use French locale
registerLocale('fr', fr);

interface CyberDatePickerProps {
    selected: Date | null;
    onChange: (date: Date | null) => void;
    placeholder?: string;
    minDate?: Date;
    maxDate?: Date;
}

export const CyberDatePicker: React.FC<CyberDatePickerProps> = ({ selected, onChange, placeholder = "Sélectionner...", minDate, maxDate }) => {
    return (
        <div className="relative w-full">
            <DatePicker
                selected={selected}
                onChange={onChange}
                locale="fr"
                dateFormat="dd/MM/yyyy"
                placeholderText={placeholder}
                minDate={minDate}
                maxDate={maxDate}
                wrapperClassName="w-full"
                className="w-full bg-white/80 border border-slate-300 focus:border-blue-500 text-blue-600 font-mono px-4 py-2 pl-10 rounded-lg transition-all focus:outline-none focus:ring-1 focus:ring-cyan-400/50 shadow-[inset_0_0_8px_rgba(34,211,238,0.1)] hover:shadow-[0_0_8px_rgba(34,211,238,0.2)]"
                calendarClassName="cyber-calendar"
                popperPlacement="bottom-start"
                portalId="root"
                showPopperArrow={false}
            />
            <CalendarIcon className="absolute left-3 top-2.5 text-blue-600 pointer-events-none" size={16} />
        </div>
    );
};
