/// <reference lib="WebWorker" />
// IO worker — wraps IndexedDB read/write so the main thread never waits on
// disk. Save format is a single object keyed by SAVE_KEY in a single store.
// The save payload is a structured-cloneable JS object (passed via
// postMessage). Typed arrays inside the payload survive the round-trip.

declare const self: DedicatedWorkerGlobalScope;

const DB_NAME = "seedscape";
const DB_VERSION = 1;
const STORE_NAME = "savegame";
export const SAVE_KEY = "current";

export type IoRequest =
  | { type: "save"; taskId: number; payload: unknown }
  | { type: "load"; taskId: number }
  | { type: "delete"; taskId: number };

export type IoResponse =
  | { type: "saved"; taskId: number }
  | { type: "loaded"; taskId: number; payload: unknown | null }
  | { type: "deleted"; taskId: number }
  | { type: "error"; taskId: number; error: string };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

async function put(payload: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB write failed"));
    tx.objectStore(STORE_NAME).put(payload, SAVE_KEY);
  });
}

async function get(): Promise<unknown | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(SAVE_KEY);
    req.onerror = () => reject(req.error ?? new Error("indexedDB read failed"));
    req.onsuccess = () => resolve(req.result ?? null);
  });
}

async function remove(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
    tx.objectStore(STORE_NAME).delete(SAVE_KEY);
  });
}

self.onmessage = async (event: MessageEvent<IoRequest>): Promise<void> => {
  const msg = event.data;
  try {
    if (msg.type === "save") {
      await put(msg.payload);
      const r: IoResponse = { type: "saved", taskId: msg.taskId };
      self.postMessage(r);
      return;
    }
    if (msg.type === "load") {
      const payload = await get();
      const r: IoResponse = { type: "loaded", taskId: msg.taskId, payload };
      self.postMessage(r);
      return;
    }
    if (msg.type === "delete") {
      await remove();
      const r: IoResponse = { type: "deleted", taskId: msg.taskId };
      self.postMessage(r);
      return;
    }
  } catch (err) {
    const r: IoResponse = {
      type: "error",
      taskId: msg.taskId,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(r);
  }
};
