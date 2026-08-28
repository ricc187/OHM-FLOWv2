import React, { useState } from 'react';
import { Logo, OhmIcon } from './Icons';
import { MfaEnrollFlow } from './MfaEnrollFlow';
import { LoginResult, User } from '../types';
import { api } from '../api';
import { Zap } from 'lucide-react';

interface Props {
    onLoginSuccess: (user: User) => void;
}

// Split-screen left panel — purely visual, no logic. Hidden below 1024px
// (the form alone carries the page on mobile/tablet).
const LoginVisual: React.FC = () => (
    <div className="hidden lg:flex relative flex-col justify-between overflow-hidden bg-ohm-bg p-12 text-white">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-ohm-primary/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] bg-blue-500/10 rounded-full blur-[120px]" />

        <div className="relative flex items-center gap-3">
            <div className="bg-white/5 p-2 rounded-xl border border-white/10">
                <OhmIcon className="w-8 h-8 text-ohm-primary" />
            </div>
            <span className="text-2xl font-extrabold tracking-tighter">
                OHM<span className="text-ohm-primary">FLOW</span>
            </span>
        </div>

        <div className="relative max-w-md">
            <Zap className="text-ohm-primary mb-4" size={28} />
            <p className="text-xl font-medium leading-relaxed text-white/90">
                Suivi des chantiers, des heures et des finances — un accès sécurisé
                par collaborateur, une double vérification pour l'administration.
            </p>
            <div className="mt-6 text-sm text-white/40">Application interne — OHM Flow</div>
        </div>
    </div>
);

// Step 2: 6-digit TOTP code (or a one-time backup code as fallback).
const MfaCodeStep: React.FC<{ mfaToken: string; onDone: (user: User) => void }> = ({ mfaToken, onDone }) => {
    const [code, setCode] = useState('');
    const [backupCode, setBackupCode] = useState('');
    const [useBackup, setUseBackup] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            const path = useBackup ? '/api/mfa/verify-backup' : '/api/mfa/verify';
            const body = useBackup ? { mfa_token: mfaToken, backup_code: backupCode } : { mfa_token: mfaToken, code };
            const res = await api.post(path, body);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Code invalide');
            onDone(data as User);
        } catch (err: any) {
            setError(err.message || 'Erreur réseau');
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} className="card w-full max-w-sm space-y-5">
            <div>
                <h1 className="text-2xl font-black text-slate-900">Vérification en deux étapes</h1>
                <p className="text-slate-500 text-sm mt-1">Code de votre application d'authentification</p>
            </div>

            {!useBackup ? (
                <label className="block">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Code à 6 chiffres</span>
                    <div className={`t-input-wrap ${error ? 'is-error' : ''}`}>
                        <input
                            className={`t-input input-field text-center text-2xl font-black tracking-[0.4em] ${error ? 'is-shaking' : ''}`}
                            type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoFocus required
                            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                        />
                        <p className="t-error-msg text-red-500 text-sm font-bold mt-1">{error}</p>
                    </div>
                </label>
            ) : (
                <label className="block">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Code de récupération (usage unique)</span>
                    <div className={`t-input-wrap ${error ? 'is-error' : ''}`}>
                        <input
                            className={`t-input input-field text-center font-mono ${error ? 'is-shaking' : ''}`}
                            type="text" autoFocus required
                            value={backupCode} onChange={e => setBackupCode(e.target.value.trim())}
                        />
                        <p className="t-error-msg text-red-500 text-sm font-bold mt-1">{error}</p>
                    </div>
                </label>
            )}

            <button type="submit" disabled={busy} className="w-full py-3.5 bg-ohm-primary text-ohm-bg font-black rounded-xl hover:bg-yellow-300 transition-all uppercase tracking-widest disabled:opacity-50">
                {busy ? 'Vérification…' : 'Valider'}
            </button>

            <button
                type="button"
                onClick={() => { setUseBackup(v => !v); setError(''); }}
                className="w-full text-center text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
            >
                {useBackup ? "Utiliser le code de l'application" : 'Utiliser un code de récupération'}
            </button>
        </form>
    );
};

export const Login: React.FC<Props> = ({ onLoginSuccess }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [step, setStep] = useState<'password' | 'mfa_code' | 'mfa_enroll'>('password');
    const [mfaToken, setMfaToken] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            const res = await api.post('/api/login', { username, password });
            const data: LoginResult = await res.json();
            if (!res.ok) throw new Error((data as any).error || 'Erreur de connexion');

            if (data.status === 'ok') { onLoginSuccess(data); return; }
            if (data.status === 'mfa_required') { setMfaToken(data.mfa_token); setStep('mfa_code'); return; }
            if (data.status === 'mfa_enroll_required') { setMfaToken(data.mfa_token); setStep('mfa_enroll'); return; }
        } catch (err: any) {
            setError(err.message || 'Erreur réseau');
            setBusy(false);
        }
    };

    if (step === 'mfa_code') {
        return (
            <div className="h-[100dvh] grid lg:grid-cols-2 safe-top safe-bottom safe-left safe-right">
                <LoginVisual />
                <div className="flex items-center justify-center p-4 bg-ohm-bg overflow-y-auto">
                    <MfaCodeStep mfaToken={mfaToken} onDone={onLoginSuccess} />
                </div>
            </div>
        );
    }

    if (step === 'mfa_enroll') {
        return (
            <div className="h-[100dvh] grid lg:grid-cols-2 safe-top safe-bottom safe-left safe-right">
                <LoginVisual />
                <div className="flex items-center justify-center p-4 bg-ohm-bg overflow-y-auto">
                    <div className="w-full max-w-sm">
                        <p className="text-slate-400 text-sm text-center mb-4">
                            La double authentification est obligatoire sur ce compte — dernière étape avant de continuer.
                        </p>
                        <MfaEnrollFlow mfaToken={mfaToken} onComplete={onLoginSuccess} />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-[100dvh] grid lg:grid-cols-2 safe-top safe-bottom safe-left safe-right">
            <LoginVisual />
            <div className="flex flex-col items-center justify-center p-4 bg-ohm-bg overflow-y-auto">
                <div className="lg:hidden mb-6"><Logo /></div>
                <form onSubmit={submit} className="card w-full max-w-sm space-y-5">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900">Connexion</h1>
                        <p className="text-slate-500 text-sm mt-1">Accès sécurisé collaborateur</p>
                    </div>

                    <label className="block">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Nom d'utilisateur</span>
                        <input
                            type="text" autoFocus required autoComplete="username"
                            className="input-field"
                            value={username} onChange={e => setUsername(e.target.value)}
                        />
                    </label>

                    <label className="block">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Mot de passe</span>
                        <div className={`t-input-wrap ${error ? 'is-error' : ''}`}>
                            <input
                                type="password" required autoComplete="current-password"
                                className={`t-input input-field ${error ? 'is-shaking' : ''}`}
                                value={password} onChange={e => setPassword(e.target.value)}
                            />
                            <p className="t-error-msg text-red-500 text-sm font-bold mt-1">{error}</p>
                        </div>
                    </label>

                    <button type="submit" disabled={busy} className="w-full py-3.5 bg-ohm-primary text-ohm-bg font-black rounded-xl hover:bg-yellow-300 transition-all uppercase tracking-widest disabled:opacity-50">
                        {busy ? 'Connexion…' : 'Se connecter'}
                    </button>
                </form>
            </div>
        </div>
    );
};
