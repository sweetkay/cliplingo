import type { Sentence } from './types';

const DB_NAME = 'cliplingo';
const DB_VERSION = 1;
const STORE = 'sentences';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('sourceUrl', 'sourceUrl');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = run(tx.objectStore(STORE));
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error);
    tx.oncomplete = () => db.close();
  });
}

export const getSentences = () => request<Sentence[]>('readonly', store => store.getAll());
export const getSentence = (id: string) => request<Sentence | undefined>('readonly', store => store.get(id));
export const putSentence = (sentence: Sentence) => request<IDBValidKey>('readwrite', store => store.put(sentence));
export const deleteSentence = (id: string) => request<undefined>('readwrite', store => store.delete(id) as IDBRequest<undefined>);

export async function updateSentence(id: string, patch: Partial<Sentence>) {
  const sentence = await getSentence(id);
  if (!sentence) return;
  await putSentence({ ...sentence, ...patch, updatedAt: Date.now() });
}

export async function exportLibrary() {
  const rows = await getSentences();
  const data = await Promise.all(rows.map(async ({ audioBlob, ...sentence }) => ({
    ...sentence,
    audio: audioBlob ? await blobToDataUrl(audioBlob) : null
  })));
  return JSON.stringify({ format: 'cliplingo', version: 1, exportedAt: Date.now(), sentences: data }, null, 2);
}

export async function importLibrary(raw: string) {
  const parsed = JSON.parse(raw);
  if (parsed?.format !== 'cliplingo' || parsed?.version !== 1 || !Array.isArray(parsed.sentences)) throw new Error('不支持的备份格式');
  for (const row of parsed.sentences) {
    const { audio, ...sentence } = row;
    await putSentence({ ...sentence, audioBlob: audio ? await dataUrlToBlob(audio) : undefined });
  }
  return parsed.sentences.length as number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url: string) { return await (await fetch(url)).blob(); }
