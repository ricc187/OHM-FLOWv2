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
    const [availableUsers, setAvailableUsers] = useState<User[]>([]);
    const [newChantier, setNewChantier] = useState({
        nom: '',
        annee: new Date().getFullYear(),
        status: 'FUTURE' as ChantierStatus,
        address_work: '',
        address_billing: '',
        date_start: '',
        date_end: '',
        remarque: '',
        members: [] as number[]
    });

    useEffect(() => {
        fetchChantiers();
        if (currentUser.role === 'admin') fetchUsers();
    }, []);

    const fetchUsers = async () => {
        const res = await fetch('/api/users');
        if (res.ok) setAvailableUsers(await res.json());
    };

    useEffect(() => {
        if (filterStatus === 'ALL') {
            setFilteredChantiers(chantiers);
        } else {
            setFilteredChantiers(chantiers.filter(c => c.status === filterStatus));
        }
    }, [filterStatus, chantiers]);

    const fetchChantiers = async () => {
        const res = await fetch(`/api/chantiers?user_id=${currentUser.id}&role=${currentUser.role}`);
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
                remarque: '',
                members: []
            });
            setShowCreate(false);
            fetchChantiers();
        }
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Folder className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Chantiers</span>
                    </h2>
                    <p className="text-gray-400 mt-1">Gérez vos projets et suivez l'avancement</p>
                </div>

                <div className="flex gap-3">
                    {currentUser.role === 'admin' && (
                        <>
                            <a
                                href="/api/export"
                                target="_blank"
                                className="bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg border border-white/10 flex items-center gap-2 transition-all hover:border-white/20"
                            >
                                <Download size={18} />
                                <span className="hidden sm:inline">Export CSV</span>
                            </a>
                            <button
                                onClick={() => setShowCreate(!showCreate)}
                                className="bg-ohm-primary text-ohm-bg px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-yellow-300 transition-colors shadow-lg shadow-primary/20"
                            >
                                <Plus size={20} /> Nouveau
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Status Filter Tabs */}
            <div className="flex p-1 bg-ohm-surface border border-slate-700 rounded-xl w-full md:w-auto self-start">
                {(['ACTIVE', 'FUTURE', 'DONE', 'ALL'] as const).map(status => (
                    <button
                        key={status}
                        onClick={() => setFilterStatus(status)}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${filterStatus === status
                            ? 'bg-slate-700 text-white shadow-lg'
                            : 'text-gray-400 hover:text-white'
                            }`}
                    >
                        {status === 'ALL' ? 'TOUS' : status === 'FUTURE' ? 'À VENIR' : status === 'ACTIVE' ? 'EN COURS' : 'TERMINÉS'}
                    </button>
                ))}
            </div>

            {/* Create Form */}
            {showCreate && (
                <div className="card bg-slate-800/50 border-l-4 border-l-ohm-primary animate-slide-up relative">
                    <button
                        onClick={() => setShowCreate(false)}
                        className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                    <form onSubmit={handleCreateChantier} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase">Nom du chantier</label>
                                <input
                                    type="text"
                                    className="input-field mt-1"
                                    value={newChantier.nom}
                                    onChange={e => setNewChantier({ ...newChantier, nom: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase">Année</label>
                                <input
                                    type="number"
                                    className="input-field mt-1"
                                    value={newChantier.annee}
                                    onChange={e => setNewChantier({ ...newChantier, annee: parseInt(e.target.value) })}
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase">Dates (Début - Fin)</label>
                                <div className="flex gap-2 mt-1">
                                    <input type="date" className="input-field" value={newChantier.date_start} onChange={e => setNewChantier({ ...newChantier, date_start: e.target.value })} />
                                    <input type="date" className="input-field" value={newChantier.date_end} onChange={e => setNewChantier({ ...newChantier, date_end: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase">Statut</label>
                                <select
                                    className="input-field mt-1"
                                    value={newChantier.status}
                                    onChange={e => setNewChantier({ ...newChantier, status: e.target.value as ChantierStatus })}
                                >
                                    <option value="FUTURE">À venir</option>
                                    <option value="ACTIVE">En cours</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase">Adresse Travaux</label>
                                <input type="text" className="input-field mt-1" value={newChantier.address_work} onChange={e => setNewChantier({ ...newChantier, address_work: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase">Adresse Facturation</label>
                                <input type="text" className="input-field mt-1" value={newChantier.address_billing} onChange={e => setNewChantier({ ...newChantier, address_billing: e.target.value })} />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase">Remarques</label>
                            <textarea className="input-field mt-1 min-h-[80px]" value={newChantier.remarque} onChange={e => setNewChantier({ ...newChantier, remarque: e.target.value })} />
                        </div>

                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase mb-2 block">Assigner des membres</label>
                            <div className="flex flex-wrap gap-2">
                                {availableUsers.filter(u => u.role !== 'admin').map(u => (
                                    <button
                                        key={u.id}
                                        type="button"
                                        onClick={() => {
                                            const isSelected = newChantier.members.includes(u.id);
                                            setNewChantier(prev => ({
                                                ...prev,
                                                members: isSelected
                                                    ? prev.members.filter(id => id !== u.id)
                                                    : [...prev.members, u.id]
                                            }));
                                        }}
                                        className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${newChantier.members.includes(u.id)
                                            ? 'bg-ohm-primary text-ohm-bg border-ohm-primary'
                                            : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'
                                            }`}
                                    >
                                        {u.username}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end pt-4">
                            <button type="submit" className="w-full md:w-auto px-8 py-3 bg-ohm-primary text-ohm-bg font-bold rounded-lg hover:bg-yellow-300 transition-colors">
                                CRÉER LE CHANTIER
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredChantiers.map((c) => (
                    <ChantierCard
                        key={c.id}
                        chantier={c}
                        onClick={() => onSelectChantier(c)}
                    />
                ))}
            </div>

            {filteredChantiers.length === 0 && (
                <div className="text-center py-20 text-gray-500 border-2 border-dashed border-white/5 rounded-2xl">
                    <Folder size={48} className="mx-auto mb-4 opacity-20" />
                    <p>Aucun chantier dans cette catégorie</p>
                </div>
            )}
        </div>
    );
};
