import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MailAccountStatus, MailFolder } from '../types';

/**
 * The move-to-folder and delete behavior shared by every place a mail row can appear (the full
 * Mail page's per-account columns, and the home page's UnreadMailWidget) — pulled out so both get
 * the exact same folder-menu popover, arm/confirm delete dance, and auto-revert timing instead of
 * two copies that could quietly drift apart. `limit` and `updateAccount` are the only things that
 * differ per caller (the Mail page's own larger limit vs. the widget's smaller one, and where the
 * refreshed `MailAccountStatus` gets written back to).
 */
export function useMailRowActions({
  limit,
  updateAccount,
  onError,
}: {
  limit: number;
  updateAccount: (address: string, updated: MailAccountStatus) => void;
  onError?: (message: string) => void;
}) {
  const [movingUids, setMovingUids] = useState<Set<string>>(new Set());
  const [deletingUids, setDeletingUids] = useState<Set<string>>(new Set());
  const [folderMenuKey, setFolderMenuKey] = useState<string | null>(null);
  const [foldersByAccount, setFoldersByAccount] = useState<Record<string, MailFolder[]>>({});
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  // Closes any open folder-menu popover on an outside click — same lightweight approach as the
  // other inline popovers in this app (e.g. NoteView's Align picker), since there's no portal/
  // overlay library in use here to manage this for us.
  useEffect(() => {
    if (!folderMenuKey) return;
    const close = () => setFolderMenuKey(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [folderMenuKey]);

  // An armed delete (showing the checkmark) auto-reverts on an outside click too, same as the
  // folder menu above — clicking away from it reads as "never mind", not "confirm".
  useEffect(() => {
    if (!confirmDeleteKey) return;
    const close = () => setConfirmDeleteKey(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [confirmDeleteKey]);

  // Also drops the armed state after a few seconds of no second click, so a delete button that
  // was armed and then forgotten about doesn't just sit there indefinitely waiting for a click
  // that may never come.
  useEffect(() => {
    if (!confirmDeleteKey) return;
    const t = setTimeout(() => setConfirmDeleteKey(null), 4000);
    return () => clearTimeout(t);
  }, [confirmDeleteKey]);

  const toggleFolderMenu = (address: string, uid: number) => {
    const k = `${address}:${uid}`;
    setFolderMenuKey((prev) => (prev === k ? null : k));
    if (!foldersByAccount[address]) {
      api
        .mailFolders(address)
        .then((folders) => setFoldersByAccount((prev) => ({ ...prev, [address]: folders })))
        .catch(() => setFoldersByAccount((prev) => ({ ...prev, [address]: [] })));
    }
  };

  const moveMessage = async (address: string, uid: number, destination: string) => {
    setFolderMenuKey(null);
    const key = `${address}:${uid}`;
    setMovingUids((prev) => new Set(prev).add(key));
    try {
      const updated = await api.moveMail(address, uid, destination, limit);
      updateAccount(address, updated);
    } catch {
      onError?.("Couldn't move that message — try again.");
    } finally {
      setMovingUids((prev) => {
        const copy = new Set(prev);
        copy.delete(key);
        return copy;
      });
    }
  };

  const deleteMessage = async (address: string, uid: number) => {
    const key = `${address}:${uid}`;
    setDeletingUids((prev) => new Set(prev).add(key));
    try {
      const updated = await api.deleteMail(address, uid, limit);
      updateAccount(address, updated);
    } catch {
      onError?.("Couldn't delete that message — try again.");
    } finally {
      setDeletingUids((prev) => {
        const copy = new Set(prev);
        copy.delete(key);
        return copy;
      });
    }
  };

  /** First click on a message's trash button arms it (the button swaps to a checkmark instead of
   * popping a confirm() dialog); the second click on that same checkmark actually deletes.
   * Clicking a *different* message's trash button just re-arms there instead — no explicit
   * disarm needed, since `confirmDeleteKey` only ever holds one key at a time. */
  const handleTrashClick = (address: string, uid: number) => {
    const key = `${address}:${uid}`;
    if (confirmDeleteKey === key) {
      setConfirmDeleteKey(null);
      void deleteMessage(address, uid);
    } else {
      setConfirmDeleteKey(key);
    }
  };

  return {
    movingUids,
    deletingUids,
    folderMenuKey,
    foldersByAccount,
    confirmDeleteKey,
    toggleFolderMenu,
    moveMessage,
    handleTrashClick,
  };
}
