import React, { useEffect, useState } from 'react';
import { Chantier, User, ChantierStatus } from '../types';
import { Folder, Plus, Download, X } from 'lucide-react';
import { ChantierCard } from './ChantierCard';

interface Props {
    currentUser: User;
    onSelectChantier: (c: Chantier) => void;
}

export const Dashboard: React.FC<Props> = ({ currentUser, onSelectChantier }) => {
    const [chantiers, setChantiers] = useState<Chantier[]>([]);
    const [filteredChantiers, setFilteredChantiers] = useState<Chantier[]>([]);
    const [filterStatus, setFilterStatus] = useState<ChantierStatus | 'ALL'>('ACTIVE');
    const [showCreate, setShowCreate] = useState(false);

    // Create Form State
    const [newChantier, setNewChantier] = useState({
        nom: '',
        annee: new Date().getFullYear(),
        status: 'FUTURE' as ChantierStatus,
        address_work: '',
        address_billing: '',
        date_start: '',
        date_end: '',
        remarque: ''
    });

    useEffect(() => {
        fetchChantiers();
    }, []);

    useEffect(() => {
        if (filterStatus === 'ALL') {
            setFilteredChantiers(chantiers);
        } else {
            setFilteredChantiers(chantiers.filter(c => c.status === filterStatus));
        }
    }, [filterStatus, chantiers]);

    const fetchChantiers = async () => {
        const res = await fetch(`/api/chantiers?status=ALL`);
        if (res.ok) setChantiers(await res.json());
    };

    const handleCreateChantier = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch('/api/chantiers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newChantier)
        });
        if (res.ok) {
            setNewChantier({
                nom: '',
                annee: new Date().getFullYear(),
                status: 'FUTURE',
                address_work: '',
                address_billing: '',
                date_start: '',
                date_end: '',
                remarque: ''
            });
            setShowCreate(false);
            fetchChantiers();
        }
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-5xl font-display font-black text-white flex items-center gap-4 tracking-tighter">
                        <div className="p-4 bg-primary/10 rounded-3xl border border-primary/30 shadow-[0_0_30px_rgba(255,215,0,0.2)] relative overflow-hidden group">
                            <div className="absolute inset-0 bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                            <Folder className="text-primary relative z-10 drop-shadow-[0_0_10px_rgba(255,215,0,0.5)]" size={40} />
                        </div>
                        <span className="text-gradient-gold text-glow">VOS CHANTIERS</span>
                    </h2>
                    <p className="text-text-muted mt-3 text-xl font-light tracking-wide max-w-2xl">
                        Interface de gestion <span className="text-primary font-bold">temps réel</span> pour vos projets.
                    </p>
                </div>

                <div className="flex gap-4">
                    {currentUser.role === 'admin' && (
                        <>
                            <a
                                href="/api/export"
                                target="_blank"
                                className="glass-panel px-6 py-4 rounded-xl flex items-center gap-3 transition-all hover:bg-white/5 hover:scale-105 active:scale-95 group text-white font-bold tracking-wide border-white/5"
                            >
                                <Download size={22} className="text-secondary group-hover:text-white transition-colors group-hover:drop-shadow-[0_0_8px_rgba(0,240,255,0.8)]" />
                                <span className="hidden sm:inline">EXPORT CSV</span>
                            </a>
                            {/* Old Button Removed */}
                        </>
                    )}
                </div>
            </div>

            {/* Status Filter Tabs */}
            <div className="flex p-2 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl w-full md:w-auto self-start shadow-glass relative overload-hidden">
                {(currentUser.role === 'admin'
                    ? ['ACTIVE', 'FUTURE', 'DONE', 'ALL']
                    : ['ACTIVE', 'ALL']
                ).map(status => (
                    <button
                        key={status}
                        onClick={() => setFilterStatus(status as any)}
                        className={`px-8 py-3 rounded-xl text-sm font-black tracking-wider transition-all duration-300 relative overflow-hidden ${filterStatus === status
                            ? 'text-black shadow-neon'
                            : 'text-text-muted hover:text-white hover:bg-white/5'
                            }`}
                    >
                        {filterStatus === status && (
                            <div className="absolute inset-0 bg-gradient-to-r from-primary via-primary-glow to-primary animate-[shine_3s_infinite] z-0"></div>
                        )}
                        <span className="relative z-10">
                            {status === 'ALL' ? 'TOUS' : status === 'FUTURE' ? 'À VENIR' : status === 'ACTIVE' ? 'EN COURS' : 'TERMINÉS'}
                        </span>
                    </button>
                ))}
            </div>

            {/* Large Static Create Button */}
            {currentUser.role === 'admin' && (
                <button
                    onClick={() => setShowCreate(!showCreate)}
                    className="w-full py-4 bg-gradient-to-r from-primary to-yellow-500 text-black font-black uppercase tracking-widest rounded-2xl shadow-lg hover:shadow-neon hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-3 text-lg"
                >
                    <Plus size={24} strokeWidth={3} />
                    <span>CRÉER UN NOUVEAU CHANTIER</span>
                </button>
            )}

            {/* Create Form */}
            {showCreate && (
                <div className="glass-panel p-8 animate-slide-up relative bg-black/60 border-primary/30 shadow-glow">
                    <button
                        onClick={() => setShowCreate(false)}
                        className="absolute top-4 right-4 bg-white/5 p-2 rounded-full text-gray-400 hover:text-white hover:bg-red-500/20 hover:text-red-400 transition-all"
                    >
                        <X size={20} />
                    </button>
                    <h3 className="text-xl font-bold text-white mb-6 border-l-4 border-primary pl-4">Nouveau Projet</h3>

                    <form onSubmit={handleCreateChantier} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-bold text-primary/80 uppercase tracking-widest mb-2 block">Nom du chantier</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    value={newChantier.nom}
                                    onChange={e => setNewChantier({ ...newChantier, nom: e.target.value })}
                                    required
                                    placeholder="Ex: Rénovation Villa..."
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-primary/80 uppercase tracking-widest mb-2 block">Année</label>
                                <input
                                    type="number"
                                    className="input-field"
                                    value={newChantier.annee}
                                    onChange={e => setNewChantier({ ...newChantier, annee: parseInt(e.target.value) })}
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-bold text-primary/80 uppercase tracking-widest mb-2 block">Période (Début - Fin)</label>
                                <div className="flex gap-3">
                                    <input type="date" className="input-field" value={newChantier.date_start} onChange={e => setNewChantier({ ...newChantier, date_start: e.target.value })} />
                                    <input type="date" className="input-field" value={newChantier.date_end} onChange={e => setNewChantier({ ...newChantier, date_end: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-primary/80 uppercase tracking-widest mb-2 block">Statut Initial</label>
                                <select
                                    className="input-field appearance-none"
                                    value={newChantier.status}
                                    onChange={e => setNewChantier({ ...newChantier, status: e.target.value as ChantierStatus })}
                                >
                                    <option value="FUTURE" className="bg-surface">À venir</option>
                                    <option value="ACTIVE" className="bg-surface">En cours</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-bold text-primary/80 uppercase tracking-widest mb-2 block">Adresse Travaux</label>
                                <input type="text" className="input-field" value={newChantier.address_work} onChange={e => setNewChantier({ ...newChantier, address_work: e.target.value })} placeholder="Rue, Ville..." />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-primary/80 uppercase tracking-widest mb-2 block">Adresse Facturation</label>
                                <input type="text" className="input-field" value={newChantier.address_billing} onChange={e => setNewChantier({ ...newChantier, address_billing: e.target.value })} placeholder="Si différente..." />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-primary/80 uppercase tracking-widest mb-2 block">Remarques</label>
                            <textarea className="input-field min-h-[100px]" value={newChantier.remarque} onChange={e => setNewChantier({ ...newChantier, remarque: e.target.value })} placeholder="Informations complémentaires..." />
                        </div>

                        <div className="flex justify-end pt-4">
                            <button type="submit" className="w-full md:w-auto px-8 py-3 bg-gradient-to-r from-primary to-yellow-600 text-black font-bold rounded-xl hover:shadow-glow hover:scale-[1.02] transition-all">
                                CRÉER LE CHANTIER
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredChantiers.map((c) => (
                    <ChantierCard
                        key={c.id}
                        chantier={c}
                        onClick={() => onSelectChantier(c)}
                    />
                ))}
            </div>

            {filteredChantiers.length === 0 && (
                <div className="text-center py-24 text-gray-500 border border-dashed border-white/10 rounded-3xl bg-white/5 backdrop-blur-sm">
                    <Folder size={64} className="mx-auto mb-6 opacity-20 text-white" />
                    <p className="text-xl font-medium">Aucun chantier dans cette catégorie</p>
                </div>
            )}
        </div>
    );
};
