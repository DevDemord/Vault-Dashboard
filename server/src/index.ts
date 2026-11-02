import path from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { ConflictError, ValidationError, VaultIndex } from './vault.js';
import { getHostMetrics } from './hostMetrics.js';
import {
  deleteMessage,
  getMessageBody,
  getUnreadMail,
  listFolders,
  markAllAsRead,
  markAsRead,
  markSenderAsRead,
  moveMessage,
  refreshAccount,
  startMailRulePoller,
} from './mail.js';
import { readSettings, writeSettings, saveSiteIcon, removeSiteIcon, resolveSiteIconPath } from './settings.js';
import { deleteDownload, listRecentDownloads, queueDownload } from './downloads.js';
import { getSnapshotContent, listSnapshots } from './versions.js';
import { fetchLinkTitle } from './linkTitle.js';
import {
  addBlockedKeyword,
  addCustomSource,
  addInterestKeyword,
  blockKeywordFromTitle,
  getTrendingFeed,
  listBlockedKeywords,
  listCustomSources,
  listInterestKeywords,
  removeCustomSource,
  removeInterestKeyword,
  startTrendingPoller,
  toTrendingFeedLine,
  unblockKeyword,
} from './trending.js';
import { getFxItems, refreshFxNow, startFxPoller } from './fx.js';
import type { CreateNoteInput, Settings } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3015);
const VAULT_DIR = process.env.VAULT_DIR ?? '/app/vault';
const WEB_DIST = path.resolve(__dirname, '../web/dist');

// Default is 1MB — too small for the Explorer's multi-file `.md` import, raised to match the
// existing 20MB multipart (image upload) limit below.
const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });
const vault = new VaultIndex(VAULT_DIR);

await app.register(cors, { origin: true });
await app.register(fastifyStatic, { root: WEB_DIST });
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

app.get('/api/health', async () => ({ ok: true }));

app.get('/api/stats', async () => vault.getStats());

app.get('/api/notes', async () => vault.listNotes());

app.get('/api/tags', async () => vault.listTags());

app.get('/api/search', async (req) => {
  const q = String((req.query as Record<string, string>).q ?? '');
  return vault.searchNotes(q);
});

app.get('/api/notes/*', async (req, reply) => {
  const relPath = decodeURIComponent((req.params as Record<string, string>)['*']);
  const note = vault.getNote(relPath);
  if (!note) return reply.code(404).send({ error: 'Note not found' });
  return note;
});

app.get('/api/related/*', async (req) => {
  const relPath = decodeURIComponent((req.params as Record<string, string>)['*']);
  return vault.getRelatedNotes(relPath);
});

app.get('/api/tasks', async () => vault.listTasks());

app.get('/api/bookmarks', async () => vault.listBookmarks());

app.get('/api/activity-log', async () => vault.listActivityLog());

app.get('/api/sports-events/all', async () => vault.listAllSportsEvents());

app.get('/api/sports-events', async (req) => {
  const limitRaw = Number((req.query as Record<string, string>).limit ?? 5);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 50) : 5;
  return vault.listUpcomingSportsEvents(limit);
});

app.post('/api/sports-events', async (req, reply) => {
  const { title, date, time, endDate, endTime, sport } =
    (req.body as {
      title?: string;
      date?: string;
      time?: string | null;
      endDate?: string | null;
      endTime?: string | null;
      sport?: string | null;
    }) ?? {};
  if (!title || !date) return reply.code(400).send({ error: 'title and date are required' });
  try {
    await vault.addSportsEvent(title, date, time ?? null, endDate ?? null, endTime ?? null, sport ?? null);
    return reply.code(201).send();
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/bookmarks', async (req, reply) => {
  const { url } = (req.body as { url?: string }) ?? {};
  if (!url || !url.trim()) return reply.code(400).send({ error: 'url is required' });
  try {
    await vault.addBookmark(url);
    return reply.code(201).send();
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/tasks', async (req, reply) => {
  const { text } = (req.body as { text?: string }) ?? {};
  if (!text || !text.trim()) return reply.code(400).send({ error: 'text is required' });
  try {
    await vault.addTask(text);
    return reply.code(201).send();
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/tasks/toggle', async (req, reply) => {
  const { sourcePath, line, done } = (req.body as { sourcePath?: string; line?: number; done?: boolean }) ?? {};
  if (!sourcePath || typeof line !== 'number' || typeof done !== 'boolean') {
    return reply.code(400).send({ error: 'sourcePath, line, and done are required' });
  }
  try {
    await vault.toggleTask(sourcePath, line, done);
    return reply.code(204).send();
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.get('/api/create-options', async () => vault.getCreateOptions());

app.post('/api/notes', async (req, reply) => {
  const body = req.body as Partial<CreateNoteInput>;
  if (!body?.title || !body?.folder) {
    return reply.code(400).send({ error: 'title and folder are required' });
  }
  try {
    const note = await vault.createNote({
      title: body.title,
      folder: body.folder,
      project: body.project,
      area: body.area,
    });
    return reply.code(201).send(note);
  } catch (err) {
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.delete('/api/notes/*', async (req, reply) => {
  const relPath = decodeURIComponent((req.params as Record<string, string>)['*']);
  try {
    await vault.deleteNote(relPath);
    return reply.code(204).send();
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/notes-archive', async (req, reply) => {
  const { relPath } = (req.body as { relPath?: string }) ?? {};
  if (!relPath) return reply.code(400).send({ error: 'relPath is required' });
  try {
    await vault.archiveNote(relPath);
    return reply.code(204).send();
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/notes-move', async (req, reply) => {
  const { relPath, folder } = (req.body as { relPath?: string; folder?: string }) ?? {};
  if (!relPath || !folder) return reply.code(400).send({ error: 'relPath and folder are required' });
  try {
    await vault.moveToResourceFolder(relPath, folder);
    return reply.code(204).send();
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.get('/api/folders', async () => ({ folders: await vault.listFolders() }));

app.post('/api/folders', async (req, reply) => {
  const { parent, name } = (req.body as { parent?: string; name?: string }) ?? {};
  if (!name) return reply.code(400).send({ error: 'name is required' });
  try {
    const folder = await vault.createFolder(parent ? `${parent}/${name}` : name);
    return { folder };
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/notes-move-folder', async (req, reply) => {
  const { relPath, destFolder } = (req.body as { relPath?: string; destFolder?: string }) ?? {};
  if (!relPath || destFolder === undefined) return reply.code(400).send({ error: 'relPath and destFolder are required' });
  try {
    const newRelPath = await vault.moveNoteToFolder(relPath, destFolder);
    return { relPath: newRelPath };
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/notes-import', async (req, reply) => {
  const { files } = (req.body as { files?: { name: string; content: string }[] }) ?? {};
  if (!Array.isArray(files) || files.length === 0) return reply.code(400).send({ error: 'files is required' });
  return { results: await vault.importNotes(files) };
});

app.post('/api/notes-tags', async (req, reply) => {
  const { relPath, tags } = (req.body as { relPath?: string; tags?: string[] }) ?? {};
  if (!relPath || !Array.isArray(tags)) return reply.code(400).send({ error: 'relPath and tags are required' });
  try {
    return await vault.setTags(relPath, tags);
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/daily', async (req, reply) => {
  const { date } = (req.body as { date?: string }) ?? {};
  if (!date) return reply.code(400).send({ error: 'date is required' });
  try {
    return await vault.getOrCreateDaily(date);
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.get('/api/graph', async () => vault.getGraph());

app.get('/api/orphans', async () => vault.listOrphans());

app.get('/api/duplicates', async () => vault.findDuplicates());

app.get('/api/dead-attachments', async () => vault.listDeadAttachments());

app.get('/api/attachment-files', async () => vault.listAttachments());

app.get('/api/vault-size', async () => vault.getVaultSize());

app.get('/api/host-metrics', async () => getHostMetrics());

app.get('/api/trending', async () => ({ items: await getTrendingFeed() }));

app.get('/api/trending/blocked', async () => ({ keywords: await listBlockedKeywords() }));

app.post('/api/trending/block', async (req, reply) => {
  const { title } = (req.body as { title?: string }) ?? {};
  if (!title) return reply.code(400).send({ error: 'title is required' });
  const keyword = await blockKeywordFromTitle(title);
  return { keyword };
});

// Typed directly into the Settings modal's "Feed" section — no title to extract a keyword from,
// unlike the card's own "not interested" button above.
app.post('/api/trending/block-keyword', async (req, reply) => {
  const { keyword } = (req.body as { keyword?: string }) ?? {};
  if (!keyword) return reply.code(400).send({ error: 'keyword is required' });
  return { keywords: await addBlockedKeyword(keyword) };
});

app.post('/api/trending/unblock', async (req, reply) => {
  const { keyword } = (req.body as { keyword?: string }) ?? {};
  if (!keyword) return reply.code(400).send({ error: 'keyword is required' });
  return { keywords: await unblockKeyword(keyword) };
});

app.get('/api/trending/interests', async () => ({ keywords: await listInterestKeywords() }));

app.post('/api/trending/interests/add', async (req, reply) => {
  const { keyword } = (req.body as { keyword?: string }) ?? {};
  if (!keyword) return reply.code(400).send({ error: 'keyword is required' });
  return { keywords: await addInterestKeyword(keyword) };
});

app.post('/api/trending/interests/remove', async (req, reply) => {
  const { keyword } = (req.body as { keyword?: string }) ?? {};
  if (!keyword) return reply.code(400).send({ error: 'keyword is required' });
  return { keywords: await removeInterestKeyword(keyword) };
});

app.get('/api/trending/sources', async () => ({ sources: await listCustomSources() }));

app.post('/api/trending/sources', async (req, reply) => {
  const { name, url } = (req.body as { name?: string; url?: string }) ?? {};
  if (!name || !url) return reply.code(400).send({ error: 'name and url are required' });
  try {
    return { sources: await addCustomSource(name, url) };
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    throw err;
  }
});

app.post('/api/trending/sources/remove', async (req, reply) => {
  const { id } = (req.body as { id?: string }) ?? {};
  if (!id) return reply.code(400).send({ error: 'id is required' });
  return { sources: await removeCustomSource(id) };
});

app.get('/api/fx', async () => getFxItems());

app.post('/api/fx/refresh', async () => refreshFxNow());

app.get('/api/link-title', async (req, reply) => {
  const { url } = req.query as Record<string, string>;
  if (!url) return reply.code(400).send({ error: 'url is required' });
  return { title: await fetchLinkTitle(url) };
});

app.get('/api/mail/unread', async (req) => {
  const limit = Number((req.query as Record<string, string>).limit);
  return getUnreadMail(Number.isFinite(limit) ? limit : undefined);
});

app.get('/api/mail/refresh', async (req, reply) => {
  const { address, limit } = req.query as Record<string, string>;
  if (!address) return reply.code(400).send({ error: 'address is required' });
  const n = Number(limit);
  return refreshAccount(address, Number.isFinite(n) ? n : undefined);
});

app.post('/api/mail/read', async (req, reply) => {
  const { address, uids, limit } = (req.body as { address?: string; uids?: number[]; limit?: number }) ?? {};
  if (!address || !Array.isArray(uids) || !uids.every((u) => typeof u === 'number')) {
    return reply.code(400).send({ error: 'address and uids (array of numbers) are required' });
  }
  return markAsRead(address, uids, limit);
});

app.post('/api/mail/read-all', async (req, reply) => {
  const { address, limit } = (req.body as { address?: string; limit?: number }) ?? {};
  if (!address) return reply.code(400).send({ error: 'address is required' });
  return markAllAsRead(address, limit);
});

app.post('/api/mail/read-sender', async (req, reply) => {
  const { address, fromAddress, limit } = (req.body as { address?: string; fromAddress?: string; limit?: number }) ?? {};
  if (!address || !fromAddress) {
    return reply.code(400).send({ error: 'address and fromAddress are required' });
  }
  return markSenderAsRead(address, fromAddress, limit);
});

app.get('/api/mail/folders', async (req, reply) => {
  const { address } = req.query as Record<string, string>;
  if (!address) return reply.code(400).send({ error: 'address is required' });
  return listFolders(address);
});

app.get('/api/mail/message', async (req, reply) => {
  const { address, uid } = req.query as Record<string, string>;
  const n = Number(uid);
  if (!address || !Number.isFinite(n)) return reply.code(400).send({ error: 'address and uid are required' });
  return getMessageBody(address, n);
});

app.post('/api/mail/move', async (req, reply) => {
  const { address, uid, destination, limit } =
    (req.body as { address?: string; uid?: number; destination?: string; limit?: number }) ?? {};
  if (!address || typeof uid !== 'number' || !destination) {
    return reply.code(400).send({ error: 'address, uid, and destination are required' });
  }
  return moveMessage(address, uid, destination, limit);
});

app.post('/api/mail/delete', async (req, reply) => {
  const { address, uid, limit } = (req.body as { address?: string; uid?: number; limit?: number }) ?? {};
  if (!address || typeof uid !== 'number') {
    return reply.code(400).send({ error: 'address and uid are required' });
  }
  return deleteMessage(address, uid, limit);
});

app.get('/api/downloads', async (req) => {
  const limit = Number((req.query as Record<string, string>).limit);
  return listRecentDownloads(Number.isFinite(limit) ? limit : 6);
});

app.post('/api/downloads', async (req, reply) => {
  const { url } = (req.body as { url?: string }) ?? {};
  if (!url) return reply.code(400).send({ error: 'url is required' });
  const result = await queueDownload(url);
  if (!result.ok) reply.code(502);
  return result;
});

app.delete<{ Params: { id: string } }>('/api/downloads/:id', async (req, reply) => {
  const result = await deleteDownload(req.params.id);
  if (!result.ok) reply.code(502);
  return result;
});

app.post('/api/attachments', async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'No file uploaded' });
  if (!file.mimetype.startsWith('image/')) return reply.code(400).send({ error: 'Only image uploads are supported' });
  const data = await file.toBuffer();
  const relPath = await vault.saveAttachment(file.filename, data);
  return reply.code(201).send({ relPath });
});

app.get('/api/versions/*', async (req, reply) => {
  const relPath = decodeURIComponent((req.params as Record<string, string>)['*']);
  return listSnapshots(relPath);
});

app.get('/api/version-content/*', async (req, reply) => {
  const relPath = decodeURIComponent((req.params as Record<string, string>)['*']);
  const ts = Number((req.query as Record<string, string>).ts);
  if (!Number.isFinite(ts)) return reply.code(400).send({ error: 'ts is required' });
  const content = await getSnapshotContent(relPath, ts);
  if (content === null) return reply.code(404).send({ error: 'Snapshot not found' });
  return { content };
});

app.get('/api/raw/*', async (req, reply) => {
  const relPath = decodeURIComponent((req.params as Record<string, string>)['*']);
  try {
    const content = await vault.getRawContent(relPath);
    return { content };
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(404).send({ error: err.message });
    throw err;
  }
});

app.put('/api/raw/*', async (req, reply) => {
  const relPath = decodeURIComponent((req.params as Record<string, string>)['*']);
  const { content } = (req.body as { content?: string }) ?? {};
  if (typeof content !== 'string') return reply.code(400).send({ error: 'content is required' });
  try {
    const note = await vault.updateNoteContent(relPath, content);
    return note;
  } catch (err) {
    if (err instanceof ValidationError) return reply.code(404).send({ error: err.message });
    throw err;
  }
});

app.get('/api/settings', async () => readSettings());

app.patch('/api/settings', async (req, reply) => {
  const patch = req.body as Partial<Settings> | undefined;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return reply.code(400).send({ error: 'Invalid settings payload' });
  }
  return writeSettings(patch);
});

app.post('/api/site-icon', async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: 'No file uploaded' });
  if (!file.mimetype.startsWith('image/')) return reply.code(400).send({ error: 'Only image uploads are supported' });
  const data = await file.toBuffer();
  const siteIcon = await saveSiteIcon(file.filename, data);
  return reply.code(201).send({ siteIcon });
});

app.post('/api/site-icon/remove', async () => {
  await removeSiteIcon();
  return { ok: true };
});

app.get('/api/site-icon', async (req, reply) => {
  const settings = await readSettings();
  if (!settings.siteIcon) return reply.code(404).send({ error: 'No site icon set' });
  const abs = resolveSiteIconPath(settings.siteIcon);
  return reply.sendFile(path.basename(abs), path.dirname(abs));
});

app.get('/api/attachments/*', async (req, reply) => {
  const relPath = decodeURIComponent((req.params as Record<string, string>)['*']);
  const abs = vault.resolveAttachmentPath(relPath);
  if (!abs) return reply.code(400).send({ error: 'Invalid path' });
  return reply.sendFile(path.basename(abs), path.dirname(abs));
});

app.setNotFoundHandler(async (req, reply) => {
  if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
  return reply.sendFile('index.html');
});

await vault.init(() => app.log.info('vault index rebuilt'));

startMailRulePoller();
// Logs every genuinely-new item the Trending card ever shows into the dedicated
// `_Templates/trending-feed.md` note, grouped `## <date>` -> `### <source>` so it's clear at a
// glance what came from where and when — see `appendToTrendingFeed` in vault.ts and
// `recordAndNotify` in trending.ts. Uses the server's own local date (there's no client request
// to ask for the browser's date here, unlike `getOrCreateDaily`'s normal callers), so an entry
// right around midnight could land on the "wrong" day if the two clocks disagree.
startTrendingPoller((items, source) => {
  const date = new Date().toISOString().slice(0, 10);
  vault
    .appendToTrendingFeed(date, source, items.map(toTrendingFeedLine))
    .catch((err) => app.log.error({ err }, 'failed to log trending items to the Trending feed note'));
});
startFxPoller();

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
