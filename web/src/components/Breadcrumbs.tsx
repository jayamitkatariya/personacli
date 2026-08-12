import { ChevronRight, Home } from "lucide-react";
import { useStore } from "../state/store";

/**
 * Clickable path above the editor — Workspace → Projects → App → PRD.md.
 * Folder segments expand the sidebar tree; the trailing file segment is the
 * current note. The leading segment labels the workspace root.
 */
export default function Breadcrumbs({ path }: { path: string }) {
  const settings = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);

  const workspaceName =
    settings?.workspace?.split("/").filter(Boolean).pop() ?? "Workspace";

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const onFolder = (prefix: string) => {
    setView("write");
    // Expand the folder and every ancestor so it is visible in the tree.
    const parts = prefix.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      if (!useStore.getState().expanded[p]) useStore.getState().toggleExpand(p);
    }
  };

  const onFile = (fullPath: string) => {
    setView("write");
    void useStore.getState().openDoc(fullPath);
  };

  return (
    <div className="h-7 shrink-0 border-b border-stone-200 dark:border-stone-700/80 bg-white dark:bg-stone-800 flex items-center gap-0.5 px-3 overflow-x-auto select-none">
      <button
        onClick={() => setView("write")}
        title="Workspace root"
        className="flex items-center gap-1 text-[11.5px] text-stone-500 dark:text-stone-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shrink-0"
      >
        <Home className="w-3 h-3" />
        {workspaceName}
      </button>
      {segments.map((seg, i) => {
        const prefix = segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={prefix} className="flex items-center gap-0.5 shrink-0">
            <ChevronRight className="w-3 h-3 text-stone-300 dark:text-stone-600" />
            {isLast ? (
              <span className="text-[11.5px] font-medium text-stone-800 dark:text-stone-200 truncate max-w-[220px]">
                {seg}
              </span>
            ) : (
              <button
                onClick={() => onFolder(prefix)}
                title={prefix}
                className="text-[11.5px] text-stone-500 dark:text-stone-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors truncate max-w-[160px]"
              >
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
