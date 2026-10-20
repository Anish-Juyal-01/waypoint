import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Flow } from "../bridge/protocol";
import { subscribeLevel } from "../store/store";

/* ───────────────────────── Sprite renderer ───────────────────────── */

type Palette = Record<string, string>;

const LINE = "var(--riso-line)";
const inkCache = new Map<string, string>();

/**
 * Re-inks an artwork colour for the risograph theme: by lightness it becomes the line ink, the paper, or one of
 * three ink plates (light = yellow, mid = pink, deep = blue). Colours that are already CSS values pass through.
 */
export function risoInk(color: string): string {
  if (!color.startsWith("#")) return color;
  let ink = inkCache.get(color);
  if (!ink) {
    const n = parseInt(color.slice(1, 7), 16);
    const l = (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
    ink = l < 0.2 ? LINE : l > 0.88 ? "var(--riso-paper)" : l > 0.62 ? "var(--riso-light)" : l > 0.38 ? "var(--riso-mid)" : "var(--riso-deep)";
    inkCache.set(color, ink);
  }
  return ink;
}

/**
 * Renders a pixel map (array of equal-length strings, '.' = transparent) as crisp SVG rects, re-inked in the riso
 * palette. Large sprites also get a faint second "plate" printed slightly off-register behind them.
 */
export const Sprite = memo(function Sprite({ map, palette, scale = 4, className, title }: { map: string[]; palette: Palette; scale?: number; className?: string; title?: string }) {
  const w = map[0].length;
  const h = map.length;
  const rects = useMemo(() => {
    const out: { x: number; y: number; w: number; c: string }[] = [];
    map.forEach((row, y) => {
      // Merge horizontal runs of the same colour to keep the DOM small.
      let x = 0;
      while (x < w) {
        const ch = row[x];
        if (ch === "." || !palette[ch]) {
          x++;
          continue;
        }
        let run = 1;
        while (x + run < w && row[x + run] === ch) run++;
        out.push({ x, y, w: run, c: risoInk(palette[ch]) });
        x += run;
      }
    });
    return out;
  }, [map, palette, w]);

  const svg = (
    <svg
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      className={`pixelated relative ${className ?? ""}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} style={{ fill: r.c }} />
      ))}
    </svg>
  );
  if (scale < 4) return svg;

  return (
    <span className="relative inline-block align-top leading-none" style={{ width: w * scale, height: h * scale }}>
      <svg
        aria-hidden
        width={w * scale}
        height={h * scale}
        viewBox={`0 0 ${w} ${h}`}
        className="riso-ghost pixelated absolute"
        style={{ left: scale * 0.5, top: scale * 0.35 }}
      >
        {rects.map((r, i) => (r.c === LINE ? null : <rect key={i} x={r.x} y={r.y} width={r.w} height={1} style={{ fill: "var(--ink-2)" }} />))}
      </svg>
      {svg}
    </span>
  );
});

/* ───────────────────────── Logo ───────────────────────── */

const LOGO = [
  "..LLLLLLLLLLLL..",
  ".LLLLLLLLLLLLLL.",
  "LLLLLLLLLLLLLLLL",
  "LLLLLLLLL#LLLLLL",
  "LLLLLLLLLL#LLLLL",
  "LLLLLLL#LLL#LLLL",
  "LLLLLLLL#LL#LLLL",
  "LLL##LLL#LL#LLLL",
  "LLL##LLL#LL#LLLL",
  "LLLLLLLL#LL#LLLL",
  "LLLLLLL#LLL#LLLL",
  "LLLLLLLLLL#LLLLL",
  "LLLLLLLLL#LLLLLL",
  "LLLLLLLLLLLLLLLL",
  ".LLLLLLLLLLLLLL.",
  "..LLLLLLLLLLLL..",
];

export function PixelLogo({ size = 20 }: { size?: number }) {
  return <Sprite map={LOGO} palette={{ L: "var(--color-lime)", "#": "var(--riso-line)" }} scale={size / 16} />;
}

/* ───────────────────────── The pal (mascot) ───────────────────────── */

// 16×15 base: a round blob wearing headphones. k=outline, b=body, B=body shade, h=headphones,
// w=eye highlight, c=cheek. Faces are patched per mood below.
const PAL_BASE = [
  ".....kkkkkk.....",
  "....khhhhhhk....",
  "...khkkkkkkhk...",
  "..khkkkkkkkkhk..",
  ".khkkbbbbbbkkhk.",
  "khhkbbbbbbbbkhhk",
  "khhkbbbbbbbbkhhk",
  "khhkbbbbbbbbkhhk",
  "khhkbbbbbbbbkhhk",
  "khhkbbbbbbbbkhhk",
  "kkkkbbbbbbbbkkkk",
  "...kbbbbbbbbk...",
  "...kBBBBBBBBk...",
  "....kkkkkkkk....",
  "....kk....kk....",
];

export type Mood = "idle" | "blink" | "dance" | "sleep" | "sad" | "surprised" | "muted";

function set(rows: string[][], r: number, c: number, ch: string) {
  rows[r][c] = ch;
}

function palFrame(mood: Mood): string[] {
  const g = PAL_BASE.map((r) => r.split(""));
  const eyesOpen = () => {
    set(g, 7, 5, "w"), set(g, 7, 6, "k"), set(g, 7, 9, "w"), set(g, 7, 10, "k");
    set(g, 8, 5, "k"), set(g, 8, 6, "k"), set(g, 8, 9, "k"), set(g, 8, 10, "k");
  };
  const eyesClosed = () => {
    set(g, 8, 5, "k"), set(g, 8, 6, "k"), set(g, 8, 9, "k"), set(g, 8, 10, "k");
  };
  const cheeks = () => {
    set(g, 9, 4, "c"), set(g, 9, 11, "c");
  };

  switch (mood) {
    case "blink":
      eyesClosed();
      cheeks();
      set(g, 10, 7, "k"), set(g, 10, 8, "k");
      break;
    case "dance": // eyes squeezed happy ^ ^, big smile
      set(g, 7, 5, "k"), set(g, 7, 10, "k"), set(g, 8, 4, "k"), set(g, 8, 6, "k"), set(g, 8, 9, "k"), set(g, 8, 11, "k");
      cheeks();
      set(g, 10, 6, "k"), set(g, 10, 9, "k"), set(g, 11, 7, "k"), set(g, 11, 8, "k");
      break;
    case "sleep":
      eyesClosed();
      set(g, 10, 7, "k");
      break;
    case "sad":
      eyesOpen();
      set(g, 10, 7, "k"), set(g, 10, 8, "k"), set(g, 11, 6, "k"), set(g, 11, 9, "k");
      break;
    case "surprised":
      eyesOpen();
      set(g, 6, 5, "w"), set(g, 6, 10, "w");
      set(g, 10, 7, "k"), set(g, 10, 8, "k"), set(g, 11, 7, "k"), set(g, 11, 8, "k");
      break;
    case "muted": // zipped mouth
      eyesOpen();
      for (let c = 6; c <= 9; c++) set(g, 10, c, "k");
      set(g, 10, 7, "w");
      break;
    default:
      eyesOpen();
      cheeks();
      set(g, 10, 7, "k"), set(g, 10, 8, "k");
  }

  return g.map((r) => r.join(""));
}

const FRAMES: Record<Mood, string[]> = {
  idle: palFrame("idle"),
  blink: palFrame("blink"),
  dance: palFrame("dance"),
  sleep: palFrame("sleep"),
  sad: palFrame("sad"),
  surprised: palFrame("surprised"),
  muted: palFrame("muted"),
};

const PALETTES: Record<Flow, Palette> = {
  output: { k: LINE, b: "var(--riso-light)", B: "color-mix(in srgb, var(--riso-light) 70%, var(--riso-mid))", h: "var(--riso-deep)", w: "var(--riso-paper)", c: "var(--riso-mid)" },
  input: { k: LINE, b: "var(--riso-mid)", B: "color-mix(in srgb, var(--riso-mid) 70%, var(--riso-deep))", h: "var(--riso-deep)", w: "var(--riso-paper)", c: "var(--riso-light)" },
};

const QUIET_LEVEL = 0.02;
const SLEEP_AFTER_MS = 12_000;

/**
 * Waypoint's resident pixel creature. It reacts to the real audio level of its flow:
 * bobs to the beat while sound plays, dozes off after a stretch of silence, zips its mouth when muted,
 * looks sad when there's no device, and does a startled hop whenever `hopKey` changes (a switch). While `crying` is
 * set (its device was just unplugged), it sobs with tears running down.
 */
export function Pal({
  flow = "output",
  scale = 4,
  hopKey,
  muted,
  absent,
  crying,
  className,
}: {
  flow?: Flow;
  scale?: number;
  hopKey?: string | null;
  muted?: boolean;
  absent?: boolean;
  crying?: boolean;
  className?: string;
}) {
  const [mood, setMood] = useState<Mood>("idle");
  const [hopping, setHopping] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();
  const reduce = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const lastHop = useRef(hopKey);

  // Level-driven behaviour (no React re-render per frame: the bob is written straight to the DOM).
  useEffect(() => {
    if (absent || muted) {
      setMood(absent ? "sad" : "muted");
      if (body.current) body.current.style.transform = "";
      return;
    }

    let level = 0;
    let smooth = 0;
    let lastSound = performance.now();
    let raf = 0;
    let current: Mood = "idle";
    const unsubscribe = subscribeLevel(flow, (v) => (level = v));
    const apply = (m: Mood) => {
      if (m !== current) {
        current = m;
        setMood(m);
      }
    };

    const tick = (t: number) => {
      smooth += (Math.sqrt(level) - smooth) * (level > smooth ? 0.5 : 0.12);
      if (level > QUIET_LEVEL) lastSound = t;
      const asleep = t - lastSound > SLEEP_AFTER_MS;
      const dancing = smooth > 0.18;
      if (current !== "blink" && current !== "surprised") apply(asleep ? "sleep" : dancing ? "dance" : "idle");
      if (body.current && !reduce) {
        // Continuous bob and squash that follow the music (the level is already low-passed above).
        const lift = dancing ? smooth * 3.5 * (0.6 + 0.4 * Math.abs(Math.sin(t / 190))) : 0;
        const squash = dancing ? 1 - 0.06 * Math.max(0, Math.sin(t / 95)) : 1;
        body.current.style.transform = `translateY(${-lift * scale}px) scale(${2 - squash}, ${squash})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Blink at random intervals while idle.
    let blinkTimer = 0;
    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        if (current === "idle") {
          apply("blink");
          window.setTimeout(() => apply("idle"), 140);
        }
        scheduleBlink();
      }, 2200 + Math.random() * 3200);
    };
    scheduleBlink();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(blinkTimer);
      unsubscribe();
    };
  }, [flow, muted, absent, scale, reduce]);

  // Startled hop when the device changes.
  useEffect(() => {
    if (lastHop.current === hopKey) return;
    lastHop.current = hopKey;
    if (reduce || !hopKey) return;
    setHopping(true);
    setMood("surprised");
    controls
      .start({
        y: [0, -6 * scale, 0, -2 * scale, 0],
        scaleX: [1, 0.9, 1.12, 0.96, 1],
        scaleY: [1, 1.12, 0.86, 1.04, 1],
        transition: { duration: 0.7, times: [0, 0.35, 0.62, 0.8, 1], ease: [0.22, 1, 0.36, 1] },
      })
      .then(() => {
        setHopping(false);
        setMood("idle");
      });
  }, [hopKey, controls, scale, reduce]);

  return (
    <div className={`relative inline-block ${className ?? ""}`} style={{ width: 16 * scale, height: 15 * scale }}>
      <motion.div animate={controls} style={{ originY: 1 }} className="absolute inset-0">
        <div ref={body} style={{ transformOrigin: "50% 100%", willChange: "transform" }}>
          <span className={crying ? "lb-sob relative block" : "relative block"}>
            <Sprite map={FRAMES[crying ? "sad" : hopping ? "surprised" : mood]} palette={PALETTES[flow]} scale={scale} />
            {crying && (
              <>
                <i className="tear tear-l" style={{ top: "50%", width: scale, height: 1.8 * scale }} />
                <i className="tear tear-r" style={{ top: "50%", width: scale, height: 1.8 * scale }} />
              </>
            )}
          </span>
        </div>
      </motion.div>
      <AnimatePresence>{mood === "sleep" && !reduce && <Zzz scale={scale} />}</AnimatePresence>
      <AnimatePresence>
        {crying ? (
          <motion.span
            key="cry"
            initial={{ opacity: 0, y: 4, scale: 0.6, rotate: -6 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: -4 }}
            exit={{ opacity: 0 }}
            className="font-pixel absolute whitespace-nowrap rounded-[8px] bg-fg px-2 py-0.5 text-ink-900"
            style={{ right: -6 * scale, top: -5 * scale, fontSize: 1.5 * scale }}
          >
            it's gone!
          </motion.span>
        ) : hopping && (
          <motion.span
            initial={{ opacity: 0, y: 4, scale: 0.6 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="font-pixel absolute text-tx-sun"
            style={{ right: -2 * scale, top: -3 * scale, fontSize: 3.5 * scale }}
          >
            !
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Zzz({ scale }: { scale: number }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute" style={{ right: -3 * scale, top: -4 * scale }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="font-pixel absolute text-fg-2"
          style={{ fontSize: (2.2 + i * 0.7) * scale }}
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{ opacity: [0, 1, 0], x: [0, scale * 2, scale * 4], y: [0, -scale * 4, -scale * 8] }}
          transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeInOut" }}
        >
          z
        </motion.span>
      ))}
    </motion.div>
  );
}

/* ───────────────────────── Pixel VU meter ───────────────────────── */

/**
 * Segmented level meter fed by the real peak meter. Lime → sun → coral, with a falling peak-hold pixel.
 * Updates the DOM directly from requestAnimationFrame.
 */
export function PixelVu({ flow, active, segments = 24, className }: { flow: Flow; active: boolean; segments?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cells = [...el.children] as HTMLElement[];
    if (!active) {
      cells.forEach((c) => (c.dataset.on = "0"));
      return;
    }

    let level = 0;
    let smooth = 0;
    let peak = 0;
    let peakHeld = 0;
    let raf = 0;
    const unsubscribe = subscribeLevel(flow, (v) => (level = v));
    const tick = (t: number) => {
      const target = Math.min(1, Math.sqrt(Math.max(0, level)));
      smooth += (target - smooth) * (target > smooth ? 0.55 : 0.1);
      const lit = Math.round(smooth * segments);
      if (lit >= peak) {
        peak = lit;
        peakHeld = t;
      } else if (t - peakHeld > 700) {
        peak = Math.max(lit, peak - 1);
        peakHeld = t - 620;
      }
      for (let i = 0; i < cells.length; i++) cells[i].dataset.on = i < lit ? "1" : i === peak - 1 && peak > 0 ? "p" : "0";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [flow, active, segments]);

  return (
    <div ref={ref} aria-hidden className={`flex items-end gap-[3px] ${className ?? ""}`}>
      {Array.from({ length: segments }, (_, i) => {
        const zone = i >= segments * 0.85 ? "coral" : i >= segments * 0.65 ? "sun" : "lime";
        return <span key={i} data-zone={zone} data-on="0" className="vu-cell" />;
      })}
    </div>
  );
}

/** Tiny 5-cell meter for list rows and the sidebar. */
export function MiniVu({ flow, active, className }: { flow: Flow; active: boolean; className?: string }) {
  return <PixelVu flow={flow} active={active} segments={5} className={`vu-mini ${className ?? ""}`} />;
}

/* ───────────────────────── Bursts & sparkles ───────────────────────── */

const BURST_COLORS = ["var(--color-lime)", "var(--color-violet)", "var(--color-sun)", "var(--color-lime)", "var(--color-sky)", "var(--color-coral)"];

/**
 * Square pixels that pop outward from the centre of the parent whenever `trigger` changes to a non-null value
 * (the value present on first render doesn't fire, so pages don't burst on load).
 */
export function PixelBurst({ trigger, count = 10, distance = 34 }: { trigger: string | number | null | undefined; count?: number; distance?: number }) {
  const first = useRef(true);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (trigger == null) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setKey((k) => k + 1);
  }, [trigger]);

  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const d = distance * (0.7 + Math.random() * 0.5);
        return { x: Math.cos(angle) * d, y: Math.sin(angle) * d, c: BURST_COLORS[i % BURST_COLORS.length], s: 3 + Math.round(Math.random() * 2) };
      }),
    // new random layout per burst
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, count, distance],
  );

  if (key === 0) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-10" key={key}>
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{ width: p.s, height: p.s, background: p.c, left: -p.s / 2, top: -p.s / 2 }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
    </span>
  );
}
