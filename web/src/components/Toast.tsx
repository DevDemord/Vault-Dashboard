export interface ToastMessage {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 print:hidden">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-xl ${
            t.kind === 'error' ? 'border-red-500/30 bg-red-950/90 text-red-200' : 'border-slate-700 bg-slate-900/95 text-slate-200'
          }`}
        >
          <span>{t.text}</span>
          <button onClick={() => onDismiss(t.id)} className="text-xs text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
