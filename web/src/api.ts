import type {
  ActivityLogEntry,
  BookmarkItem,
  ChecklistItem,
  CreateNoteInput,
  CreateOptions,
  DeadAttachment,
  DuplicatePair,
  GraphData,
  DownloadSummary,
  FxItem,
  HostMetricsStatus,
  ImportResult,
  MailAccountStatus,
  MailFolder,
  MailMessageBody,
  MailStatus,
  NoteDetail,
  NoteSummary,
  SearchResult,
  Settings,
  SportsEvent,
  Stats,
  TagCount,
  TrendingItem,
  TrendingSource,
  VaultFolderSize,
  VersionMeta,
} from './types';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export class ApiError extends Error {}

function safeParse(text: string): { error?: string } & Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function send(url: string, method: string, data?: unknown): Promise<void> {
  await sendJson(url, method, data);
}

async function sendJson<T>(url: string, method: string, data?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: data !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  // `.text()` first, not `.json()` directly — several endpoints (e.g. `POST /api/tasks`,
  // `POST /api/sports-events`) reply `201 Created` with an empty body, not `204 No Content`, and
  // `res.json()` throws `SyntaxError: Unexpected end of JSON input` on an empty string. Reading as
  // text and only parsing a non-empty body handles both that and the existing 204 case uniformly.
  const text = await res.text();
  if (!res.ok) {
    const body = text ? safeParse(text) : {};
    throw new ApiError(body.error ?? `Request failed (${res.status})`);
  }
  return (text ? safeParse(text) : undefined) as T;
}

export const api = {
  stats: () => get<Stats>('/api/stats'),
  notes: () => get<NoteSummary[]>('/api/notes'),
  tags: () => get<TagCount[]>('/api/tags'),
  note: (relPath: string) => get<NoteDetail>(`/api/notes/${relPath.split('/').map(encodeURIComponent).join('/')}`),
  related: (relPath: string) => get<NoteSummary[]>(`/api/related/${relPath.split('/').map(encodeURIComponent).join('/')}`),
  search: (q: string) => get<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  tasks: () => get<ChecklistItem[]>('/api/tasks'),
  bookmarks: () => get<BookmarkItem[]>('/api/bookmarks'),
  createOptions: () => get<CreateOptions>('/api/create-options'),
  createNote: async (input: CreateNoteInput): Promise<NoteDetail> => {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<NoteDetail>;
  },
  deleteNote: (relPath: string) =>
    send(`/api/notes/${relPath.split('/').map(encodeURIComponent).join('/')}`, 'DELETE'),
  archiveNote: (relPath: string) => send('/api/notes-archive', 'POST', { relPath }),
  moveToResourceFolder: (relPath: string, folder: string) => send('/api/notes-move', 'POST', { relPath, folder }),
  moveNoteToFolder: (relPath: string, destFolder: string) =>
    sendJson<{ relPath: string }>('/api/notes-move-folder', 'POST', { relPath, destFolder }),
  importNotes: (files: { name: string; content: string }[]) =>
    sendJson<{ results: ImportResult[] }>('/api/notes-import', 'POST', { files }).then((r) => r.results),
  listFolders: () => get<{ folders: string[] }>('/api/folders').then((r) => r.folders),
  createFolder: (parent: string, name: string) =>
    sendJson<{ folder: string }>('/api/folders', 'POST', { parent, name }).then((r) => r.folder),
  setTags: (relPath: string, tags: string[]) => sendJson<NoteDetail>('/api/notes-tags', 'POST', { relPath, tags }),
  toggleTask: (sourcePath: string, line: number, done: boolean) =>
    send('/api/tasks/toggle', 'POST', { sourcePath, line, done }),
  addTask: (text: string) => send('/api/tasks', 'POST', { text }),
  addBookmark: (url: string) => send('/api/bookmarks', 'POST', { url }),
  activityLog: () => get<ActivityLogEntry[]>('/api/activity-log'),
  sportsEvents: (limit?: number) => get<SportsEvent[]>(`/api/sports-events${limit ? `?limit=${limit}` : ''}`),
  allSportsEvents: () => get<SportsEvent[]>('/api/sports-events/all'),
  addSportsEvent: (
    title: string,
    date: string,
    time: string | null,
    endDate: string | null = null,
    endTime: string | null = null,
    sport: string | null = null,
  ) => send('/api/sports-events', 'POST', { title, date, time, endDate, endTime, sport }),
  getOrCreateDaily: (date: string) => sendJson<NoteDetail>('/api/daily', 'POST', { date }),
  graph: () => get<GraphData>('/api/graph'),
  orphans: () => get<NoteSummary[]>('/api/orphans'),
  duplicates: () => get<DuplicatePair[]>('/api/duplicates'),
  deadAttachments: () => get<DeadAttachment[]>('/api/dead-attachments'),
  attachmentFiles: () => get<DeadAttachment[]>('/api/attachment-files'),
  vaultSize: () => get<VaultFolderSize[]>('/api/vault-size'),
  hostMetrics: () => get<HostMetricsStatus>('/api/host-metrics'),
  trending: () => get<{ items: TrendingItem[] }>('/api/trending').then((r) => r.items),
  trendingBlocked: () => get<{ keywords: string[] }>('/api/trending/blocked').then((r) => r.keywords),
  trendingBlock: (title: string) => sendJson<{ keyword: string }>('/api/trending/block', 'POST', { title }),
  trendingUnblock: (keyword: string) =>
    sendJson<{ keywords: string[] }>('/api/trending/unblock', 'POST', { keyword }).then((r) => r.keywords),
  trendingBlockKeyword: (keyword: string) =>
    sendJson<{ keywords: string[] }>('/api/trending/block-keyword', 'POST', { keyword }).then((r) => r.keywords),
  trendingInterests: () => get<{ keywords: string[] }>('/api/trending/interests').then((r) => r.keywords),
  trendingAddInterest: (keyword: string) =>
    sendJson<{ keywords: string[] }>('/api/trending/interests/add', 'POST', { keyword }).then((r) => r.keywords),
  trendingRemoveInterest: (keyword: string) =>
    sendJson<{ keywords: string[] }>('/api/trending/interests/remove', 'POST', { keyword }).then((r) => r.keywords),
  trendingSources: () => get<{ sources: TrendingSource[] }>('/api/trending/sources').then((r) => r.sources),
  trendingAddSource: (name: string, url: string) =>
    sendJson<{ sources: TrendingSource[] }>('/api/trending/sources', 'POST', { name, url }).then((r) => r.sources),
  trendingRemoveSource: (id: string) =>
    sendJson<{ sources: TrendingSource[] }>('/api/trending/sources/remove', 'POST', { id }).then((r) => r.sources),
  fx: () => get<FxItem[]>('/api/fx'),
  fxRefresh: () => sendJson<FxItem[]>('/api/fx/refresh', 'POST'),
  mailUnread: (limit?: number) => get<MailStatus>(`/api/mail/unread${limit ? `?limit=${limit}` : ''}`),
  markMailRead: (address: string, uids: number[], limit?: number) =>
    sendJson<MailAccountStatus>('/api/mail/read', 'POST', { address, uids, limit }),
  markSenderRead: (address: string, fromAddress: string, limit?: number) =>
    sendJson<MailAccountStatus>('/api/mail/read-sender', 'POST', { address, fromAddress, limit }),
  markAllRead: (address: string, limit?: number) =>
    sendJson<MailAccountStatus>('/api/mail/read-all', 'POST', { address, limit }),
  refreshMailAccount: (address: string, limit?: number) =>
    get<MailAccountStatus>(`/api/mail/refresh?address=${encodeURIComponent(address)}${limit ? `&limit=${limit}` : ''}`),
  mailFolders: (address: string) => get<MailFolder[]>(`/api/mail/folders?address=${encodeURIComponent(address)}`),
  mailMessageBody: (address: string, uid: number) =>
    get<MailMessageBody | { error: string }>(`/api/mail/message?address=${encodeURIComponent(address)}&uid=${uid}`),
  moveMail: (address: string, uid: number, destination: string, limit?: number) =>
    sendJson<MailAccountStatus>('/api/mail/move', 'POST', { address, uid, destination, limit }),
  deleteMail: (address: string, uid: number, limit?: number) =>
    sendJson<MailAccountStatus>('/api/mail/delete', 'POST', { address, uid, limit }),
  downloads: (limit?: number) =>
    get<{ items: DownloadSummary[]; dashboardUrl: string } | { error: string }>(
      `/api/downloads${limit ? `?limit=${limit}` : ''}`,
    ),
  addDownload: (url: string) => sendJson<{ ok: boolean; error?: string }>('/api/downloads', 'POST', { url }),
  deleteDownload: (id: string) => sendJson<{ ok: boolean; error?: string }>(`/api/downloads/${encodeURIComponent(id)}`, 'DELETE'),
  uploadAttachment: async (file: File): Promise<{ relPath: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/attachments', { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<{ relPath: string }>;
  },
  linkTitle: (url: string) => get<{ title: string | null }>(`/api/link-title?url=${encodeURIComponent(url)}`).then((r) => r.title),
  uploadSiteIcon: async (file: File): Promise<{ siteIcon: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/site-icon', { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<{ siteIcon: string }>;
  },
  removeSiteIcon: () => sendJson<{ ok: boolean }>('/api/site-icon/remove', 'POST'),
  listVersions: (relPath: string) =>
    get<VersionMeta[]>(`/api/versions/${relPath.split('/').map(encodeURIComponent).join('/')}`),
  getVersionContent: (relPath: string, ts: number) =>
    get<{ content: string }>(
      `/api/version-content/${relPath.split('/').map(encodeURIComponent).join('/')}?ts=${ts}`,
    ).then((r) => r.content),
  getRaw: (relPath: string) =>
    get<{ content: string }>(`/api/raw/${relPath.split('/').map(encodeURIComponent).join('/')}`).then((r) => r.content),
  updateRaw: (relPath: string, content: string) =>
    sendJson<NoteDetail>(`/api/raw/${relPath.split('/').map(encodeURIComponent).join('/')}`, 'PUT', { content }),
  getSettings: () => get<Settings>('/api/settings'),
  updateSettings: (patch: Partial<Settings>) => sendJson<Settings>('/api/settings', 'PATCH', patch),
};
