import clsx from "clsx";

/**
 * Display headline: clean ink type with a soft pink plate printed a touch off-register. The pink plate eases into
 * place when it mounts (give it a `key` to replay that when the text changes).
 */
export function Headline({ text, className }: { text: string; className?: string }) {
  return <span className={clsx("headline", className)}>{text}</span>;
}
