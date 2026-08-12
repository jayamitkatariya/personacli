import OpenAI from "openai";
import { getApiKey } from "./keychain.js";
import { isLocalEndpoint, resolveAiConfig } from "./ai.js";
import type { TransformMode } from "../shared/types.js";

export const TRANSFORM_MODES: TransformMode[] = [
  "summarize",
  "fix_grammar",
  "rewrite",
  "translate",
  "bulletize",
  "explain",
  "shorten",
  "tone",
];

const PROMPTS: Record<TransformMode, string> = {
  summarize:
    "Summarize the following text concisely. Keep the key points and tone; return only the summary with no preamble.",
  fix_grammar:
    "Fix grammar, spelling and punctuation in the following text. Do not change meaning, wording or tone beyond the fixes; return only the corrected text.",
  rewrite:
    "Rewrite the following text to be clearer and more polished, keeping the same meaning and length; return only the rewritten text.",
  translate:
    "Translate the following text into the target language. Preserve markdown formatting; return only the translation.",
  bulletize:
    "Convert the following text into a clean bullet-point list. Preserve every idea; use '- ' bullets with sub-bullets where useful; return only the list.",
  explain:
    "Explain the following text in plain, friendly terms as if to a smart colleague. Be concise; return only the explanation.",
  shorten:
    "Shorten the following text to its essential meaning, cutting fluff while keeping the point and any key details; return only the shortened version.",
  tone:
    "Rephrase the following text to the requested tone. Keep the meaning and length; return only the rephrased text.",
};

export interface TransformOptions {
  mode: TransformMode;
  text: string;
  /** Target language for "translate"; tone label for "tone". */
  lang?: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

export async function streamTransform(options: TransformOptions): Promise<void> {
  const { mode, text, lang } = options;
  if (!text.trim()) {
    options.onError("Nothing to transform — select some text first.");
    return;
  }

  let apiKey = await getApiKey();
  const { baseUrl, model, local } = await resolveAiConfig();
  const usingLocal = local || isLocalEndpoint(baseUrl);
  if (!apiKey) {
    if (usingLocal) {
      apiKey = "ollama";
    } else {
      options.onError("No AI provider available — add an API key in Settings → AI.");
      return;
    }
  }
  if (local && !model) {
    options.onError("No chat model available in Ollama — install one with `ollama pull llama3.2`.");
    return;
  }

  const instruction = PROMPTS[mode];
  const directive =
    mode === "translate"
      ? `${instruction} Target language: ${lang || "Spanish"}.`
      : mode === "tone"
        ? `${instruction} Requested tone: ${lang || "friendly"}.`
        : instruction;

  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  try {
    const stream = await client.chat.completions.create(
      {
        model,
        stream: true,
        messages: [
          { role: "system", content: directive },
          { role: "user", content: text },
        ],
        temperature: 0.4,
      },
      { signal: options.signal },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) options.onDelta(delta);
    }
    options.onDone();
  } catch (err) {
    if (options.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      options.onDone();
      return;
    }
    const message =
      err instanceof OpenAI.APIError && err.status === 401
        ? "Invalid API key — check Settings → AI."
        : err instanceof Error
          ? err.message
          : "Transformation failed";
    options.onError(message);
  }
}
