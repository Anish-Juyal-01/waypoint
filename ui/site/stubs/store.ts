// Stand-in for the app's store on the website: the pals and meters read levels from here, and the page's
// scenes push a fake "what's playing" level in. Nothing talks to Windows.
type Flow = "output" | "input";
type LevelListener = (level: number) => void;

const listeners: Record<Flow, Set<LevelListener>> = { output: new Set(), input: new Set() };
const current: Record<Flow, number> = { output: 0, input: 0 };

export function subscribeLevel(flow: Flow, l: LevelListener): () => void {
  listeners[flow].add(l);
  l(current[flow]);
  return () => listeners[flow].delete(l);
}

export function pushLevel(flow: Flow, level: number) {
  current[flow] = level;
  listeners[flow].forEach((l) => l(level));
}
