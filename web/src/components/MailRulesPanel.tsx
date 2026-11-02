import { useEffect, useState } from 'react';
import { CaretDown, CaretRight, Trash } from '@phosphor-icons/react';
import { api } from '../api';
import type { MailRule, MailRuleLogEntry } from '../types';

const ACTION_LABEL: Record<MailRule['action'], string> = {
  read: 'Mark as read',
  delete: 'Move to Trash',
};

/**
 * Lets you auto-handle mail from a sender before you ever see it: a background poller
 * (server/src/mail.ts's startMailRulePoller, every 5 min, independent of this page being open)
 * checks each account's unread mail against these rules and applies the first match. Every
 * automatic action lands in the log below so a delete rule never silently disappears a message.
 */
export function MailRulesPanel({ accountAddresses }: { accountAddresses: string[] }) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<MailRule[] | null>(null);
  const [log, setLog] = useState<MailRuleLogEntry[]>([]);
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<MailRule['action']>('read');
  const [scope, setScope] = useState('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setRules(s.mailRules ?? []);
        setLog(s.mailRuleLog ?? []);
      })
      .catch(() => setError('Could not load mail rules.'));
  }, []);

  const addRule = async () => {
    const trimmed = pattern.trim();
    if (!trimmed || !rules) return;
    setSaving(true);
    setError(null);
    const rule: MailRule = { id: `${Date.now()}`, pattern: trimmed, action, accountAddress: scope };
    try {
      const updated = await api.updateSettings({ mailRules: [...rules, rule] });
      setRules(updated.mailRules ?? []);
      setPattern('');
    } catch {
      setError('Could not save that rule — try again.');
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (id: string) => {
    if (!rules) return;
    const next = rules.filter((r) => r.id !== id);
    setRules(next);
    try {
      await api.updateSettings({ mailRules: next });
    } catch {
      setError('Could not remove that rule — try again.');
    }
  };

  const clearLog = async () => {
    setLog([]);
    try {
      await api.updateSettings({ mailRuleLog: [] });
    } catch {
      setError('Could not clear the log — try again.');
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-slate-800/80 bg-slate-900/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-200"
      >
        {open ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
        Mail rules
        {rules && rules.length > 0 && (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{rules.length}</span>
        )}
        <span className="ml-auto hidden text-xs text-slate-500 sm:block">
          Auto mark-read / delete by sender — checked every 5 min, even if this page is closed
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-800/80 px-4 py-4">
          {error && <div className="mb-3 text-sm text-red-300">{error}</div>}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRule()}
              placeholder="Sender contains… e.g. noreply@ or @linkedin.com"
              className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as MailRule['action'])}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
            >
              <option value="read">Mark as read</option>
              <option value="delete">Move to Trash</option>
            </select>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
            >
              <option value="all">All accounts</option>
              {accountAddresses.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button
              onClick={addRule}
              disabled={saving || !pattern.trim()}
              className="rounded-lg bg-violet-500/20 px-3 py-1.5 text-sm text-violet-300 hover:bg-violet-500/30 disabled:opacity-40"
            >
              Add rule
            </button>
          </div>

          {rules && rules.length === 0 && <div className="text-sm text-slate-500">No rules yet.</div>}
          {rules && rules.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {rules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-3 py-1.5 text-sm">
                  <span className="truncate text-slate-200">&quot;{r.pattern}&quot;</span>
                  <span className="flex-shrink-0 text-slate-500">→ {ACTION_LABEL[r.action]}</span>
                  <span className="flex-shrink-0 truncate text-xs text-slate-500">
                    ({r.accountAddress === 'all' ? 'all accounts' : r.accountAddress})
                  </span>
                  <button
                    onClick={() => removeRule(r.id)}
                    title="Remove this rule"
                    className="ml-auto flex-shrink-0 text-slate-500 hover:text-red-300"
                  >
                    <Trash size={14} weight="regular" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Recent automated actions</div>
            {log.length > 0 && (
              <button onClick={clearLog} className="text-xs text-slate-500 hover:text-slate-300">
                Clear log
              </button>
            )}
          </div>
          {log.length === 0 && <div className="mt-1 text-sm text-slate-500">Nothing yet.</div>}
          {log.length > 0 && (
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-slate-400">
              {log.map((entry) => (
                <div key={entry.id} className="truncate">
                  <span className="text-slate-500">{new Date(entry.at).toLocaleString()}</span>{' '}
                  {ACTION_LABEL[entry.action]} — {entry.subject}{' '}
                  <span className="text-slate-600">from {entry.fromAddress}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
