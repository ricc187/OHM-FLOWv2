// Queues an hour/material entry that failed to submit because there's no
// network — chantiers often have weak/no signal, and a submit that just
// silently fails there is a real problem, not an edge case. Persisted in
// localStorage so it survives a reload; retried automatically once the
// connection comes back.

export interface QueuedEntry {
    tempId: string;
    user_id: number;
    chantier_id: number;
    chantier_nom: string;
    date: string;
    heures: number;
    materiel: number;
    created_by_id: number;
    queuedAt: string;
}

const KEY = 'ohm_offline_entries';
const CHANGE_EVENT = 'ohm:offline-queue-changed';

function read(): QueuedEntry[] {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function write(entries: QueuedEntry[]) {
    try {
        localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
        // storage full/unavailable — nothing more we can do here
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function queueEntry(entry: Omit<QueuedEntry, 'tempId' | 'queuedAt'>) {
    const entries = read();
    entries.push({
        ...entry,
        tempId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        queuedAt: new Date().toISOString(),
    });
    write(entries);
}

export function getQueuedEntries(): QueuedEntry[] {
    return read();
}

export function onQueueChange(cb: () => void) {
    window.addEventListener(CHANGE_EVENT, cb);
    return () => window.removeEventListener(CHANGE_EVENT, cb);
}

let syncing = false;

/** Attempts to flush the queue. Stops at the first network failure (still
 * offline) and keeps everything from that point on queued; a request the
 * server explicitly rejects is also kept (rather than silently dropping a
 * worker's entry) so it surfaces instead of vanishing. */
export async function trySyncQueue(apiPost: (path: string, body?: unknown) => Promise<Response>) {
    if (syncing) return;
    const entries = read();
    if (entries.length === 0) return;

    syncing = true;
    try {
        const stillQueued: QueuedEntry[] = [];
        let offline = false;
        for (const entry of entries) {
            if (offline) {
                stillQueued.push(entry);
                continue;
            }
            const { tempId, queuedAt, chantier_nom, ...payload } = entry;
            try {
                const res = await apiPost('/api/entries', payload);
                if (!res.ok) stillQueued.push(entry);
            } catch {
                offline = true;
                stillQueued.push(entry);
            }
        }
        write(stillQueued);
    } finally {
        syncing = false;
    }
}
