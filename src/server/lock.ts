import { createHash } from "node:crypto";
import { readConfig, writeConfig } from "./state.js";
import type { LockSettings } from "../shared/types.js";

const SERVICE = "persona";
const PIN_ACCOUNT = "app-pin";

let keyring: typeof import("@napi-rs/keyring") | null = null;
try {
  keyring = await import("@napi-rs/keyring");
} catch {
  keyring = null;
}

function pinEntry(): import("@napi-rs/keyring").AsyncEntry | null {
  if (!keyring) return null;
  try {
    return new keyring.AsyncEntry(SERVICE, PIN_ACCOUNT);
  } catch {
    return null;
  }
}

function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

export async function getAppPin(): Promise<string | null> {
  const e = pinEntry();
  if (e) {
    try {
      const value = await e.getPassword();
      if (value) return value;
    } catch {
      // fall through to config fallback
    }
  }
  const hash = readConfig().lock?.pinHash;
  return hash ? `sha256:${hash}` : null;
}

export async function setAppPin(pin: string) {
  const e = pinEntry();
  if (e) {
    try {
      await e.setPassword(pin);
      const config = readConfig();
      if (config.lock) {
        delete config.lock.pinHash;
        if (Object.keys(config.lock).length === 0) delete config.lock;
      }
      writeConfig(config);
      return;
    } catch {
      // fall through to config fallback
    }
  }
  const config = readConfig();
  config.lock = { ...config.lock, pinHash: hashPin(pin) };
  writeConfig(config);
}

export async function clearAppPin() {
  const e = pinEntry();
  if (e) {
    try {
      await e.deletePassword();
    } catch {
      // ignore
    }
  }
  const config = readConfig();
  if (config.lock) {
    delete config.lock.pinHash;
    if (Object.keys(config.lock).length === 0) delete config.lock;
    writeConfig(config);
  }
}

export async function hasAppPin(): Promise<boolean> {
  return (await getAppPin()) !== null;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await getAppPin();
  if (!stored) return false;
  if (stored.startsWith("sha256:")) {
    return stored.slice(7) === hashPin(pin);
  }
  return stored === pin;
}

export async function getLockSettings(): Promise<LockSettings> {
  const config = readConfig();
  return {
    enabled: Boolean(config.lock?.enabled),
    idleMinutes: Math.max(1, Math.min(180, config.lock?.idleMinutes ?? 5)),
    hasPin: await hasAppPin(),
  };
}

export async function updateLockSettings(input: {
  enabled?: boolean;
  idleMinutes?: number;
  pin?: string; // empty string clears the pin
}): Promise<LockSettings> {
  const config = readConfig();
  const lock = { ...(config.lock ?? {}) };
  if (typeof input.enabled === "boolean") lock.enabled = input.enabled;
  if (typeof input.idleMinutes === "number" && Number.isFinite(input.idleMinutes)) {
    lock.idleMinutes = Math.max(1, Math.min(180, Math.round(input.idleMinutes)));
  }
  config.lock = lock;
  writeConfig(config);
  // PIN ops re-read the config internally, so they must run after the write
  // above — otherwise their hash would be clobbered by the stale object.
  if (input.pin !== undefined) {
    if (input.pin === "") {
      await clearAppPin();
    } else {
      await setAppPin(input.pin);
    }
  }
  return {
    enabled: Boolean(lock.enabled),
    idleMinutes: lock.idleMinutes ?? 5,
    hasPin: await hasAppPin(),
  };
}
