import type { LocalAiInfo } from "../shared/types.js";

const OLLAMA_HOSTS = ["http://127.0.0.1:11434", "http://localhost:11434"];

const EMBEDDING_KEYWORDS = ["embed", "minilm", "bge", "mxbai", "nomic", "e5-"];

/** Embedding models we'd rather use, in order. */
const PREFERRED_EMBEDDING_MODELS = ["nomic-embed-text", "all-minilm", "mxbai-embed-large", "bge-m3", "snowflake-arctic-embed"];

const PREFERRED_MODELS = [
  "llama3.3", "llama3.2", "llama3.1", "llama3",
  "qwen3", "qwen2.5", "qwen2",
  "mistral", "gemma3", "gemma2", "phi4", "phi3",
  "deepseek-r1", "command-r", "llava",
];

let cache: { at: number; info: LocalAiInfo | null } | null = null;
let embeddingCache: { at: number; info: OllamaEmbeddingInfo | null } | null = null;
const CACHE_MS = 15_000;

function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function isEmbeddingModel(name: string): boolean {
  const lower = name.toLowerCase();
  return EMBEDDING_KEYWORDS.some((k) => lower.includes(k));
}

function pickModel(models: string[]): string {
  for (const preferred of PREFERRED_MODELS) {
    const hit = models.find((m) => m.toLowerCase().startsWith(preferred));
    if (hit) return hit;
  }
  return models[0]!;
}

async function probeTags(host: string, timeoutMs: number): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: string }[] };
    return (body.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probe(host: string, timeoutMs: number): Promise<LocalAiInfo | null> {
  const models = await probeTags(host, timeoutMs);
  if (!models) return null;
  if (models.length === 0) return { name: "Ollama", baseUrl: `${host}/v1`, model: "", models: [] };
  const chatModels = models.filter((n) => !isEmbeddingModel(n));
  const model = chatModels.length > 0 ? pickModel(chatModels) : "";
  return { name: "Ollama", baseUrl: `${host}/v1`, model, models: chatModels };
}

export function invalidateOllamaCache() {
  cache = null;
  embeddingCache = null;
}

/** An Ollama instance that can embed text (has an embedding model installed). */
export interface OllamaEmbeddingInfo {
  baseUrl: string;
  model: string;
}

/**
 * Detect a local Ollama with an embedding model (nomic-embed-text, all-minilm,
 * bge-*, mxbai-*, e5-*…). Returns null when none is reachable or installed.
 * Results are cached briefly so search doesn't re-probe on every query.
 */
export async function detectOllamaEmbedding(): Promise<OllamaEmbeddingInfo | null> {
  if (embeddingCache && Date.now() - embeddingCache.at < CACHE_MS) return embeddingCache.info;
  const hosts: string[] = [];
  if (process.env.OLLAMA_HOST) hosts.push(normalizeHost(process.env.OLLAMA_HOST));
  hosts.push(...OLLAMA_HOSTS);
  for (const host of hosts) {
    const models = await probeTags(host, 800);
    if (!models) continue;
    const embedding = models.filter(isEmbeddingModel);
    if (embedding.length === 0) continue;
    embedding.sort((a, b) => {
      const ai = PREFERRED_EMBEDDING_MODELS.indexOf(a);
      const bi = PREFERRED_EMBEDDING_MODELS.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    const info = { baseUrl: `${host}/v1`, model: embedding[0]! };
    embeddingCache = { at: Date.now(), info };
    return info;
  }
  embeddingCache = { at: Date.now(), info: null };
  return null;
}

/**
 * Detect a running local Ollama instance — default ports or $OLLAMA_HOST.
 * Returns null when Ollama is not reachable. When the daemon is up but has no
 * usable chat models, returns info with an empty `model`. Results are cached
 * briefly so the page and chat don't re-probe on every request.
 */
export async function detectOllama(): Promise<LocalAiInfo | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.info;
  const hosts: string[] = [];
  if (process.env.OLLAMA_HOST) hosts.push(normalizeHost(process.env.OLLAMA_HOST));
  hosts.push(...OLLAMA_HOSTS);
  for (const host of hosts) {
    const info = await probe(host, 800);
    if (info) {
      cache = { at: Date.now(), info };
      return info;
    }
  }
  cache = { at: Date.now(), info: null };
  return null;
}
