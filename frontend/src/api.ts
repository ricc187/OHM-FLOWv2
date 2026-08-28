// Centralized API client.
//
// Auth is a httpOnly cookie set by the backend on /api/login — the browser
// attaches it automatically on same-origin requests, so there is nothing to
// read/store in JS (no more localStorage token, no more manual Authorization
// header on every call). This also closes the XSS-token-theft risk that
// came with keeping the token in localStorage.
//
// Any 401 (missing/expired session) fires a global event so App.tsx can drop
// back to the login screen without every component re-implementing that.

export const UNAUTHORIZED_EVENT = 'ohm:unauthorized';

async function request(path: string, options: RequestInit = {}): Promise<Response> {
    const isFormData = options.body instanceof FormData;
    const res = await fetch(path, {
        ...options,
        credentials: 'same-origin', // send/receive the httpOnly cookie
        headers: {
            ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
            ...(options.headers || {}),
        },
    });
    if (res.status === 401) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return res;
}

// Minimal Response-shaped result so callers can keep using res.ok/res.json()
// like everywhere else, while still getting real upload progress — plain
// fetch() has no upload progress event, only XHR does.
export interface UploadResult {
    ok: boolean;
    status: number;
    json: () => Promise<any>;
}

function uploadWithProgress(path: string, formData: FormData, onProgress?: (pct: number) => void): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', path);
        xhr.withCredentials = true; // send the httpOnly auth cookie
        xhr.upload.onprogress = (e) => {
            if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
            if (xhr.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
            resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                json: async () => { try { return JSON.parse(xhr.responseText); } catch { return {}; } },
            });
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.send(formData);
    });
}

export const api = {
    get: (path: string) => request(path),
    post: (path: string, body?: unknown) =>
        request(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
    put: (path: string, body?: unknown) =>
        request(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
    delete: (path: string) => request(path, { method: 'DELETE' }),
    upload: (path: string, formData: FormData) => request(path, { method: 'POST', body: formData }),
    uploadWithProgress,
};
