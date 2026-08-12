import { useEffect } from "react";
import { Timer, Pause, Play, X, CircleCheck } from "lucide-react";
import { useStore } from "../state/store";
import { sounds } from "../lib/sounds";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const RADIUS = 23;
const CIRC = 2 * Math.PI * RADIUS;

export default function FocusTimer() {
  const session = useStore((s) => s.focusSession);
  const tasks = useStore((s) => s.tasks);
  const pauseFocus = useStore((s) => s.pauseFocus);
  const resumeFocus = useStore((s) => s.resumeFocus);
  const stopFocus = useStore((s) => s.stopFocus);

  useEffect(() => {
    if (!session?.running) return;
    const id = setInterval(() => {
      const store = useStore.getState();
      const s = store.focusSession;
      if (!s || !s.running) return;
      const now = Date.now();
      const elapsed = (now - s.lastTick) / 1000;
      const rem = Math.max(0, Math.ceil(s.remaining - elapsed));
      if (rem <= 0) {
        store.finishFocus();
        sounds.chime();
        store.triggerConfetti();
      } else {
        store.tickFocus(rem, now);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [session?.running]);

  if (!session) return null;

  const selected = tasks.filter((t) => session.taskIds.includes(t.id));
  const done = session.remaining <= 0;
  const progress = session.durationSec > 0 ? session.remaining / session.durationSec : 0;
  const endsAt = new Date(Date.now() + session.remaining * 1000);
  const endsLabel = `${String(endsAt.getHours()).padStart(2, "0")}:${String(endsAt.getMinutes()).padStart(2, "0")}`;
  const noun = selected.length === 1 ? "task" : "tasks";
  const statusLine = done
    ? "Focus complete"
    : session.running
      ? selected.length > 0
        ? `Focusing on ${selected.length} ${noun}`
        : "Focusing"
      : selected.length > 0
        ? `Paused — ${selected.length} ${noun}`
        : "Paused";

  return (
    <div className="fixed bottom-4 right-4 z-50 aura-border pop-in w-[310px] rounded-xl bg-white dark:bg-stone-800 shadow-2xl shadow-stone-900/15 border border-stone-200 dark:border-stone-700 overflow-hidden">
      <div className="flex items-center gap-3.5 p-3.5">
        <div className="relative w-[54px] h-[54px] shrink-0">
          <svg width="54" height="54" viewBox="0 0 54 54" className="-rotate-90">
            <circle
              cx="27"
              cy="27"
              r={RADIUS}
              strokeWidth="4"
              fill="none"
              className="stroke-stone-200 dark:stroke-stone-700"
            />
            <circle
              cx="27"
              cy="27"
              r={RADIUS}
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
              className={done ? "stroke-emerald-500" : session.running ? "stroke-blue-500" : "stroke-amber-500"}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
          <span
            className={`absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums ${
              done ? "text-emerald-600 dark:text-emerald-400" : "text-stone-800 dark:text-stone-200"
            }`}
          >
            {done ? "✓" : fmt(session.remaining)}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-800 dark:text-stone-200">
            <Timer className="w-3 h-3 text-blue-500 shrink-0" />
            <span className="truncate">{statusLine}</span>
          </div>
          {!done && (
            <div className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">
              {session.running ? (
                <>
                  {fmt(session.remaining)} left · ends at {endsLabel}
                </>
              ) : (
                <>{fmt(session.remaining)} left · paused</>
              )}
            </div>
          )}
          {done && (
            <div className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">
              Nice work — take a break.
            </div>
          )}
        </div>
      </div>

      {!done && selected.length > 0 && (
        <div className="px-3.5 pb-3 flex flex-wrap gap-1.5">
          {selected.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className="max-w-[140px] truncate px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-700/60 text-[10.5px] text-stone-500 dark:text-stone-400"
            >
              {t.title}
            </span>
          ))}
          {selected.length > 3 && (
            <span className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-700/60 text-[10.5px] text-stone-400 dark:text-stone-500">
              +{selected.length - 3} more
            </span>
          )}
        </div>
      )}

      {done && (
        <div className="px-3.5 pb-3 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <CircleCheck className="w-3.5 h-3.5" />
          {selected.length > 0 ? `${selected.length} ${noun} in your session` : "Session finished"}
        </div>
      )}

      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-stone-100 dark:border-stone-700/60">
        {!done && (
          <button
            onClick={() => {
              sounds.tick();
              if (session.running) pauseFocus();
              else resumeFocus();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700/60 transition-colors"
          >
            {session.running ? (
              <>
                <Pause className="w-3 h-3" /> Pause
              </>
            ) : (
              <>
                <Play className="w-3 h-3" /> Resume
              </>
            )}
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => {
            sounds.tick();
            stopFocus();
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
        >
          <X className="w-3 h-3" /> {done ? "Dismiss" : "Stop"}
        </button>
      </div>
    </div>
  );
}
