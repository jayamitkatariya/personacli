import { useEffect, useRef, useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import type { LockSettings } from "../../../src/shared/types";

export default function LockOverlay({
  onUnlock,
  onLockChange,
}: {
  onUnlock: () => void;
  onLockChange: (lock: LockSettings) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!pin || busy) return;
    setBusy(true);
    const retry = () => {
      setError(true);
      setPin("");
      inputRef.current?.focus();
    };
    try {
      const res = await api.verifyLock(pin);
      if (res.ok) {
        void api.getLock().then(onLockChange).catch(() => {});
        onUnlock();
      } else {
        retry();
      }
    } catch {
      retry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-stone-50 dark:bg-stone-900">
      <div className="pop-in flex flex-col items-center max-w-[320px] w-full px-6">
        <div className="aura-border rounded-2xl p-6 flex flex-col items-center w-full">
          <div className="gradient-text text-[22px] font-semibold tracking-tight select-none">
            Persona
          </div>
          <div className="mt-4 w-11 h-11 rounded-full bg-stone-100 dark:bg-stone-700/60 flex items-center justify-center">
            <Lock className="w-5 h-5 text-stone-500 dark:text-stone-400" />
          </div>
          <p className="mt-3 text-[13px] text-stone-600 dark:text-stone-300">
            This workspace is locked
          </p>
          <p className="mt-0.5 text-[11.5px] text-stone-400 dark:text-stone-500">
            Enter your PIN to continue
          </p>
          <form
            className="mt-4 w-full"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(false);
              }}
              placeholder="••••"
              disabled={busy}
              className={`w-full text-center tracking-[0.5em] px-3 py-2.5 rounded-lg border bg-white dark:bg-stone-800 text-[16px] text-stone-900 dark:text-stone-100 placeholder:text-stone-300 dark:placeholder:text-stone-600 outline-none transition-shadow ${
                error
                  ? "border-red-400 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
                  : "border-stone-200 dark:border-stone-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-500/20"
              }`}
            />
            {error && (
              <p className="mt-2 text-[11.5px] text-red-500 text-center">
                Wrong PIN — try again
              </p>
            )}
            <button
              type="submit"
              disabled={!pin || busy}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-[12.5px] font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Unlock
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
