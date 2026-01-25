import React, { useEffect, useState } from 'react';
import { User, Leave } from '../types';
import { Calendar, Plus, Clock } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

interface Props {
    currentUser: User;
}

type Tab = 'GLOBAL' | 'MY_LEAVES' | 'VALIDATION';

export const Planning: React.FC<Props> = ({ currentUser }) => {
    const [activeTab, setActiveTab] = useState<Tab>('GLOBAL');
    const [leaves, setLeaves] = useState<Leave[]>([]);

    // New Leave State
    const [showNewLeave, setShowNewLeave] = useState(false);
    const [newLeave, setNewLeave] = useState({ start_date: '', end_date: '', type: 'VACATION' });

    useEffect(() => {
        fetchLeaves();
    }, [activeTab]);

    const fetchLeaves = async () => {
        const url = activeTab === 'MY_LEAVES'
            ? `/api/leaves?user_id=${currentUser.id}`
            : '/api/leaves';
        const res = await fetch(url);
        if (res.ok) setLeaves(await res.json());
    };

    const handleCreateLeave = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch('/api/leaves', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                type: newLeave.type,
                date_start: newLeave.start_date,
                date_end: newLeave.end_date,
                days_count: 1
            })
        });
        if (res.ok) {
            setNewLeave({ start_date: '', end_date: '', type: 'VACATION' });
            setShowNewLeave(false);
            fetchLeaves();
        }
    };

    const handleValidation = async (leaveId: number, status: 'APPROVED' | 'REJECTED') => {
        const res = await fetch(`/api/leaves/${leaveId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (res.ok) fetchLeaves();
    };

    const renderLeaveType = (type: string) => {
        switch (type) {
            case 'VACATION': return 'Vacances';
            case 'SICKNESS': return 'Maladie';
            case 'OTHER': return 'Autre';
            default: return type;
        }
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Calendar className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Planning & Congés</span>
                    </h2>
                    <p className="text-gray-400 mt-1">Vue d'équipe et gestion des absences</p>
                </div>

                <div className="flex bg-slate-800 p-1 rounded-lg">
                    <button onClick={() => setActiveTab('GLOBAL')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'GLOBAL' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}>PLANNING</button>
                    <button onClick={() => setActiveTab('MY_LEAVES')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'MY_LEAVES' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}>MES CONGÉS</button>
                    {currentUser.role === 'admin' && (
                        <button onClick={() => setActiveTab('VALIDATION')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'VALIDATION' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}>VALIDATION</button>
                    )}
                </div>
            </div>

            {/* GLOBAL PLANNING */}
            {activeTab === 'GLOBAL' && (
                <div className="card space-y-4">
                    <h3 className="font-bold text-white uppercase tracking-wider mb-4">Absences à venir</h3>
                    <div className="space-y-2">
                        {leaves.filter(l => l.status === 'APPROVED').map(l => (
                            <div key={l.id} className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border-l-4 border-l-orange-400">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-slate-800 rounded-full flex items-center justify-center font-bold text-xs text-white">
                                        {l.user_name?.[0]}
                                    </div>
                                    <div>
                                        <div className="font-bold text-white">{l.user_name}</div>
                                        <div className="text-xs text-gray-400 font-mono">{l.date_start} au {l.date_end}</div>
                                    </div>
                                </div>
                                <div className="text-sm text-gray-500 font-medium uppercase">{renderLeaveType(l.type)}</div>
                            </div>
                        ))}
                        {leaves.filter(l => l.status === 'APPROVED').length === 0 && (
                            <div className="text-center py-8 text-gray-500 italic">Aucune absence prévue</div>
                        )}
                    </div>
                </div>
            )}

            {/* MY LEAVES */}
            {activeTab === 'MY_LEAVES' && (
                <div className="space-y-6">
                    <button
                        onClick={() => setShowNewLeave(!showNewLeave)}
                        className="w-full py-4 border-2 border-dashed border-slate-700 rounded-xl text-gray-400 hover:text-white hover:border-ohm-primary hover:bg-slate-800 transition-all flex items-center justify-center gap-2 font-bold uppercase tracking-widest"
                    >
                        <Plus /> Nouvelle Demande
                    </button>

                    {showNewLeave && (
                        <div className="card border-l-4 border-l-ohm-primary animate-slide-up">
                            <form onSubmit={handleCreateLeave} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase">Début</label>
                                        <input type="date" required className="input-field mt-1" value={newLeave.start_date} onChange={e => setNewLeave({ ...newLeave, start_date: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase">Fin</label>
                                        <input type="date" required className="input-field mt-1" value={newLeave.end_date} onChange={e => setNewLeave({ ...newLeave, end_date: e.target.value })} />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-gray-500 uppercase">Type</label>
                                    <select className="input-field mt-1" value={newLeave.type} onChange={e => setNewLeave({ ...newLeave, type: e.target.value })}>
                                        <option value="VACATION">Vacances</option>
                                        <option value="SICKNESS">Maladie</option>
                                        <option value="OTHER">Autre</option>
                                    </select>
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setShowNewLeave(false)} className="px-6 py-2 rounded-lg font-bold text-gray-400 hover:text-white hover:bg-slate-700 transition-colors">ANNULER</button>
                                    <button type="submit" className="px-6 py-2 rounded-lg font-bold bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-colors">ENVOYER</button>
                                </div>
                            </form>
                        </div>
                    )}

                    <div className="space-y-2">
                        {leaves.map(l => (
                            <div key={l.id} className="card p-4 flex items-center justify-between">
                                <div>
                                    <div className="font-bold text-white text-lg">{renderLeaveType(l.type)}</div>
                                    <div className="text-sm text-gray-400 font-mono mt-1 flex items-center gap-2">
                                        <span>{l.date_start}</span>
                                        <span className="text-slate-600">➔</span>
                                        <span>{l.date_end}</span>
                                    </div>
                                </div>
                                <StatusBadge status={l.status} type="leave" />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ADMIN VALIDATION */}
            {activeTab === 'VALIDATION' && currentUser.role === 'admin' && (
                <div className="space-y-4">
                    <h3 className="font-bold text-white uppercase tracking-wider mb-4">Demandes en attente</h3>
                    {leaves.filter(l => l.status === 'PENDING').map(l => (
                        <div key={l.id} className="card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-l-4 border-l-ohm-primary">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center font-bold text-white">
                                    {l.user_name?.[0]}
                                </div>
                                <div>
                                    <div className="font-bold text-white text-lg">{l.user_name}</div>
                                    <div className="text-sm text-gray-400 font-mono flex items-center gap-2">
                                        <span>{l.date_start}</span>
                                        <span className="text-slate-600">➔</span>
                                        <span>{l.date_end}</span>
                                    </div>
                                    <div className="text-xs font-bold text-orange-400 mt-1 uppercase">{renderLeaveType(l.type)}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleValidation(l.id, 'REJECTED')} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all">Refuser</button>
                                <button onClick={() => handleValidation(l.id, 'APPROVED')} className="px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 font-bold transition-all shadow-lg shadow-primary/20">Valider</button>
                            </div>
                        </div>
                    ))}
                    {leaves.filter(l => l.status === 'PENDING').length === 0 && (
                        <div className="p-12 text-center text-gray-500 italic flex flex-col items-center border-2 border-dashed border-slate-800 rounded-xl">
                            <Clock size={48} className="opacity-20 mb-4" />
                            <p>Toutes les demandes ont été traitées.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
