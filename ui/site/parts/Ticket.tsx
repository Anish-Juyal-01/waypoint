import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Wordmark } from "../../src/components/Wordmark";
import { DOWNLOAD, INSTALL_GUIDE, REPO } from "./acts";

/**
 * The finale: a gig ticket whose stub is the download button. Clicking tears the stub off along the perforation,
 * then opens the release page.
 */
export function Ticket() {
  const stub = useAnimationControls();
  const reduce = useReducedMotion();
  const [torn, setTorn] = useState(false);

  const tear = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (reduce || torn || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setTorn(true);
    await stub.start({ rotate: [0, -4, 9], x: [0, -6, 26], y: [0, -10, 40], transition: { duration: 0.55, ease: [0.5, 0, 0.3, 1] } });
    window.location.href = DOWNLOAD;
    window.setTimeout(() => {
      stub.set({ rotate: 0, x: 0, y: 0 });
      setTorn(false);
    }, 1200);
  };

  return (
    <section className="mx-auto flex w-full max-w-[1100px] flex-col items-center px-4 py-24 md:px-8 md:py-32">
      <h2 className="headline text-center text-[clamp(2.4rem,5.4vw,4.2rem)]">Last call.</h2>
      <p className="mt-4 max-w-[44ch] text-center text-[1.05rem] leading-relaxed text-fg-2">
        One portable exe, no installer, no account. Unzip it, run it, rank your devices.
      </p>

      <div className="ticket mt-12">
        <div className="ticket-main">
          <div className="ticket-dots" aria-hidden />
          <Wordmark />
          <p className="mt-3 font-display text-[clamp(1.2rem,2.4vw,1.6rem)] font-extrabold leading-tight">Live on your desktop, every night.</p>
          <dl className="ticket-facts">
            <div>
              <dt>Venue</dt>
              <dd>Windows 10 and 11</dd>
            </div>
            <div>
              <dt>Door</dt>
              <dd>Free, MIT licence</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>about 60 MB zipped</dd>
            </div>
          </dl>
        </div>
        <motion.a href={DOWNLOAD} className="ticket-stub" onClick={tear} animate={stub} whileHover={reduce ? undefined : { rotate: 2, y: -3 }} whileTap={{ scale: 0.98 }}>
          <span className="ticket-admit">Admit one</span>
          <span className="ticket-exe">waypoint.exe</span>
          <span className="ticket-cta">Download</span>
        </motion.a>
      </div>

      <p className="mt-8 max-w-[60ch] text-center text-[0.95rem] leading-relaxed text-fg-3">
        Have the .NET 10 Desktop Runtime? The lite build on the same page is under 1 MB. Waypoint isn't code-signed yet, so
        Windows may ask once.{" "}
        <a className="link" href={INSTALL_GUIDE}>
          How to install
        </a>{" "}
        or{" "}
        <a className="link" href={REPO}>
          read the code
        </a>
        .
      </p>
    </section>
  );
}
