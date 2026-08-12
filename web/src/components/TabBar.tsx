import { X, FileText } from "lucide-react";
import type { OpenDoc } from "../state/store";

export default function TabBar({
  docs,
  activePath,
  onSelect,
  onClose,
}: {
  docs: OpenDoc[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
      {docs.length === 0 && (
        <span className="text-[12.5px] text-stone-400 px-1 select-none">No file open</span>
      )}
      {docs.map((d) => {
        const active = d.path === activePath;
        const dirty = d.status === "unsaved" || d.status === "saving";
        const conflict = d.status === "conflict";
        return (
          <div
            key={d.path}
            onClick={() => onSelect(d.path)}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(d.path);
            }}
            title={d.path}
            className={`group relative flex items-center gap-1.5 h-[26px] pr-6 pl-2.5 rounded-md text-[12.5px] cursor-pointer select-none shrink-0 max-w-[200px] ${
              active
                ? "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                : "text-stone-500 hover:text-stone-800 hover:bg-stone-50 dark:text-stone-400 dark:hover:text-stone-200 dark:hover:bg-stone-800/60"
            }`}
          >
            <FileText
              className={`w-3 h-3 shrink-0 ${
                conflict
                  ? "text-amber-500"
                  : dirty
                    ? "text-blue-500"
                    : "text-stone-400 dark:text-stone-500"
              }`}
            />
            <span className="truncate">{d.path.split("/").pop()}</span>

            <span
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full group-hover:opacity-0 ${
                conflict
                  ? "bg-amber-500"
                  : dirty
                    ? "bg-blue-500"
                    : active
                      ? "bg-stone-300"
                      : "bg-transparent"
              }`}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(d.path);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-stone-200/80 dark:hover:bg-stone-700 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 opacity-0 group-hover:opacity-100"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
