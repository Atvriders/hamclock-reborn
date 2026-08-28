import { useState, useEffect } from 'react';

/**
 * Reports whether the viewport is narrower than `breakpoint`.
 *
 * NOTE: this hook does NOT gate the dashboard. Every viewport renders the full
 * Operator's Bench; the layout tier is chosen in CSS (see styles/layout.css).
 * Use this only for genuinely behavioural differences (e.g. defaulting a map
 * control to collapsed), never to withhold content.
 */
export function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    handler(mql);
    // Safari < 14 only supports the deprecated addListener API.
    if (mql.addEventListener) {
      mql.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
      return () => mql.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
    }
    mql.addListener(handler as (e: MediaQueryListEvent) => void);
    return () => mql.removeListener(handler as (e: MediaQueryListEvent) => void);
  }, [query]);

  return isMobile;
}
