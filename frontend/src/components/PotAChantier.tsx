import React, { useEffect, useState } from 'react';
import { Inbox, CalendarPlus, User as UserIcon } from 'lucide-react';
import { Chantier, User } from '../types';
import { api } from '../api';
import { AgendaFormModal, AgendaFormValues, emptyFormValues } from './AgendaForm';

// Chantiers créés mais sans aucune chantier_assignment — pas encore
// planifiés. "Planifier" ouvre le même AgendaFormModal que l'Agenda, avec le
// chantier verrouillé (voir lockedChantier dans AgendaForm.tsx) : pas de
// second composant, juste ce champ en plus sur celui qui existe déjà.
interface Props {
    currentUser: User;
}

export const PotAChantier: React.FC<Props> = ({ currentUser: _currentUser }) => {
    const [chantiers, setChantiers] = useState<Chantier[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [planning, setPlanning] = useState<{ chantier: Chantier; initial: AgendaFormValues } | null>(null);

    const fetchPot = () => {
        api.get('/api/chantiers?has_assignments=false')
            .then(res => res.ok && res.json())
            .then((data: Chantier[] | false) => data && setChantiers(data));
    };
    useEffect(() => {
        fetchPot();
        api.get('/api/users').then(res => res.ok && res.json()).then((data: User[] | false) => data && setUsers(data));
    }, []);

    const openPlanifier = (c: Chantier) => {
        const today = new Date().toISOString().split('T')[0];
        setPlanning({ chantier: c, initial: { ...emptyFormValues(today), chantierId: c.id.toString() } });
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div>
                <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                    <Inbox className="text-primary" />
                    <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Pot à chantier</span>
                </h2>
                <p className="text-slate-500 mt-1">Chantiers créés mais pas encore planifiés — aucun employé affecté</p>
            </div>

            <div className="space-y-2">
                {chantiers.map(c => (
                    <div key={c.id} className="card p-4 flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <div className="font-bold text-slate-900 text-lg">{c.nom}</div>
                            <div className="text-sm text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                                {c.referent_name && (
                                    <span className="flex items-center gap-1"><UserIcon size={14} /> {c.referent_name}</span>
                                )}
                                {c.numero && <span className="font-mono">N° {c.numero}</span>}
                                <span>{c.created_at ? new Date(c.created_at).toLocaleDateString('fr-CH') : 'Date inconnue'}</span>
                            </div>
                        </div>
                        <button
                            onClick={() => openPlanifier(c)}
                            className="px-5 py-2.5 rounded-lg font-bold text-sm bg-primary text-white hover:bg-primary-dark transition-all flex items-center gap-2 shrink-0"
                        >
                            <CalendarPlus size={16} /> Planifier
                        </button>
                    </div>
                ))}
            </div>

            {chantiers.length === 0 && (
                <div className="text-center py-24 text-slate-400 border border-dashed border-black/5 rounded-3xl bg-white/5 backdrop-blur-sm">
                    <Inbox size={64} className="mx-auto mb-6 opacity-20 text-slate-900" />
                    <p className="text-xl font-medium">Le pot est vide — tous les chantiers sont planifiés.</p>
                </div>
            )}

            {planning && (
                <AgendaFormModal
                    mode="create"
                    initial={planning.initial}
                    users={users}
                    sidebarUserIds={users.map(u => u.id)}
                    lockedChantier={planning.chantier}
                    onClose={() => setPlanning(null)}
                    onSaved={fetchPot}
                />
            )}
        </div>
    );
};
