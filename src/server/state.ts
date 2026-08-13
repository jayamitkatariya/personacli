import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ChatBackend, Density, FontFamily } from "../shared/types.js";

export type ThemeSetting = "light" | "dark" | "system";

export interface ConfigFile {
  workspace?: string;
  theme?: ThemeSetting;
  /** Custom accent color (6-digit hex, e.g. "#0891b2"). */
  accent?: string;
  typography?: {
    fontFamily?: FontFamily;
    serifProse?: boolean;
    fontSize?: 13 | 14 | 15 | 16;
    density?: Density;
    ligatures?: boolean;
  };
  lock?: {
    enabled?: boolean;
    idleMinutes?: number;
    /** Fallback when the OS keychain is unavailable (sha-256 hex). */
    pinHash?: string;
  };
  ai?: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    embeddingModel?: string;
    /** Chat backend selection: "auto" (default), "local" (Ollama), "cloud" (API key). */
    backend?: ChatBackend;
    /** Chosen local chat model (when several Ollama models are installed). */
    ollamaModel?: string;
    apiKey?: string; // fallback only; keychain is preferred
    /** Embeddings are served from here when set (e.g. a local Ollama). */
    embeddingBaseUrl?: string;
    embeddingApiKey?: string; // fallback only; keychain is preferred
  };
}

const configDir = join(homedir(), ".persona");
const configPath = join(configDir, "config.json");
const statePath = join(configDir, "state.json");
const logDir = join(configDir, "logs");

export function ensureConfigDir() {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
}

export function readConfig(): ConfigFile {
  try {
    if (!existsSync(configPath)) return {};
    return JSON.parse(readFileSync(configPath, "utf8")) as ConfigFile;
  } catch {
    return {};
  }
}

export function writeConfig(config: ConfigFile) {
  ensureConfigDir();
  writeFileSync(configPath, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function getWorkspace(): string | null {
  return readConfig().workspace ?? null;
}

export interface ServerState {
  port: number;
  pid: number;
  startedAt: number;
}

export function readState(): ServerState | null {
  try {
    if (!existsSync(statePath)) return null;
    return JSON.parse(readFileSync(statePath, "utf8")) as ServerState;
  } catch {
    return null;
  }
}

export function writeState(state: ServerState) {
  ensureConfigDir();
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function serverLogPath() {
  ensureConfigDir();
  return join(logDir, "server.log");
}

export function serverPidPath() {
  ensureConfigDir();
  return join(configDir, "server.pid");
}
