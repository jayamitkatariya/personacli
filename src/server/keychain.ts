import { readConfig, writeConfig } from "./state.js";

const SERVICE = "persona";
const ACCOUNT = "api-key";
const EMBEDDING_ACCOUNT = "embedding-api-key";

let keyring: typeof import("@napi-rs/keyring") | null = null;
try {
  keyring = await import("@napi-rs/keyring");
} catch {
  keyring = null;
}

function entry(account: string): import("@napi-rs/keyring").AsyncEntry | null {
  if (!keyring) return null;
  try {
    return new keyring.AsyncEntry(SERVICE, account);
  } catch {
    return null;
  }
}

function fileFallbackKey(): string | null {
  return readConfig().ai?.apiKey ?? null;
}

function fileFallbackSet(key: string) {
  const config = readConfig();
  config.ai = { ...config.ai, apiKey: key };
  writeConfig(config);
}

function fileFallbackClear() {
  const config = readConfig();
  if (config.ai) {
    delete config.ai.apiKey;
    writeConfig(config);
  }
}

export async function getApiKey(): Promise<string | null> {
  const e = entry(ACCOUNT);
  if (e) {
    try {
      const value = await e.getPassword();
      if (value) return value;
    } catch {
      // fall through to file
    }
  }
  return fileFallbackKey();
}

export async function setApiKey(key: string) {
  const e = entry(ACCOUNT);
  if (e) {
    try {
      await e.setPassword(key);
      fileFallbackClear();
      return;
    } catch {
      // fall through to file
    }
  }
  fileFallbackSet(key);
}

export async function hasApiKey(): Promise<boolean> {
  return (await getApiKey()) !== null;
}

export async function clearApiKey() {
  const e = entry(ACCOUNT);
  if (e) {
    try {
      await e.deletePassword();
    } catch {
      // ignore
    }
  }
  fileFallbackClear();
}

function fileFallbackEmbeddingKey(): string | null {
  return readConfig().ai?.embeddingApiKey ?? null;
}

function fileFallbackEmbeddingSet(key: string) {
  const config = readConfig();
  config.ai = { ...config.ai, embeddingApiKey: key };
  writeConfig(config);
}

function fileFallbackEmbeddingClear() {
  const config = readConfig();
  if (config.ai && "embeddingApiKey" in config.ai) {
    delete config.ai.embeddingApiKey;
    writeConfig(config);
  }
}

export async function getEmbeddingApiKey(): Promise<string | null> {
  const e = entry(EMBEDDING_ACCOUNT);
  if (e) {
    try {
      const value = await e.getPassword();
      if (value) return value;
    } catch {
      // fall through to file
    }
  }
  return fileFallbackEmbeddingKey();
}

export async function setEmbeddingApiKey(key: string) {
  const e = entry(EMBEDDING_ACCOUNT);
  if (e) {
    try {
      await e.setPassword(key);
      fileFallbackEmbeddingClear();
      return;
    } catch {
      // fall through to file
    }
  }
  fileFallbackEmbeddingSet(key);
}

export async function hasEmbeddingApiKey(): Promise<boolean> {
  return (await getEmbeddingApiKey()) !== null;
}

export async function clearEmbeddingApiKey() {
  const e = entry(EMBEDDING_ACCOUNT);
  if (e) {
    try {
      await e.deletePassword();
    } catch {
      // ignore
    }
  }
  fileFallbackEmbeddingClear();
}
