import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { getApiKey, getEmbeddingApiKey } from "./keychain.js";
import { getWorkspace, readConfig } from "./state.js";
import { readFileContent, walkFiles, workspaceRoot } from "./fs.js";
import { detectOllamaEmbedding } from "./ollama.js";
import type { SemanticHit } from "../shared/types.js";

const SEARCHABLE_EXT = new Set([".md", ".markdown", ".txt"]);
const CHUNK_TARGET = 1200;
const CHUNK_MAX = 2400;
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 64;
const MAX_CHUNKS_PER_FILE = 300;
const MIN_SIMILARITY = 0.2;
const INDEX_VERSION = 1;

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export function embeddingModel(): string {
  return readConfig().ai?.embeddingModel || DEFAULT_EMBEDDING_MODEL;
}

/** Where embeddings are produced from. */
export interface EmbeddingEndpoint {
  client: OpenAI;
  baseUrl: string;
  model: string;
  /** True when the vectors come from a local Ollama — no key required. */
  local: boolean;
}

/**
 * Resolve the endpoint used for embeddings, in priority order:
 * 1. An explicitly configured embedding base URL (Settings → AI).
 * 2. A running local Ollama with an embedding model installed.
 * 3. The chat provider's endpoint (OpenAI-compatible).
 */
export async function resolveEmbeddingEndpoint(): Promise<EmbeddingEndpoint | null> {
  const config = readConfig();
  const explicit = config.ai?.embeddingBaseUrl?.trim();
  if (explicit) {
    const key = (await getEmbeddingApiKey()) ?? (await getApiKey());
    if (!key) return null;
    return { client: new OpenAI({ apiKey: key, baseURL: explicit }), baseUrl: explicit, model: embeddingModel(), local: false };
  }
  const ollama = await detectOllamaEmbedding();
  if (ollama) {
    return { client: new OpenAI({ apiKey: "ollama", baseURL: ollama.baseUrl }), baseUrl: ollama.baseUrl, model: ollama.model, local: true };
  }
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  const baseUrl = config.ai?.baseUrl?.trim() || "https://api.openai.com/v1";
  return { client: new OpenAI({ apiKey, baseURL: baseUrl }), baseUrl, model: embeddingModel(), local: false };
}

export function isSearchableFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return SEARCHABLE_EXT.has(ext);
}

interface ChunkRecord {
  path: string;
  content: string;
}

interface IndexState {
  baseUrl: string;
  model: string;
  chunks: ChunkRecord[];
  vectors: Float32Array[];
  byPath: Map<string, number[]>;
}

let loaded: IndexState | null = null;
let building: Promise<void> | null = null;
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastBuildError: string | null = null;

/** The last embedding build failure, if any (surfaced by the reindex endpoint). */
export function getLastBuildError(): string | null {
  return lastBuildError;
}

function indexDir(): string {
  return join(workspaceRoot(), ".persona", "embeddings");
}

function indexPath(): string {
  return join(indexDir(), "index.json");
}

/** Split a document into overlapping chunks on paragraph boundaries. */
export function chunkContent(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > CHUNK_TARGET && current.length >= CHUNK_TARGET / 2) {
      chunks.push(current);
      const overlap = current.length > CHUNK_OVERLAP ? current.slice(-CHUNK_OVERLAP) : current;
      current = overlap ? overlap + "\n\n" + paragraph : paragraph;
      continue;
    }
    current = current ? current + "\n\n" + paragraph : paragraph;
    if (current.length > CHUNK_MAX) {
      const cut = current.slice(0, CHUNK_MAX);
      chunks.push(cut);
      current = cut.slice(-CHUNK_OVERLAP);
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.filter((c) => c.trim().length >= 5);
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= norm;
  return v;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i]! * b[i]!;
  return sum;
}

function buildByPath(chunks: ChunkRecord[]): Map<string, number[]> {
  const byPath = new Map<string, number[]>();
  chunks.forEach((c, i) => {
    const list = byPath.get(c.path) ?? [];
    list.push(i);
    byPath.set(c.path, list);
  });
  return byPath;
}

function makeSnippet(content: string, limit: number): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return clean.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendlyEmbeddingError(err: unknown, endpoint: EmbeddingEndpoint | null): string {
  const detail = err instanceof Error ? err.message.replace(/^\s*\d+\s+/, "").trim() : "unknown error";
  if (endpoint?.local) {
    return `Local Ollama embeddings failed (${endpoint.model}): ${detail}`;
  }
  if (endpoint) {
    return `Embeddings failed at ${endpoint.baseUrl} (model ${endpoint.model}): ${detail}. Your chat provider may not offer embeddings — install Ollama and \`ollama pull all-minilm\`, or set an embedding provider in Settings → AI.`;
  }
  return "No AI provider available for embeddings — run Ollama (\`ollama pull all-minilm\`) or add an API key in Settings → AI.";
}

async function embed(endpoint: EmbeddingEndpoint, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await endpoint.client.embeddings.create({
      model: endpoint.model,
      input: batch,
    });
    const ordered: number[][] = new Array(batch.length);
    for (const item of res.data) ordered[item.index] = item.embedding;
    out.push(...ordered);
    if (i + BATCH_SIZE < texts.length) await sleep(50);
  }
  return out;
}

export async function loadSemanticIndex(): Promise<void> {
  try {
    const raw = await readFile(indexPath(), "utf8");
    const data = JSON.parse(raw) as {
      version?: number;
      baseUrl?: string;
      model?: string;
      chunks?: { path: string; content: string; v?: number[] }[];
    };
    if (data.version !== INDEX_VERSION || !Array.isArray(data.chunks)) return;
    const chunks: ChunkRecord[] = [];
    const vectors: Float32Array[] = [];
    for (const c of data.chunks) {
      if (!Array.isArray(c.v) || c.v.length === 0) continue;
      chunks.push({ path: c.path, content: c.content });
      vectors.push(normalize(new Float32Array(c.v)));
    }
    if (chunks.length !== vectors.length) return;
    loaded = { baseUrl: data.baseUrl ?? "", model: data.model ?? "", chunks, vectors, byPath: buildByPath(chunks) };
  } catch {
    loaded = null;
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!dirty || !loaded) return;
    dirty = false;
    try {
      const data = {
        version: INDEX_VERSION,
        baseUrl: loaded.baseUrl,
        model: loaded.model,
        chunks: loaded.chunks.map((c, i) => ({
          path: c.path,
          content: c.content,
          v: Array.from(loaded ? loaded.vectors[i]! : new Float32Array(0)),
        })),
      };
      await mkdir(indexDir(), { recursive: true });
      await writeFile(indexPath(), JSON.stringify(data));
    } catch (err) {
      console.error("[persona] failed to persist search index:", err instanceof Error ? err.message : err);
    }
  }, 800);
}

async function readSearchable(path: string): Promise<{ content: string } | null> {
  try {
    const content = await readFileContent(path);
    return { content };
  } catch {
    return null;
  }
}

/**
 * Full rebuild: walk the workspace, chunk every searchable file, embed and
 * store locally. Returns null when no API key is configured.
 */
export async function rebuildSemanticIndex(
  onProgress?: (done: number, total: number) => void,
): Promise<{ files: number; chunks: number } | null> {
  if (building) {
    await building;
    return loaded ? { files: new Set(loaded.chunks.map((c) => c.path)).size, chunks: loaded.chunks.length } : null;
  }
  if (!getWorkspace()) return null;
  const endpoint = await resolveEmbeddingEndpoint();
  if (!endpoint) {
    loaded = null;
    dirty = false;
    lastBuildError = null;
    return null;
  }
  if (building) {
    await building;
    return loaded ? { files: new Set(loaded.chunks.map((c) => c.path)).size, chunks: loaded.chunks.length } : null;
  }

  const p = (async () => {
    const entries = await walkFiles().catch(() => []);
    const searchable = entries.filter((e) => isSearchableFile(e.path));
    const chunks: ChunkRecord[] = [];
    for (const entry of searchable) {
      const file = await readSearchable(entry.path);
      if (!file) continue;
      const parts = chunkContent(file.content).slice(0, MAX_CHUNKS_PER_FILE);
      for (const part of parts) chunks.push({ path: entry.path, content: part });
    }
    const vectors: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await embed(endpoint, batch.map((c) => c.content));
      for (const v of embeddings) vectors.push(normalize(new Float32Array(v)));
      onProgress?.(Math.min(i + BATCH_SIZE, chunks.length), chunks.length);
    }
    loaded = { baseUrl: endpoint.baseUrl, model: endpoint.model, chunks, vectors, byPath: buildByPath(chunks) };
    lastBuildError = null;
    dirty = true;
    scheduleSave();
  })().catch((err) => {
    console.error("[persona] semantic index build failed:", err instanceof Error ? err.message : err);
    loaded = null;
    dirty = false;
    lastBuildError = friendlyEmbeddingError(err, endpoint);
  });
  building = p;
  await p;
  building = null;
  if (!loaded) return null;
  return { files: new Set(loaded.chunks.map((c) => c.path)).size, chunks: loaded.chunks.length };
}

/**
 * Incremental update after filesystem changes: re-embed changed files,
 * drop deleted ones. No-op until the initial build has completed.
 */
export async function updateSemanticIndex(paths: string[]): Promise<void> {
  if (building) await building;
  if (!loaded) return;
  if (!getWorkspace()) return;
  const changed = [...new Set(paths)].filter(isSearchableFile);
  if (changed.length === 0) return;
  const endpoint = await resolveEmbeddingEndpoint();
  if (!endpoint) return;
  if (loaded.baseUrl !== endpoint.baseUrl || loaded.model !== endpoint.model) {
    void rebuildSemanticIndex();
    return;
  }

  const fresh: ChunkRecord[] = [];
  const freshVectors: Float32Array[] = [];
  for (const path of changed) {
    const file = await readSearchable(path);
    if (!file) continue;
    const parts = chunkContent(file.content).slice(0, MAX_CHUNKS_PER_FILE);
    if (parts.length === 0) continue;
    const embeddings = await embed(endpoint, parts);
    for (let i = 0; i < parts.length; i++) {
      fresh.push({ path, content: parts[i]! });
      freshVectors.push(normalize(new Float32Array(embeddings[i]!)));
    }
  }

  const drop = new Set(changed);
  const keepChunks: ChunkRecord[] = [];
  const keepVectors: Float32Array[] = [];
  for (let i = 0; i < loaded.chunks.length; i++) {
    if (drop.has(loaded.chunks[i]!.path)) continue;
    keepChunks.push(loaded.chunks[i]!);
    keepVectors.push(loaded.vectors[i]!);
  }
  const chunks = [...keepChunks, ...fresh];
  const vectors = [...keepVectors, ...freshVectors];
  loaded = { ...loaded, chunks, vectors, byPath: buildByPath(chunks) };
  dirty = true;
  scheduleSave();
}

/** Embed the query and return the best matching files, one hit per file. */
export async function semanticSearch(q: string, k = 6, fullText = false): Promise<SemanticHit[]> {
  const query = q.trim();
  if (!query || query.length < 3) return [];
  const endpoint = await resolveEmbeddingEndpoint();
  if (!endpoint || !loaded) return [];
  if (loaded.baseUrl !== endpoint.baseUrl || loaded.model !== endpoint.model) {
    void rebuildSemanticIndex();
    return [];
  }
  if (building) await building;
  if (!loaded) return [];

  let queryVec: number[] = [];
  try {
    const [emb] = await embed(endpoint, [query]);
    if (emb) queryVec = emb;
  } catch {
    return [];
  }
  const qv = normalize(new Float32Array(queryVec));
  const scored: { idx: number; score: number }[] = [];
  for (let i = 0; i < loaded.vectors.length; i++) {
    const score = cosine(qv, loaded.vectors[i]!);
    if (score >= MIN_SIMILARITY) scored.push({ idx: i, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const hits: SemanticHit[] = [];
  const seen = new Set<string>();
  for (const { idx, score } of scored.slice(0, k * 2)) {
    const c = loaded.chunks[idx]!;
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    hits.push({
      path: c.path,
      name: c.path.slice(c.path.lastIndexOf("/") + 1),
      snippet: fullText ? c.content : makeSnippet(c.content, 160),
      score,
    });
    if (hits.length >= k) break;
  }
  return hits;
}
