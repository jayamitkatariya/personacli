const PREF_KEY = "persona.sound-effects";

let ctx: AudioContext | null = null;

export function soundsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PREF_KEY) !== "off";
}

export function setSoundsEnabled(on: boolean) {
  localStorage.setItem(PREF_KEY, on ? "on" : "off");
}

function getCtx(): AudioContext | null {
  if (!soundsEnabled()) return null;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return null;
  }
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(
  freq: number,
  opts: { delay?: number; dur?: number; gain?: number; slideTo?: number } = {},
) {
  const ac = getCtx();
  if (!ac) return;
  const { delay = 0, dur = 0.12, gain = 0.02, slideTo } = opts;
  const t0 = ac.currentTime + delay;
  try {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const lp = ac.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(lp);
    lp.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    // audio unavailable — ignore
  }
}

export const sounds = {
  /** Faint click — sending a chat message. */
  tick() {
    blip(1600, { dur: 0.05, gain: 0.008 });
  },
  /** Soft pop — creating a file or task. */
  pop() {
    blip(520, { dur: 0.08, gain: 0.02, slideTo: 940 });
  },
  /** Gentle two-note chime — task completed. */
  chime() {
    blip(659.25, { dur: 0.22, gain: 0.02 });
    blip(880, { delay: 0.09, dur: 0.26, gain: 0.016 });
  },
  /** Warm rising arpeggio — journal entry logged. */
  success() {
    blip(523.25, { dur: 0.18, gain: 0.018 });
    blip(659.25, { delay: 0.07, dur: 0.2, gain: 0.016 });
    blip(783.99, { delay: 0.14, dur: 0.3, gain: 0.014 });
  },
  /** Single soft note — chat reply finished. */
  done() {
    blip(987.77, { dur: 0.24, gain: 0.014 });
  },
  /** Short soft click — a note was saved (⌘S). */
  save() {
    blip(740, { dur: 0.07, gain: 0.012 });
    blip(988, { delay: 0.04, dur: 0.09, gain: 0.008 });
  },
};
