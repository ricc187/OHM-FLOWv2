import React, { useEffect, useState } from 'react';
import { User, Leave } from '../types';
import { Calendar, Plus, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

// Helper to get days in month
const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

// Helper to check if a date is within a range (inclusive)
const isWithinRange = (checkDate: Date, start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    // Reset hours to avoid timezone issues/miscalculations for full days
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate >= s && checkDate <= e;
};

const CalendarView = ({ leaves }: { leaves: Leave[] }) => {
    const [currentDate, setCurrentDate] = useState(new Date());

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun, 1=Mon
    // Adjust for Monday start (Mon=0, ..., Sun=6)
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;

    const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    const renderDays = () => {
        const days = [];
        // Empty cells for offset
        for (let i = 0; i < startOffset; i++) {
            days.push(<div key={`empty-${i}`} className="h-24 bg-slate-900/30 border border-slate-800/50"></div>);
        }

        // Days of month
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month, d);
            // dateStr removed as it was unused

            // Find overlapping leaves
            const dayLeaves = leaves
                .filter(l => (l.status === 'APPROVED' || l.status === 'PENDING') && isWithinRange(new Date(year, month, d), l.date_start, l.date_end))
                .sort((a, b) => a.id - b.id); // Sort by ID to keep consistent order across days

            days.push(
                <div key={d} className="min-h-[6rem] bg-slate-900/50 border border-slate-800 pt-2 px-0 flex flex-col gap-1 overflow-hidden hover:bg-slate-800/50 transition-colors p-0">
                    <span className={`text-sm font-mono font-bold self-end mb-1 mr-2 ${new Date().toDateString() === dateObj.toDateString()
                        ? 'bg-ohm-primary text-black w-6 h-6 rounded-full flex items-center justify-center'
                        : 'text-gray-500'
                        }`}>{d}</span>

                    {dayLeaves.map(l => {
                        const isStart = new Date(l.date_start).getTime() === dateObj.getTime();
                        const isEnd = new Date(l.date_end).getTime() === dateObj.getTime();
                        // Also check if it continues from yesterday (even if not start date, e.g. spanning months)
                        const continuesFromPrev = !isStart && d > 1;
                        // Check if continues to tomorrow
                        const continuesToNext = !isEnd && d < daysInMonth;

                        let roundedClass = 'rounded';
                        let marginClass = 'mx-1';

                        if (continuesFromPrev && continuesToNext) {
                            roundedClass = 'rounded-none';
                            marginClass = 'mx-0 border-l-0 border-r-0';
                        } else if (continuesFromPrev) {
                            roundedClass = 'rounded-l-none rounded-r';
                            marginClass = 'ml-0 mr-1 border-l-0';
                        } else if (continuesToNext) {
                            roundedClass = 'rounded-l rounded-r-none';
                            marginClass = 'ml-1 mr-0 border-r-0';
                        }

                        return (
                            <div
                                key={l.id}
                                className={`py-1 text-[10px] font-bold truncate flex items-center gap-1 shadow-sm h-6 ${roundedClass} ${marginClass} ${l.status === 'APPROVED'
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                    : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                    } ${continuesFromPrev ? 'pl-2' : 'pl-2'} ${continuesToNext ? 'pr-2' : 'pr-2'}`}
                                title={`${l.user_name} - ${l.type}`}
                            >
                                {/* Only show dot on start or if space permits? Showing it always is fine for now */}
                                {isStart && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-current"></span>}
                                {/* Hide text if it's a middle segment to save space, or keep it for readability? Keeping it. */}
                                {l.user_name}
                            </div>
                        );
                    })}
                </div>
            );
        }
        return days;
    };

    return (
        <div className="card p-0 overflow-hidden border border-slate-700">
            {/* Calendar Header */}
            <div className="p-4 flex items-center justify-between bg-slate-800 border-b border-slate-700">
                <button onClick={prevMonth} className="p-2 hover:bg-slate-700 rounded-lg text-gray-400 hover:text-white transition-colors"><ChevronLeft /></button>
                <h3 className="text-xl font-bold text-white uppercase tracking-wider">{monthNames[month]} {year}</h3>
                <button onClick={nextMonth} className="p-2 hover:bg-slate-700 rounded-lg text-gray-400 hover:text-white transition-colors"><ChevronRight /></button>
            </div>

            {/* Days Header */}
            <div className="grid grid-cols-7 bg-slate-900 border-b border-slate-700">
                {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => (
                    <div key={d} className="p-3 text-center text-xs font-bold text-gray-500 uppercase tracking-widest">{d}</div>
                ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 bg-slate-950">
                {renderDays()}
            </div>

            <div className="p-4 bg-slate-900 border-t border-slate-800 flex gap-6 text-xs text-gray-400 font-mono">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-green-500/20 border border-green-500/30"></span> Validé
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded bg-orange-500/20 border border-orange-500/30"></span> En Attente
                </div>
            </div>
        </div>
    );
};

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

            {/* GLOBAL PLANNING (CALENDAR) */}
            {activeTab === 'GLOBAL' && (
                <CalendarView leaves={leaves} />
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
