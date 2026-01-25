import React, { useState, useEffect } from 'react';
import { Logo } from './Icons';

interface Props {
    onLogin: (pin: string) => void;
}

export const Login: React.FC<Props> = ({ onLogin }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');

    const handleKeyClick = (num: string) => {
        if (pin.length < 6) {
            setPin(prev => prev + num);
            setError('');
        }
    };

    const handleClear = () => {
        setPin('');
        setError('');
    };

    // Auto-submit when PIN is full (6 digits)
    useEffect(() => {
        if (pin.length === 6) {
            // Small delay for visual feedback
            const timer = setTimeout(() => {
                onLogin(pin);
                // We can optionally clear pin here if login fails in parent, 
                // but since we don't know the result immediately, we leave it.
                // Parent might reset it or mount a new component.
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [pin, onLogin]);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-ohm-bg">
            <div className="w-full max-w-md flex flex-col items-center">
                <div className="mb-12 scale-125">
                    <Logo />
                </div>

                <h2 className="text-ohm-text-main text-lg font-bold mb-2 uppercase tracking-widest">Saisir PIN</h2>
                <p className="text-ohm-text-muted text-xs mb-8">Accès sécurisé collaborateur</p>

                {/* PIN Display (6 digits) */}
                <div className="flex gap-2 mb-10">
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <div
                            key={idx}
                            className={`w-10 h-14 rounded-xl border-2 flex items-center justify-center transition-all duration-300 ${pin.length > idx
                                    ? 'bg-ohm-primary border-ohm-primary shadow-[0_0_15px_rgba(250,204,21,0.3)]'
                                    : 'bg-slate-900 border-slate-700'
                                }`}
                        >
                            {pin.length > idx && <div className="w-3 h-3 bg-ohm-bg rounded-full animate-in zoom-in" />}
                        </div>
                    ))}
                </div>

                {error && <p className="text-red-400 text-sm font-bold mb-6 animate-bounce">{error}</p>}

                {/* Numpad */}
                <div className="grid grid-cols-3 gap-4 w-full px-8">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                        <button
                            key={num}
                            onClick={() => handleKeyClick(num.toString())}
                            className="aspect-square bg-ohm-surface border border-slate-800 rounded-2xl text-2xl font-black text-ohm-text-main hover:bg-slate-700 active:scale-95 active:bg-ohm-primary active:text-ohm-bg transition-all shadow-lg"
                        >
                            {num}
                        </button>
                    ))}
                    <div />
                    <button
                        onClick={() => handleKeyClick('0')}
                        className="aspect-square bg-ohm-surface border border-slate-800 rounded-2xl text-2xl font-black text-ohm-text-main hover:bg-slate-700 active:scale-95 active:bg-ohm-primary active:text-ohm-bg transition-all shadow-lg"
                    >
                        0
                    </button>
                    <button
                        onClick={handleClear}
                        className="aspect-square flex items-center justify-center bg-slate-800 border border-slate-700 rounded-2xl text-red-400 hover:bg-slate-700 active:scale-95 transition-all shadow-lg"
                    >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                        </svg>
                    </button>
                </div>

                <div className="mt-12 text-[10px] text-ohm-text-muted text-center uppercase tracking-widest leading-relaxed opacity-50">
                    Patron: 000000 | Thomas: 123456
                </div>
            </div>
        </div>
    );
};
