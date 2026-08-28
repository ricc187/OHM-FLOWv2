import React, { useEffect, useRef, useState } from 'react';
import { X, FileText, Image as ImageIcon, Download, Trash2, FolderDown, Archive, Loader2, Folder, Upload, UploadCloud, ChevronLeft, ChevronRight } from 'lucide-react';
import { ChantierDocument, DocumentCategory } from '../types';
import { api } from '../api';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
    chantierId: number;
    chantierNom: string;
    isAdmin: boolean;
    onClose: () => void;
}

const CATEGORY_META: Record<DocumentCategory, { label: string; icon: React.ElementType; accept: string; multiple: boolean }> = {
    document: { label: 'Documents', icon: FileText, accept: 'application/pdf', multiple: true },
    photo: { label: 'Photos', icon: ImageIcon, accept: 'image/*', multiple: true },
};
const CATEGORIES: DocumentCategory[] = ['document', 'photo'];

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

interface UploadTask {
    id: string;
    name: string;
    pct: number;
    error: string | null;
}

export const DocumentExplorer: React.FC<Props> = ({ chantierId, chantierNom, isAdmin, onClose }) => {
    const [documents, setDocuments] = useState<ChantierDocument[]>([]);
    const [archived, setArchived] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | 'all' | DocumentCategory | null>(null);
    const [activeCategory, setActiveCategory] = useState<DocumentCategory>('document');
    // Mobile only (sm and up always show both panes side by side) — the
    // sidebar+pane split was too cramped on a phone, so below sm it's one
    // screen at a time: the folder list, or the open folder with a breadcrumb
    // back to it.
    const [mobileView, setMobileView] = useState<'folders' | 'files'>('folders');
    const [tasks, setTasks] = useState<UploadTask[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const dragDepth = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // transitions-dev "06-modal" — this component owns its own mount, so it
    // plays the close animation itself before telling the parent to unmount it.
    const [isOpen, setIsOpen] = useState(false);
    useEffect(() => {
        const raf = requestAnimationFrame(() => setIsOpen(true));
        return () => cancelAnimationFrame(raf);
    }, []);
    const handleClose = () => {
        setIsOpen(false);
        setTimeout(onClose, 150);
    };
    useEscapeKey(true, handleClose);

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

    const handleDeleteCategory = async (category: DocumentCategory) => {
        const count = byCategory(category).length;
        if (!count) return;
        if (!confirm(`Supprimer les ${count} fichier(s) du dossier "${CATEGORY_META[category].label}" ?`)) return;
        setBusyId(category);
        const res = await api.delete(`/api/chantiers/${chantierId}/documents/category?category=${category}`);
        setBusyId(null);
        if (res.ok) fetchDocuments();
        else alert('Erreur lors de la suppression du dossier');
    };

    const handleDownloadAll = async () => {
        setBusyId('all');
        await downloadUrl(`/api/chantiers/${chantierId}/documents/zip?category=all`, `${chantierNom}.zip`);
        setBusyId(null);
    };

    const byCategory = (cat: DocumentCategory) => documents.filter(d => d.category === cat);

    // Real progress per file — XHR upload.onprogress reports actual bytes
    // sent, not a simulated timer, so slow connections show a true bar.
    const uploadFiles = async (category: DocumentCategory, files: File[]) => {
        if (!files.length) return;
        const withTasks = files.map(f => ({ file: f, task: { id: `${f.name}-${f.size}-${f.lastModified}`, name: f.name, pct: 0, error: null as string | null } }));
        setTasks(prev => [...prev, ...withTasks.map(w => w.task)]);

        for (const { file, task } of withTasks) {
            const formData = new FormData();
            formData.append('category', category);
            formData.append('file', file);
            try {
                const res = await api.uploadWithProgress(`/api/chantiers/${chantierId}/documents`, formData, pct => {
                    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, pct } : t));
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, error: data.error || 'Échec import' } : t));
                } else {
                    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, pct: 100 } : t));
                }
            } catch {
                setTasks(prev => prev.map(t => t.id === task.id ? { ...t, error: 'Erreur réseau' } : t));
            }
        }
        fetchDocuments();
        // Let finished bars sit at 100% briefly before clearing, so the
        // "real time it took" is actually visible instead of instant-vanish.
        setTimeout(() => {
            setTasks(prev => prev.filter(t => t.error)); // keep failures visible, drop successes
        }, 1200);
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        uploadFiles(activeCategory, files);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        dragDepth.current = 0;
        setIsDragOver(false);
        if (archived) return;
        const files = Array.from(e.dataTransfer.files || []);
        uploadFiles(activeCategory, files);
    };
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        dragDepth.current += 1;
        setIsDragOver(true);
    };
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setIsDragOver(false);
    };
    const handleDragOver = (e: React.DragEvent) => e.preventDefault();

    const activeMeta = CATEGORY_META[activeCategory];
    const activeDocs = byCategory(activeCategory);

    return (
        <div className={`t-modal ${isOpen ? 'is-open' : 'is-closing'} fixed inset-0 bg-white/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 safe-top safe-bottom`}>
            <div className="w-full max-w-4xl h-[85vh] bg-white rounded-3xl border border-slate-300 shadow-2xl overflow-hidden flex flex-col">
                <div className="p-4 sm:p-6 border-b border-black/5 flex justify-between items-center bg-slate-50 shrink-0">
                    <div className="min-w-0">
                        <h3 className="text-lg sm:text-xl font-black text-slate-900 uppercase tracking-tight truncate">Dossiers — {chantierNom}</h3>
                        {archived && (
                            <div className="text-xs text-amber-600 font-bold mt-1 flex items-center gap-1">
                                <Archive size={12} /> Chantier archivé — rouvrez-le pour ajouter/télécharger des fichiers individuels
                            </div>
                        )}
                    </div>
                    <button onClick={handleClose} className="p-2 rounded-full hover:bg-black/5 text-slate-500 hover:text-slate-900 transition-colors shrink-0">
                        <X size={22} />
                    </button>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>
                ) : (
                    <div className="flex-1 flex min-h-0">
                        {/* Sidebar — folder list, Windows-Explorer style. On mobile this IS
                            the first screen (full width); picking a folder switches to the
                            files screen. sm+ always shows both panes side by side. */}
                        <div className={`${mobileView === 'files' ? 'hidden sm:block' : 'block'} w-full sm:w-56 border-r border-black/5 bg-slate-50/50 shrink-0 overflow-y-auto py-2`}>
                            {CATEGORIES.map(cat => {
                                const meta = CATEGORY_META[cat];
                                const count = byCategory(cat).length;
                                const active = activeCategory === cat;
                                return (
                                    <button
                                        key={cat}
                                        onClick={() => { setActiveCategory(cat); setMobileView('files'); }}
                                        className={`w-full flex items-center gap-2.5 px-4 py-3 sm:py-2.5 text-sm font-bold transition-colors ${active
                                            ? 'bg-ohm-primary/15 text-ohm-primary sm:border-r-2 sm:border-ohm-primary'
                                            : 'text-slate-500 hover:bg-black/5 hover:text-slate-900'
                                            }`}
                                    >
                                        <Folder size={18} className="shrink-0" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : 0} />
                                        <span className="truncate flex-1 text-left">{meta.label}</span>
                                        <span className="text-xs font-mono text-slate-400">{count}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Main pane — files in the selected folder */}
                        <div
                            className={`${mobileView === 'folders' ? 'hidden' : 'flex'} sm:flex flex-1 flex-col min-w-0 relative`}
                            onDrop={handleDrop}
                            onDragEnter={handleDragEnter}
                            onDragLeave={handleDragLeave}
                            onDragOver={handleDragOver}
                        >
                            <input ref={fileInputRef} type="file" accept={activeMeta.accept} multiple={activeMeta.multiple} className="hidden" onChange={handleFileInputChange} />

                            {/* Breadcrumb — mobile only, doubles as the back navigation to the folder list */}
                            <div className="flex sm:hidden items-center gap-1.5 px-4 py-3 border-b border-black/5 shrink-0 text-sm min-w-0">
                                <button onClick={() => setMobileView('folders')} className="flex items-center gap-1.5 text-slate-400 font-bold shrink-0 py-1 -my-1 pr-1 max-w-[45%]">
                                    <ChevronLeft size={16} className="shrink-0" /> <span className="truncate">{chantierNom}</span>
                                </button>
                                <ChevronRight size={14} className="text-slate-300 shrink-0" />
                                <span className="font-bold text-slate-900 truncate">{activeMeta.label}</span>
                            </div>

                            <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-black/5 shrink-0">
                                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    <activeMeta.icon size={16} className="text-ohm-primary shrink-0" />
                                    <span className="hidden sm:inline">{activeMeta.label} ({activeDocs.length})</span>
                                    <span className="sm:hidden text-xs text-slate-400 font-mono">{activeDocs.length}</span>
                                </div>
                                {!archived && (
                                    // Icon-only on mobile (no room for labels next to the folder
                                    // sidebar) — title attr keeps the label as a tooltip/a11y name.
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            title="Importer"
                                            className="flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-ohm-primary hover:bg-black/5 transition-colors"
                                        >
                                            <Upload size={14} /> <span className="hidden sm:inline">Importer</span>
                                        </button>
                                        {activeDocs.length > 0 && (
                                            <button
                                                onClick={() => handleDownloadCategory(activeCategory)}
                                                disabled={busyId === activeCategory}
                                                title="Télécharger"
                                                className="flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-ohm-primary hover:bg-black/5 transition-colors disabled:opacity-50"
                                            >
                                                {busyId === activeCategory ? <Loader2 size={14} className="animate-spin" /> : <FolderDown size={14} />} <span className="hidden sm:inline">Télécharger</span>
                                            </button>
                                        )}
                                        {isAdmin && activeDocs.length > 0 && (
                                            <button
                                                onClick={() => handleDeleteCategory(activeCategory)}
                                                disabled={busyId === activeCategory}
                                                title="Vider le dossier"
                                                className="flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                            >
                                                <Trash2 size={14} /> <span className="hidden sm:inline">Vider</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
                                {/* Upload progress — real per-file percentage from the upload's own byte count */}
                                {tasks.length > 0 && (
                                    <div className="space-y-2 mb-4">
                                        {tasks.map(t => (
                                            <div key={t.id} className={`p-3 rounded-xl border text-xs ${t.error ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                                    <span className="font-medium text-slate-700 truncate">{t.name}</span>
                                                    <span className={`font-mono font-bold shrink-0 ${t.error ? 'text-red-500' : 'text-slate-400'}`}>{t.error ? 'Échec' : `${t.pct}%`}</span>
                                                </div>
                                                {!t.error && (
                                                    <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                                        <div className="h-full bg-ohm-primary transition-[width] duration-150 ease-out" style={{ width: `${t.pct}%` }} />
                                                    </div>
                                                )}
                                                {t.error && <div className="text-red-500 mt-1">{t.error}</div>}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {activeDocs.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2 py-12">
                                        <Folder size={40} />
                                        <span className="italic text-sm">Dossier vide</span>
                                    </div>
                                ) : activeCategory === 'photo' ? (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                        {activeDocs.map(doc => (
                                            <div key={doc.id} className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                                                {!archived ? (
                                                    <img src={`/api/documents/${doc.id}/thumbnail`} alt={doc.filename} className="w-full h-full object-cover" loading="lazy" />
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
                                        {activeDocs.map(doc => (
                                            <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50/50 border border-slate-200/50 min-w-0">
                                                <FileText size={16} className="text-slate-400 shrink-0" />
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

                            {/* Drag overlay */}
                            {isDragOver && !archived && (
                                <div className="absolute inset-0 bg-ohm-primary/10 border-4 border-dashed border-ohm-primary rounded-xl flex items-center justify-center pointer-events-none z-10">
                                    <div className="flex flex-col items-center gap-2 text-ohm-primary font-black uppercase tracking-widest">
                                        <UploadCloud size={40} />
                                        Déposer ici — {activeMeta.label}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

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
