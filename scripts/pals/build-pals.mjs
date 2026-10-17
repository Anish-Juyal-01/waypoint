// Waypoint's pixel cast — original creatures, drawn procedurally.
//
// Each creature is a 16×16 grid built from simple shapes (discs, rects, single pixels), wrapped in a 1px ink
// outline, then given a face. Faces are swapped per pose, so every creature gets the same set of clips:
//   idle (2 frames: rest + 1px bob), blink, sleep, cheer (happy face + hop), plus a few special poses.
//
// usage: node scripts/pals/build-pals.mjs ui/src/pals/data.ts [preview.json]
import fs from "node:fs";

const W = 16, H = 16;
const INK = "#17121f";

/* ── drawing ─────────────────────────────────────────── */

class Grid {
  constructor() {
    this.px = Array.from({ length: H }, () => Array(W).fill("."));
  }
  set(x, y, c) {
    if (x >= 0 && y >= 0 && x < W && y < H) this.px[y][x] = c;
    return this;
  }
  get(x, y) {
    return x >= 0 && y >= 0 && x < W && y < H ? this.px[y][x] : ".";
  }
  /** Filled ellipse centred on a pixel grid (cx, cy in pixel units, radii in pixels). */
  disc(cx, cy, rx, ry, c, keep = () => true) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = (x - cx) / (rx + 0.35), dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy <= 1 && keep(x, y)) this.set(x, y, c);
      }
    return this;
  }
  rect(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
    return this;
  }
  dots(list, c) {
    for (const [x, y] of list) this.set(x, y, c);
    return this;
  }
  /** Shade: recolour body pixels in the lowest `rows` rows of the shape. */
  shadeBottom(body, shade, rows = 2) {
    for (let x = 0; x < W; x++) {
      let seen = 0;
      for (let y = H - 1; y >= 0 && seen < rows; y--) {
        if (this.px[y][x] === body) {
          this.px[y][x] = shade;
          seen++;
        } else if (this.px[y][x] !== "." && this.px[y][x] !== shade) break;
      }
    }
    return this;
  }
  /** Every empty pixel touching the shape (4-neighbourhood) becomes ink. */
  outline() {
    const src = this.px.map((r) => r.slice());
    const filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && src[y][x] !== ".";
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (src[y][x] === "." && (filled(x + 1, y) || filled(x - 1, y) || filled(x, y + 1) || filled(x, y - 1))) this.px[y][x] = "k";
    return this;
  }
  clone() {
    const g = new Grid();
    g.px = this.px.map((r) => r.slice());
    return g;
  }
  rows() {
    return this.px.map((r) => r.join(""));
  }
}

/* ── faces ───────────────────────────────────────────── */

// Eyes are 2×2 at (x, y) top-left. Mouth is centred at (mx, my) (mx = left pixel of a 2px mouth).
const EYES = {
  open: (g, x, y) => g.dots([[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]], "k").set(x, y, "w"),
  closed: (g, x, y) => g.dots([[x, y + 1], [x + 1, y + 1]], "k"),
  happy: (g, x, y) => g.dots([[x, y + 1], [x + 1, y], [x + 2, y + 1]].map(([a, b]) => [a - 0, b]), "k"),
  wide: (g, x, y) => g.dots([[x, y - 1], [x + 1, y - 1], [x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]], "k").set(x, y - 1, "w"),
  side: (g, x, y) => g.dots([[x + 1, y], [x + 1, y + 1], [x, y + 1]], "k"),
};
const MOUTHS = {
  smile: (g, x, y) => g.dots([[x - 1, y], [x, y + 1], [x + 1, y + 1], [x + 2, y]], "k"),
  flat: (g, x, y) => g.dots([[x, y], [x + 1, y]], "k"),
  open: (g, x, y) => g.dots([[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]], "k").set(x, y + 1, "t"),
  small: (g, x, y) => g.set(x, y, "k"),
  wobble: (g, x, y) => g.dots([[x - 1, y + 1], [x, y], [x + 1, y + 1], [x + 2, y]], "k"),
};

/** Applies a face. spec: { l:[x,y], r:[x,y], m:[x,y], cheeks?:[[x,y],[x,y]] } */
function face(base, spec, eyes, mouth, opts = {}) {
  const g = base.clone();
  const happyOffset = eyes === "happy" ? -0 : 0;
  EYES[eyes](g, spec.l[0] + happyOffset, spec.l[1]);
  EYES[eyes](g, spec.r[0] + happyOffset, spec.r[1]);
  if (mouth) MOUTHS[mouth](g, spec.m[0], spec.m[1]);
  if (spec.cheeks && opts.cheeks !== false) g.dots(spec.cheeks, "c");
  if (opts.brows) g.dots([[spec.l[0] + 1, spec.l[1] - 2], [spec.l[0], spec.l[1] - 1], [spec.r[0], spec.r[1] - 2], [spec.r[0] + 1, spec.r[1] - 1]], "k");
  if (opts.look) {
    // pupils shifted right: redraw eyes as side-glance
    for (const e of [spec.l, spec.r]) {
      g.dots([[e[0], e[1]], [e[0] + 1, e[1]], [e[0], e[1] + 1], [e[0] + 1, e[1] + 1]], opts.lookBg ?? "b");
      EYES.side(g, e[0], e[1]);
    }
  }
  return g;
}

const shiftY = (rows, n) => (n < 0 ? [...rows.slice(-n), ...Array(-n).fill(".".repeat(W))] : [...Array(n).fill(".".repeat(W)), ...rows.slice(0, H - n)]);
const shiftX = (rows, n) => rows.map((r) => (n > 0 ? ".".repeat(n) + r.slice(0, W - n) : r.slice(-n) + ".".repeat(-n)));

/** Standard clip set from a body + face spec. */
function clips(base, spec, extra = {}) {
  const idle = face(base, spec, "open", "smile").rows();
  return {
    idle: [idle, idle, idle, shiftY(idle, -1)],
    blink: [face(base, spec, "closed", "smile").rows()],
    sleep: [face(base, spec, "closed", "flat", { cheeks: false }).rows()],
    cheer: [face(base, spec, "happy", "open").rows(), shiftY(face(base, spec, "happy", "open").rows(), -2)],
    worried: [face(base, spec, "open", "wobble", { brows: true }).rows()],
    alarm: (() => {
      const r = face(base, spec, "wide", "open").rows();
      return [shiftX(r, -1), shiftX(r, 1)];
    })(),
    ...extra,
  };
}

/* ── the cast ────────────────────────────────────────── */

const cast = {};
const add = (name, tag, palette, base, spec, fps = {}, extra) => {
  cast[name] = { w: W, h: H, tag, palette: { k: INK, w: "#ffffff", c: "#ff8fab", t: "#ff6b6b", ...palette }, frames: clips(base, spec, extra?.(base, spec)), fps: { idle: 2.5, cheer: 5, alarm: 10, ...fps } };
};

// SPROUT — a bean with a two-leaf sprout. Cheerful, always growing.
{
  const g = new Grid().disc(8, 10, 6, 5, "b").shadeBottom("b", "d").rect(8, 3, 8, 5, "g").disc(6, 3, 1.4, 0.6, "l").disc(10, 2, 1.4, 0.6, "l").outline();
  add("sprout", "A bean that just sprouted. Cheerful, always growing.", { b: "#7ed957", d: "#4caf50", g: "#2e7d32", l: "#b6f07a" }, g, { l: [5, 9], r: [10, 9], m: [7, 12], cheeks: [[4, 11], [12, 11]] });
}

// PUFF — a little cloud. Drifts off to sleep at the slightest chance.
{
  const g = new Grid().disc(5, 10, 3.6, 3, "b").disc(8, 8, 4, 4, "b").disc(11, 10, 3.6, 3, "b").rect(3, 10, 13, 12, "b").shadeBottom("b", "d").outline();
  add("puff", "A small cloud. Drifts off to sleep at the slightest chance.", { b: "#f4f1fb", d: "#cfc8e4" }, g, { l: [5, 9], r: [10, 9], m: [7, 11], cheeks: [[4, 11], [12, 11]] });
}

// OWLET — a round owl with ear tufts. Watches everything, misses nothing.
{
  const g = new Grid().disc(8, 9, 6, 6, "b").dots([[3, 2], [4, 3], [12, 2], [11, 3]], "b").disc(8, 12, 3, 2.4, "B").shadeBottom("b", "d", 1).outline();
  // big white eye patches drawn into the face spec below
  const eyes = g.clone().disc(6, 7.5, 1.6, 1.6, "w").disc(10, 7.5, 1.6, 1.6, "w");
  add(
    "owlet",
    "A round owl with ear tufts. Watches everything, misses nothing.",
    { b: "#a0703f", d: "#7a5230", B: "#ecd2a6", o: "#ffa63a" },
    eyes.dots([[8, 10], [8, 11]], "o"),
    { l: [5, 7], r: [9, 7], m: [7, 13] },
    {},
    (base, spec) => ({
      // owls don't smile: keep the beak, drop the mouth
      idle: (() => {
        const r = face(base, spec, "open", null).rows();
        return [r, r, r, shiftY(r, -1)];
      })(),
      blink: [face(base, spec, "closed", null).rows()],
      sleep: [face(base, spec, "closed", null).rows()],
      cheer: [face(base, spec, "happy", null).rows(), shiftY(face(base, spec, "happy", null).rows(), -2)],
      alarm: (() => {
        const r = face(base, spec, "wide", null).rows();
        return [shiftX(r, -1), shiftX(r, 1)];
      })(),
    }),
  );
}

// BEEPO — a boxy little robot with an antenna light.
{
  const g = new Grid().rect(3, 5, 12, 13, "b").shadeBottom("b", "d", 1).rect(4, 6, 11, 11, "s").rect(8, 2, 8, 4, "g").outline().set(8, 1, "r");
  add("beepo", "A boxy little robot. Its antenna blinks when it's thinking.", { b: "#b8c4d6", d: "#8794ab", s: "#2b3140", g: "#5d6578", r: "#ff5a4f", e: "#5ee7f7" }, g, { l: [5, 8], r: [9, 8], m: [7, 10] },
    { idle: 2 },
    (base) => {
      // screen face with cyan pixels instead of ink
      const screen = (eyesDown) => {
        const f = base.clone();
        f.dots([[5, 8], [6, 8], [9, 8], [10, 8]], "e");
        if (!eyesDown) f.dots([[5, 7], [6, 7], [9, 7], [10, 7]], "e");
        return f;
      };
      const idleA = screen(false).dots([[7, 10], [8, 10]], "e").rows();
      const idleB = screen(false).dots([[7, 10], [8, 10]], "e").rows().map((r, y) => (y === 1 ? r.replace("r", "e") : r));
      const happy = screen(true).dots([[5, 7], [10, 7], [6, 10], [7, 11], [8, 11], [9, 10]], "e").rows();
      const sleep = screen(true).dots([[7, 10], [8, 10]], "e").rows().map((r, y) => (y === 1 ? r.replace("r", "g") : r));
      return { idle: [idleA, idleA, idleB, idleA], blink: [sleep], sleep: [sleep], cheer: [happy, shiftY(happy, -2)] };
    });
}

// RADISH — a pink radish with a leafy top and a stubby root.
{
  const g = new Grid().disc(8, 10, 5, 4.6, "b").shadeBottom("b", "d").dots([[8, 15]], "d").rect(7, 3, 7, 5, "g").rect(9, 2, 9, 5, "g").dots([[6, 3], [5, 2], [10, 2], [11, 1], [8, 4]], "g").outline();
  add("radish", "A pink radish with a leafy top. Pulled up and pleased about it.", { b: "#ff6f91", d: "#d94f75", g: "#4caf50" }, g, { l: [5, 9], r: [10, 9], m: [7, 12] });
}

// SHROOM — a red-capped mushroom, face on the stalk.
{
  const g = new Grid().disc(8, 6, 7, 4.2, "r", (x, y) => y <= 7).rect(5, 8, 10, 14, "b").shadeBottom("b", "d", 1).dots([[5, 4], [6, 4], [10, 3], [11, 3], [12, 6], [3, 6], [8, 2]], "w").outline();
  add("shroom", "A red-capped mushroom. Quiet, patient, a little spotty.", { r: "#ff5a4f", b: "#f3e3c3", d: "#d9c49b" }, g, { l: [5, 10], r: [9, 10], m: [7, 13], cheeks: [] });
}

// SLIME — a wobbly blue slime with a shiny highlight.
{
  const g = new Grid().disc(8, 12, 7, 3.2, "b").disc(8, 9.5, 5, 4, "b").shadeBottom("b", "d").dots([[5, 7], [5, 8], [6, 7]], "h").outline();
  add("slime", "A wobbly blue slime. Squishes when it laughs.", { b: "#4fb3ff", d: "#2f86d9", h: "#c9ecff" }, g, { l: [5, 10], r: [10, 10], m: [7, 13], cheeks: [[4, 12], [12, 12]] });
}

// BUN — a white bunny with tall ears.
{
  const g = new Grid().disc(8, 11, 5, 4, "b").shadeBottom("b", "d", 1).rect(5, 2, 6, 7, "b").rect(10, 2, 11, 7, "b").dots([[6, 3], [6, 4], [6, 5], [10, 3], [10, 4], [10, 5]], "p").outline();
  add("bun", "A white bunny with tall ears. Hears every device connect.", { b: "#f7f4ff", d: "#d6d0ea", p: "#ffb3c7" }, g, { l: [5, 10], r: [10, 10], m: [7, 13] }, {}, (base, spec) => ({
    // bunny nose instead of the shared mouth
    ...(() => {
      const nose = (f) => f.dots([[8, 12]], "p");
      const idle = nose(face(base, spec, "open", null)).rows();
      const happy = nose(face(base, spec, "happy", null)).rows();
      return {
        idle: [idle, idle, idle, shiftY(idle, -1)],
        blink: [nose(face(base, spec, "closed", null)).rows()],
        sleep: [nose(face(base, spec, "closed", null)).rows()],
        cheer: [happy, shiftY(happy, -2)],
        worried: [nose(face(base, spec, "open", "wobble", { brows: true })).rows()],
      };
    })(),
  }));
}

// CHICK — a round yellow chick with a tuft.
{
  const g = new Grid().disc(8, 10, 5, 4.6, "b").shadeBottom("b", "d").dots([[8, 4], [8, 3], [9, 3]], "b").dots([[3, 11], [13, 11]], "d").outline().dots([[6, 15], [10, 15]], "o");
  add("chick", "A round yellow chick. Peeps when good things happen.", { b: "#ffd23f", d: "#e8b417", o: "#ff8a1f" }, g, { l: [5, 9], r: [10, 9], m: [7, 11] }, {}, (base, spec) => {
    const beak = (f) => f.dots([[7, 11], [8, 11]], "o");
    const idle = beak(face(base, spec, "open", null)).rows();
    const happy = beak(face(base, spec, "happy", null)).rows();
    return { idle: [idle, idle, idle, shiftY(idle, -1)], blink: [beak(face(base, spec, "closed", null)).rows()], sleep: [beak(face(base, spec, "closed", null)).rows()], cheer: [happy, shiftY(happy, -2)] };
  });
}

// JELLY — a violet jellyfish with wiggly tentacles.
{
  const bell = () => new Grid().disc(8, 7, 6, 4.6, "b", (x, y) => y <= 9).shadeBottom("b", "d", 1).outline();
  // Tentacles are drawn after the outline (1px strands, no ink) and sway: tips lean right, then left.
  const tentacles = (g, phase) => {
    for (const [i, x] of [4, 7, 9, 12].entries()) {
      const len = i % 2 ? 4 : 3;
      for (let y = 11; y < 11 + len; y++) {
        const lean = y === 10 + len ? (phase ? 1 : -1) : 0;
        g.set(x + lean, y, "d");
      }
    }
    return g;
  };
  const spec = { l: [5, 6], r: [10, 6], m: [7, 8] };
  const a = tentacles(bell(), 0), b = tentacles(bell(), 1);
  add("jelly", "A violet jellyfish. Floats along, tentacles waving.", { b: "#b48cff", d: "#8a62e0" }, a, spec, { idle: 3 }, () => ({
    idle: [face(a, spec, "open", "smile").rows(), face(b, spec, "open", "smile").rows()],
    cheer: [face(a, spec, "happy", "open").rows(), shiftY(face(b, spec, "happy", "open").rows(), -2)],
  }));
}

// FOX — an orange fox face with pointy ears and white cheeks.
{
  const g = new Grid()
    .disc(8, 10, 6, 4.6, "b")
    .dots([[3, 3], [3, 4], [4, 4], [3, 5], [4, 5], [5, 5], [12, 3], [12, 4], [11, 4], [12, 5], [11, 5], [10, 5]], "b")
    .dots([[4, 5], [11, 5]], "d")
    .rect(3, 12, 5, 13, "w")
    .rect(10, 12, 12, 13, "w")
    .shadeBottom("b", "d", 1)
    .outline();
  add("fox", "A little fox. Quick to notice when something changes.", { b: "#ff9a3c", d: "#d9701d" }, g, { l: [5, 9], r: [10, 9], m: [7, 13] }, {}, (base, spec) => {
    const nose = (f) => f.dots([[7, 12], [8, 12]], "k");
    const idle = nose(face(base, spec, "open", null)).rows();
    const happy = nose(face(base, spec, "happy", null)).rows();
    return { idle: [idle, idle, idle, shiftY(idle, -1)], blink: [nose(face(base, spec, "closed", null)).rows()], sleep: [nose(face(base, spec, "closed", null)).rows()], cheer: [happy, shiftY(happy, -2)] };
  });
}

// MIKEY — a walking microphone. Sings along to whatever your mic hears.
{
  const head = () => new Grid().disc(8, 6, 5, 5, "b").shadeBottom("b", "d", 1);
  // Grille only across the crown, so the face below stays readable.
  const grille = (g) => {
    for (const y of [2, 3]) for (let x = 5; x <= 11; x += 2) if (g.get(x + (y % 2), y) === "b") g.set(x + (y % 2), y, "d");
    return g;
  };
  const body = (g) => g.rect(7, 12, 9, 14, "h").rect(5, 11, 11, 11, "r");
  const base = body(grille(head())).outline();
  // clear grille dots where the face goes
  const spec = { l: [5, 6], r: [10, 6], m: [7, 9] };
  const clean = (g) => g;
  add("mikey", "A walking microphone. Sings along to whatever your mic hears.", { b: "#d5d9e2", d: "#a3a9b8", h: "#3b3f4a", r: "#ff5a4f" }, base, spec, { sing: 4, look: 1.5 }, () => {
    const f = (eyes, mouth, opts) => face(clean(base.clone()), spec, eyes, mouth, opts).rows();
    return {
      idle: [f("open", "smile"), f("open", "smile"), f("open", "smile"), shiftY(f("open", "smile"), -1)],
      blink: [f("closed", "smile")],
      sleep: [f("closed", "flat")],
      sing: [f("happy", "open"), shiftY(f("happy", "small"), -1)],
      look: [f("open", "small"), f("open", "small", { look: true })],
      hush: [f("closed", "flat")],
      cheer: [f("happy", "open"), shiftY(f("happy", "open"), -2)],
    };
  });
}

/* ── output ─────────────────────────────────────────── */

const [, , outTs, previewJson] = process.argv;
const header = `/* Waypoint pixel cast — original artwork.
   GENERATED by scripts/pals/build-pals.mjs; edit the generator, not this file. */

export interface CritterSpec {
  w: number;
  h: number;
  palette: Record<string, string>;
  /** clip name → frames; each frame is rows of palette keys ('.' = transparent). */
  frames: Record<string, string[][]>;
  /** clip name → frames per second (default 6). */
  fps: Record<string, number>;
  tag: string | null;
}

export const CRITTERS = ${JSON.stringify(cast)} as const satisfies Record<string, CritterSpec>;

export type CritterName = keyof typeof CRITTERS;
`;
if (outTs) fs.writeFileSync(outTs, header);
if (previewJson) fs.writeFileSync(previewJson, JSON.stringify(cast));
console.log(Object.keys(cast).length, "creatures:", Object.entries(cast).map(([n, s]) => `${n}(${Object.keys(s.frames).join("/")})`).join(" "));
