import { PixelLogo } from "./Pixel";

/** The Waypoint mark: a pixel source dot emitting two echo arcs on a lime tile. */
export function Logo({ size = 24 }: { size?: number }) {
  return <PixelLogo size={size} />;
}
