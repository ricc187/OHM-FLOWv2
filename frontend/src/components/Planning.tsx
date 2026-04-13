import React, { useEffect, useState, useMemo } from 'react';
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
    const [holidays, setHolidays] = useState<Record<string, string>>({});

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    useEffect(() => {
        fetch(`https://calendrier.api.gouv.fr/jours-feries/metropole/${year}.json`)
            .then(res => res.json())
            .then(data => setHolidays(data))
            .catch(err => console.error("Erreur lors du chargement des jours fériés", err));
    }, [year]);

    const allLeaves = useMemo(() => {
        const synthHolidays: Leave[] = Object.entries(holidays).map(([date, name], idx) => ({
            id: -(idx + 1), // Negative IDs for synthetic items to avoid clash
            user_id: 0,
            user_name: `🌟 ${name}`,
            type: 'HOLIDAY',
            date_start: date,
            date_end: date,
            days_count: 1,
            status: 'APPROVED'
        }));
        return [...leaves, ...synthHolidays];
    }, [leaves, holidays]);

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

            // Find overlapping leaves
            const dayLeaves = allLeaves
                .filter(l => (l.status === 'APPROVED' || l.status === 'PENDING') && isWithinRange(new Date(year, month, d), l.date_start, l.date_end))
                .sort((a, b) => {
                    if (a.type === 'HOLIDAY' && b.type !== 'HOLIDAY') return -1;
                    if (a.type !== 'HOLIDAY' && b.type === 'HOLIDAY') return 1;
                    return b.id - a.id; 
                }); // Sort to keep holidays on top and keep consistent order

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
                        
                        let extraClass = '';
                        if (l.type === 'HOLIDAY') {
                            extraClass = 'bg-purple-500/20 text-purple-300 border border-purple-500/30 font-extrabold uppercase italic tracking-wider shadow-purple-500/10 shadow-inner z-10 mx-0 mt-1 mb-1';
                        } else if (l.status === 'APPROVED') {
                            extraClass = 'bg-green-500/20 text-green-400 border border-green-500/30';
                        } else {
                            extraClass = 'bg-orange-500/20 text-orange-400 border border-orange-500/30';
                        }

                        return (
                            <div
                                key={l.id}
                                className={`py-1 text-[10px] truncate flex items-center gap-1 shadow-sm opacity-90 h-6 ${roundedClass} ${marginClass} ${extraClass} ${continuesFromPrev ? 'pl-2' : 'pl-2'} ${continuesToNext ? 'pr-2' : 'pr-2'} ${l.type === 'HOLIDAY' ? 'justify-center border-l border-r' : 'font-bold'}`}
                                title={`${l.user_name} - ${l.type}`}
                            >
                                {/* Only show dot on start or if space permits? Showing it always is fine for now */}
                                {isStart && l.type !== 'HOLIDAY' && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-current"></span>}
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

    // Admin Edit Leave State
    const [editingLeaveId, setEditingLeaveId] = useState<number | null>(null);
    const [editLeaveForm, setEditLeaveForm] = useState({ start_date: '', end_date: '', type: 'VACATION', admin_note: '' });

    useEffect(() => {
        fetchLeaves();
    }, [activeTab]);

    const fetchLeaves = async () => {
        const url = activeTab === 'MY_LEAVES'
            ? `/api/leaves?user_id=${currentUser.id}`
            : '/api/leaves';
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` } });
        if (res.ok) setLeaves(await res.json());
    };

    const handleCreateLeave = async (e: React.FormEvent) => {
        e.preventDefault();
        const res = await fetch('/api/leaves', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('ohm_token')}`
            },
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('ohm_token')}`
            },
            body: JSON.stringify({ status })
        });
        if (res.ok) fetchLeaves();
    };

    const handleSaveEditLeave = async (leaveId: number) => {
        const res = await fetch(`/api/leaves/${leaveId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('ohm_token')}`
            },
            body: JSON.stringify({
                date_start: editLeaveForm.start_date,
                date_end: editLeaveForm.end_date,
                type: editLeaveForm.type,
                admin_note: editLeaveForm.admin_note
                 // Simplification: we might need to recalculate days_count, but let's assume default 1 or let backend/admin fix
                 // Ideally calculate working days here. We'll leave it as is for UI update.
            })
        });
        if (res.ok) {
            setEditingLeaveId(null);
            fetchLeaves();
        } else {
            alert('Erreur lors de la modification');
        }
    };

    const startEditingLeave = (leave: Leave) => {
        setEditingLeaveId(leave.id);
        setEditLeaveForm({
            start_date: leave.date_start,
            end_date: leave.date_end,
            type: leave.type,
            admin_note: leave.admin_note || ''
        });
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
                        <button onClick={() => setActiveTab('VALIDATION')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${activeTab === 'VALIDATION' ? 'bg-slate-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}>GESTION DES CONGÉS</button>
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
                                    {l.admin_note && (
                                        <div className="mt-2 text-xs italic text-gray-400 bg-slate-800/50 p-2 rounded border border-slate-700">
                                            <span className="font-bold text-ohm-primary mr-1">Note de l'admin:</span>
                                            {l.admin_note}
                                        </div>
                                    )}
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
                    <h3 className="font-bold text-white uppercase tracking-wider mb-4">Gestion des Congés</h3>
                    {[...leaves].sort((a, b) => {
                        if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
                        if (a.status !== 'PENDING' && b.status === 'PENDING') return 1;
                        return new Date(b.date_start).getTime() - new Date(a.date_start).getTime();
                    }).map(l => (
                        <div key={l.id} className={`card p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 border-l-4 ${l.status === 'PENDING' ? 'border-l-ohm-primary' : 'border-l-slate-700'}`}>
                            <div className="flex items-start gap-4 w-full md:w-auto">
                                <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center font-bold text-white shrink-0 mt-1">
                                    {l.user_name?.[0]}
                                </div>
                                <div className="flex-1">
                                    <div className="font-bold text-white text-lg flex items-center gap-3">
                                        {l.user_name}
                                        <StatusBadge status={l.status} type="leave" />
                                    </div>
                                    
                                    {editingLeaveId === l.id ? (
                                        <div className="mt-2 space-y-2">
                                            <div className="flex items-center gap-2 text-sm">
                                                <input type="date" className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white" value={editLeaveForm.start_date} onChange={e => setEditLeaveForm({...editLeaveForm, start_date: e.target.value})} />
                                                <span className="text-gray-500">➔</span>
                                                <input type="date" className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white" value={editLeaveForm.end_date} onChange={e => setEditLeaveForm({...editLeaveForm, end_date: e.target.value})} />
                                            </div>
                                            <select className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-xs uppercase" value={editLeaveForm.type} onChange={e => setEditLeaveForm({...editLeaveForm, type: e.target.value})}>
                                                <option value="VACATION">Vacances</option>
                                                <option value="SICKNESS">Maladie</option>
                                                <option value="OTHER">Autre</option>
                                            </select>
                                            <textarea 
                                                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm mt-2" 
                                                rows={2} 
                                                placeholder="Ajouter une note administrative (visible par l'utilisateur)..."
                                                value={editLeaveForm.admin_note} 
                                                onChange={e => setEditLeaveForm({...editLeaveForm, admin_note: e.target.value})} 
                                            />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="text-sm text-gray-400 font-mono flex items-center gap-2 mt-1">
                                                <span>{l.date_start}</span>
                                                <span className="text-slate-600">➔</span>
                                                <span>{l.date_end}</span>
                                            </div>
                                            <div className="text-xs font-bold text-orange-400 mt-1 uppercase">{renderLeaveType(l.type)}</div>
                                            {l.admin_note && (
                                                <div className="mt-2 text-xs italic text-gray-400 bg-slate-800/50 p-2 rounded border border-slate-700">
                                                    <span className="font-bold text-ohm-primary mr-1">Note:</span>
                                                    {l.admin_note}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mt-4 md:mt-0 self-end md:self-auto flex-wrap justify-end">
                                {editingLeaveId === l.id ? (
                                    <>
                                        <button onClick={() => setEditingLeaveId(null)} className="p-2 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-all text-xs font-bold uppercase">Annuler</button>
                                        <button onClick={() => handleSaveEditLeave(l.id)} className="px-4 py-2 rounded-lg bg-blue-500 text-white font-bold hover:bg-blue-400 transition-all text-xs uppercase">Enregistrer</button>
                                    </>
                                ) : (
                                    <>
                                        <button onClick={() => startEditingLeave(l)} className="p-2 rounded-lg bg-slate-800 text-gray-400 hover:text-white hover:bg-slate-700 transition-all font-bold text-xs mr-2 border border-slate-700">MODIFIER</button>
                                        {l.status === 'PENDING' && (
                                            <>
                                                <button onClick={() => handleValidation(l.id, 'REJECTED')} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all text-xs font-bold uppercase">Refuser</button>
                                                <button onClick={() => handleValidation(l.id, 'APPROVED')} className="px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 font-bold transition-all shadow-lg shadow-primary/20 text-xs uppercase">Valider</button>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                    {leaves.length === 0 && (
                        <div className="p-12 text-center text-gray-500 italic flex flex-col items-center border-2 border-dashed border-slate-800 rounded-xl">
                            <Clock size={48} className="opacity-20 mb-4" />
                            <p>Aucune demande de congé.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
