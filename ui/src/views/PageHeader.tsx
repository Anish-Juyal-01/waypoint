import type { ReactNode } from "react";
import { Headline } from "../components/Headline";

/** Page title set like a zine cover line: big overprinted headline, a short standfirst, actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode; accent?: string }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b-2 border-dotted border-[var(--line-strong)] pb-5">
      <div>
        <h1 className="text-[clamp(40px,6vw,60px)]">
          <Headline text={title} />
        </h1>
        <p className="mt-2 max-w-[560px] text-[14.5px] text-fg-3">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
