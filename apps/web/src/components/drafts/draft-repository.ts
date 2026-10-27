export interface DraftRecord<T = unknown> {
  key: string;
  accountId: string;
  baseline: string;
  value: T;
  revision: number;
  updatedAt: number;
  writer: string;
  conflictOf?: string;
}

export class DraftConflict extends Error {
  constructor(readonly current: DraftRecord) { super("此草稿已在另一个标签页更新"); }
}

const memory = new Map<string, DraftRecord>();
const pending = new Set<() => Promise<void>>();
const discards = new Map<() => Promise<void>, string>();
const blockedAccounts = new Set<string>();
let database: Promise<IDBDatabase> | undefined;
const writer = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, "0")).join("-");
export const draftWriter = typeof crypto === "undefined" ? "server" : writer();

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("fashion-workspace-drafts", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("drafts", { keyPath: "key" });
      store.createIndex("accountId", "accountId");
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("草稿数据库升级被另一个标签页阻塞")); };
  });
  return database;
}

export const draftRepository = {
  async read<T>(key: string): Promise<DraftRecord<T> | undefined> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(request.result as DraftRecord<T> | undefined);
      request.onerror = () => reject(request.error);
    });
  },
  async conflicts<T>(key: string): Promise<DraftRecord<T>[]> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").getAll(IDBKeyRange.bound(`${key}:conflict:`, `${key}:conflict:\uffff`));
      request.onsuccess = () => resolve((request.result as DraftRecord<T>[]).sort((a, b) => b.updatedAt - a.updatedAt));
      request.onerror = () => reject(request.error);
    });
  },
  async write<T>(input: Omit<DraftRecord<T>, "revision" | "updatedAt" | "writer">, expected: number): Promise<DraftRecord<T>> {
    input = { ...input, value: JSON.parse(serializeDraft(input.value)) as T, baseline: normalizeDraftBaseline(input.baseline) };
    if (blockedAccounts.has(input.accountId)) throw new Error("账号已退出");
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts");
      const request = store.get(input.key);
      let result: DraftRecord<T>;
      let conflict: DraftRecord | undefined;
      request.onsuccess = () => {
        const current = request.result as DraftRecord | undefined;
        if ((current?.revision ?? 0) !== expected) {
          conflict = current ?? { ...input, revision: 0, updatedAt: Date.now(), writer: draftWriter };
          store.put({ ...input, key: `${input.key}:conflict:${draftWriter}`, conflictOf: input.key, revision: 1, updatedAt: Date.now(), writer: draftWriter });
        } else {
          result = { ...input, revision: expected + 1, updatedAt: Date.now(), writer: draftWriter };
          store.put(result);
        }
      };
      tx.oncomplete = () => {
        if (conflict) { reject(new DraftConflict(conflict)); return; }
        memory.set(input.key, result);
        resolve(result);
      };
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
  async remove(key: string, revision: number) {
    const db = await openDatabase();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts");
      const request = store.get(key);
      let removed = false;
      request.onsuccess = () => {
        if ((request.result as DraftRecord | undefined)?.revision === revision) { store.delete(key); memory.delete(key); removed = true; }
      };
      tx.oncomplete = () => resolve(removed);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
  async clearAccount(accountId: string) {
    blockedAccounts.add(accountId);
    for (const [key, record] of memory) if (record.accountId === accountId) memory.delete(key);
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts");
      const cursor = store.index("accountId").openCursor(IDBKeyRange.only(accountId));
      cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  },
  enableAccount(accountId: string) { blockedAccounts.delete(accountId); },
  memory<T>(key: string) { return memory.get(key) as DraftRecord<T> | undefined; },
  remember(record: DraftRecord) { memory.set(record.key, record); },
};

export function registerDraftFlush(flush: () => Promise<void>) { pending.add(flush); return () => { pending.delete(flush); }; }
export function registerDraftDiscard(key: string, discard: () => Promise<void>) { discards.set(discard, key); return () => { discards.delete(discard); }; }
export async function discardWorkspaceDrafts(matches: (key: string) => boolean = () => true) { await Promise.all([...discards].filter(([, key]) => matches(key)).map(([discard]) => discard())); }
export async function flushWorkspaceDrafts() { await Promise.all([...pending].map(flush => flush())); }

export function normalizeDraftBaseline(value: string): string {
  try { return serializeDraft(JSON.parse(value)); } catch { return value; }
}

/** Exclude ephemeral references; real resource IDs remain serializable. */
export function serializeDraft(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof File !== "undefined" && item instanceof File || typeof Blob !== "undefined" && item instanceof Blob) return undefined;
    if (typeof item === "string" && (/^blob:/u.test(item) || /[?&](?:X-Amz-Signature|X-Amz-Credential|token)=/iu.test(item))) return undefined;
    return item;
  });
}
