import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Check, Loader2 } from 'lucide-react';
import { User } from '../types';
import { api } from '../api';

interface Props {
    // Mid-login mandatory enrollment: identifies the user via this short-lived
    // ticket (no session exists yet). Omit for voluntary re-enrollment from an
    // already-logged-in admin's own account settings — the request then relies
    // on the session cookie instead.
    mfaToken?: string;
    onComplete: (user: User) => void;
}

// Reusable in both contexts above. Flow: start (fetch QR + manual key) ->
// scan (user enters the 6-digit code from their app) -> confirm (shows the
// one-time backup codes, requires explicit acknowledgement before finishing —
// they are never shown again after this).
export const MfaEnrollFlow: React.FC<Props> = ({ mfaToken, onComplete }) => {
    const [stage, setStage] = useState<'loading' | 'scan' | 'backup_codes' | 'error'>('loading');
    const [qr, setQr] = useState('');
    const [manualKey, setManualKey] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [backupCodes, setBackupCodes] = useState<string[]>([]);
    const [pendingUser, setPendingUser] = useState<any>(null);
    const startedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return; // guards against StrictMode's double-invoke in dev
        startedRef.current = true;
        (async () => {
            try {
                const res = await api.post('/api/mfa/enroll/start', mfaToken ? { mfa_token: mfaToken } : {});
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Erreur lors de l\'enrôlement');
                setQr(data.qr_code_data_uri);
                setManualKey(data.manual_entry_key);
                setStage('scan');
            } catch (err: any) {
                setError(err.message || 'Erreur réseau');
                setStage('error');
            }
        })();
    }, [mfaToken]);

    const submitCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            const res = await api.post('/api/mfa/enroll/confirm', mfaToken ? { mfa_token: mfaToken, code } : { code });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Code invalide');
            setBackupCodes(data.backup_codes || []);
            setPendingUser(data);
            setStage('backup_codes');
        } catch (err: any) {
            setError(err.message || 'Erreur réseau');
        } finally {
            setBusy(false);
        }
    };

    if (stage === 'loading') {
        return (
            <div className="card w-full flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-ohm-primary" size={28} />
            </div>
        );
    }

    if (stage === 'error') {
        return (
            <div className="card w-full text-center space-y-3 py-8">
                <p className="text-red-500 font-bold">{error}</p>
                <p className="text-slate-400 text-sm">Reconnectez-vous pour réessayer.</p>
            </div>
        );
    }

    if (stage === 'backup_codes') {
        return (
            <div className="card w-full space-y-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
                        <Check className="text-green-600" size={22} strokeWidth={3} />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-900">2FA activée</h2>
                        <p className="text-slate-500 text-xs">Conservez ces codes de récupération en lieu sûr</p>
                    </div>
                </div>
                <p className="text-slate-500 text-sm">
                    Si vous perdez l'accès à votre application d'authentification, chacun de ces 10 codes
                    permet de vous reconnecter une seule fois. Ils ne seront plus jamais affichés.
                </p>
                <pre className="bg-slate-50 border border-slate-200 rounded-xl p-4 font-mono text-sm text-slate-900 grid grid-cols-2 gap-2 whitespace-pre-wrap">
                    {backupCodes.map(c => <span key={c}>{c}</span>)}
                </pre>
                <button
                    onClick={() => onComplete(pendingUser)}
                    className="w-full py-3.5 bg-ohm-primary text-ohm-bg font-black rounded-xl hover:bg-yellow-300 transition-all uppercase tracking-widest"
                >
                    J'ai sauvegardé mes codes
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={submitCode} className="card w-full space-y-5">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ohm-primary/15 flex items-center justify-center shrink-0">
                    <ShieldCheck className="text-ohm-primary" size={22} />
                </div>
                <div>
                    <h2 className="text-lg font-black text-slate-900">Activer la 2FA</h2>
                    <p className="text-slate-500 text-xs">Scannez avec Google Authenticator, Authy, etc.</p>
                </div>
            </div>

            {qr && (
                <div className="flex justify-center bg-white p-3 rounded-xl border border-slate-200">
                    <img src={qr} alt="QR code d'enrôlement 2FA" className="w-44 h-44" />
                </div>
            )}

            <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Ou saisissez la clé manuellement</div>
                <div className="font-mono text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 break-all">{manualKey}</div>
            </div>

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

            <button type="submit" disabled={busy} className="w-full py-3.5 bg-ohm-primary text-ohm-bg font-black rounded-xl hover:bg-yellow-300 transition-all uppercase tracking-widest disabled:opacity-50">
                {busy ? 'Vérification…' : 'Activer'}
            </button>
        </form>
    );
};
