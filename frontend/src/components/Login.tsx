import React, { useState, useEffect } from 'react';
import { Logo } from './Icons';

interface Props {
    onLogin: (pin: string) => Promise<boolean>;
}

export const Login: React.FC<Props> = ({ onLogin }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [displayedError, setDisplayedError] = useState('');
    const [checking, setChecking] = useState(false);
    const [shake, setShake] = useState(false);

    useEffect(() => {
        if (error) setDisplayedError(error);
    }, [error]);

    const handleKeyClick = (num: string) => {
        if (pin.length < 6 && !checking) {
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
            const timer = setTimeout(async () => {
                setChecking(true);
                const success = await onLogin(pin);
                if (!success) {
                    setError('PIN incorrect');
                    setPin(''); // wipe it — no need to make them clear it by hand
                    setShake(true);
                    setTimeout(() => setShake(false), 400);
                }
                setChecking(false);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [pin, onLogin]);

    return (
        <div className="h-[100dvh] flex flex-col items-center justify-center p-4 bg-ohm-bg safe-top safe-bottom safe-left safe-right overflow-y-auto">
            <div className="w-full flex flex-col items-center my-auto py-2">
                <div className="mb-4 sm:mb-6">
                    <Logo />
                </div>

                <h2 className="text-slate-900 text-lg font-bold mb-1 uppercase tracking-widest">Saisir PIN</h2>
                <p className="text-slate-500 text-xs mb-4 sm:mb-6">Accès sécurisé collaborateur</p>

                {/* PIN Display (6 digits) — transitions-dev "12-error-state-shake" */}
                <div className={`t-input-wrap ${error ? 'is-error' : ''} flex flex-col items-center`}>
                    <div className={`t-input flex gap-2 mb-1 ${shake ? 'is-shaking' : ''}`}>
                        {[0, 1, 2, 3, 4, 5].map((idx) => (
                            <div
                                key={idx}
                                className={`w-9 h-12 rounded-xl border-2 flex items-center justify-center transition-all duration-300 ${pin.length > idx
                                        ? 'bg-ohm-primary border-ohm-primary shadow-[0_0_15px_rgba(250,204,21,0.3)]'
                                        : 'bg-white border-slate-300'
                                    }`}
                            >
                                {pin.length > idx && <div className="w-3 h-3 bg-ohm-bg rounded-full animate-in zoom-in" />}
                            </div>
                        ))}
                    </div>
                    <p className="t-error-msg text-red-500 text-sm font-bold mb-3">{displayedError}</p>
                </div>

                {/* Numpad — fixed button size so it stays compact on any screen height */}
                <div className="grid grid-cols-3 gap-3 w-fit mx-auto">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                        <button
                            key={num}
                            onClick={() => handleKeyClick(num.toString())}
                            className="w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] flex items-center justify-center bg-ohm-surface border border-slate-200 rounded-2xl text-2xl font-black text-slate-900 hover:bg-slate-100 active:scale-95 active:bg-ohm-primary active:text-ohm-bg transition-all shadow-lg"
                        >
                            {num}
                        </button>
                    ))}
                    <div />
                    <button
                        onClick={() => handleKeyClick('0')}
                        className="w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] flex items-center justify-center bg-ohm-surface border border-slate-200 rounded-2xl text-2xl font-black text-slate-900 hover:bg-slate-100 active:scale-95 active:bg-ohm-primary active:text-ohm-bg transition-all shadow-lg"
                    >
                        0
                    </button>
                    <button
                        onClick={handleClear}
                        className="w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] flex items-center justify-center bg-slate-50 border border-slate-300 rounded-2xl text-red-400 hover:bg-slate-100 active:scale-95 transition-all shadow-lg"
                    >
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};
