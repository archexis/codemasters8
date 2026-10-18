import { supabase } from './supabase';
import { applyCommand, initialState } from './domain';
import type { Command } from './domain';
import type { AppState, Media } from './types';
const KEY = 'sq_svelte_demo_v2';
let version = 0;
let userId = '';
export async function loadState(): Promise<AppState> {
  if (!supabase) {
    const saved = localStorage.getItem(KEY);
    if (!saved) return initialState();
    try {
      const state = JSON.parse(saved) as AppState;
      if (!Array.isArray(state.complexes) || !Array.isArray(state.ads) || !Array.isArray(state.media) || !Array.isArray(state.audit) || !state.signals) throw new Error();
      return state;
    } catch { throw new Error('Демоданные повреждены. Используйте «Сбросить демо».'); }
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { userId = ''; version = 0; return { complexes: [], ads: [], media: [], signals: {}, audit: [] }; }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Войдите через Supabase Auth');
  userId = user.id;
  const { data, error } = await supabase.from('workspaces').select('data,version').eq('owner_id', userId).maybeSingle();
  if (error) throw error;
  version = data?.version ?? 0;
  return data?.data ?? { complexes: [], ads: [], media: [], signals: {}, audit: [] };
}
export async function initializeWorkspace(): Promise<AppState> {
  if (!supabase) return resetDemo();
  const { data, error } = await supabase.rpc('initialize_workspace');
  if (error) throw error;
  version = data.version;
  return data.data;
}
export async function saveCommand(state: AppState, command: Command, reviewer: string): Promise<AppState> {
  // Same invariant checks run locally and inside the PostgreSQL transaction.
  const next = applyCommand(state, command, reviewer);
  if (!supabase) { localStorage.setItem(KEY, JSON.stringify(next)); return next; }
  const { data, error } = await supabase.rpc('apply_command', { command, expected_version: version });
  if (error) throw new Error(error.message.includes('STALE_VERSION') ? 'Данные изменились в другой вкладке. Обновите страницу перед решением.' : error.message);
  version = data.version;
  return data.data;
}
export async function resetDemo(): Promise<AppState> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
  localStorage.removeItem(KEY); return initialState();
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sq-demo-evidence', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function blobStore(mode: IDBTransactionMode, path: string, file?: File): Promise<Blob | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = file ? tx.objectStore('files').put(file, path) : mode === 'readwrite' ? tx.objectStore('files').delete(path) : tx.objectStore('files').get(path);
    tx.oncomplete = () => { resolve(req.result as Blob | undefined); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
  });
}
export async function uploadFile(file: File, zkId: string): Promise<Media> {
  if (file.size > 20 * 1024 * 1024 || !/^(image\/(jpeg|png|webp)|video\/mp4|application\/pdf)$/.test(file.type)) throw new Error('Допустимы JPG, PNG, WebP, MP4, PDF до 20 МБ');
  const id = crypto.randomUUID();
  const path = `${userId || 'demo'}/${zkId}/${id}.${file.name.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'bin'}`;
  if (supabase) {
    const { error } = await supabase.storage.from('evidence').upload(path, file, { contentType: file.type });
    if (error) throw error;
  } else await blobStore('readwrite', path, file);
  return { id, zkId, path, name: file.name, kind: file.type, date: new Date().toISOString().slice(0, 10), note: '', ready: null };
}
export async function removeFile(path: string) {
  if (supabase) { const { error } = await supabase.storage.from('evidence').remove([path]); if (error) throw error; }
  else await blobStore('readwrite', path);
}
export async function mediaUrl(media: Media): Promise<string> {
  if (supabase) {
    const { data, error } = await supabase.storage.from('evidence').createSignedUrl(media.path, 300);
    if (error) throw error;
    return data.signedUrl;
  }
  const blob = await blobStore('readonly', media.path);
  if (!blob) throw new Error('Файл не найден в этом браузере');
  return URL.createObjectURL(blob);
}
