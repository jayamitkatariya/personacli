import { useEffect, useMemo, useState } from "react";

const COLORS = ["#60a5fa", "#a78bfa", "#f472b6", "#fbbf24", "#34d399"];

interface Piece {
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  w: number;
  h: number;
  color: string;
  round: boolean;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePieces(seed: number): Piece[] {
  const rand = mulberry32(seed * 7919 + 1);
  const n = 26;
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n + rand() * 0.6;
    const dist = 95 + rand() * 130;
    const round = rand() < 0.3;
    pieces.push({
      dx: Math.cos(angle) * dist * (0.7 + rand() * 0.6),
      dy: Math.sin(angle) * dist * (0.5 + rand() * 0.8) + 70 + rand() * 90,
      rot: -260 + rand() * 520,
      delay: rand() * 0.12,
      w: 3 + (rand() < 0.35 ? 0 : 1),
      h: round ? 4 : 7 + rand() * 4,
      color: COLORS[Math.floor(rand() * COLORS.length)] ?? "#60a5fa",
      round,
    });
  }
  return pieces;
}

/** A soft, brief confetti burst. Rendered once per trigger, self-cleaning. */
export default function ConfettiBurst({ count }: { count: number }) {
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (count === 0) return;
    setSeed(count);
    const t = setTimeout(() => setSeed(0), 1900);
    return () => clearTimeout(t);
  }, [count]);

  const pieces = useMemo(() => (seed === 0 ? [] : makePieces(seed)), [seed]);
  if (pieces.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80]" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              left: "50%",
              top: "40%",
              width: p.w,
              height: p.h,
              borderRadius: p.round ? "9999px" : "2px",
              background: p.color,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              "--rot": `${p.rot}deg`,
              "--delay": `${p.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
