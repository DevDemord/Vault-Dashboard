import { useEffect, useMemo, useState } from 'react';
import { FolderSimple, FolderOpen as FolderOpenIcon, FolderPlus, File, Image, UploadSimple, Archive } from '@phosphor-icons/react';
import type { DeadAttachment, NoteSummary } from '../types';
import { api, ApiError } from '../api';
import { NotePreviewPanel, type PreviewItem } from './NotePreviewPanel';

const INBOX_FOLDER = '1. Inbox';
const ARCHIVE_FOLDER = '5. Archive';
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

function folderOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

function fileName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  count: number;
}

function newNode(name: string, path: string): TreeNode {
  return { name, path, children: new Map(), count: 0 };
}

/** Folder-only tree (no note rows inside it, unlike the sidebar's `FolderTree`) — this is the
 * "destination" pane, so it only needs to show where things can go. Built from `note.folder`/
 * attachment paths *plus* `extraFolders` (every real folder on disk, from `GET /api/folders`) —
 * unlike the sidebar's tree, Explorer needs empty folders (including one you just created with
 * "New Folder") to actually show up, not just folders that happen to already hold something. The
 * badge count is notes + attachments combined, so it matches what the right pane actually lists. */
function buildFolderTree(notes: NoteSummary[], attachments: DeadAttachment[], extraFolders: string[]): TreeNode {
  const root = newNode('', '');

  const ensure = (folder: string): TreeNode => {
    if (!folder) return root;
    const segments = folder.split('/');
    let cursor = root;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!cursor.children.has(seg)) cursor.children.set(seg, newNode(seg, acc));
      cursor = cursor.children.get(seg)!;
    }
    return cursor;
  };

  for (const note of notes) ensure(note.folder).count++;
  for (const file of attachments) ensure(folderOf(file.relPath)).count++;
  for (const folder of extraFolders) ensure(folder);

  return root;
}

function FolderBranch({
  node,
  depth,
  selected,
  dragOverPath,
  onSelect,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  dragOverPath: string | null;
  onSelect: (path: string) => void;
  onDragOverFolder: (path: string) => void;
  onDragLeaveFolder: () => void;
  onDropOnFolder: (path: string, e: React.DragEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  const isDragOver = dragOverPath === node.path;
  const isSelected = selected === node.path;

  return (
    <div>
      {node.name && (
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-note-relpath')) return;
            e.preventDefault();
            onDragOverFolder(node.path);
          }}
          onDragLeave={onDragLeaveFolder}
          onDrop={(e) => onDropOnFolder(node.path, e)}
          className={`rounded ${isDragOver ? 'bg-violet-500/25 ring-1 ring-violet-400' : ''}`}
        >
          <button
            onClick={() => {
              setOpen((v) => !v);
              onSelect(node.path);
            }}
            className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm transition ${
              isSelected ? 'bg-violet-500/15 text-violet-300' : 'text-slate-300 hover:bg-slate-800/60'
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <span className={`inline-block text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
            {isSelected ? <FolderOpenIcon size={15} weight="fill" className="text-violet-400" /> : <FolderSimple size={15} weight="regular" />}
            <span className="truncate">{node.name}</span>
            {node.count > 0 && <span className="ml-auto flex-shrink-0 text-xs text-slate-500">{node.count}</span>}
          </button>
        </div>
      )}
      {(open || !node.name) && (
        <div>
          {children.map((child) => (
            <FolderBranch
              key={child.path}
              node={child}
              depth={node.name ? depth + 1 : depth}
              selected={selected}
              dragOverPath={dragOverPath}
              onSelect={onSelect}
              onDragOverFolder={onDragOverFolder}
              onDragLeaveFolder={onDragLeaveFolder}
              onDropOnFolder={onDropOnFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A FileZilla-style two-pane view: a recursive folder tree on the left (every destination, any
 * depth), the selected folder's notes on the right. Drag a note row left onto a folder to move it
 * there (single file at a time); drag `.md` files in from your OS file manager onto the right
 * pane to import them into `1. Inbox`, renaming any name collision with a `" DUPE"` suffix so an
 * accidental re-import stands out instead of silently overwriting or blending in as `" (2)"`.
 */
export function ExplorerView({
  notes,
  attachments,
  onChanged,
  onOpenNote,
  pushToast,
}: {
  notes: NoteSummary[];
  attachments: DeadAttachment[];
  onChanged: () => void;
  onOpenNote: (relPath: string) => void;
  pushToast: (text: string, kind?: 'error' | 'info') => void;
}) {
  const [selected, setSelected] = useState(INBOX_FOLDER);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [importDragActive, setImportDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [archivingPath, setArchivingPath] = useState<string | null>(null);

  const loadFolders = () => api.listFolders().then(setFolders).catch(() => {});
  useEffect(() => {
    loadFolders();
  }, []);

  const tree = useMemo(() => buildFolderTree(notes, attachments, folders), [notes, attachments, folders]);
  const visibleNotes = useMemo(
    () => notes.filter((n) => n.folder === selected).sort((a, b) => a.title.localeCompare(b.title)),
    [notes, selected],
  );
  const visibleAttachments = useMemo(
    () =>
      attachments
        .filter((a) => folderOf(a.relPath) === selected)
        .sort((a, b) => fileName(a.relPath).localeCompare(fileName(b.relPath))),
    [attachments, selected],
  );

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const folder = await api.createFolder(selected, name);
      setNewFolderName('');
      setCreatingFolder(false);
      await loadFolders();
      setSelected(folder);
      pushToast(`Created "${folder}".`, 'info');
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not create that folder.');
    }
  };

  const handleArchive = async (relPath: string) => {
    setArchivingPath(relPath);
    try {
      await api.archiveNote(relPath);
      if (preview?.type === 'note' && preview.relPath === relPath) setPreview(null);
      pushToast(`Archived "${relPath.slice(relPath.lastIndexOf('/') + 1)}".`, 'info');
      onChanged();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not archive that note.');
    } finally {
      setArchivingPath(null);
    }
  };

  const handleMove = async (relPath: string, destFolder: string) => {
    try {
      await api.moveNoteToFolder(relPath, destFolder);
      pushToast(`Moved "${relPath.slice(relPath.lastIndexOf('/') + 1)}" to ${destFolder || '(vault root)'}.`, 'info');
      onChanged();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Could not move that note.');
    }
  };

  const handleImportFiles = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setImporting(true);
    try {
      const items = await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() })));
      const results = await api.importNotes(items);
      const imported = results.filter((r) => r.status === 'imported');
      const dupes = imported.filter((r) => r.savedAs?.includes('DUPE'));
      const skipped = results.filter((r) => r.status === 'skipped');
      let msg = `Imported ${imported.length} file${imported.length === 1 ? '' : 's'} into ${INBOX_FOLDER}.`;
      if (dupes.length) msg += ` ${dupes.length} renamed with "DUPE" — that name already existed there.`;
      if (skipped.length) msg += ` Skipped ${skipped.length} non-.md file${skipped.length === 1 ? '' : 's'}.`;
      pushToast(msg, 'info');
      if (imported.length > 0) onChanged();
    } catch (err) {
      pushToast(err instanceof ApiError ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-shrink-0 px-1 pb-3">
        <h1 className="text-lg font-semibold text-slate-100">Explorer</h1>
        <p className="mt-1 text-sm text-slate-500">
          Drag a note from the right onto a folder on the left to move it. Drag <code className="text-slate-400">.md</code> files
          from your computer onto the right panel to import them into <span className="text-slate-400">{INBOX_FOLDER}</span>.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,25fr)_minmax(0,25fr)_minmax(0,50fr)] gap-4">
        <div className="flex min-h-0 flex-col overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-900/40 p-2">
          <div className="mb-1 flex flex-shrink-0 items-center justify-between px-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Folders</span>
            {!creatingFolder && (
              <button
                onClick={() => setCreatingFolder(true)}
                title={`New folder inside ${selected || '(Vault root)'}`}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-800/60 hover:text-violet-300"
              >
                <FolderPlus size={14} weight="regular" />
                New
              </button>
            )}
          </div>
          {creatingFolder && (
            <form onSubmit={handleCreateFolder} className="mb-2 flex-shrink-0 px-1">
              <div className="mb-1 truncate text-xs text-slate-500">
                Inside <span className="text-slate-300">{selected || '(Vault root)'}</span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="flex-shrink-0 rounded bg-violet-500/20 px-2 py-1 text-xs text-violet-300 hover:bg-violet-500/30"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFolder(false);
                    setNewFolderName('');
                  }}
                  className="flex-shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-800/60"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div
            onClick={() => setSelected('')}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-note-relpath')) return;
              e.preventDefault();
              setDragOverFolder('');
            }}
            onDragLeave={() => setDragOverFolder(null)}
            onDrop={(e) => {
              e.preventDefault();
              const relPath = e.dataTransfer.getData('application/x-note-relpath');
              setDragOverFolder(null);
              if (relPath) void handleMove(relPath, '');
            }}
            className={`mb-1 cursor-pointer rounded px-2 py-1.5 text-sm transition ${
              selected === ''
                ? 'bg-violet-500/15 text-violet-300'
                : dragOverFolder === ''
                  ? 'bg-violet-500/25 ring-1 ring-violet-400'
                  : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            (Vault root)
          </div>
          <FolderBranch
            node={tree}
            depth={0}
            selected={selected}
            dragOverPath={dragOverFolder}
            onSelect={setSelected}
            onDragOverFolder={setDragOverFolder}
            onDragLeaveFolder={() => setDragOverFolder(null)}
            onDropOnFolder={(path, e) => {
              e.preventDefault();
              const relPath = e.dataTransfer.getData('application/x-note-relpath');
              setDragOverFolder(null);
              if (relPath) void handleMove(relPath, path);
            }}
          />
        </div>

        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setImportDragActive(true);
          }}
          onDragLeave={() => setImportDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setImportDragActive(false);
            if (e.dataTransfer.files.length > 0) void handleImportFiles(e.dataTransfer.files);
          }}
          className={`relative flex min-h-0 flex-col overflow-y-auto rounded-xl border p-2 transition ${
            importDragActive ? 'border-violet-400 bg-violet-500/10' : 'border-slate-800/80 bg-slate-900/40'
          }`}
        >
          <div className="mb-1 flex-shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {selected || '(Vault root)'} · {visibleNotes.length + visibleAttachments.length} item
            {visibleNotes.length + visibleAttachments.length === 1 ? '' : 's'}
          </div>
          <div className="divide-y divide-slate-800/60">
            {visibleNotes.map((note) => (
              <div
                key={note.relPath}
                draggable
                onClick={() => setPreview({ type: 'note', relPath: note.relPath })}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-note-relpath', note.relPath);
                  e.dataTransfer.setData('text/plain', note.relPath);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingPath(note.relPath);
                }}
                onDragEnd={() => setDraggingPath(null)}
                className={`group flex cursor-grab items-center gap-2 rounded px-2 py-2 text-sm transition hover:bg-slate-800/50 active:cursor-grabbing ${
                  draggingPath === note.relPath ? 'opacity-40' : ''
                } ${
                  preview?.type === 'note' && preview.relPath === note.relPath
                    ? 'bg-violet-500/15 text-violet-200'
                    : 'text-slate-200'
                }`}
                title="Click to preview · drag onto a folder on the left to move"
              >
                <File size={15} weight="regular" className="flex-shrink-0 text-slate-500" />
                <span className="truncate">{note.title}</span>
                {note.folder !== ARCHIVE_FOLDER && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleArchive(note.relPath);
                    }}
                    disabled={archivingPath === note.relPath}
                    title={`Archive (move to ${ARCHIVE_FOLDER})`}
                    className="ml-auto flex-shrink-0 rounded p-1 text-slate-500 opacity-0 transition hover:bg-slate-700/60 hover:text-amber-300 disabled:opacity-50 group-hover:opacity-100"
                  >
                    <Archive size={14} weight="regular" />
                  </button>
                )}
              </div>
            ))}
            {visibleAttachments.map((file) => (
              <div
                key={file.relPath}
                onClick={() => setPreview({ type: 'attachment', relPath: file.relPath })}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm transition hover:bg-slate-800/50 ${
                  preview?.type === 'attachment' && preview.relPath === file.relPath
                    ? 'bg-violet-500/15 text-violet-200'
                    : 'text-slate-400'
                }`}
                title={`${fileName(file.relPath)} · ${formatSize(file.size)} — click to preview, not movable from here yet`}
              >
                {IMAGE_EXT.test(file.relPath) ? (
                  <Image size={15} weight="regular" className="flex-shrink-0 text-slate-500" />
                ) : (
                  <File size={15} weight="regular" className="flex-shrink-0 text-slate-500" />
                )}
                <span className="truncate">{fileName(file.relPath)}</span>
                <span className="ml-auto flex-shrink-0 text-xs text-slate-600">{formatSize(file.size)}</span>
              </div>
            ))}
            {visibleNotes.length === 0 && visibleAttachments.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-slate-500">
                Nothing directly in this folder.
              </div>
            )}
          </div>

          {(importDragActive || importing) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/70">
              <div className="flex items-center gap-2 text-sm font-medium text-violet-300">
                <UploadSimple size={18} weight="bold" />
                {importing ? 'Importing…' : `Drop to import into ${INBOX_FOLDER}`}
              </div>
            </div>
          )}
        </div>

        <NotePreviewPanel item={preview} onOpenNote={onOpenNote} />
      </div>
    </div>
  );
}
