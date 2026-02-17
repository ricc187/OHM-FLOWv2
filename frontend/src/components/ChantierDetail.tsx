import React, { useEffect, useState } from 'react';
import { Chantier, Entry, User, Alert } from '../types';
import { Plus, Minus, X, Check, ArrowLeft, Clock, Calendar, Bell, Info, Pencil, Download, FileText, Upload, Eye } from 'lucide-react';
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

    // PDF Modal
    const [showPdfModal, setShowPdfModal] = useState(false);
    const [isUploadingPdf, setIsUploadingPdf] = useState(false);

    useEffect(() => {
        fetchDetails();
    }, [activeTab]);

    const fetchDetails = async () => {
        // Always refresh chantier to get latest status/members
        const resChantier = await fetch(`/api/chantiers/${chantier.id}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` } });
        if (resChantier.ok) setChantier(await resChantier.json());

        if (activeTab === 'SUIVI') {
            const res = await fetch(`/api/chantiers/${chantier.id}/entries?role=${currentUser.role}&user_id=${currentUser.id}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` } });
            if (res.ok) setEntries(await res.json());
        }
        if (activeTab === 'ALERTES') {
            const res = await fetch(`/api/chantiers/${chantier.id}/alerts`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` } });
            if (res.ok) setAlerts(await res.json());
        }
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch(`/api/chantiers/${chantier.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('ohm_token')}`
            },
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('ohm_token')}`
            },
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('ohm_token')}`
            },
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('ohm_token')}`
            },
            body: JSON.stringify({ is_resolved: !alert.is_resolved })
        });
        fetchDetails();
    };

    const handleExport = () => {
        window.open(`/api/export?chantier_id=${chantier.id}`, '_blank');
    };

    const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        setIsUploadingPdf(true);
        const formData = new FormData();
        formData.append('file', e.target.files[0]);

        try {
            const res = await fetch(`/api/chantiers/${chantier.id}/pdf`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` },
                body: formData
            });
            if (res.ok) {
                const updated = await res.json();
                setChantier(updated);
                alert('Plan importé avec succès');
            } else {
                alert('Erreur lors de l\'import');
            }
        } catch (err) {
            console.error(err);
            alert('Erreur réseau');
        } finally {
            setIsUploadingPdf(false);
        }
    };

    const handlePdfView = async () => {
        try {
            const res = await fetch(`/api/chantiers/${chantier.id}/pdf`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` }
            });
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                window.open(url, '_blank');
            } else {
                alert('Plan introuvable');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const totalHeures = entries.reduce((acc, curr) => acc + curr.heures, 0);
    const totalMateriel = entries.reduce((acc, curr) => acc + curr.materiel, 0);

    return (
        <div className="animate-fade-in relative pb-40 min-h-screen">
            {/* Header - Completely transparent as requested */}
            <div className="sticky top-0 z-30 pt-4 pb-4 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
                    <div className="flex items-center gap-4 w-full">
                        <button onClick={onBack} className="p-2 rounded-lg bg-surface border border-slate-700 hover:border-ohm-primary text-gray-400 hover:text-white transition-all shrink-0">
                            <ArrowLeft size={20} />
                        </button>
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight truncate">{chantier.nom}</h1>
                                <StatusBadge status={chantier.status} type="chantier" />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-400 font-mono mt-1">
                                <span>{chantier.annee}</span>
                                {currentUser.role === 'admin' && (
                                    <button onClick={() => { setEditForm(chantier); setShowEditModal(true); }} className="p-1 hover:text-white transition-colors">
                                        <Pencil size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tags Navigation & Export */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0 w-full sm:w-auto">
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

                    <div className="flex justify-end w-full sm:w-auto">
                        <button
                            onClick={() => setShowPdfModal(true)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors border border-slate-700 group w-full sm:w-auto justify-center mr-2
                                ${chantier.plan_pdf_path ? 'bg-slate-800 text-ohm-primary border-ohm-primary/30' : 'bg-slate-800 text-gray-400 hover:text-white'}`}
                            title="Gérer le Plan PDF"
                        >
                            <FileText size={18} />
                            <span className="font-bold text-xs uppercase tracking-wider">{chantier.plan_pdf_path ? 'Plan Dispo' : 'Ajouter Plan'}</span>
                        </button>
                        <button
                            onClick={handleExport}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-gray-400 hover:text-white hover:bg-slate-700 transition-colors border border-slate-700 group w-full sm:w-auto justify-center"
                            title="Exporter en CSV"
                        >
                            <Download size={18} className="group-hover:text-ohm-primary transition-colors" />
                            <span className="font-bold text-xs uppercase tracking-wider">Export</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="space-y-6">

                {/* SUIVI TAB */}
                {activeTab === 'SUIVI' && (
                    <div className="space-y-6 animate-slide-up">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="card bg-gradient-to-br from-surface to-slate-900 border-l-4 border-l-ohm-primary relative overflow-hidden group flex flex-col items-center justify-center text-center py-8">
                                {/* Permanent subtle gold background */}
                                <div className="absolute inset-0 bg-ohm-primary/5"></div>
                                {/* Stronger on hover */}
                                <div className="absolute inset-0 bg-ohm-mix opacity-0 group-hover:opacity-20 transition-opacity duration-500"></div>
                                <span className="text-xs font-bold text-ohm-primary uppercase relative z-10 tracking-widest mb-2">Heures Totales</span>
                                <div className="text-4xl font-black text-white relative z-10">{totalHeures} <span className="text-lg text-gray-400 font-normal">h</span></div>
                            </div>
                            <div className="card bg-gradient-to-br from-surface to-slate-900 border-l-4 border-l-secondary relative overflow-hidden group flex flex-col items-center justify-center text-center py-8">
                                {/* Permanent subtle blue background */}
                                <div className="absolute inset-0 bg-secondary/10"></div>
                                {/* Stronger on hover */}
                                <div className="absolute inset-0 bg-blue-500/20 opacity-0 group-hover:opacity-30 transition-opacity duration-500"></div>
                                <span className="text-xs font-bold text-blue-400 uppercase relative z-10 tracking-widest mb-2">Matériel & Frais</span>
                                <div className="text-4xl font-black text-white relative z-10">{totalMateriel} <span className="text-lg text-gray-400 font-normal">CHF</span></div>
                            </div>
                        </div>

                        {/* Static Add Button (Moved from FAB) */}
                        <button
                            onClick={() => setShowEntryModal(true)}
                            className="w-full py-3 bg-primary text-black font-black uppercase tracking-widest rounded-xl shadow-md hover:bg-yellow-400 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm"
                        >
                            <span className="text-lg">+</span> AJOUTER UNE ENTRÉE
                        </button>

                        <div className="card overflow-hidden p-0 overflow-x-auto">
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

                        {/* FAB Removed */}
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
                    <div className="w-full max-w-2xl bg-slate-900 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden animate-fade-in ring-1 ring-white/10 max-h-[90vh] flex flex-col">
                        <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-slate-900 to-slate-800 shrink-0">
                            <div>
                                <h3 className="text-2xl font-black text-white uppercase tracking-tight">Nouvelle Saisie</h3>
                                <div className="text-gray-400 text-sm mt-1">Ajoutez des heures ou du matériel pour ce chantier.</div>
                            </div>
                            <button onClick={() => setShowEntryModal(false)} className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleEntrySubmit} className="p-8 space-y-8 overflow-y-auto">

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
            {/* PDF MODAL */}
            {showPdfModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="card w-full max-w-md space-y-6 animate-slide-up">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold text-white uppercase flex items-center gap-2">
                                <FileText className="text-ohm-primary" /> Plan du Chantier
                            </h3>
                            <button onClick={() => setShowPdfModal(false)}><X className="text-gray-400 hover:text-white" /></button>
                        </div>

                        <div className="space-y-4">
                            {chantier.plan_pdf_path ? (
                                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center gap-3">
                                    <Check className="text-green-500" />
                                    <div>
                                        <div className="text-green-400 font-bold text-sm">Plan disponible</div>
                                        <div className="text-xs text-gray-400 break-all">{chantier.plan_pdf_path}</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 bg-slate-800 rounded-xl text-center text-gray-400 text-sm italic">
                                    Aucun plan associé à ce chantier.
                                </div>
                            )}

                            <div className="grid grid-cols-1 gap-3">
                                {chantier.plan_pdf_path && (
                                    <button
                                        onClick={handlePdfView}
                                        className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all"
                                    >
                                        <Eye size={20} /> Voir / Télécharger le Plan
                                    </button>
                                )}

                                <div className="relative">
                                    <input
                                        type="file"
                                        accept="application/pdf"
                                        onChange={handlePdfUpload}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                        disabled={isUploadingPdf}
                                    />
                                    <button className={`w-full py-3 ${chantier.plan_pdf_path ? 'bg-slate-800 border-dashed border-2 border-slate-600' : 'bg-ohm-primary text-ohm-bg'} font-bold rounded-xl flex items-center justify-center gap-2 transition-all`}>
                                        <Upload size={20} />
                                        {isUploadingPdf ? 'Importation...' : (chantier.plan_pdf_path ? 'Remplacer le fichier PDF' : 'Importer un fichier PDF')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
