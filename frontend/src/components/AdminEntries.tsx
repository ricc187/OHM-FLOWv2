import React, { useEffect, useState } from 'react';
import { Entry } from '../types';
import { Check, X } from 'lucide-react';

interface Props {
    currentUser: any;
}

export const AdminEntries: React.FC<Props> = () => {
    const [entries, setEntries] = useState<Entry[]>([]);
    
    // Edit state
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState({
        heures: '',
        materiel: ''
    });

    useEffect(() => {
        fetchPendingEntries();
    }, []);

    const fetchPendingEntries = async () => {
        const res = await fetch('/api/entries/pending', { headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` } });
        if (res.ok) {
            setEntries(await res.json());
        }
    };

    const handleValidate = async (entryId: number) => {
        const res = await fetch(`/api/entries/${entryId}/validate`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` }
        });
        if (res.ok) {
            setEditingId(null);
            fetchPendingEntries();
        }
    };

    const handleSaveEdit = async (entryId: number) => {
        const res = await fetch(`/api/entries/${entryId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('ohm_token')}`
            },
            body: JSON.stringify({
                heures: parseFloat(editForm.heures) || 0,
                materiel: parseFloat(editForm.materiel) || 0
            })
        });
        
        if (res.ok) {
            setEditingId(null);
            fetchPendingEntries();
        } else {
            alert('Erreur lors de la modification');
        }
    };

    const startEditing = (entry: Entry) => {
        setEditingId(entry.id);
        setEditForm({
            heures: entry.heures.toString(),
            materiel: entry.materiel.toString()
        });
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
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` }
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
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Check className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Validation Saisies</span>
                    </h2>
                    <p className="text-slate-500 mt-1">Validez les heures et le matériel saisis par les équipes</p>
                </div>
                <div className="bg-slate-50 px-4 py-2 rounded-lg text-slate-900 font-mono font-bold">
                    {entries.length} En attente
                </div>
            </div>

            <div className="card overflow-hidden p-0">
                <table className="w-full text-left text-sm">
                    <thead className="bg-white/50 text-slate-400 font-bold uppercase text-xs">
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
                            <tr key={e.id} className="hover:bg-black/5 transition-colors">
                                <td className="p-4 text-slate-600 font-mono">{e.date}</td>
                                <td className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-900">
                                            {e.user_name?.[0]}
                                        </div>
                                        <div>
                                            <div className="text-slate-900 font-medium">{e.user_name}</div>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 text-slate-600">
                                    {e.chantier_nom}
                                </td>
                                <td className="p-4 text-right font-mono font-bold text-slate-900">
                                    {editingId === e.id ? (
                                        <input 
                                            type="number" 
                                            step="0.5" 
                                            className="w-20 bg-white/40 border border-black/10 rounded px-2 py-1 text-right focus:outline-none focus:border-ohm-primary" 
                                            value={editForm.heures} 
                                            onChange={ev => setEditForm({...editForm, heures: ev.target.value})}
                                        />
                                    ) : (
                                        e.heures > 0 ? `${e.heures} h` : '-'
                                    )}
                                </td>
                                <td className="p-4 text-right font-mono font-bold text-blue-400">
                                    {editingId === e.id ? (
                                        <input 
                                            type="number" 
                                            step="0.01" 
                                            className="w-20 bg-white/40 border border-black/10 rounded px-2 py-1 text-right focus:outline-none focus:border-blue-500 text-slate-900" 
                                            value={editForm.materiel} 
                                            onChange={ev => setEditForm({...editForm, materiel: ev.target.value})}
                                        />
                                    ) : (
                                        e.materiel > 0 ? `${e.materiel} .-` : '-'
                                    )}
                                </td>
                                <td className="p-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        {editingId === e.id ? (
                                            <>
                                                <button
                                                    onClick={() => setEditingId(null)}
                                                    className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 transition-all"
                                                    title="Annuler"
                                                >
                                                    <X size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleSaveEdit(e.id)}
                                                    className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-slate-900 transition-all"
                                                    title="Enregistrer"
                                                >
                                                    <Check size={18} />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => startEditing(e)}
                                                    className="p-2 rounded-lg bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all font-bold text-xs"
                                                    title="Modifier"
                                                >
                                                    MODIFIER
                                                </button>
                                                <button
                                                    onClick={() => handleReject(e.id)}
                                                    className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-slate-900 transition-all"
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
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {entries.length === 0 && (
                    <div className="p-12 text-center text-slate-400 italic flex flex-col items-center">
                        <Check size={48} className="opacity-20 mb-4" />
                        <p>Tout est à jour ! Aucune saisie en attente.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
