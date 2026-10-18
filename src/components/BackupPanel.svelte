/**
 * S2.5 (C3). Backup/restore UI: экспорт полного ZIP-пакета
 * (manifest.json + workspace.json + files/ по mediaId) и импорт
 * с предпросмотром документированных преобразований.
 *
 * Автономная панель: встраивается в App.svelte маршрутом #/backup.
 * Cloud-ветка идёт через Supabase Storage + RPC restore_workspace;
 * DEMO-ветка (без логина, по умолчанию) — через тот же IndexedDB
 * 'sq-demo-evidence', что использует repository, и рабочий ключ localStorage.
 * Подписанные URL нигде не сохраняются — только mediaId/path/hash (C6).
 */
<script lang="ts">
  import type { AppState, Media } from '../lib/types';
  import { supabase } from '../lib/supabase';
  import {
    applyImportTransform,
    buildBackup,
    isRestoreTargetEmpty,
    previewRestore,
    validateBackupPackage,
  } from '../lib/backup';
  import type { RestorePreview, ValidatedBackup } from '../lib/backup';

  let {
    workspace,
    getFileBytes,
    onRestoreDone = () => {},
  }: {
    workspace: AppState;
    /** DEMO-провайдер байтов (родитель читает свой IndexedDB); в cloud читаем Storage сами. */
    getFileBytes?: (media: Media) => Promise<Uint8Array>;
    onRestoreDone?: (state: AppState) => void;
  } = $props();

  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let preview = $state<RestorePreview | null>(null);
  let pending = $state<ValidatedBackup | null>(null);

  async function cloudBytes(media: Media): Promise<Uint8Array> {
    if (!supabase) throw new Error('Нет соединения с сервером');
    const { data, error: dlError } = await supabase.storage.from('evidence').download(media.path);
    if (dlError || !data) throw new Error(`Файл ${media.id} не скачался: ${dlError?.message ?? 'пусто'}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  function downloadZip(zip: Uint8Array, name: string): void {
    const blob = new Blob([zip as unknown as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    busy = true; error = ''; notice = '';
    try { await fn(); } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }

  async function exportBackup(): Promise<void> {
    await run(async () => {
      const entries = new Map<string, Uint8Array>();
      for (const m of workspace.media) entries.set(m.id, getFileBytes ? await getFileBytes(m) : await cloudBytes(m));
      const { zip, manifest } = await buildBackup(workspace, entries);
      downloadZip(zip, `saq-backup-${manifest.createdAt.slice(0, 10)}.zip`);
      notice = `Готов полный backup: ${manifest.files.length} файлов. Это НЕ экспорт данных — восстановление только из такого ZIP.`;
    });
  }

  async function pickFile(files: FileList | undefined): Promise<void> {
    await run(async () => {
      pending = null; preview = null;
      const file = files?.[0];
      if (!file) throw new Error('Выберите ZIP-файл backup');
      const validated = await validateBackupPackage(new Uint8Array(await file.arrayBuffer()));
      pending = validated;
      preview = { ...previewRestore(validated.workspace), fileBytes: validated.manifest.files.reduce((s, f) => s + f.bytes, 0), mediaCount: validated.manifest.files.length };
      notice = '';
    });
  }

  function extOf(name: string): string {
    return (name.split('.').pop() ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'bin';
  }

  async function restore(): Promise<void> {
    await run(async () => {
      if (!pending || !preview) throw new Error('Сначала выберите и проверьте пакет');
      if (!isRestoreTargetEmpty(workspace)) {
        throw new Error('Восстановление — только в пустое workspace (нет публикаций, файлов и решений), слияние не выполняется.');
      }
      const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
      const importer = user?.email ?? user?.id ?? 'demo';
      // Без сессии — DEMO-ветка (регистрации нет, вход не требуется).
      // Staged upload с новым owner-prefix ДО единой DB-записи (C3).
      const staged: Array<{ mediaId: string; path: string }> = [];
      if (supabase && user) {
        for (const [mediaId, bytes] of pending.files) {
          const media = pending.workspace.media.find((m) => m.id === mediaId)!;
          const zkId = media.zkId;
          const path = `${user.id}/${zkId}/${mediaId}.${extOf(media.name)}`;
          const { error: upError } = await supabase.storage.from('evidence').upload(path, new Blob([bytes as unknown as BlobPart]), { contentType: media.kind });
          if (upError) throw new Error(`Staged upload ${mediaId} не удался: ${upError.message}`);
          staged.push({ mediaId, path });
        }
        const { data, error: rpcError } = await supabase.rpc('restore_workspace', {
          backup: { manifest: pending.manifest, workspace: pending.workspace, staged },
        });
        if (rpcError) {
          // Откат staged при отказе записи: только свои неподключённые файлы (C3).
          await supabase.storage.from('evidence').remove(staged.map((s) => s.path));
          throw new Error(rpcError.message);
        }
        onRestoreDone(data.data as AppState);
      } else {
        // DEMO без логина: байты — в локальный IndexedDB, состояние — в рабочий ключ.
        const db = await openDemoDb();
        for (const [mediaId, bytes] of pending.files) {
          const media = pending.workspace.media.find((m) => m.id === mediaId)!;
          await demoPut(db, `demo/${media.zkId}/${mediaId}.${extOf(media.name)}`, new Blob([bytes as unknown as BlobPart]));
        }
        db.close();
        const imported = applyImportTransform(pending.workspace, 'demo');
        try { localStorage.setItem('sq_svelte_demo_v2', JSON.stringify(imported)); } catch { /* работаем в памяти */ }
        onRestoreDone(imported);
      }
      notice = `Восстановлено: ${preview.confirmedToVerify.length} confirmed → needs-verification, ${preview.signalsToDraft.length} сигналов → draft. Баллы — только после нового решения.`;
      pending = null; preview = null;
    });
  }

  function openDemoDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('sq-demo-evidence', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function demoPut(db: IDBDatabase, path: string, blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
</script>

<section class="panel" aria-label="Backup и восстановление">
  <h2>Backup и восстановление</h2>
  <p class="muted">Полный пакет: manifest.json + workspace.json + файлы. Обычный экспорт данных для восстановления непригоден.</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if notice}<p class="muted" role="status">{notice}</p>{/if}
  <div class="actions">
    <button class="primary" disabled={busy} onclick={exportBackup}>Скачать полный backup (ZIP)</button>
  </div>
  <label>Проверить пакет для восстановления
    <input type="file" accept="application/zip,.zip" disabled={busy} onchange={(e) => pickFile(e.currentTarget.files ?? undefined)} />
  </label>
  {#if preview}
    <article class="mt-4">
      <p>Файлов: <b>{preview.mediaCount}</b> · байтов: <b>{preview.fileBytes}</b></p>
      <p>Confirmed → needs-verification: <b>{preview.confirmedToVerify.length}</b>
        {#each preview.confirmedToVerify as t}<span> {t.zkId}:{t.code}</span>{/each}</p>
      <p>Сигналов → draft: <b>{preview.signalsToDraft.length}</b></p>
      <p class="muted">{preview.auditNote}</p>
      <div class="actions mt-4">
        <button class="primary" disabled={busy} onclick={restore}>Восстановить в пустое workspace</button>
      </div>
    </article>
  {/if}
</section>
