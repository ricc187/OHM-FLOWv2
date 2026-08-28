import React, { useEffect, useState } from 'react';
import { AdminNotice } from '../types';
import { Megaphone, Check } from 'lucide-react';
import { api } from '../api';

// Shown once per app open: fetches notices the current user hasn't
// acknowledged yet and are inside their display window, and walks through
// them one at a time. "J'ai pris note" acks the current one and moves to
// the next — it never comes back for that user once acked.
export const NoticeBanner: React.FC = () => {
    const [queue, setQueue] = useState<AdminNotice[]>([]);
    const [acking, setAcking] = useState(false);

    useEffect(() => {
        api.get('/api/notices/active').then(res => res.ok && res.json()).then(data => data && setQueue(data));
    }, []);

    const current = queue[0];
    if (!current) return null;

    const handleAck = async () => {
        setAcking(true);
        try {
            await api.post(`/api/notices/${current.id}/ack`);
        } finally {
            setAcking(false);
            setQueue(q => q.slice(1));
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white/80 backdrop-blur-md p-4 safe-top safe-bottom">
            <div className="w-full max-w-md bg-white rounded-3xl border border-slate-300 shadow-2xl overflow-hidden animate-fade-in">
                <div className="p-6 sm:p-8 flex flex-col items-center text-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-ohm-primary/15 flex items-center justify-center shrink-0">
                        <Megaphone className="text-ohm-primary" size={28} />
                    </div>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        {queue.length > 1 ? `Annonce (1/${queue.length})` : 'Annonce'}
                    </div>
                    <p className="text-slate-900 text-lg font-medium whitespace-pre-wrap">{current.message}</p>
                    {current.created_by && (
                        <div className="text-xs text-slate-400">— {current.created_by}</div>
                    )}
                    <button
                        onClick={handleAck}
                        disabled={acking}
                        className="w-full mt-2 flex items-center justify-center gap-2 py-3.5 bg-ohm-primary text-ohm-bg font-black rounded-2xl hover:bg-yellow-300 hover:scale-[1.01] active:scale-[0.99] transition-all shadow-xl shadow-primary/20 uppercase tracking-widest disabled:opacity-50"
                    >
                        <Check size={20} strokeWidth={3} /> J'ai pris note
                    </button>
                </div>
            </div>
        </div>
    );
};
