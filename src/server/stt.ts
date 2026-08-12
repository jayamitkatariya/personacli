import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Local speech-to-text via parakeet.cpp (mudler/parakeet.cpp). The browser
 * records audio (webm/opus), the server converts it to 16 kHz mono WAV with
 * ffmpeg, and `parakeet-cli transcribe` produces the transcript on Metal/CPU.
 *
 * Configuration (env vars):
 *   PERSONA_STT_MODEL  path to the parakeet GGUF model
 *   PERSONA_STT_BIN    path to the parakeet-cli binary
 */

const DEFAULT_MODEL = "";
const DEFAULT_BIN = fileURLToPath(new URL("../../bin/parakeet-cli", import.meta.url));

export function sttModelPath(): string {
  return process.env.PERSONA_STT_MODEL || DEFAULT_MODEL;
}

function sttBinPath(): string {
  return process.env.PERSONA_STT_BIN || DEFAULT_BIN;
}

/** Runs `parakeet-cli transcribe --json` and returns the plain transcript text. */
async function runParakeet(wavPath: string, signal?: AbortSignal): Promise<string> {
  const model = sttModelPath();
  const bin = sttBinPath();
  if (!model) throw new Error("Speech-to-text model not configured. Set PERSONA_STT_MODEL.");
  if (!bin) throw new Error("parakeet-cli not found. Set PERSONA_STT_BIN.");

  const { stdout } = await execFileP(
    bin,
    ["transcribe", "--model", model, "--input", wavPath, "--json"],
    { timeout: 120_000, signal, maxBuffer: 16 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as { text?: string };
  return (parsed.text ?? "").trim();
}

/** Serializes transcription requests — one at a time, like parakeet-server. */
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Transcribe an audio blob (webm/ogg/mp4/wav…). Returns the transcript text.
 * Converts to 16 kHz mono WAV with ffmpeg, then runs the local parakeet model.
 */
export async function transcribeAudio(
  audio: Buffer,
  ext: string,
  signal?: AbortSignal,
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "persona-stt-"));
  const input = join(dir, `input.${ext.replace(/[^a-z0-9]/gi, "") || "webm"}`);
  const wav = join(dir, "audio.wav");
  try {
    writeFileSync(input, audio);
    try {
      await execFileP(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-f", "wav", wav],
        { timeout: 60_000, signal },
      );
    } catch (err) {
      const e = err as { code?: string | number };
      if (e.code === "ENOENT") {
        throw new Error("ffmpeg is required for voice input. Install it with `brew install ffmpeg`.");
      }
      if ((err as Error)?.name === "AbortError") throw err;
      throw new Error("Couldn't read the audio recording. Try recording again.");
    }
    return await withLock(() => runParakeet(wav, signal));
  } catch (err) {
    const e = err as { code?: string | number; message?: string };
    if (e.code === "ENOENT") {
      throw new Error(
        "parakeet-cli is missing. Reinstall it next to the server (bin/parakeet-cli) or set PERSONA_STT_BIN.",
      );
    }
    if (e.code === "ETIMEDOUT") throw new Error("Transcription timed out.");
    if (err instanceof Error && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : "Transcription failed";
    if (/parakeet|model/i.test(message)) {
      throw new Error(
        `Speech-to-text model failed to load (${sttModelPath()}). ` +
          "Set PERSONA_STT_MODEL to a parakeet.cpp-compatible GGUF.",
      );
    }
    throw new Error(message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
