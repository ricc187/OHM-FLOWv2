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
    /** Set once a sync attempt gets a 401/403 back — almost always means a
     * different user is now logged in on this device than the one who
     * queued the entry (shared/handed-off tablet). Kept (not dropped) and
     * still retried in the background in case the right user logs back in,
     * but the UI shows it distinctly instead of an indefinite silent retry. */
    authError?: boolean;
}

const KEY = 'ohm_offline_entries';
const CHANGE_EVENT = 'ohm:offline-queue-changed';
// Cross-tab sync lock: two tabs open on the same device both reacting to the
// same 'online' event would otherwise both read the queue before either
// writes it back, and both post everything — a short localStorage-based
// lock closes most of that window (doesn't need to be perfect, just short).
const LOCK_KEY = 'ohm_offline_sync_lock';
const LOCK_TTL_MS = 8000;

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

export function queueEntry(entry: Omit<QueuedEntry, 'tempId' | 'queuedAt' | 'authError'>) {
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

function acquireLock(): boolean {
    try {
        const raw = localStorage.getItem(LOCK_KEY);
        const held = raw ? parseInt(raw, 10) : 0;
        if (held && Date.now() - held < LOCK_TTL_MS) return false; // another tab is syncing
        localStorage.setItem(LOCK_KEY, String(Date.now()));
        return true;
    } catch {
        return true; // storage unavailable — proceed rather than block sync entirely
    }
}
function releaseLock() {
    try { localStorage.removeItem(LOCK_KEY); } catch { /* best-effort */ }
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
    if (!acquireLock()) return; // another tab is already flushing the same queue

    syncing = true;
    try {
        const stillQueued: QueuedEntry[] = [];
        let offline = false;
        for (const entry of entries) {
            if (offline) {
                stillQueued.push(entry);
                continue;
            }
            const { tempId, queuedAt, chantier_nom, authError, ...payload } = entry;
            try {
                const res = await apiPost('/api/entries', { ...payload, client_ref: tempId });
                if (!res.ok) {
                    stillQueued.push({ ...entry, authError: res.status === 401 || res.status === 403 });
                }
            } catch {
                offline = true;
                stillQueued.push(entry);
            }
        }
        write(stillQueued);
    } finally {
        syncing = false;
        releaseLock();
    }
}
