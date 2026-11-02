import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { readSettings, writeSettings } from './settings.js';
import type {
  MailAccountStatus,
  MailFolder,
  MailMessage,
  MailMessageBody,
  MailRule,
  MailRuleLogEntry,
  MailStatus,
} from './types.js';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 200;

export function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

/** Account 1 keeps the original unsuffixed env var names (backwards compatible with the
 * single-account setup); account 2+ are GMAIL_ADDRESS_2/GMAIL_APP_PASSWORD_2 and so on. Reading
 * this at module load (not per-request) means adding an account always requires a container
 * restart anyway, which is already true of every other env-driven setting here. */
function readAccounts(): { address: string; password: string }[] {
  const accounts: { address: string; password: string }[] = [];
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? '' : `_${i}`;
    const address = process.env[`GMAIL_ADDRESS${suffix}`];
    const password = process.env[`GMAIL_APP_PASSWORD${suffix}`];
    if (!address || !password) break;
    accounts.push({ address, password });
  }
  return accounts;
}

const ACCOUNTS = readAccounts();

function newClient(address: string, password: string): ImapFlow {
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: address, pass: password },
    logger: false,
  });
}

/** Must be called with the INBOX already locked. `count` is always the true total (from the
 * unseen search, uncapped) — only how many of those get fetched as full `messages` is limited. */
async function collectUnread(client: ImapFlow, address: string, limit: number): Promise<MailAccountStatus> {
  const uids = await client.search({ seen: false }, { uid: true });
  if (uids === false || !uids) return { address, count: 0, messages: [] };

  const count = uids.length;
  const recentUids = uids.slice(-limit);
  const messages: MailMessage[] = [];
  if (recentUids.length > 0) {
    for await (const msg of client.fetch(recentUids, { envelope: true }, { uid: true })) {
      const envelope = msg.envelope;
      const from = envelope?.from?.[0];
      messages.push({
        uid: msg.uid,
        subject: envelope?.subject || '(no subject)',
        from: from?.name || from?.address || 'Unknown sender',
        fromAddress: from?.address ?? '',
        date: envelope?.date ? new Date(envelope.date).toISOString() : '',
      });
    }
  }
  messages.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { address, count, messages };
}

async function fetchAccount(address: string, password: string, limit: number): Promise<MailAccountStatus> {
  const client = newClient(address, password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      return await collectUnread(client, address, limit);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Per-(account, limit) cache/in-flight dedup. The home-page widgets and the full Mail page now
 * poll with the *same* limit on purpose (see web/src/mailConstants.ts) so they share one cache
 * entry instead of each paying for their own IMAP fetch. That poll runs every 60s, so the TTL
 * here is set comfortably longer than that — long enough that opening the Mail page always lands
 * on a warm entry from the last background poll rather than racing it. Mutations (mark read/all/
 * sender, the per-account refresh button) all write straight back into this cache afterward, so
 * staleness is bounded by "time since last poll or action", not by this TTL. Several browser
 * tabs/devices polling at once shouldn't each open their own IMAP connection, and one account's
 * slow/erroring login shouldn't block or retry the others. */
const CACHE_TTL_MS = 90_000;
const cache = new Map<string, { at: number; status: MailAccountStatus }>();
const inFlight = new Map<string, Promise<MailAccountStatus>>();

async function getAccountStatus(
  address: string,
  password: string,
  limit: number,
  forceRefresh = false,
): Promise<MailAccountStatus> {
  const key = `${address}:${limit}`;
  if (!forceRefresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.status;
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = fetchAccount(address, password, limit)
    .catch((err): MailAccountStatus => ({
      address,
      count: 0,
      messages: [],
      error: err instanceof Error ? err.message : 'Failed to check mail',
    }))
    .then((status) => {
      cache.set(key, { at: Date.now(), status });
      return status;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

export async function getUnreadMail(limit?: number): Promise<MailStatus> {
  if (ACCOUNTS.length === 0) return { configured: false, accounts: [] };
  const n = clampLimit(limit);
  const accounts = await Promise.all(ACCOUNTS.map((a) => getAccountStatus(a.address, a.password, n)));
  return { configured: true, accounts };
}

/** Re-checks just one account's mailbox right now, bypassing its cache entry (which could
 * otherwise still have up to CACHE_TTL_MS left on it) — the mail page's per-account refresh
 * button. Updates that account's cache afterward too, so other pollers (the top-bar pill, other
 * open tabs) pick up the fresh result instead of it being overwritten by a stale re-poll. */
export async function refreshAccount(address: string, limit?: number): Promise<MailAccountStatus> {
  const n = clampLimit(limit);
  const account = ACCOUNTS.find((a) => a.address === address);
  if (!account) return { address, count: 0, messages: [], error: 'Unknown account' };
  return getAccountStatus(account.address, account.password, n, true);
}

/** Flags `uids` as \Seen on Gmail's actual server (not just hidden locally) for the given
 * account, then re-reads that one mailbox in the same connection so the result is already
 * current — no separate getUnreadMail() round trip. `limit` should match whatever limit the
 * caller is displaying (e.g. the full mail page passes its own larger limit) so the refreshed
 * list isn't silently truncated back down to the default. */
export async function markAsRead(address: string, uids: number[], limit?: number): Promise<MailAccountStatus> {
  const n = clampLimit(limit);
  const account = ACCOUNTS.find((a) => a.address === address);
  if (!account) return { address, count: 0, messages: [], error: 'Unknown account' };
  if (uids.length === 0) return getAccountStatus(account.address, account.password, n);

  const client = newClient(account.address, account.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      const status = await collectUnread(client, address, n);
      cache.set(`${address}:${n}`, { at: Date.now(), status });
      return status;
    } finally {
      lock.release();
    }
  } catch (err) {
    const status: MailAccountStatus = {
      address,
      count: 0,
      messages: [],
      error: err instanceof Error ? err.message : 'Failed to mark mail as read',
    };
    cache.set(`${address}:${n}`, { at: Date.now(), status });
    return status;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Marks *every* unread message in the account as read, in one IMAP STORE call regardless of
 * how many there are — unlike the mail page's "Mark these read"/"Mark all read" footer button,
 * which only covers whatever got fetched into `messages` (capped at `limit`, so at most 200). A
 * fresh, uncapped search finds every unseen UID first, so this reaches the real backlog, not
 * just what's currently on screen. */
export async function markAllAsRead(address: string, limit?: number): Promise<MailAccountStatus> {
  const n = clampLimit(limit);
  const account = ACCOUNTS.find((a) => a.address === address);
  if (!account) return { address, count: 0, messages: [], error: 'Unknown account' };

  const client = newClient(account.address, account.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (uids && uids.length > 0) {
        await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      }
      const status = await collectUnread(client, address, n);
      cache.set(`${address}:${n}`, { at: Date.now(), status });
      return status;
    } finally {
      lock.release();
    }
  } catch (err) {
    const status: MailAccountStatus = {
      address,
      count: 0,
      messages: [],
      error: err instanceof Error ? err.message : 'Failed to mark all mail as read',
    };
    cache.set(`${address}:${n}`, { at: Date.now(), status });
    return status;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Folder listings barely ever change (a user adding/renaming a Gmail label is rare), so this
 * gets its own long-TTL cache separate from the unread-mail one above — the move-to-folder picker
 * can hit it on every open without a fresh IMAP round trip each time. */
const FOLDER_CACHE_TTL_MS = 5 * 60_000;
const folderCache = new Map<string, { at: number; folders: MailFolder[] }>();

/** Every selectable mailbox for `address` — a Gmail label, from IMAP's point of view — for the
 * mail page's "move to" picker. Excludes `\Noselect` entries (parent nodes some IMAP servers list
 * that exist only to group other folders, like Gmail's bare "[Gmail]") since those can't actually
 * receive a moved message. */
export async function listFolders(address: string): Promise<MailFolder[]> {
  const hit = folderCache.get(address);
  if (hit && Date.now() - hit.at < FOLDER_CACHE_TTL_MS) return hit.folders;

  const account = ACCOUNTS.find((a) => a.address === address);
  if (!account) return [];

  const client = newClient(account.address, account.password);
  try {
    await client.connect();
    const list = await client.list();
    const folders: MailFolder[] = list
      .filter((entry) => !entry.flags.has('\\Noselect') && entry.path !== 'INBOX')
      .map((entry) => ({ path: entry.path, name: entry.name, specialUse: entry.specialUse }));
    folderCache.set(address, { at: Date.now(), folders });
    return folders;
  } catch {
    return hit?.folders ?? [];
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Finds the account's real Trash folder by its IMAP special-use flag (`\Trash`) rather than by
 * name — Gmail localizes "Trash" per the account's own language setting, so a hardcoded
 * "[Gmail]/Trash" path would silently break on a non-English account. */
async function findTrashPath(client: ImapFlow): Promise<string | null> {
  const list = await client.list();
  return list.find((entry) => entry.specialUse === '\\Trash')?.path ?? null;
}

/** Fetches and parses one message's full body — the mail page's preview modal, opened on demand
 * when a message is clicked. Deliberately uncached (unlike the unread list): this is a one-off
 * read of one specific message, not something repeatedly polled, so there's no reuse to gain by
 * keeping it around, and holding full HTML email bodies in memory indefinitely would be wasteful. */
export async function getMessageBody(address: string, uid: number): Promise<MailMessageBody | { error: string }> {
  const account = ACCOUNTS.find((a) => a.address === address);
  if (!account) return { error: 'Unknown account' };

  const client = newClient(account.address, account.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const dl = await client.download(uid, undefined, { uid: true });
      if (!dl || !dl.content) return { error: 'Message not found' };
      const parsed = await simpleParser(dl.content);
      return {
        subject: parsed.subject || '(no subject)',
        from: parsed.from?.text || '',
        to: parsed.to && 'text' in parsed.to ? parsed.to.text : '',
        date: parsed.date ? parsed.date.toISOString() : '',
        html: typeof parsed.html === 'string' ? parsed.html : null,
        text: parsed.text ?? null,
      };
    } finally {
      lock.release();
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load message' };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Moves one message out of INBOX into `destination` (any folder from `listFolders`) — Gmail's
 * IMAP MOVE removes the Inbox label and adds the destination's, which is exactly "drag to a
 * label" from the Gmail UI's own point of view. Re-reads the mailbox afterward in the same
 * connection so the caller gets an already-current unread list back, same pattern as
 * `markAsRead`. */
export async function moveMessage(
  address: string,
  uid: number,
  destination: string,
  limit?: number,
): Promise<MailAccountStatus> {
  const n = clampLimit(limit);
  const account = ACCOUNTS.find((a) => a.address === address);
  if (!account) return { address, count: 0, messages: [], error: 'Unknown account' };

  const client = newClient(account.address, account.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageMove([uid], destination, { uid: true });
      const status = await collectUnread(client, address, n);
      cache.set(`${address}:${n}`, { at: Date.now(), status });
      return status;
    } finally {
      lock.release();
    }
  } catch (err) {
    const status: MailAccountStatus = {
      address,
      count: 0,
      messages: [],
      error: err instanceof Error ? err.message : 'Failed to move that message',
    };
    cache.set(`${address}:${n}`, { at: Date.now(), status });
    return status;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** "Delete" means what clicking Gmail's own trash icon means: move to Trash (which Gmail then
 * auto-expires after 30 days), not an immediate, unrecoverable IMAP expunge. Falls back to a
 * plain `\Deleted` flag + expunge only if no Trash folder could be found at all, so this still
 * does *something* reasonable against a non-Gmail IMAP server. */
export async function deleteMessage(address: string, uid: number, limit?: number): Promise<MailAccountStatus> {
  const n = clampLimit(limit);
  const account = ACCOUNTS.find((a) => a.address === address);
  if (!account) return { address, count: 0, messages: [], error: 'Unknown account' };

  const client = newClient(account.address, account.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const trashPath = await findTrashPath(client);
      if (trashPath) {
        await client.messageMove([uid], trashPath, { uid: true });
      } else {
        await client.messageDelete([uid], { uid: true });
      }
      const status = await collectUnread(client, address, n);
      cache.set(`${address}:${n}`, { at: Date.now(), status });
      return status;
    } finally {
      lock.release();
    }
  } catch (err) {
    const status: MailAccountStatus = {
      address,
      count: 0,
      messages: [],
      error: err instanceof Error ? err.message : 'Failed to delete that message',
    };
    cache.set(`${address}:${n}`, { at: Date.now(), status });
    return status;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Drops every cached unread-mail entry for `address` (across whatever different `limit`s the
 * home widget vs. the full Mail page happen to be using) so the next poll from either one goes
 * live instead of serving a now-stale count — the mail-rules poller below mutates the mailbox
 * directly, outside of any of the normal getAccountStatus() call sites that would otherwise keep
 * this in sync on their own. */
function invalidateAccountCache(address: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${address}:`)) cache.delete(key);
  }
}

/** First rule (in list order) whose pattern is a case-insensitive substring of `fromAddress` and
 * whose scope covers `accountAddress` — same substring-on-From-address semantics as the existing
 * per-sender "mark as read" button, just persisted instead of a one-off click. */
function matchRule(fromAddress: string, accountAddress: string, rules: MailRule[]): MailRule | null {
  const addr = fromAddress.toLowerCase();
  for (const rule of rules) {
    if (!rule.pattern) continue;
    if (rule.accountAddress !== 'all' && rule.accountAddress !== accountAddress) continue;
    if (addr.includes(rule.pattern.toLowerCase())) return rule;
  }
  return null;
}

/** Applies whatever rules are scoped to this account against its current unread mail (an
 * uncapped search, same as `markAllAsRead` — the backlog, not just whatever a `limit` would
 * normally truncate to). Log entries are only built from the matches found while scanning, but
 * only returned once the actual IMAP mutation (flag or move) that entry claims happened has
 * actually succeeded — an error partway through the connection must never claim an action that
 * didn't really happen. */
async function applyRulesToAccount(
  account: { address: string; password: string },
  rules: MailRule[],
): Promise<MailRuleLogEntry[]> {
  const scoped = rules.filter((r) => r.accountAddress === 'all' || r.accountAddress === account.address);
  if (scoped.length === 0) return [];

  const client = newClient(account.address, account.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return [];

      const entries: MailRuleLogEntry[] = [];
      const toMarkRead: number[] = [];
      const toDelete: number[] = [];
      for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
        const envelope = msg.envelope;
        const from = envelope?.from?.[0];
        const fromAddress = from?.address ?? '';
        const rule = matchRule(fromAddress, account.address, scoped);
        if (!rule) continue;
        entries.push({
          id: `${Date.now()}-${account.address}-${msg.uid}`,
          at: new Date().toISOString(),
          accountAddress: account.address,
          fromAddress,
          subject: envelope?.subject || '(no subject)',
          action: rule.action,
          rulePattern: rule.pattern,
        });
        (rule.action === 'read' ? toMarkRead : toDelete).push(msg.uid);
      }
      if (entries.length === 0) return [];

      if (toMarkRead.length > 0) {
        await client.messageFlagsAdd(toMarkRead, ['\\Seen'], { uid: true });
      }
      if (toDelete.length > 0) {
        const trashPath = await findTrashPath(client);
        if (trashPath) {
          await client.messageMove(toDelete, trashPath, { uid: true });
        } else {
          await client.messageDelete(toDelete, { uid: true });
        }
      }
      invalidateAccountCache(account.address);
      return entries;
    } finally {
      lock.release();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[mail-rules] ${account.address} poll failed:`, err instanceof Error ? err.message : err);
    return [];
  } finally {
    await client.logout().catch(() => client.close());
  }
}

const MAX_RULE_LOG_ENTRIES = 100;

/** The actual check: reads whatever rules are currently configured, applies them against every
 * configured account's unread mail, and — only if anything actually happened — prepends the
 * resulting log entries. A second `readSettings()` right before the write (rather than reusing
 * the one from the top) means a rule the user added/removed mid-poll via the UI isn't clobbered
 * by this write finishing after theirs. */
export async function runMailRules(): Promise<void> {
  if (ACCOUNTS.length === 0) return;
  const { mailRules: rules } = await readSettings();
  if (!rules || rules.length === 0) return;

  const results = await Promise.all(ACCOUNTS.map((a) => applyRulesToAccount(a, rules)));
  const newEntries = results.flat();
  if (newEntries.length === 0) return;

  const current = await readSettings();
  const log = [...newEntries, ...(current.mailRuleLog ?? [])].slice(0, MAX_RULE_LOG_ENTRIES);
  await writeSettings({ mailRuleLog: log });
}

const RULE_POLL_MS = 5 * 60_000;
let pollerStarted = false;

/** Starts the independent background check — unlike every other mail function in this file,
 * this one isn't triggered by a browser request. It runs on a fixed interval for as long as the
 * container is up, so a rule fires even if nobody has the dashboard open at all. Idempotent:
 * safe to call once at server startup without worrying about double-registering the interval. */
export function startMailRulePoller(): void {
  if (pollerStarted) return;
  pollerStarted = true;
  const tick = () => {
    runMailRules().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[mail-rules] poll tick failed:', err);
    });
  };
  setInterval(tick, RULE_POLL_MS);
  tick();
}

/** Marks *every* unread message from `fromAddress` as read on the server — not just the ones
 * currently fetched into `messages` (which may be truncated by `limit`). IMAP's own `from`
 * search is a case-insensitive substring match against the From header, done server-side by
 * Gmail, so this reaches unread mail from that sender that was never fetched into this process
 * at all. */
export async function markSenderAsRead(address: string, fromAddress: string, limit?: number): Promise<MailAccountStatus> {
  const n = clampLimit(limit);
  const account = ACCOUNTS.find((a) => a.address === address);
  if (!account) return { address, count: 0, messages: [], error: 'Unknown account' };
  if (!fromAddress) return getAccountStatus(account.address, account.password, n);

  const client = newClient(account.address, account.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false, from: fromAddress }, { uid: true });
      if (uids && uids.length > 0) {
        await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      }
      const status = await collectUnread(client, address, n);
      cache.set(`${address}:${n}`, { at: Date.now(), status });
      return status;
    } finally {
      lock.release();
    }
  } catch (err) {
    const status: MailAccountStatus = {
      address,
      count: 0,
      messages: [],
      error: err instanceof Error ? err.message : 'Failed to mark sender as read',
    };
    cache.set(`${address}:${n}`, { at: Date.now(), status });
    return status;
  } finally {
    await client.logout().catch(() => client.close());
  }
}
