import { Critter } from "../../src/pals/Critter";
import type { CritterName } from "../../src/pals/data";

/**
 * The pals left behind where a stage used to stand: worried faces, tears running down, and a line each about the
 * stage that just fell. Shown inside the etched outline the stage leaves in its card.
 */
export function LeftBehind({ pals, scale = 4 }: { pals: { name: CritterName; says: string }[]; scale?: number }) {
  return (
    <div className="left-behind" aria-hidden>
      {pals.map((p, i) => (
        <div key={p.name} className="lb-pal" style={{ "--i": i } as React.CSSProperties}>
          <span className="amp-bubble lb-says">{p.says}</span>
          <span className="lb-sob">
            <Critter name={p.name} clip="worried" scale={scale} blink={false} />
            <i className="tear tear-l" />
            <i className="tear tear-r" />
          </span>
        </div>
      ))}
    </div>
  );
}
