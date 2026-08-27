import React, { useEffect, useState } from 'react';
import { X, FileText, Receipt, Image as ImageIcon, Download, Trash2, FolderDown, Archive, Loader2 } from 'lucide-react';
import { ChantierDocument, DocumentCategory } from '../types';
import { api } from '../api';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
    chantierId: number;
    chantierNom: string;
    isAdmin: boolean;
    onClose: () => void;
}

const CATEGORY_META: Record<DocumentCategory, { label: string; icon: React.ElementType }> = {
    plan: { label: 'Plans', icon: FileText },
    devis: { label: 'Devis', icon: Receipt },
    photo: { label: 'Photos', icon: ImageIcon },
};

const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

// Downloads go through fetch+blob (not a plain <a href>) so the httpOnly
// auth cookie rides along and we control the saved filename.
const downloadUrl = async (url: string, filename: string) => {
    const res = await api.get(url);
    if (!res.ok) { alert('Erreur lors du téléchargement'); return; }
    const blob = await res.blob();
    const objUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(objUrl);
};

export const DocumentExplorer: React.FC<Props> = ({ chantierId, chantierNom, isAdmin, onClose }) => {
    const [documents, setDocuments] = useState<ChantierDocument[]>([]);
    const [archived, setArchived] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | 'all' | DocumentCategory | null>(null);
    useEscapeKey(true, onClose);

    const fetchDocuments = async () => {
        setLoading(true);
        const res = await api.get(`/api/chantiers/${chantierId}/documents`);
        if (res.ok) {
            const data = await res.json();
            setDocuments(data.documents);
            setArchived(data.archived);
        }
        setLoading(false);
    };

    useEffect(() => { fetchDocuments(); }, [chantierId]);

    const handleDelete = async (doc: ChantierDocument) => {
        if (!confirm(`Supprimer "${doc.filename}" ?`)) return;
        setBusyId(doc.id);
        const res = await api.delete(`/api/documents/${doc.id}`);
        setBusyId(null);
        if (res.ok) fetchDocuments();
        else alert('Erreur lors de la suppression');
    };

    const handleDownloadCategory = async (category: DocumentCategory) => {
        setBusyId(category);
        await downloadUrl(`/api/chantiers/${chantierId}/documents/zip?category=${category}`, `${chantierNom}_${CATEGORY_META[category].label}.zip`);
        setBusyId(null);
    };

    const handleDownloadAll = async () => {
        setBusyId('all');
        await downloadUrl(`/api/chantiers/${chantierId}/documents/zip?category=all`, `${chantierNom}.zip`);
        setBusyId(null);
    };

    const byCategory = (cat: DocumentCategory) => documents.filter(d => d.category === cat);

    return (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 safe-top safe-bottom">
            <div className="w-full max-w-2xl bg-white rounded-3xl border border-slate-300 shadow-2xl overflow-hidden animate-fade-in max-h-[90vh] flex flex-col">
                <div className="p-4 sm:p-6 border-b border-black/5 flex justify-between items-center bg-slate-50 shrink-0">
                    <div className="min-w-0">
                        <h3 className="text-lg sm:text-xl font-black text-slate-900 uppercase tracking-tight truncate">Documents — {chantierNom}</h3>
                        {archived && (
                            <div className="text-xs text-amber-600 font-bold mt-1 flex items-center gap-1">
                                <Archive size={12} /> Chantier archivé — rouvrez-le pour ajouter/télécharger des fichiers individuels
                            </div>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-black/5 text-slate-500 hover:text-slate-900 transition-colors shrink-0">
                        <X size={22} />
                    </button>
                </div>

                <div className="p-4 sm:p-6 space-y-6 overflow-y-auto overflow-x-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="animate-spin" /></div>
                    ) : documents.length === 0 && !archived ? (
                        <div className="text-center text-slate-400 italic py-8">Aucun document pour ce chantier</div>
                    ) : (
                        (Object.keys(CATEGORY_META) as DocumentCategory[]).map(cat => {
                            const docs = byCategory(cat);
                            if (docs.length === 0) return null;
                            const Icon = CATEGORY_META[cat].icon;
                            return (
                                <div key={cat}>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2 text-sm font-bold text-slate-500 uppercase tracking-wider">
                                            <Icon size={16} className="text-ohm-primary" /> {CATEGORY_META[cat].label} ({docs.length})
                                        </div>
                                        {!archived && (
                                            <button
                                                onClick={() => handleDownloadCategory(cat)}
                                                disabled={busyId === cat}
                                                className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-ohm-primary transition-colors disabled:opacity-50"
                                            >
                                                {busyId === cat ? <Loader2 size={14} className="animate-spin" /> : <FolderDown size={14} />} Télécharger le dossier
                                            </button>
                                        )}
                                    </div>

                                    {cat === 'photo' ? (
                                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                            {docs.map(doc => (
                                                <div key={doc.id} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                                                    {!archived ? (
                                                        <img src={`/api/documents/${doc.id}`} alt={doc.filename} className="w-full h-full object-cover" loading="lazy" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-slate-300"><ImageIcon size={24} /></div>
                                                    )}
                                                    {!archived && (
                                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                            <button onClick={() => downloadUrl(`/api/documents/${doc.id}`, doc.filename)} className="p-1.5 rounded-full bg-white/90 text-slate-900" title="Télécharger">
                                                                <Download size={14} />
                                                            </button>
                                                            {isAdmin && (
                                                                <button onClick={() => handleDelete(doc)} disabled={busyId === doc.id} className="p-1.5 rounded-full bg-white/90 text-red-500" title="Supprimer">
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            {docs.map(doc => (
                                                <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50/50 border border-slate-200/50 min-w-0">
                                                    <Icon size={16} className="text-slate-400 shrink-0" />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm font-medium text-slate-900 truncate">{doc.filename}</div>
                                                        <div className="text-xs text-slate-400">{formatSize(doc.size_bytes)}{doc.uploaded_by ? ` · ${doc.uploaded_by}` : ''}</div>
                                                    </div>
                                                    {!archived && (
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <button onClick={() => downloadUrl(`/api/documents/${doc.id}`, doc.filename)} className="p-2 rounded-lg hover:bg-black/5 text-slate-500 hover:text-ohm-primary transition-colors" title="Télécharger">
                                                                <Download size={16} />
                                                            </button>
                                                            {isAdmin && (
                                                                <button onClick={() => handleDelete(doc)} disabled={busyId === doc.id} className="p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-500 transition-colors" title="Supprimer">
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {(documents.length > 0 || archived) && (
                    <div className="p-4 sm:p-6 border-t border-black/5 shrink-0">
                        <button
                            onClick={handleDownloadAll}
                            disabled={busyId === 'all'}
                            className="w-full py-3 bg-ohm-primary text-ohm-bg font-black rounded-xl hover:bg-yellow-300 transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest disabled:opacity-50"
                        >
                            {busyId === 'all' ? <Loader2 size={18} className="animate-spin" /> : <FolderDown size={18} />}
                            Télécharger le dossier complet
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
