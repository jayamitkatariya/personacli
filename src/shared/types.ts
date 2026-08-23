export type ModuleKey = "focus" | "journal" | "today";
export type ModuleSettings = Partial<Record<ModuleKey, boolean>>;

export type ChatMessageStatus = "queued" | "streaming" | "done" | "failed" | "cancelled";

/** A tool call waiting for user approval before it executes. */
export interface ChatApprovalRequest {
  id: string;
  tool: string;
  /** Truncated copies of the call's arguments, for the approval card. */
  args: Record<string, unknown>;
}

/** How destructive AI tool calls are handled. */
export type ToolApprovalMode = "ask" | "auto";

export interface ChatToolStep {
  name: string;
  status: "start" | "done";
  detail?: string;
  at: number;
}

export type ImportSource = "obsidian" | "bear" | "roam" | "notion" | "plain";

export interface ImportPreview {
  source: ImportSource;
  notes: number;
  attachments: number;
  /** First few target-relative paths for the confirmation UI. */
  sample: string[];
}

export interface ImportResult {
  notes: number;
  attachments: number;
  created: string[];
}

export type NodeType = "file" | "folder";

/** How a file should be displayed in the workspace. */
export type FileKind = "text" | "pdf" | "html" | "image";

const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".text", ".html", ".htm", ".css", ".js", ".mjs",
  ".cjs", ".ts", ".tsx", ".jsx", ".json", ".jsonc", ".yaml", ".yml", ".toml",
  ".ini", ".cfg", ".conf", ".sh", ".zsh", ".bash", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".h", ".cpp", ".hpp", ".sql", ".csv", ".tsv", ".xml", ".log",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".avif",
  ".tiff", ".tif",
]);

/** Classify a file by extension so binary files are never read as text. */
export function fileKind(path: string): FileKind {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === ".html" || ext === ".htm") return "html";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "text";
}

export interface TreeNode {
  name: string;
  path: string; // relative to workspace root, POSIX-style
  type: NodeType;
  size?: number;
  mtime?: number;
  children?: TreeNode[];
}

export type TaskStatus = "todo" | "done";
export type TaskPriority = "high" | "medium" | "low";
export type TaskRecur = "daily" | "weekly" | "monthly" | `${number}d` | `${number}w` | `${number}m`;

export interface Task {
  id: string; // filename without .md
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due: string | null; // YYYY-MM-DD
  project: string | null;
  recur: TaskRecur | null;
  created: string;
  updated: string;
  path: string;
}

export interface ParsedTask {
  title: string;
  priority: TaskPriority;
  due: string | null;
  project: string | null;
  recur: TaskRecur | null;
}

/** A local LLM runtime auto-detected on this machine (e.g. Ollama). */
export interface LocalAiInfo {
  name: string;
  baseUrl: string;
  model: string;
  /** All installed chat models (embedding models excluded). */
  models?: string[];
}

/**
 * Which backend to use for chat. "auto" keeps the old behaviour (explicit
 * provider wins, then a running local Ollama, then the OpenAI defaults).
 */
export type ChatBackend = "auto" | "local" | "cloud";

export interface AiModelProfile {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface AiSettings {
  provider: string;
  baseUrl: string;
  model: string;
  embeddingModel: string;
  hasKey: boolean;
  /** The user's chat backend choice: "auto", "local" (Ollama) or "cloud" (API key). */
  backend: ChatBackend;
  /** Embeddings endpoint, when explicitly configured (empty = auto-detect). */
  embeddingBaseUrl: string;
  /** True when a separate embedding API key is stored. */
  embeddingHasKey: boolean;
  /** A local Ollama with an embedding model installed, if detected. */
  embeddingLocal: { baseUrl: string; model: string } | null;
  /** Set when a local LLM is running and can be used with zero setup. */
  local: LocalAiInfo | null;
  /** The user's chosen local chat model, when it differs from auto-detection. */
  ollamaModel?: string;
  profiles: AiModelProfile[];
  defaultModelId?: string | null;
  backupModelId?: string | null;
  /** "ask" gates destructive tool calls behind an approval card (default). */
  toolApproval: ToolApprovalMode;
}

export interface Settings {
  configured: boolean;
  workspace: string;
  defaultWorkspace: string;
  theme: "light" | "dark" | "system";
  /** Custom accent color (6-digit hex, e.g. "#0891b2"). */
  accent?: string;
  /** Font family, prose serif, size, density and ligatures. */
  typography?: TypographySettings;
  ai: AiSettings;
  /** Toggleable sidebar modules. Missing keys fall back to defaults. */
  modules: ModuleSettings;
}

export type FontFamily = "inter" | "plex" | "system";
export type Density = "compact" | "comfortable" | "spacious";

export interface TypographySettings {
  /** "system" keeps the OS stack; "inter"/"plex" use the bundled variable fonts. */
  fontFamily: FontFamily;
  /** Render markdown prose (and the editor) in the Newsreader serif. */
  serifProse: boolean;
  /** Base UI font size in px. */
  fontSize: 13 | 14 | 15 | 16;
  /** Editor/content density preset. */
  density: Density;
  /** Common ligatures on/off (font-feature-settings). */
  ligatures: boolean;
}

export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  fontFamily: "inter",
  serifProse: false,
  fontSize: 13,
  density: "comfortable",
  ligatures: true,
};

export interface SettingsInput {
  workspace?: string;
  theme?: "light" | "dark" | "system";
  accent?: string;
  typography?: Partial<TypographySettings>;
  ai?: Partial<Omit<AiSettings, "hasKey" | "embeddingHasKey" | "embeddingLocal">>;
  aiKey?: string;
  /** Separate key for the embeddings endpoint (empty string clears it). */
  embeddingAiKey?: string;
  modules?: ModuleSettings;
}

export type ContextTarget =
  | { type: "file"; path: string }
  | { type: "folder"; path: string }
  | { type: "tasks"; path: "" };

/** A note the assistant drew on when answering. `line` is 1-based. */
export interface ChatSource {
  path: string;
  line: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  contexts?: ContextTarget[];
  /** Data URLs of images pasted into the chat (user messages only). */
  images?: string[];
  /** Notes the assistant read while answering; each cites a 1-based line. */
  sources?: ChatSource[];
  createdAt: number;
  status?: ChatMessageStatus;
  error?: string | null;
  steps?: ChatToolStep[];
  /** Set while a destructive tool call waits for the user's decision. */
  pendingApproval?: ChatApprovalRequest | null;
  /** Provider-reported token counts for this reply (cloud models only). */
  usage?: { promptTokens: number; completionTokens: number };
  /** Stores the content before the last AI rewrite so Undo survives reloads. */
  undoContent?: string | null;
}

/** A persisted chat conversation (stored under <workspace>/.persona/chats/). */
export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preview: string;
}

export interface ChatTranscript extends ChatMeta {
  messages: ChatMessage[];
  /** Per-chat AI overrides. null/undefined = follow global settings. */
  modelId?: string | null;
  personaId?: string | null;
  temperature?: number | null;
}

/** Patchable per-chat AI settings. */
export interface ChatSettingsInput {
  modelId?: string | null;
  personaId?: string | null;
  temperature?: number | null;
}

/** A named system-prompt add-on ("persona") selectable per chat. */
export interface Persona {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
}

export interface ChatSearchHit {
  id: string;
  title: string;
  snippet: string;
  updatedAt: number;
}

export interface ContextItem {
  type: "file" | "folder" | "tasks";
  path: string;
  label: string;
}

export interface SemanticHit {
  path: string;
  name: string;
  snippet: string;
  score: number;
}

export interface SearchResults {
  files: TreeNode[];
  tasks: Task[];
  semantic: SemanticHit[];
}

/** A pinned item on the pinboard. `ref` is a file path (file) or task id (task). */
export interface Pin {
  type: "file" | "task";
  ref: string;
  addedAt: number;
}

export interface Pinboard {
  files: TreeNode[];
  tasks: Task[];
  /** Pins whose target no longer exists (file deleted / task removed). */
  missing: Pin[];
}

export type ServerEvent =
  | { type: "fs"; paths: string[] }
  | { type: "tasks" }
  | { type: "chats" }
  | { type: "settings" }
  | { type: "pins" };

/** App-lock preferences. The PIN itself lives in the OS keychain. */
export interface LockSettings {
  enabled: boolean;
  /** Re-prompt after this many minutes without activity. */
  idleMinutes: number;
  hasPin: boolean;
}

export type TransformMode =
  | "summarize"
  | "fix_grammar"
  | "rewrite"
  | "translate"
  | "bulletize"
  | "explain"
  | "shorten"
  | "tone";

export interface FileUpdate {
  path: string;
  content: string;
}

export interface TagSuggestResult {
  tags: string[];
  content: string;
}

/** A single AI review suggestion for an open task. `apply` is an optional validated patch. */
export type TriageKind = "priority" | "due" | "project" | "stale" | "duplicate";

export interface TriageSuggestion {
  taskId: string;
  kind: TriageKind;
  suggestion: string;
  apply?: Partial<Pick<Task, "priority" | "due" | "project" | "status">>;
}
