// Offline queue for Field Assist: when there's no signal, notes and photos are kept on the phone (IndexedDB)
// and sent automatically once the connection is back. Nothing is lost if the page is closed in between.

import { pin } from "./proClient";

type Item = { key?: number; at: string; method: string; path: string; body: string; label: string };

const DB = "jarvis-field";
const STORE = "queue";
const EVENT = "field-queue";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "key", autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const pending = () => tx<Item[]>("readonly", (s) => s.getAll() as IDBRequest<Item[]>);
const notify = async () => window.dispatchEvent(new CustomEvent(EVENT, { detail: (await pending()).length }));
export const onQueueChange = (fn: (n: number) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<number>).detail);
  window.addEventListener(EVENT, h);
  notify();
  return () => window.removeEventListener(EVENT, h);
};

async function post(method: string, path: string, body: string): Promise<Response> {
  return fetch(path, { method, body, headers: { "content-type": "application/json", "x-jarvis-pin": pin() } });
}

/**
 * Send a change; if the network is down, queue it and resolve {queued: true}.
 * Server errors (wrong data, locked report) are thrown as usual: those shouldn't be retried.
 */
export async function sendOrQueue(method: string, path: string, body: object, label: string): Promise<{ queued: boolean; data?: unknown }> {
  const text = JSON.stringify(body);
  try {
    const r = await post(method, path, text);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((data as { error?: string }).error || `Request failed (${r.status}).`), { server: true });
    return { queued: false, data };
  } catch (e) {
    if ((e as { server?: boolean }).server) throw e;
    await tx("readwrite", (s) => s.add({ at: new Date().toISOString(), method, path, body: text, label }));
    notify();
    return { queued: true };
  }
}

let flushing = false;
/** Try to send everything waiting. Returns how many went through. */
export async function flush(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const it of await pending()) {
      try {
        const r = await post(it.method, it.path, it.body);
        if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429)) {
          // Sent, or permanently refused (e.g. report locked): either way it shouldn't stay queued.
          await tx("readwrite", (s) => s.delete(it.key!));
          if (r.ok) sent++;
        } else break;
      } catch {
        break; // still offline
      }
    }
  } finally {
    flushing = false;
    notify();
  }
  return sent;
}

/** Retry when the connection returns, and every 15 s while anything is waiting. */
export function startAutoFlush(onSent: (n: number) => void): () => void {
  const go = () => flush().then((n) => n && onSent(n));
  window.addEventListener("online", go);
  const t = setInterval(go, 15_000);
  go();
  return () => {
    window.removeEventListener("online", go);
    clearInterval(t);
  };
}
