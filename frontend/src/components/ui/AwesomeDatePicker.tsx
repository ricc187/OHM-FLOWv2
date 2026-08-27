import React from 'react';
import { Calendar } from 'lucide-react';

interface AwesomeDatePickerProps {
    value: string;
    onChange: (val: string) => void;
    minDate?: string;
    maxDate?: string;
    placeholder?: string;
}

// Wraps the browser's native date input so mobile users get their OS's
// native picker (iOS wheel, Android calendar) instead of a custom widget
// fighting the system keyboard/UI.
export const AwesomeDatePicker: React.FC<AwesomeDatePickerProps> = ({ value, onChange, minDate, maxDate, placeholder = "Sélectionner une date" }) => {
    return (
        // iOS Safari ignores `width: 100%` on native date inputs — it sizes them
        // to their own locale-dependent content instead, overflowing any
        // container. `width: 0` + `min-width: 100%` is the standard workaround:
        // it forces the box back to the container's width regardless of content.
        <div className="relative w-full min-w-0">
            <Calendar size={16} className="text-blue-600 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
                type="date"
                value={value || ''}
                min={minDate}
                max={maxDate}
                onChange={(e) => onChange(e.target.value)}
                aria-label={placeholder}
                className={`block w-0 min-w-full box-border bg-white/80 border border-slate-300 focus:border-blue-500 font-mono pl-10 pr-4 py-2 rounded-lg transition-all outline-none [color-scheme:light] ${value ? 'text-blue-600' : 'text-slate-500'}`}
            />
        </div>
    );
};
