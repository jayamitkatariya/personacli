import { useMemo, useRef, useState } from "react";
import {
  File,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Ellipsis,
  Check,
  X,
  Pin,
  PinOff,
  Search,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import EmptyState from "./EmptyState";
import type { TreeNode } from "../../../src/shared/types";

interface FileTreeProps {
  filter: string;
  creating: "file" | "folder" | null;
  onCreateDone: (path: string) => void;
  onCancelCreate: () => void;
}

function flattenFolders(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === "folder") {
      acc.push(node.path);
      if (node.children) flattenFolders(node.children, acc);
    }
  }
  return acc;
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes;
  const ql = q.toLowerCase();
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (node.name.toLowerCase().includes(ql)) out.push({ ...node });
    } else {
      const children = node.children ? filterTree(node.children, q) : [];
      if (children.length > 0) out.push({ ...node, children });
    }
  }
  return out;
}

/** A source can only be dropped onto a folder that is not itself or one of its descendants. */
function canDrop(source: string | null, target: string): boolean {
  if (!source) return false;
  if (source === target) return false;
  if (target.startsWith(source + "/")) return false;
  return true;
}

export default function FileTree({ filter, creating, onCreateDone, onCancelCreate }: FileTreeProps) {
  const tree = useStore((s) => s.tree);
  const expanded = useStore((s) => s.expanded);
  const toggleExpand = useStore((s) => s.toggleExpand);
  const openDoc = useStore((s) => s.openDoc);
  const activeDocPath = useStore((s) => s.activeDocPath);
  const pinFile = useStore((s) => s.pinFile);
  const unpinFile = useStore((s) => s.unpinFile);
  const openPalette = useStore((s) => s.openPalette);
  const pinnedFiles = useStore((s) => s.pins.files);
  const pinnedPaths = useMemo(
    () => new Set(pinnedFiles.map((f) => f.path)),
    [pinnedFiles],
  );

  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter]);
  const folders = useMemo(() => flattenFolders(tree), [tree]);

  const visible = filter ? filtered : tree;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState<string | null>(null);

  const retarget = (from: string, to: string) => {
    if (from === to) return;
    useStore.getState().retargetDocs(from, to);
  };

  const doMove = async (paths: string[], target: string) => {
    try {
      const res = await api.moveEntries(paths, target);
      paths.forEach((p, i) => {
        const to = res.paths[i];
        if (to) retarget(p, to);
      });
      useStore.getState().refreshTree();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const isFolder = node.type === "folder";
    const isExpanded = expanded[node.path];
    const isActive = activeDocPath === node.path;
    const isRenaming = renaming === node.path;
    const highlighted = isFolder && draggingOver === node.path;

    return (
      <ContextMenu.Root key={node.path}>
        <ContextMenu.Trigger asChild>
          <div
            draggable={!isRenaming}
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", node.path);
              setDragging(node.path);
              setDraggingOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDraggingOver(null);
            }}
            onDragOver={(e) => {
              if (isFolder) {
                e.stopPropagation();
                if (canDrop(dragging, node.path)) {
                  e.preventDefault();
                  if (draggingOver !== node.path) setDraggingOver(node.path);
                } else if (draggingOver === node.path) {
                  setDraggingOver(null);
                }
              } else {
                // files are not drop targets — don't let the drop fall through to root
                e.preventDefault();
                e.stopPropagation();
                if (draggingOver) setDraggingOver(null);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                if (draggingOver === node.path) setDraggingOver(null);
              }
            }}
            onDrop={(e) => {
              if (!isFolder) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              const dragged = dragging;
              setDragging(null);
              setDraggingOver(null);
              if (canDrop(dragged, node.path)) void doMove([dragged as string], node.path);
            }}
            className={`group flex items-center gap-1.5 rounded-md pr-1 pl-1 mr-1 ${
              isActive ? "bg-blue-50 dark:bg-blue-950/50" : "hover:bg-stone-100 dark:hover:bg-stone-800"
            } ${highlighted ? "outline outline-1 outline-blue-400 outline-offset-[-1px]" : ""}`}
            style={{ paddingLeft: `${depth * 14 + 4}px` }}
          >
          {isFolder ? (
            <button
              onClick={() => toggleExpand(node.path)}
              className="shrink-0 p-0.5 rounded hover:bg-stone-200/70 dark:hover:bg-stone-700/70"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-stone-400 dark:text-stone-500" />
              ) : (
                <ChevronRight className="w-3 h-3 text-stone-400 dark:text-stone-500" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {isFolder ? (
            isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.8} />
            ) : (
              <Folder className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.8} />
            )
          ) : (
            <File className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.8} />
          )}

          {isRenaming ? (
            <RenameInput
              defaultValue={node.name}
              onCommit={async (name) => {
                if (name && name !== node.name) {
                  try {
                    const res = await api.renameEntry(node.path, name);
                    retarget(node.path, res.path);
                    useStore.getState().refreshTree();
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }
                setRenaming(null);
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <button
              onClick={() => {
                if (isFolder) toggleExpand(node.path);
                else void openDoc(node.path);
              }}
              className={`flex-1 text-left truncate py-[3px] text-[13px] ${
                isActive ? "text-blue-700 font-medium" : "text-stone-700 dark:text-stone-300"
              }`}
              title={node.path}
            >
              {node.name}
            </button>
          )}

          {!isRenaming && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-stone-200/70 dark:hover:bg-stone-700/70 text-stone-500 dark:text-stone-400">
                  <Ellipsis className="w-3.5 h-3.5" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={4}
                  className="min-w-[160px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
                >
                  <DropdownMenu.Item
                    onSelect={() => setRenaming(node.path)}
                    className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800"
                  >
                    Rename
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => {
                      void api.duplicateEntry(node.path).then(() =>
                        useStore.getState().refreshTree(),
                      );
                    }}
                    className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800"
                  >
                    Duplicate
                  </DropdownMenu.Item>
                  {!isFolder && (
                    <DropdownMenu.Item
                      onSelect={() => {
                        if (pinnedPaths.has(node.path)) void unpinFile(node.path);
                        else void pinFile(node.path);
                      }}
                      className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800 flex items-center gap-2"
                    >
                      {pinnedPaths.has(node.path) ? (
                        <>
                          <PinOff className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                          Unpin from pinboard
                        </>
                      ) : (
                        <>
                          <Pin className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                          Pin to pinboard
                        </>
                      )}
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800 flex items-center justify-between">
                      Move to
                      <ChevronRight className="w-3 h-3" />
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.SubContent
                        sideOffset={4}
                        className="min-w-[160px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 max-h-64 overflow-y-auto text-[13px]"
                      >
                        <DropdownMenu.Item
                          onSelect={() => void doMove([node.path], "")}
                          className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800"
                        >
                          Workspace root
                        </DropdownMenu.Item>
                        {folders
                          .filter((f) => canDrop(node.path, f))
                          .map((f) => (
                            <DropdownMenu.Item
                              key={f}
                              onSelect={() => void doMove([node.path], f)}
                              className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800"
                            >
                              {f}
                            </DropdownMenu.Item>
                          ))}
                      </DropdownMenu.SubContent>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Sub>
                  <DropdownMenu.Separator className="h-px bg-stone-100 dark:bg-stone-800 my-1" />
                  <DropdownMenu.Item
                    onSelect={() => {
                      if (confirm(`Delete "${node.name}"?`)) {
                        void api.deleteEntry(node.path).then(() => {
                          const store = useStore.getState();
                          if (node.type === "folder") store.closeDocsUnder(node.path);
                          else store.closeDoc(node.path);
                          store.refreshTree();
                        });
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 focus:bg-red-50 dark:focus:bg-red-950/40"
                  >
                    Delete
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content
            className="min-w-[180px] bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg shadow-stone-900/5 p-1 z-50 text-[13px]"
          >
            <ContextMenu.Item
              onSelect={() => {
                if (isFolder) {
                  toggleExpand(node.path);
                } else {
                  void openDoc(node.path);
                }
              }}
              className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800"
            >
              <span className="flex items-center gap-2">
                {isFolder ? (
                  <FolderOpen className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                ) : (
                  <File className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                )}
                {isFolder ? (isExpanded ? "Collapse folder" : "Expand folder") : "Open note"}
              </span>
            </ContextMenu.Item>
            {isFolder && (
              <ContextMenu.Item
                onSelect={() => {
                  openPalette("search", node.path);
                }}
                className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800"
              >
                <span className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-blue-500" />
                  Search in this folder
                </span>
              </ContextMenu.Item>
            )}
            <ContextMenu.Separator className="h-px bg-stone-100 dark:bg-stone-800 my-1" />
            <ContextMenu.Item
              onSelect={() => setRenaming(node.path)}
              className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800"
            >
              Rename
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={() => {
                void api.duplicateEntry(node.path).then(() =>
                  useStore.getState().refreshTree(),
                );
              }}
              className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800"
            >
              Duplicate
            </ContextMenu.Item>
            {!isFolder && (
              <ContextMenu.Item
                onSelect={() => {
                  if (pinnedPaths.has(node.path)) void unpinFile(node.path);
                  else void pinFile(node.path);
                }}
                className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 focus:bg-stone-100 dark:focus:bg-stone-800 flex items-center gap-2"
              >
                {pinnedPaths.has(node.path) ? (
                  <>
                    <PinOff className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                    Unpin from pinboard
                  </>
                ) : (
                  <>
                    <Pin className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                    Pin to pinboard
                  </>
                )}
              </ContextMenu.Item>
            )}
            <ContextMenu.Separator className="h-px bg-stone-100 dark:bg-stone-800 my-1" />
            <ContextMenu.Item
              onSelect={() => {
                if (confirm(`Delete "${node.name}"?`)) {
                  void api.deleteEntry(node.path).then(() => {
                    const store = useStore.getState();
                    if (node.type === "folder") store.closeDocsUnder(node.path);
                    else store.closeDoc(node.path);
                    store.refreshTree();
                  });
                }
              }}
              className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 focus:bg-red-50 dark:focus:bg-red-950/40"
            >
              Delete
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>

        {isFolder && isExpanded && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </ContextMenu.Root>
    );
  };

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto py-1 pb-4"
      onDragOver={(e) => {
        // empty area of the tree drops into the workspace root
        if (dragging && draggingOver === null) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const dragged = dragging;
        setDragging(null);
        setDraggingOver(null);
        if (dragged) void doMove([dragged], "");
      }}
    >
      {creating && (
        <div
          className="flex items-center gap-1.5 pr-1 pl-4"
          onDragOver={(e) => e.preventDefault()}
        >
          {creating === "folder" ? (
            <Folder className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.8} />
          ) : (
            <File className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.8} />
          )}
          <CreateInput
            autoFocus
            placeholder={creating === "file" ? "name.md" : "folder name"}
            onCommit={async (name) => {
              if (!name) return onCancelCreate();
              const finalName = creating === "file" && !name.includes(".") ? `${name}.md` : name;
              try {
                const res = await api.createEntry(finalName, creating);
                await useStore.getState().refreshTree();
                onCreateDone(res.path);
              } catch (e) {
                alert((e as Error).message);
              }
            }}
            onCancel={onCancelCreate}
          />
        </div>
      )}
      {visible.map((node) => renderNode(node, 0))}
      {visible.length === 0 && (
        <div className="pt-3">
          <EmptyState
            compact
            icon={Search}
            title={filter ? "No matches" : "No files yet"}
            subtitle={filter ? "Try a different search." : "Create your first note above."}
          />
        </div>
      )}
    </div>
  );
}

function RenameInput({
  defaultValue,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const doneRef = useRef(false);

  const commit = (name: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(name);
  };

  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <form
      className="flex-1 flex items-center gap-1 min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        commit(value);
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => commit(value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
        }}
        className="flex-1 min-w-0 text-[13px] px-1 py-[2px] rounded border border-blue-400 outline-none"
      />
      <button type="submit" className="p-0.5 rounded hover:bg-stone-200 text-stone-500 dark:text-stone-400">
        <Check className="w-3 h-3" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          cancel();
        }}
        className="p-0.5 rounded hover:bg-stone-200 text-stone-500 dark:text-stone-400"
      >
        <X className="w-3 h-3" />
      </button>
    </form>
  );
}

function CreateInput({
  defaultValue,
  placeholder,
  autoFocus,
  onCommit,
  onCancel,
}: {
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const doneRef = useRef(false);

  const commit = (name: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(name);
  };

  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <form
      className="flex-1 flex items-center min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        commit(value);
      }}
    >
      <input
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
        }}
        onBlur={() => {
          if (value) commit(value);
          else cancel();
        }}
        className="flex-1 min-w-0 text-[13px] px-1 py-[2px] rounded border border-blue-400 outline-none"
      />
    </form>
  );
}
