import { useMemo, useState } from 'react';
import type { DeadAttachment, NoteSummary } from '../types';
import { NoteHoverPreview } from './NoteHoverPreview';

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  notes: NoteSummary[];
  files: DeadAttachment[];
}

function newNode(name: string, path: string): TreeNode {
  return { name, path, children: new Map(), notes: [], files: [] };
}

/** Builds one tree from both notes and plain attachment files, keyed by folder path — a folder
 * holding only images (e.g. `_Attachments`) used to be invisible here entirely, since the tree
 * was built purely from where notes live. Walking attachment relPaths the same way notes already
 * are is what makes it show up as a node like any other folder. */
function buildTree(notes: NoteSummary[], attachments: DeadAttachment[]): TreeNode {
  const root = newNode('', '');

  const folderOf = (relPath: string) => {
    const idx = relPath.lastIndexOf('/');
    return idx === -1 ? '' : relPath.slice(0, idx);
  };

  const ensureFolder = (folder: string): TreeNode => {
    const segments = folder ? folder.split('/') : [];
    let cursor = root;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!cursor.children.has(seg)) cursor.children.set(seg, newNode(seg, acc));
      cursor = cursor.children.get(seg)!;
    }
    return cursor;
  };

  for (const note of notes) ensureFolder(note.folder).notes.push(note);
  for (const file of attachments) ensureFolder(folderOf(file.relPath)).files.push(file);

  return root;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

function Branch({
  node,
  depth,
  activePath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (relPath: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const childFolders = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
  const notes = [...node.notes].sort((a, b) => a.title.localeCompare(b.title));
  const files = [...node.files].sort((a, b) => a.relPath.localeCompare(b.relPath));

  return (
    <div>
      {node.name && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-medium text-slate-300 hover:bg-slate-800/60"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''} text-slate-500`}>›</span>
          {node.name}
        </button>
      )}
      {open && (
        <div>
          {childFolders.map((child) => (
            <Branch key={child.path} node={child} depth={depth + 1} activePath={activePath} onSelect={onSelect} />
          ))}
          {notes.map((note) => (
            <NoteHoverPreview key={note.relPath} note={note}>
              <button
                onClick={() => onSelect(note.relPath)}
                className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-slate-800/60 ${
                  activePath === note.relPath ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400'
                }`}
                style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}
                title={note.title}
              >
                {note.title}
              </button>
            </NoteHoverPreview>
          ))}
          {files.map((file) => (
            <a
              key={file.relPath}
              href={`/api/attachments/${encodeURIComponent(file.relPath)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 truncate rounded px-2 py-1 text-left text-sm text-slate-500 hover:bg-slate-800/60 hover:text-slate-300"
              style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}
              title={`${fileName(file.relPath)} · ${formatSize(file.size)} · opens in a new tab`}
            >
              <span className="truncate">🖼️ {fileName(file.relPath)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderTree({
  notes,
  attachments = [],
  activePath,
  onSelect,
}: {
  notes: NoteSummary[];
  attachments?: DeadAttachment[];
  activePath: string | null;
  onSelect: (relPath: string) => void;
}) {
  const tree = useMemo(() => buildTree(notes, attachments), [notes, attachments]);
  return <Branch node={tree} depth={0} activePath={activePath} onSelect={onSelect} />;
}
