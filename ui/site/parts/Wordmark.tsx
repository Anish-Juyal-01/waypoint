const LETTERS = "waypoint".split("");

/**
 * The website's wordmark: plum letters with a pink offset shadow on a sunflower badge, each letter swaying to its
 * own beat. `bare` drops the badge (for places that are already yellow, like the ticket).
 */
export function Wordmark({ size = 28, bare = false }: { size?: number; bare?: boolean }) {
  return (
    <span className={`wordmark-m ${bare ? "is-bare" : ""}`} style={{ fontSize: size }} role="img" aria-label="Waypoint">
      {LETTERS.map((ch, i) => (
        <span key={i} aria-hidden className="wmm-drop" style={{ "--i": i } as React.CSSProperties}>
          <span className="wmm-letter">{ch}</span>
        </span>
      ))}
    </span>
  );
}
