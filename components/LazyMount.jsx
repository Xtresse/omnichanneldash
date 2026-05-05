"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Defers rendering of children until the placeholder enters the viewport.
 * Used to keep the dashboard's first paint cheap — only the above-fold
 * sections render eagerly; below-fold heavy charts and tables wait until
 * the user actually scrolls within ~400px of them.
 *
 * IntersectionObserver-based, no scroll listeners, falls back to mounting
 * eagerly if IO isn't supported (rare on modern browsers but safe).
 *
 * Props:
 *   minHeight  — placeholder height while children are deferred so the
 *                page doesn't jank when content swaps in. Default 320px
 *                which covers most chart cells.
 *   rootMargin — IntersectionObserver rootMargin. Default "400px" so we
 *                start mounting roughly half a screen before the section
 *                actually scrolls into view, hiding any layout cost.
 */
export default function LazyMount({
  children,
  minHeight = 320,
  rootMargin = "400px",
  className = "",
}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    if (typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);

  return (
    <div ref={ref} className={className} style={{ minHeight: shown ? undefined : minHeight }}>
      {shown ? children : null}
    </div>
  );
}
