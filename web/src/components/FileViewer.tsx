import { useMemo, useState } from "react";
import { FileText, FileCode2, Image as ImageIcon, RotateCw } from "lucide-react";
import type { FileKind } from "../../../src/shared/types";

const rawUrl = (path: string) => `/api/fs/raw?path=${encodeURIComponent(path)}`;

const KIND_META: Record<Exclude<FileKind, "text">, { label: string; icon: typeof FileText }> = {
  pdf: { label: "PDF", icon: FileText },
  html: { label: "HTML", icon: FileCode2 },
  image: { label: "Image", icon: ImageIcon },
};

export default function FileViewer({ path, kind }: { path: string; kind: Exclude<FileKind, "text"> }) {
  const [reloadKey, setReloadKey] = useState(0);
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const src = useMemo(() => rawUrl(path), [path]);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-stone-800">
      <div className="h-9 shrink-0 border-b border-stone-200 dark:border-stone-700/80 flex items-center gap-2 px-3 text-[12px] text-stone-500 dark:text-stone-400">
        <Icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
        <span className="font-medium text-stone-600 dark:text-stone-300">{meta.label}</span>
        <span className="truncate text-stone-400 dark:text-stone-500">{path}</span>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          title="Reload file"
          className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-700/60"
        >
          <RotateCw className="w-3 h-3" /> Reload
        </button>
      </div>
      {kind === "image" ? (
        <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-6">
          <img
            key={reloadKey}
            src={src}
            alt={path}
            className="max-w-full rounded-lg shadow-sm"
          />
        </div>
      ) : (
        <iframe
          key={reloadKey}
          src={src}
          title={path}
          className="flex-1 min-h-0 w-full border-0 bg-white"
        />
      )}
    </div>
  );
}
