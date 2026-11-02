import { CheckIcon, FolderIcon, TrashIcon } from './mailIcons';
import type { MailFolder, MailMessage } from '../types';

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * One unread message row — mark-read, move-to-folder, delete, and click-to-preview — shared
 * between the full Mail page's per-account columns and the home page's UnreadMailWidget. The two
 * callers differ in exactly two ways: the Mail page already groups rows under an account header
 * so it doesn't need `accountPill`, and it also offers a "mark this sender read" shortcut
 * (`onMarkSenderRead`) that the space-constrained widget skips — both are optional for that
 * reason, not because either caller is more "complete" than the other.
 */
export function MailMessageRow({
  address,
  msg,
  accountPill = false,
  markingUids,
  markingSenders,
  movingUids,
  deletingUids,
  folderMenuKey,
  confirmDeleteKey,
  folders,
  onMarkRead,
  onMarkSenderRead,
  onPreview,
  onToggleFolderMenu,
  onMove,
  onTrashClick,
}: {
  address: string;
  msg: MailMessage;
  /** Shows the sending account's address as a small pill next to the sender name — on by default
   * everywhere except the Mail page, where the account is already the column's own header. */
  accountPill?: boolean;
  markingUids: Set<string>;
  markingSenders?: Set<string>;
  movingUids: Set<string>;
  deletingUids: Set<string>;
  folderMenuKey: string | null;
  confirmDeleteKey: string | null;
  folders: MailFolder[] | undefined;
  onMarkRead: (address: string, uid: number) => void;
  onMarkSenderRead?: (address: string, fromAddress: string) => void;
  onPreview: (address: string, uid: number) => void;
  onToggleFolderMenu: (address: string, uid: number) => void;
  onMove: (address: string, uid: number, destination: string) => void;
  onTrashClick: (address: string, uid: number) => void;
}) {
  const key = `${address}:${msg.uid}`;
  const senderKey = msg.fromAddress ? `${address}:${msg.fromAddress}` : '';

  return (
    <div
      onClick={() => onPreview(address, msg.uid)}
      className="group relative flex cursor-pointer items-start gap-2 border-b border-slate-800/60 px-3 py-2.5 last:border-0 hover:bg-slate-800/40"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMarkRead(address, msg.uid);
        }}
        disabled={markingUids.has(key)}
        title="Mark as read"
        className="mt-0.5 flex-shrink-0 text-sm text-slate-600 transition-colors hover:text-violet-300 disabled:opacity-40"
      >
        {markingUids.has(key) ? '…' : '☐'}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="truncate text-sm font-medium text-slate-100">{msg.from}</div>
            {accountPill && (
              <span
                title={address}
                className="flex-shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
              >
                {address.split('@')[0]}
              </span>
            )}
            {onMarkSenderRead && msg.fromAddress && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkSenderRead(address, msg.fromAddress);
                }}
                disabled={markingSenders?.has(senderKey)}
                title={`Mark all unread from ${msg.from} as read`}
                className="flex-shrink-0 text-[11px] text-slate-600 opacity-0 transition-opacity hover:text-violet-300 disabled:opacity-40 group-hover:opacity-100"
              >
                {markingSenders?.has(senderKey) ? '…' : '✓✓'}
              </button>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFolderMenu(address, msg.uid);
                }}
                disabled={movingUids.has(key)}
                title="Move to folder"
                className="inline-flex text-slate-600 opacity-0 transition-opacity hover:text-violet-300 disabled:opacity-40 group-hover:opacity-100"
              >
                {movingUids.has(key) ? '…' : <FolderIcon />}
              </button>
              {folderMenuKey === key && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 z-20 mt-1 max-h-56 w-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-1 shadow-xl"
                >
                  {!folders && <div className="px-2 py-1.5 text-xs text-slate-500">Loading folders…</div>}
                  {folders?.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-slate-500">No other folders found.</div>
                  )}
                  {folders?.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => onMove(address, msg.uid, f.path)}
                      className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-slate-300 hover:bg-slate-800 hover:text-violet-300"
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTrashClick(address, msg.uid);
              }}
              disabled={deletingUids.has(key)}
              title={confirmDeleteKey === key ? 'Click again to confirm delete' : 'Delete (moves to Trash)'}
              className={`inline-flex transition-opacity disabled:opacity-40 ${
                confirmDeleteKey === key
                  ? 'text-emerald-400 opacity-100'
                  : 'text-slate-600 opacity-0 hover:text-red-400 group-hover:opacity-100'
              }`}
            >
              {deletingUids.has(key) ? '…' : confirmDeleteKey === key ? <CheckIcon /> : <TrashIcon />}
            </button>
            <div className="text-xs text-slate-500">{timeAgo(msg.date)}</div>
          </div>
        </div>
        <div className="truncate text-xs text-slate-400">{msg.subject}</div>
      </div>
    </div>
  );
}
