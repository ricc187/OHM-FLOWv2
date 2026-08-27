import React, { useEffect, useRef, useState } from 'react';
import { Chantier, Entry, User } from '../types';
import { Plus, Minus, X, ArrowLeft, Clock, Calendar, Info, Pencil, Download, FileText, Receipt, Camera, FolderOpen, Lock, Unlock, Loader2, Ruler, ClipboardList, AlertTriangle } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { AwesomeDatePicker } from './ui/AwesomeDatePicker';
import { AwesomeSelect } from './ui/AwesomeSelect';
import { DocumentExplorer } from './DocumentExplorer';
import { api } from '../api';
import { setAppModalOpen } from '../modalState';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
    chantier: Chantier;
    currentUser: User;
    onBack: () => void;
}

type Tab = 'SUIVI' | 'INFO';

export const ChantierDetail: React.FC<Props> = ({ chantier: initialChantier, currentUser, onBack }) => {
    const [chantier, setChantier] = useState(initialChantier);
    const [activeTab, setActiveTab] = useState<Tab>('SUIVI');
    const [entries, setEntries] = useState<Entry[]>([]);

    // Suivi Modal
    const [showEntryModal, setShowEntryModal] = useState(false);
    // Combined Entry Mode
    const [entryForm, setEntryForm] = useState({ heures: '', materiel: '' });
    const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);

    // Edit Modal
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState(initialChantier);

    // Documents (plans / devis / photos / mesures / rapports d'intervention)
    const [showExplorer, setShowExplorer] = useState(false);
    const [uploadingCategory, setUploadingCategory] = useState<'plan' | 'devis' | 'photo' | 'mesure' | 'rapport' | null>(null);
    const planInputRef = useRef<HTMLInputElement>(null);
    const devisInputRef = useRef<HTMLInputElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);
    const mesureInputRef = useRef<HTMLInputElement>(null);
    const rapportInputRef = useRef<HTMLInputElement>(null);

    // Closing is blocked server-side while a required document is missing —
    // shows the reason as a small popup instead of failing silently.
    const [closeBlockedMessage, setCloseBlockedMessage] = useState<string | null>(null);
    useEffect(() => {
        if (!closeBlockedMessage) return;
        const t = setTimeout(() => setCloseBlockedMessage(null), 5000);
        return () => clearTimeout(t);
    }, [closeBlockedMessage]);

    useEffect(() => {
        fetchDetails();
    }, [activeTab]);

    // Lock background scroll while any modal is open, and tell the app shell
    // to hide its own nav bar so it can't sit on top of / peek behind the modal.
    const anyModalOpen = showEntryModal || showEditModal || showExplorer;
    useEffect(() => {
        setAppModalOpen(anyModalOpen);
        return () => setAppModalOpen(false);
    }, [anyModalOpen]);

    // Escape closes whichever modal is open — no reason a keyboard user
    // should need the mouse just to back out of one.
    useEscapeKey(showEntryModal, () => setShowEntryModal(false));
    useEscapeKey(showEditModal, () => setShowEditModal(false));

    const fetchDetails = async () => {
        // Always refresh chantier to get latest status/members
        const resChantier = await api.get(`/api/chantiers/${chantier.id}`);
        if (resChantier.ok) setChantier(await resChantier.json());

        if (activeTab === 'SUIVI') {
            const res = await api.get(`/api/chantiers/${chantier.id}/entries?role=${currentUser.role}&user_id=${currentUser.id}`);
            if (res.ok) setEntries(await res.json());
        }
    };

    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await api.put(`/api/chantiers/${chantier.id}`, editForm);
        if (res.ok) {
            const updated = await res.json();
            setChantier(updated);
            setShowEditModal(false);
        }
    };

    const handleToggleStatus = async () => {
        const newStatus = chantier.status === 'DONE' ? 'ACTIVE' : 'DONE';
        const res = await api.put(`/api/chantiers/${chantier.id}`, { ...chantier, status: newStatus });
        if (res.ok) {
            const updated = await res.json();
            setChantier(updated);
        } else {
            const data = await res.json().catch(() => ({}));
            setCloseBlockedMessage(data.error || 'Impossible de clôturer ce chantier');
        }
    };

    const handleToggleNoMesureNeeded = async (value: boolean) => {
        const res = await api.put(`/api/chantiers/${chantier.id}`, { no_mesure_needed: value });
        if (res.ok) setChantier(await res.json());
    };

    // --- Entry Logic (Suivi) ---
    const handleEntrySubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const h = parseFloat(entryForm.heures) || 0;
        const m = parseFloat(entryForm.materiel) || 0;

        if (h === 0 && m === 0) return;

        const res = await api.post('/api/entries', {
            user_id: currentUser.id,
            chantier_id: chantier.id,
            date: entryDate,
            heures: h,
            materiel: m,
            created_by_id: currentUser.id
        });
        if (res.ok) {
            setEntryForm({ heures: '', materiel: '' });
            setShowEntryModal(false);
            fetchDetails();
        }
    };


    const handleExport = async () => {
        try {
            const res = await api.get(`/api/export?chantier_id=${chantier.id}`);
            if (!res.ok) { alert('Erreur lors de l\'export'); return; }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `export_chantier_${chantier.id}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            alert('Erreur réseau lors de l\'export');
        }
    };

    // --- Document Logic (Plans / Devis / Photos / Mesures / Rapports) ---
    const uploadDocument = async (category: 'plan' | 'devis' | 'photo' | 'mesure' | 'rapport', file: File) => {
        const formData = new FormData();
        formData.append('category', category);
        formData.append('file', file);
        return api.upload(`/api/chantiers/${chantier.id}/documents`, formData);
    };

    // Plan/Devis/Mesure/Rapport: one PDF at a time. Photos: the picker allows
    // selecting several at once (from the phone's own gallery), uploaded one by one.
    const handleDocumentInputChange = async (category: 'plan' | 'devis' | 'photo' | 'mesure' | 'rapport', e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = ''; // allow re-selecting the same file(s) later
        if (!files.length) return;

        setUploadingCategory(category);
        const errors: string[] = [];
        for (const file of files) {
            const res = await uploadDocument(category, file);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                errors.push(data.error || `Échec de l'import de "${file.name}"`);
            }
        }
        setUploadingCategory(null);
        if (errors.length > 0) alert(errors.join('\n'));
        fetchDetails(); // refresh has_mesure/has_rapport so the buttons' red state updates
    };

    const totalHeures = entries.reduce((acc, curr) => acc + curr.heures, 0);
    const totalMateriel = entries.reduce((acc, curr) => acc + curr.materiel, 0);
    const mesureMissing = !chantier.has_mesure && !chantier.no_mesure_needed;
    const rapportMissing = !chantier.has_rapport;

    return (
        <div className="animate-fade-in relative pb-40 min-h-screen">
            {/* Header — scrolls away with the rest of the page instead of staying
                pinned, so it never sits on top of the entries below it */}
            <div className="pt-4 pb-4 mb-6 -mx-4 px-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
                    <div className="flex items-center gap-4 w-full">
                        <button onClick={onBack} className="p-2 rounded-lg bg-surface border border-slate-300 hover:border-ohm-primary text-slate-500 hover:text-slate-900 transition-all shrink-0">
                            <ArrowLeft size={20} />
                        </button>
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <h1 className="text-2xl sm:text-3xl font-black text-slate-900 uppercase tracking-tight truncate">{chantier.nom}</h1>
                                <StatusBadge status={chantier.status} type="chantier" />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-500 font-mono mt-1">
                                <span>{chantier.annee}</span>
                                {currentUser.role === 'admin' && (
                                    <>
                                        <button onClick={() => { setEditForm(chantier); setShowEditModal(true); }} className="p-1 hover:text-slate-900 transition-colors" title="Modifier">
                                            <Pencil size={14} />
                                        </button>
                                        <button
                                            onClick={handleToggleStatus}
                                            title={chantier.status === 'DONE' ? 'Ré-ouvrir le chantier' : 'Clôturer le chantier'}
                                            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all border ${chantier.status === 'DONE'
                                                ? 'border-green-500/50 text-green-400 hover:bg-green-500/10'
                                                : 'border-red-500/50 text-red-400 hover:bg-red-500/10'
                                                }`}
                                        >
                                            {chantier.status === 'DONE'
                                                ? <><Unlock size={12} /> Ré-ouvrir</>
                                                : <><Lock size={12} /> Clôturer</>
                                            }
                                        </button>
                                    </>
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
                        ].map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as Tab)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${isActive
                                        ? 'bg-ohm-primary text-ohm-bg shadow-lg shadow-primary/20'
                                        : 'bg-surface text-slate-500 hover:text-slate-900 border border-slate-300'
                                        }`}
                                >
                                    <Icon size={16} /> {tab.label}
                                </button>
                            )
                        })}
                    </div>

                    <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
                        {/* Hidden native pickers, one per category — buttons below just trigger them */}
                        <input ref={planInputRef} type="file" accept="application/pdf" className="hidden" onChange={e => handleDocumentInputChange('plan', e)} />
                        <input ref={devisInputRef} type="file" accept="application/pdf" className="hidden" onChange={e => handleDocumentInputChange('devis', e)} />
                        <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleDocumentInputChange('photo', e)} />
                        <input ref={mesureInputRef} type="file" accept="application/pdf" className="hidden" onChange={e => handleDocumentInputChange('mesure', e)} />
                        <input ref={rapportInputRef} type="file" accept="application/pdf" className="hidden" onChange={e => handleDocumentInputChange('rapport', e)} />

                        {currentUser.role === 'admin' && (
                            <>
                                <button
                                    onClick={() => planInputRef.current?.click()}
                                    disabled={chantier.archived || uploadingCategory !== null}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-slate-300 justify-center disabled:opacity-40"
                                    title="Importer un plan (PDF)"
                                >
                                    {uploadingCategory === 'plan' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                    <span className="font-bold text-xs uppercase tracking-wider">Plan</span>
                                </button>
                                <button
                                    onClick={() => devisInputRef.current?.click()}
                                    disabled={chantier.archived || uploadingCategory !== null}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-slate-300 justify-center disabled:opacity-40"
                                    title="Importer un devis (PDF)"
                                >
                                    {uploadingCategory === 'devis' ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
                                    <span className="font-bold text-xs uppercase tracking-wider">Devis</span>
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => photoInputRef.current?.click()}
                            disabled={chantier.archived || uploadingCategory !== null}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-slate-300 justify-center disabled:opacity-40"
                            title="Ajouter des photos"
                        >
                            {uploadingCategory === 'photo' ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                            <span className="font-bold text-xs uppercase tracking-wider">Photos</span>
                        </button>
                        {!chantier.no_mesure_needed && (
                            <button
                                onClick={() => mesureInputRef.current?.click()}
                                disabled={chantier.archived || uploadingCategory !== null}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border justify-center disabled:opacity-40 ${mesureMissing
                                    ? 'bg-red-50 text-red-600 border-red-300 hover:bg-red-100'
                                    : 'bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                                    }`}
                                title={mesureMissing ? "Aucune mesure — le nom du fichier doit contenir \"mesure\"" : "Ajouter des mesures (PDF)"}
                            >
                                {uploadingCategory === 'mesure' ? <Loader2 size={16} className="animate-spin" /> : mesureMissing ? <AlertTriangle size={16} /> : <Ruler size={16} />}
                                <span className="font-bold text-xs uppercase tracking-wider">Mesures</span>
                            </button>
                        )}
                        <button
                            onClick={() => rapportInputRef.current?.click()}
                            disabled={chantier.archived || uploadingCategory !== null}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border justify-center disabled:opacity-40 ${rapportMissing
                                ? 'bg-red-50 text-red-600 border-red-300 hover:bg-red-100'
                                : 'bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-slate-300'
                                }`}
                            title={rapportMissing ? "Aucun rapport d'intervention — le nom du fichier doit contenir \"rapport\"" : "Ajouter un rapport d'intervention (PDF)"}
                        >
                            {uploadingCategory === 'rapport' ? <Loader2 size={16} className="animate-spin" /> : rapportMissing ? <AlertTriangle size={16} /> : <ClipboardList size={16} />}
                            <span className="font-bold text-xs uppercase tracking-wider">Rapport d'inter</span>
                        </button>
                        <button
                            onClick={() => setShowExplorer(true)}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-slate-500 hover:text-ohm-primary hover:bg-slate-100 transition-colors border border-slate-300 justify-center"
                            title="Explorer les documents"
                        >
                            <FolderOpen size={16} />
                        </button>
                        <button
                            onClick={handleExport}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-slate-300 group justify-center"
                            title="Exporter en CSV"
                        >
                            <Download size={16} className="group-hover:text-ohm-primary transition-colors" />
                            <span className="font-bold text-xs uppercase tracking-wider">Export</span>
                        </button>
                    </div>
                </div>
                {chantier.archived && (
                    <div className="mt-3 text-xs text-amber-600 font-bold flex items-center gap-1.5">
                        <Lock size={12} /> Chantier archivé — rouvrez-le pour ajouter des documents
                    </div>
                )}
                {currentUser.role === 'admin' && (
                    <label className="mt-3 text-xs text-slate-500 font-medium flex items-center gap-2 cursor-pointer w-fit">
                        <input
                            type="checkbox"
                            checked={!!chantier.no_mesure_needed}
                            onChange={e => handleToggleNoMesureNeeded(e.target.checked)}
                            className="w-4 h-4 rounded accent-ohm-primary"
                        />
                        Pas de mesure nécessaire pour ce chantier
                    </label>
                )}
            </div>

            {/* Closure blocked — small popup, auto-dismisses */}
            {closeBlockedMessage && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-md w-[calc(100%-2rem)] safe-top">
                    <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl shadow-xl p-4 flex items-start gap-3 animate-slide-up">
                        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                        <div className="text-sm font-medium flex-1">{closeBlockedMessage}</div>
                        <button onClick={() => setCloseBlockedMessage(null)} className="shrink-0 text-red-400 hover:text-red-700">
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Content Area */}
            <div className="space-y-6">

                {/* SUIVI TAB */}
                {activeTab === 'SUIVI' && (
                    <div className="space-y-6 animate-slide-up">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="card bg-gradient-to-br from-surface to-slate-50 border-l-4 border-l-ohm-primary relative overflow-hidden group flex flex-col items-center justify-center text-center py-8">
                                {/* Permanent subtle gold background */}
                                <div className="absolute inset-0 bg-ohm-primary/5"></div>
                                {/* Stronger on hover */}
                                <div className="absolute inset-0 bg-ohm-mix opacity-0 group-hover:opacity-20 transition-opacity duration-500"></div>
                                <span className="text-xs font-bold text-ohm-primary uppercase relative z-10 tracking-widest mb-2">Heures Totales</span>
                                <div className="text-4xl font-black text-slate-900 relative z-10">{totalHeures} <span className="text-lg text-slate-500 font-normal">h</span></div>
                            </div>
                            <div className="card bg-gradient-to-br from-surface to-slate-50 border-l-4 border-l-secondary relative overflow-hidden group flex flex-col items-center justify-center text-center py-8">
                                {/* Permanent subtle blue background */}
                                <div className="absolute inset-0 bg-secondary/10"></div>
                                {/* Stronger on hover */}
                                <div className="absolute inset-0 bg-blue-500/20 opacity-0 group-hover:opacity-30 transition-opacity duration-500"></div>
                                <span className="text-xs font-bold text-blue-400 uppercase relative z-10 tracking-widest mb-2">Matériel & Frais</span>
                                <div className="text-4xl font-black text-slate-900 relative z-10">{totalMateriel} <span className="text-lg text-slate-500 font-normal">CHF</span></div>
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
                            <table className="w-full text-left text-sm min-w-[520px]">
                                <thead className="bg-white/50 text-slate-400 font-bold uppercase text-xs">
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
                                        <tr key={e.id} className="hover:bg-black/5">
                                            <td className="p-4 text-slate-600 font-mono">{e.date}</td>
                                            <td className="p-4 text-slate-900 font-medium">
                                                {e.user_name}
                                            </td>
                                            <td className="p-4 text-right font-mono font-bold text-slate-900">
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
                            {entries.length === 0 && <div className="p-8 text-center text-slate-400 italic">Aucune saisie</div>}
                        </div>

                        {/* FAB Removed */}
                    </div>
                )}

                {/* INFO TAB */}
                {activeTab === 'INFO' && (
                    <div className="card space-y-6 animate-slide-up">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase">Dates</label>
                                <div className="mt-2 text-slate-900 font-mono flex items-center gap-2">
                                    <Calendar size={16} className="text-ohm-primary" />
                                    {chantier.date_start || 'Non défini'} → {chantier.date_end || '...'}
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase">Adresse Travaux</label>
                                <div className="mt-2 text-slate-900">{chantier.address_work || '-'}</div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase">Adresse Facturation</label>
                                <div className="mt-2 text-slate-900">{chantier.address_billing || '-'}</div>
                            </div>
                            <div className="col-span-full">
                                <label className="text-xs font-bold text-slate-400 uppercase">Remarques</label>
                                <div className="mt-2 p-4 bg-white rounded-lg text-slate-600 whitespace-pre-wrap">
                                    {chantier.remarque || 'Aucune remarque.'}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>

            {/* ENTRY MODAL */}
            {showEntryModal && (
                <div className="fixed inset-0 bg-white/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 safe-top safe-bottom">
                    <div className="w-full max-w-2xl bg-white rounded-3xl border border-slate-300 shadow-2xl overflow-hidden animate-fade-in ring-1 ring-white/10 max-h-[90vh] flex flex-col">
                        <div className="p-4 sm:p-8 border-b border-black/5 flex justify-between items-center bg-slate-50 shrink-0">
                            <div>
                                <h3 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">Nouvelle Saisie</h3>
                                <div className="text-slate-500 text-sm mt-1">Ajoutez des heures ou du matériel pour ce chantier.</div>
                            </div>
                            <button onClick={() => setShowEntryModal(false)} className="p-2 rounded-full hover:bg-white/10 text-slate-500 hover:text-slate-900 transition-colors shrink-0">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleEntrySubmit} className="p-4 sm:p-8 space-y-6 sm:space-y-8 overflow-y-auto overflow-x-hidden">

                            <div className="min-w-0">
                                <label className="text-xs font-bold text-ohm-primary uppercase tracking-widest mb-2 block">Date</label>
                                <AwesomeDatePicker value={entryDate} onChange={d => setEntryDate(d)} />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
                                <div className="bg-slate-50/50 p-4 sm:p-6 rounded-2xl border border-slate-300/50 hover:border-ohm-primary/50 transition-colors group">
                                    <label className="flex items-center gap-2 text-sm font-bold text-slate-500 uppercase mb-4 group-hover:text-slate-900 transition-colors">
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
                                            className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-red-500/20 text-slate-900 hover:text-red-400 flex items-center justify-center transition-colors shadow-lg"
                                        >
                                            <Minus size={20} strokeWidth={3} />
                                        </button>

                                        <div className="relative flex-1">
                                            <input
                                                type="number"
                                                step="0.5"
                                                inputMode="decimal"
                                                autoFocus
                                                className="w-full bg-transparent text-center text-4xl font-black text-slate-900 py-2 focus:outline-none placeholder-slate-700 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                placeholder="0"
                                                value={entryForm.heures}
                                                onChange={e => setEntryForm({ ...entryForm, heures: e.target.value })}
                                            />
                                            <span className="absolute right-0 bottom-4 text-slate-400 font-bold text-xs uppercase tracking-wider">HRS</span>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                const current = parseFloat(entryForm.heures) || 0;
                                                setEntryForm({ ...entryForm, heures: (current + 0.5).toString() });
                                            }}
                                            className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-ohm-primary text-slate-900 hover:text-ohm-bg flex items-center justify-center transition-colors shadow-lg"
                                        >
                                            <Plus size={20} strokeWidth={3} />
                                        </button>
                                    </div>
                                </div>

                                <div className="bg-slate-50/50 p-4 sm:p-6 rounded-2xl border border-slate-300/50 hover:border-blue-500/50 transition-colors group">
                                    <label className="flex items-center gap-2 text-sm font-bold text-slate-500 uppercase mb-4 group-hover:text-slate-900 transition-colors">
                                        <div className="w-4 h-4 rounded-full border-2 border-blue-500"></div>
                                        Matériel / Frais
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.01"
                                            inputMode="decimal"
                                            className="w-full bg-transparent text-center text-4xl font-black text-slate-900 py-2 focus:outline-none placeholder-slate-700 appearance-none [&::-webkit-inner-spin-button]:appearance-none border-b-2 border-transparent focus:border-blue-500 transition-all"
                                            placeholder="0.00"
                                            value={entryForm.materiel}
                                            onChange={e => setEntryForm({ ...entryForm, materiel: e.target.value })}
                                        />
                                        <span className="absolute right-0 bottom-4 text-slate-400 font-bold text-xs uppercase tracking-wider">CHF</span>
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

            {/* EDIT MODAL */}
            {showEditModal && (
                <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 safe-top safe-bottom">
                    <div className="card w-full max-w-2xl animate-slide-up max-h-[90vh] overflow-y-auto overflow-x-hidden">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-slate-900 uppercase">Modifier le chantier</h3>
                            <button onClick={() => setShowEditModal(false)}><X className="text-slate-500" /></button>
                        </div>
                        <form onSubmit={handleEditSubmit} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase">Nom</label>
                                    <input type="text" required autoFocus className="input-field mt-1" value={editForm.nom} onChange={e => setEditForm({ ...editForm, nom: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase">Année</label>
                                    <input type="number" inputMode="numeric" pattern="[0-9]*" required className="input-field mt-1" value={editForm.annee} onChange={e => setEditForm({ ...editForm, annee: parseInt(e.target.value) })} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                                <div className="min-w-0">
                                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Dates</label>
                                    <div className="flex flex-col gap-2 mt-1">
                                        <AwesomeDatePicker value={editForm.date_start || ''} onChange={d => setEditForm({ ...editForm, date_start: d })} placeholder="Début" />
                                        <AwesomeDatePicker value={editForm.date_end || ''} onChange={d => setEditForm({ ...editForm, date_end: d })} minDate={editForm.date_start} placeholder="Fin" />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Statut</label>
                                    <div className="mt-1">
                                        <AwesomeSelect
                                            value={editForm.status}
                                            onChange={(v: string) => setEditForm({ ...editForm, status: v as any })}
                                            options={[
                                                { value: 'FUTURE', label: 'À venir' },
                                                { value: 'ACTIVE', label: 'En cours' },
                                                { value: 'DONE', label: 'Terminé' }
                                            ]}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase">Adresse Travaux</label>
                                    <input type="text" className="input-field mt-1" value={editForm.address_work || ''} onChange={e => setEditForm({ ...editForm, address_work: e.target.value })} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase">Adresse Facturation</label>
                                    <input type="text" className="input-field mt-1" value={editForm.address_billing || ''} onChange={e => setEditForm({ ...editForm, address_billing: e.target.value })} />
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase">Remarques</label>
                                <textarea className="input-field mt-1 min-h-[100px]" value={editForm.remarque || ''} onChange={e => setEditForm({ ...editForm, remarque: e.target.value })} />
                            </div>

                            <div className="pt-4 flex justify-end gap-3">
                                <button type="button" onClick={() => setShowEditModal(false)} className="px-6 py-3 rounded-lg font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100">Annuler</button>
                                <button type="submit" className="px-6 py-3 rounded-lg font-bold bg-ohm-primary text-ohm-bg hover:bg-yellow-300">ENREGISTRER</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* DOCUMENT EXPLORER */}
            {showExplorer && (
                <DocumentExplorer
                    chantierId={chantier.id}
                    chantierNom={chantier.nom}
                    isAdmin={currentUser.role === 'admin'}
                    onClose={() => setShowExplorer(false)}
                />
            )}
        </div>
    );
};
