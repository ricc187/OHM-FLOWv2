import React, { useEffect, useState } from 'react';
import { Entry } from '../types';
import { Check, X } from 'lucide-react';

interface Props {
    currentUser: any;
}

export const AdminEntries: React.FC<Props> = () => {
    const [entries, setEntries] = useState<Entry[]>([]);

    useEffect(() => {
        fetchPendingEntries();
    }, []);

    const fetchPendingEntries = async () => {
        const res = await fetch('/api/entries/pending');
        if (res.ok) {
            setEntries(await res.json());
        }
    };

    const handleValidate = async (entryId: number) => {
        const res = await fetch(`/api/entries/${entryId}/validate`, {
            method: 'PUT'
        });
        if (res.ok) {
            fetchPendingEntries();
        }
    };

    const handleReject = async (entryId: number) => {
        // For now, rejection just deletes the entry or sets separate status?
        // Schema says status: 'PENDING' | 'VALIDATED'. Maybe delete or add 'REJECTED' status?
        // Requirement says "Valider/Refuser".
        // Let's assume Delete for Refuser for simplicity, or I should have added REJECTED to schema.
        // Current Schema in types.ts: 'PENDING' | 'VALIDATED'.
        // I'll stick to Delete for now as "Refuser" implies it's wrong.
        if (confirm('Refuser et supprimer cette saisie ?')) {
            const res = await fetch(`/api/entries/${entryId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                fetchPendingEntries();
            }
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Check className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Validation Saisies</span>
                    </h2>
                    <p className="text-gray-400 mt-1">Validez les heures et le matériel saisis par les équipes</p>
                </div>
                <div className="bg-slate-800 px-4 py-2 rounded-lg text-white font-mono font-bold">
                    {entries.length} En attente
                </div>
            </div>

            <div className="card overflow-hidden p-0">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-900/50 text-gray-500 font-bold uppercase text-xs">
                        <tr>
                            <th className="p-4">Date</th>
                            <th className="p-4">Ouvrier</th>
                            <th className="p-4">Chantier</th>
                            <th className="p-4 text-right">Heures</th>
                            <th className="p-4 text-right">Matériel</th>
                            <th className="p-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {entries.map(e => (
                            <tr key={e.id} className="hover:bg-white/5 transition-colors">
                                <td className="p-4 text-gray-300 font-mono">{e.date}</td>
                                <td className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-bold text-xs text-white">
                                            {e.user_name?.[0]}
                                        </div>
                                        <div>
                                            <div className="text-white font-medium">{e.user_name}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 text-gray-300">
                                    {e.chantier_nom}
                                </td>
                                <td className="p-4 text-right font-mono font-bold text-white">
                                    {e.heures > 0 ? `${e.heures} h` : '-'}
                                </td>
                                <td className="p-4 text-right font-mono font-bold text-blue-400">
                                    {e.materiel > 0 ? `${e.materiel} .-` : '-'}
                                </td>
                                <td className="p-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => handleReject(e.id)}
                                            className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                                            title="Refuser"
                                        >
                                            <X size={18} />
                                        </button>
                                        <button
                                            onClick={() => handleValidate(e.id)}
                                            className="p-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all shadow-lg shadow-primary/20"
                                            title="Valider"
                                        >
                                            <Check size={18} strokeWidth={3} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {entries.length === 0 && (
                    <div className="p-12 text-center text-gray-500 italic flex flex-col items-center">
                        <Check size={48} className="opacity-20 mb-4" />
                        <p>Tout est à jour ! Aucune saisie en attente.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
