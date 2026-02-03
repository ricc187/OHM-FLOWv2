import React, { useEffect, useState } from 'react';
import { Chantier, Entry, User, Alert } from '../types';
import { Plus, Minus, X, Check, ArrowLeft, Clock, Calendar, Bell, Info, Pencil } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

interface Props {
    chantier: Chantier;
    currentUser: User;
    onBack: () => void;
}

type Tab = 'SUIVI' | 'INFO' | 'ALERTES';

export const ChantierDetail: React.FC<Props> = ({ chantier: initialChantier, currentUser, onBack }) => {
    const [chantier, setChantier] = useState(initialChantier);
    const [activeTab, setActiveTab] = useState<Tab>('SUIVI');
    const [entries, setEntries] = useState<Entry[]>([]);
    const [alerts, setAlerts] = useState<Alert[]>([]);

    // Suivi Modal
    const [showEntryModal, setShowEntryModal] = useState(false);
    // Combined Entry Mode
    const [entryForm, setEntryForm] = useState({ heures: '', materiel: '' });
    const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);

    // Alert Modal
    const [showAlertModal, setShowAlertModal] = useState(false);
    const [newAlert, setNewAlert] = useState({ title: '', due_date: '' });

    // Edit Modal
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState(initialChantier);

    useEffect(() => {
        fetchDetails();
    }, [activeTab]);

    const fetchDetails = async () => {
        // Always refresh chantier to get latest status/members
        const resChantier = await fetch(`/api/chantiers/${chantier.id}`);
        if (resChantier.ok) setChantier(await resChantier.json());

        if (activeTab === 'SUIVI') {
            const res = await fetch(`/api/chantiers/${chantier.id}/entries?role=${currentUser.role}&user_id=${currentUser.id}`);
            if (res.ok) setEntries(await res.json());
        }
        if (activeTab === 'ALERTES') {
            const res = await fetch(`/api/chantiers/${chantier.id}/alerts`);
            if (res.ok) setAlerts(await res.json());
        }
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch(`/api/chantiers/${chantier.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(editForm)
        });
        if (res.ok) {
            const updated = await res.json();
            setChantier(updated);
            setShowEditModal(false);
        }
    };

    // --- Entry Logic (Suivi) ---
    const handleEntrySubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const h = parseFloat(entryForm.heures) || 0;
        const m = parseFloat(entryForm.materiel) || 0;

        if (h === 0 && m === 0) return;

        const res = await fetch('/api/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                chantier_id: chantier.id,
                date: entryDate,
                heures: h,
                materiel: m,
                created_by_id: currentUser.id
            })
        });
        if (res.ok) {
            setEntryForm({ heures: '', materiel: '' });
            setShowEntryModal(false);
            fetchDetails();
        }
    };


    // --- Alert Logic ---
    const handleCreateAlert = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch(`/api/chantiers/${chantier.id}/alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newAlert)
        });
        if (res.ok) {
            setNewAlert({ title: '', due_date: '' });
            setShowAlertModal(false);
            fetchDetails();
        }
    };

    const toggleAlert = async (alert: Alert) => {
        await fetch(`/api/alerts/${alert.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_resolved: !alert.is_resolved })
        });
        fetchDetails();
    };

    const totalHeures = entries.reduce((acc, curr) => acc + curr.heures, 0);
    const totalMateriel = entries.reduce((acc, curr) => acc + curr.materiel, 0);

    return (
        <div className="animate-fade-in relative pb-24 min-h-screen">
            {/* Header */}
            <div className="sticky top-0 z-30 bg-ohm-bg/95 backdrop-blur-md pt-4 pb-4 border-b border-slate-800 mb-6">
                <div className="flex items-center gap-4 mb-4">
                    <button onClick={onBack} className="p-2 rounded-lg bg-surface border border-slate-700 hover:border-ohm-primary text-gray-400 hover:text-white transition-all">
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex-1">
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight">{chantier.nom}</h1>
                            <StatusBadge status={chantier.status} type="chantier" />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-400 font-mono">
                            <span>{chantier.annee}</span>
                            {currentUser.role === 'admin' && (
                                <button onClick={() => { setEditForm(chantier); setShowEditModal(true); }} className="p-1 hover:text-white transition-colors">
                                    <Pencil size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tags Navigation */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                    {[
                        { id: 'SUIVI', icon: Clock, label: 'Suivi' },
                        { id: 'INFO', icon: Info, label: 'Infos' },
                        { id: 'ALERTES', icon: Bell, label: 'Alertes' },
                    ].map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as Tab)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${isActive
                                    ? 'bg-ohm-primary text-ohm-bg shadow-lg shadow-primary/20'
                                    : 'bg-surface text-gray-400 hover:text-white border border-slate-700'
                                    }`}
                            >
                                <Icon size={16} /> {tab.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Content Area */}
            <div className="space-y-6">

                {/* SUIVI TAB */}
                {activeTab === 'SUIVI' && (
                    <div className="space-y-6 animate-slide-up">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="card bg-gradient-to-br from-surface to-slate-900 border-l-4 border-l-ohm-primary">
                                <span className="text-xs font-bold text-gray-400 uppercase">Heures</span>
                                <div className="text-3xl font-black text-white mt-1">{totalHeures} <span className="text-sm text-gray-500 font-normal">h</span></div>
                            </div>
                            <div className="card bg-gradient-to-br from-surface to-slate-900 border-l-4 border-l-blue-500">
                                <span className="text-xs font-bold text-gray-400 uppercase">Matériel</span>
                                <div className="text-3xl font-black text-white mt-1">{totalMateriel} <span className="text-sm text-gray-500 font-normal">CHF</span></div>
                            </div>
                        </div>

                        <div className="card overflow-hidden p-0">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-900/50 text-gray-500 font-bold uppercase text-xs">
                                    <tr>
                                        <th className="p-4">Date</th>
                                        <th className="p-4">Qui</th>
                                        <th className="p-4 text-right">Heures</th>
                                        <th className="p-4 text-right">Matériel</th>
                                        <th className="p-4 text-right">Statut</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {entries.map(e => (
                                        <tr key={e.id} className="hover:bg-white/5">
                                            <td className="p-4 text-gray-300 font-mono">{e.date}</td>
                                            <td className="p-4 text-white font-medium">
                                                {e.user_name}
                                            </td>
                                            <td className="p-4 text-right font-mono font-bold text-white">
                                                {e.heures > 0 ? `${e.heures}h` : '-'}
                                            </td>
                                            <td className="p-4 text-right font-mono font-bold text-blue-400">
                                                {e.materiel > 0 ? `${e.materiel}.-` : '-'}
                                            </td>
                                            <td className="p-4 text-right">
                                                <StatusBadge status={e.status} type="entry" />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {entries.length === 0 && <div className="p-8 text-center text-gray-500 italic">Aucune saisie</div>}
                        </div>

                        {/* FAB - Allower for ACTIVE and FUTURE if user is assigned */}
                        {(chantier.status === 'ACTIVE' || chantier.status === 'FUTURE') && (
                            <button
                                onClick={() => { setShowEntryModal(true); setEntryForm({ heures: '', materiel: '' }); }}
                                className="fixed bottom-8 right-8 w-14 h-14 bg-ohm-primary text-ohm-bg rounded-full shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-30"
                            >
                                <Plus size={28} />
                            </button>
                        )}
                    </div>
                )}

                {/* INFO TAB */}
                {activeTab === 'INFO' && (
                    <div className="card space-y-6 animate-slide-up">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase">Dates</label>
                                <div className="mt-2 text-white font-mono flex items-center gap-2">
                                    <Calendar size={16} className="text-ohm-primary" />
                                    {chantier.date_start || 'Non défini'} → {chantier.date_end || '...'}
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase">Adresse Travaux</label>
                                <div className="mt-2 text-white">{chantier.address_work || '-'}</div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase">Adresse Facturation</label>
                                <div className="mt-2 text-white">{chantier.address_billing || '-'}</div>
                            </div>
                            <div className="col-span-full">
                                <label className="text-xs font-bold text-gray-500 uppercase">Remarques</label>
                                <div className="mt-2 p-4 bg-slate-900 rounded-lg text-gray-300 whitespace-pre-wrap">
                                    {chantier.remarque || 'Aucune remarque.'}
                                </div>
                            </div>
                        </div>
                    </div>
                )}



                {/* ALERTES TAB */}
                {activeTab === 'ALERTES' && (
                    <div className="space-y-6 animate-slide-up">
                        {alerts.map(alert => (
                            <div key={alert.id} className={`card p-4 flex items-center justify-between group ${alert.is_resolved ? 'opacity-50' : 'border-l-4 border-l-red-500'}`}>
                                <div>
                                    <h4 className={`font-bold ${alert.is_resolved ? 'text-gray-500 line-through' : 'text-white'}`}>{alert.title}</h4>
                                    {alert.due_date && <div className="text-xs text-gray-500 font-mono mt-1 flex items-center gap-1"><Clock size={12} /> {alert.due_date}</div>}
                                </div>
                                <button onClick={() => toggleAlert(alert)} className={`p-2 rounded-full border ${alert.is_resolved ? 'border-green-500/30 text-green-500' : 'border-gray-600 text-gray-400 hover:text-green-400'}`}>
                                    <Check size={18} />
                                </button>
                            </div>
                        ))}

                        {currentUser.role === 'admin' && (
                            <button
                                onClick={() => setShowAlertModal(true)}
                                className="w-full py-3 rounded-xl border border-dashed border-slate-600 text-gray-400 hover:text-white hover:border-slate-500 hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                            >
                                <Plus size={20} /> Ajouter une alerte
                            </button>
                        )}
                    </div>
                )}

            </div>

            {/* ENTRY MODAL */}
            {showEntryModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
                    <div className="w-full max-w-2xl bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden animate-fade-in ring-1 ring-white/10">
                        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-slate-900 to-slate-800">
                            <div>
                                <h3 className="text-2xl font-black text-white uppercase tracking-tight">Nouvelle Saisie</h3>
                                <div className="text-gray-400 text-sm mt-1">Ajoutez des heures ou du matériel pour ce chantier.</div>
                            </div>
                            <button onClick={() => setShowEntryModal(false)} className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleEntrySubmit} className="p-8 space-y-8">

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-ohm-primary uppercase tracking-widest">Date</label>
                                    <input
                                        type="date"
                                        required
                                        className="w-full bg-black/20 border border-slate-700 rounded-xl px-4 py-4 text-white font-mono text-lg focus:ring-2 focus:ring-ohm-primary/50 focus:border-ohm-primary transition-all outline-none"
                                        value={entryDate}
                                        onChange={e => setEntryDate(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-ohm-primary uppercase tracking-widest">Ouvrier</label>
                                    <div className="w-full bg-black/20 border border-slate-700 rounded-xl px-4 py-4 text-gray-300 font-medium flex items-center justify-between">
                                        <span>{currentUser.username}</span>
                                        <div className="px-2 py-1 bg-ohm-primary/10 text-ohm-primary text-xs font-bold rounded uppercase">Moi-même</div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 hover:border-ohm-primary/50 transition-colors group">
                                    <label className="flex items-center gap-2 text-sm font-bold text-gray-400 uppercase mb-4 group-hover:text-white transition-colors">
                                        <Clock size={18} className="text-ohm-primary" />
                                        Heures Travaillées
                                    </label>
                                    <div className="flex items-center gap-4">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const current = parseFloat(entryForm.heures) || 0;
                                                setEntryForm({ ...entryForm, heures: Math.max(0, current - 0.5).toString() });
                                            }}
                                            className="w-12 h-12 rounded-xl bg-slate-700 hover:bg-red-500/20 text-white hover:text-red-400 flex items-center justify-center transition-colors shadow-lg"
                                        >
                                            <Minus size={20} strokeWidth={3} />
                                        </button>

                                        <div className="relative flex-1">
                                            <input
                                                type="number"
                                                step="0.5"
                                                className="w-full bg-transparent text-center text-4xl font-black text-white py-2 focus:outline-none placeholder-slate-700 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                placeholder="0"
                                                value={entryForm.heures}
                                                onChange={e => setEntryForm({ ...entryForm, heures: e.target.value })}
                                            />
                                            <span className="absolute right-0 bottom-4 text-gray-500 font-bold text-xs uppercase tracking-wider">HRS</span>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                const current = parseFloat(entryForm.heures) || 0;
                                                setEntryForm({ ...entryForm, heures: (current + 0.5).toString() });
                                            }}
                                            className="w-12 h-12 rounded-xl bg-slate-700 hover:bg-ohm-primary text-white hover:text-ohm-bg flex items-center justify-center transition-colors shadow-lg"
                                        >
                                            <Plus size={20} strokeWidth={3} />
                                        </button>
                                    </div>
                                </div>

                                <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 hover:border-blue-500/50 transition-colors group">
                                    <label className="flex items-center gap-2 text-sm font-bold text-gray-400 uppercase mb-4 group-hover:text-white transition-colors">
                                        <div className="w-4 h-4 rounded-full border-2 border-blue-500"></div>
                                        Matériel / Frais
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="w-full bg-transparent text-center text-4xl font-black text-white py-2 focus:outline-none placeholder-slate-700 appearance-none [&::-webkit-inner-spin-button]:appearance-none border-b-2 border-transparent focus:border-blue-500 transition-all"
                                            placeholder="0.00"
                                            value={entryForm.materiel}
                                            onChange={e => setEntryForm({ ...entryForm, materiel: e.target.value })}
                                        />
                                        <span className="absolute right-0 bottom-4 text-gray-500 font-bold text-xs uppercase tracking-wider">CHF</span>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4">
                                <button
                                    type="submit"
                                    className="w-full py-5 bg-ohm-primary text-ohm-bg font-black text-lg rounded-2xl hover:bg-yellow-300 hover:scale-[1.01] active:scale-[0.99] transition-all shadow-xl shadow-primary/20 uppercase tracking-widest"
                                >
                                    Valider la Saisie
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ALERT MODAL */}
            {showAlertModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="card w-full max-w-md space-y-4">
                        <h3 className="text-xl font-bold text-white">Nouvelle Alerte</h3>
                        <input type="text" placeholder="Titre" className="input-field" value={newAlert.title} onChange={e => setNewAlert({ ...newAlert, title: e.target.value })} />
                        <input type="date" className="input-field" value={newAlert.due_date} onChange={e => setNewAlert({ ...newAlert, due_date: e.target.value })} />
                        <div className="flex gap-2">
                            <button onClick={() => setShowAlertModal(false)} className="flex-1 py-3 rounded-lg bg-slate-700 text-white font-bold">Annuler</button>
                            <button onClick={handleCreateAlert} className="flex-1 py-3 rounded-lg bg-ohm-primary text-ohm-bg font-bold">Créer</button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT MODAL */}
            {showEditModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="card w-full max-w-2xl animate-slide-up max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white uppercase">Modifier le chantier</h3>
                            <button onClick={() => setShowEditModal(false)}><X className="text-gray-400" /></button>
                        </div>
                        <form onSubmit={handleEditSubmit} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Nom</label>
                                    <input type="text" required className="input-field mt-1" value={editForm.nom} onChange={e => setEditForm({ ...editForm, nom: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Année</label>
                                    <input type="number" required className="input-field mt-1" value={editForm.annee} onChange={e => setEditForm({ ...editForm, annee: parseInt(e.target.value) })} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Dates</label>
                                    <div className="flex gap-2 mt-1">
                                        <input type="date" className="input-field" value={editForm.date_start || ''} onChange={e => setEditForm({ ...editForm, date_start: e.target.value })} />
                                        <input type="date" className="input-field" value={editForm.date_end || ''} onChange={e => setEditForm({ ...editForm, date_end: e.target.value })} />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Statut</label>
                                    <select className="input-field mt-1" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value as any })}>
                                        <option value="FUTURE">À venir</option>
                                        <option value="ACTIVE">En cours</option>
                                        <option value="DONE">Terminé</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Adresse Travaux</label>
                                    <input type="text" className="input-field mt-1" value={editForm.address_work || ''} onChange={e => setEditForm({ ...editForm, address_work: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Adresse Facturation</label>
                                    <input type="text" className="input-field mt-1" value={editForm.address_billing || ''} onChange={e => setEditForm({ ...editForm, address_billing: e.target.value })} />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase">Remarques</label>
                                <textarea className="input-field mt-1 min-h-[100px]" value={editForm.remarque || ''} onChange={e => setEditForm({ ...editForm, remarque: e.target.value })} />
                            </div>

                            <div className="pt-4 flex justify-end gap-3">
                                <button type="button" onClick={() => setShowEditModal(false)} className="px-6 py-3 rounded-lg font-bold text-gray-400 hover:text-white hover:bg-slate-700">Annuler</button>
                                <button type="submit" className="px-6 py-3 rounded-lg font-bold bg-ohm-primary text-ohm-bg hover:bg-yellow-300">ENREGISTRER</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
