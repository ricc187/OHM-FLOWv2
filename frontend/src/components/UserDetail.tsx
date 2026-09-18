import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, ShieldCheck, ShieldAlert, Briefcase, CalendarOff, Folder, Pencil, Lock, LogOut, Trash2, Copy, Check } from 'lucide-react';
import { User, UserDetailPayload } from '../types';
import { api } from '../api';
import { StatTile } from './statsUi';
import { LEAVE_TYPE_LABELS } from '../leaveTypes';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from './ConfirmDialog';
import { useMountTransition } from '../hooks/useMountTransition';
import { UserFormModal } from './UserFormModal';

interface Props {
    userId: number;
    currentUser: User;
    onBack: () => void;
    // Appelé après une suppression réussie — le parent (AdminUsers) revient
    // à la liste et la rafraîchit ; cette fiche n'a plus de raison d'exister.
    onDeleted: () => void;
}

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', depanneur: 'Dépanneur', vehicule: 'Garagiste', user: 'Employé' };

const LEAVE_STATUS_META: Record<string, { label: string; className: string }> = {
    APPROVED: { label: 'Approuvé', className: 'bg-green-500/10 text-green-600' },
    PENDING: { label: 'En attente', className: 'bg-ohm-primary/15 text-ohm-primary' },
    REJECTED: { label: 'Refusé', className: 'bg-red-500/10 text-red-500' },
};

const formatHeures = (v: number) => v.toLocaleString('fr-CH', { maximumFractionDigits: 2 });

// Fiche détail utilisateur (Gestion Utilisateurs) — centralise ce qui était
// éparpillé : solde vacances, charge de travail (chantiers en cours),
// heures totales, historique des absences, ET les actions admin (reset mdp,
// modifier, force-logout, supprimer — voir prompt "centralisation"). Seul
// le reset 2FA reste sur la liste (AdminUsers.tsx), hors scope de cette
// fiche. Un seul appel agrégé pour les données, voir
// GET /api/users/<id>/detail (app.py).
export const UserDetail: React.FC<Props> = ({ userId, currentUser, onBack, onDeleted }) => {
    const { confirm, confirmDialogProps } = useConfirm();
    const [data, setData] = useState<UserDetailPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [showEditModal, setShowEditModal] = useState(false);

    // Résultat du reset mot de passe — affiché une seule fois, jamais
    // re-consultable après fermeture (même mécanisme must_change_password
    // que l'onboarding classique : l'utilisateur devra le changer au
    // prochain login). Même comportement que l'ancien AdminUsers.tsx.
    const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
    const revealModalT = useMountTransition(!!revealedPassword, 150);
    const [copied, setCopied] = useState(false);

    // Échec de suppression (ex: heures/absences/chantiers encore liés à ce
    // compte) — affiché sur la fiche, pas dans une alert() générique.
    const [deleteError, setDeleteError] = useState('');

    const fetchDetail = () => {
        setLoading(true);
        setError('');
        api.get(`/api/users/${userId}/detail`).then(async res => {
            if (res.ok) setData(await res.json());
            else { const d = await res.json().catch(() => ({})); setError(d.error || 'Erreur lors du chargement'); }
        }).finally(() => setLoading(false));
    };

    useEffect(() => { fetchDetail(); }, [userId]);

    const isSelf = data?.user.id === currentUser.id;

    const handleResetPassword = async () => {
        if (!data) return;
        // Pas destructeur, l'admin voit tout de suite le nouveau mot de
        // passe et peut le communiquer — pas besoin de la friction "strict"
        // (même exception qu'auparavant, voir l'ancien AdminUsers.tsx).
        if (!window.confirm(`Réinitialiser le mot de passe de ${data.user.username} ? Un nouveau mot de passe temporaire sera généré, l'ancien cessera immédiatement de fonctionner.`)) return;
        const res = await api.post(`/api/users/${userId}/reset-password`);
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { alert(d.error || 'Erreur'); return; }
        setCopied(false);
        setRevealedPassword(d.password);
        fetchDetail();
    };

    const handleForceLogout = async () => {
        if (!data || isSelf) return;
        if (!window.confirm(`Déconnecter ${data.user.username} de partout ? Sa session en cours sera immédiatement invalidée.`)) return;
        const res = await api.post(`/api/users/${userId}/force-logout`);
        if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Erreur'); }
    };

    const handleDelete = async () => {
        if (!data) return;
        setDeleteError('');
        // Strict (taper le nom) : suppression définitive — même composant
        // réutilisable que PotAChantier.tsx (useConfirm/ConfirmDialog),
        // même tier "strict" que dans l'ancien AdminUsers.tsx.
        const ok = await confirm({
            title: 'Supprimer cet utilisateur ?',
            message: `Le compte « ${data.user.username} » sera définitivement supprimé.`,
            strict: true,
            confirmText: data.user.username,
        });
        if (!ok) return;
        const res = await api.delete(`/api/users/${userId}`);
        if (res.ok) { onDeleted(); return; }
        // Le dialog de confirmation est déjà fermé à ce stade (useConfirm
        // résout dès le clic) — l'erreur backend (ex: heures/absences/
        // chantiers encore liés à ce compte) s'affiche donc sur la fiche
        // elle-même, pas dans une alert() générique qui masquerait le détail.
        const d = await res.json().catch(() => ({}));
        setDeleteError(d.error || 'Erreur lors de la suppression');
    };

    return (
        <div className="animate-fade-in relative pb-40">
            <div className="pt-4 pb-4 mb-6 -mx-4 px-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-4 w-full">
                        <button onClick={onBack} className="p-2 rounded-lg bg-surface border border-slate-300 hover:border-ohm-primary text-slate-500 hover:text-slate-900 transition-all shrink-0">
                            <ArrowLeft size={20} />
                        </button>
                        <div className="flex-1 min-w-0">
                            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 uppercase tracking-tight truncate">
                                {data?.user.username ?? '…'}
                            </h1>
                            {data && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 font-mono mt-1">
                                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">{ROLE_LABELS[data.user.role] ?? data.user.role}</span>
                                    {data.user.mfa_required && (
                                        data.user.mfa_enabled
                                            ? <span className="flex items-center gap-1 text-xs font-bold text-green-600"><ShieldCheck size={14} /> 2FA activée</span>
                                            : <span className="flex items-center gap-1 text-xs font-bold text-amber-600"><ShieldAlert size={14} /> 2FA requise, pas configurée</span>
                                    )}
                                    {data.user.must_change_password && (
                                        <span className="text-[10px] text-amber-600 font-bold uppercase">Mot de passe temporaire</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Actions centralisées — plus éparpillées sur la liste (voir prompt) */}
                    {data && (
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setShowEditModal(true)}
                                className="p-2 rounded-lg bg-surface border border-slate-300 text-slate-500 hover:text-ohm-primary hover:border-ohm-primary transition-all"
                                title="Modifier"
                            >
                                <Pencil size={18} />
                            </button>
                            <button
                                onClick={handleResetPassword}
                                className="p-2 rounded-lg bg-surface border border-slate-300 text-slate-500 hover:text-ohm-primary hover:border-ohm-primary transition-all"
                                title="Réinitialiser le mot de passe"
                            >
                                <Lock size={18} />
                            </button>
                            {!isSelf && (
                                <button
                                    onClick={handleForceLogout}
                                    className="p-2 rounded-lg bg-surface border border-slate-300 text-slate-500 hover:text-red-500 hover:border-red-300 transition-all"
                                    title="Déconnecter de partout"
                                >
                                    <LogOut size={18} />
                                </button>
                            )}
                            <button
                                onClick={handleDelete}
                                className="p-2 rounded-lg bg-surface border border-slate-300 text-red-400 hover:bg-red-500/10 hover:border-red-300 transition-all"
                                title="Supprimer"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {deleteError && (
                <div className="mb-6 card border-l-4 border-l-red-500 bg-red-50/50 flex items-start gap-3">
                    <div className="text-sm text-red-700 flex-1">{deleteError}</div>
                    <button onClick={() => setDeleteError('')} className="text-red-400 hover:text-red-600 text-xs font-bold uppercase shrink-0">Fermer</button>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="animate-spin" size={28} /></div>
            ) : error ? (
                <div className="card text-center text-red-500 py-8">{error}</div>
            ) : data ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <StatTile label="Solde vacances" value={`${data.user.vacation_balance} j`} />
                        <StatTile label="Chantiers en cours" value={data.chantiers_en_cours_count} />
                        <StatTile label="Heures entrées (total)" value={formatHeures(data.total_heures)} />
                    </div>

                    {/* Chantiers en cours — la liste, pas juste le compteur : c'est
                        elle qui permet de repérer une surcharge d'un coup d'œil. */}
                    <div className="card">
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 uppercase tracking-wide mb-4">
                            <Briefcase size={16} className="text-ohm-primary" /> Chantiers en cours ({data.chantiers_en_cours_count})
                        </h3>
                        {data.chantiers_en_cours.length === 0 ? (
                            <div className="text-sm text-slate-400 italic py-2">Aucun chantier en cours.</div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {data.chantiers_en_cours.map(c => (
                                    <span key={c.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700">
                                        <Folder size={13} className="text-slate-400 shrink-0" /> {c.nom}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Historique des absences */}
                    <div className="card">
                        <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 uppercase tracking-wide mb-4">
                            <CalendarOff size={16} className="text-ohm-primary" /> Historique des absences
                        </h3>
                        {data.leaves.length === 0 ? (
                            <div className="text-sm text-slate-400 italic py-2">Aucune absence enregistrée.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">
                                            <th className="py-2 pr-4">Type</th>
                                            <th className="py-2 pr-4">Dates</th>
                                            <th className="py-2 pr-4">Jours</th>
                                            <th className="py-2 pr-4">Statut</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {data.leaves.map(l => {
                                            const statusMeta = LEAVE_STATUS_META[l.status] ?? { label: l.status, className: 'bg-slate-100 text-slate-500' };
                                            return (
                                                <tr key={l.id}>
                                                    <td className="py-2.5 pr-4 font-medium text-slate-700">{LEAVE_TYPE_LABELS[l.type] ?? l.type}</td>
                                                    <td className="py-2.5 pr-4 font-mono text-slate-600">
                                                        {l.date_start}{l.date_end !== l.date_start ? ` → ${l.date_end}` : ''}
                                                    </td>
                                                    <td className="py-2.5 pr-4 font-mono text-slate-600">{formatHeures(l.days_count)}</td>
                                                    <td className="py-2.5 pr-4">
                                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${statusMeta.className}`}>{statusMeta.label}</span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            {data && (
                <UserFormModal
                    show={showEditModal}
                    editingUser={data.user}
                    onClose={() => setShowEditModal(false)}
                    onSaved={() => { setShowEditModal(false); fetchDetail(); }}
                />
            )}

            {revealModalT.mounted && revealedPassword && (
                <div className={`t-modal ${revealModalT.active ? 'is-open' : 'is-closing'} fixed inset-0 z-[100] flex items-center justify-center p-4`}>
                    <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={() => setRevealedPassword(null)}></div>
                    <div className="relative w-full max-w-sm bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl p-6 space-y-4">
                        <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">
                            Mot de passe de {data?.user.username}
                        </h3>
                        <p className="text-xs text-slate-500">
                            Communiquez-le à {data?.user.username} — il ne sera plus jamais affiché. Changement obligatoire à la prochaine connexion.
                        </p>
                        <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-4 py-3">
                            <code className="flex-1 font-mono text-sm text-slate-900 select-all break-all">{revealedPassword}</code>
                            <button
                                type="button"
                                onClick={() => { navigator.clipboard.writeText(revealedPassword); setCopied(true); }}
                                className="shrink-0 text-slate-500 hover:text-ohm-primary transition-colors"
                                title="Copier"
                            >
                                {copied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setRevealedPassword(null)}
                            className="w-full py-3 rounded-xl bg-ohm-primary text-ohm-bg font-black hover:bg-yellow-300 transition-all"
                        >
                            Fermer
                        </button>
                    </div>
                </div>
            )}
            {confirmDialogProps && <ConfirmDialog {...confirmDialogProps} />}
        </div>
    );
};
