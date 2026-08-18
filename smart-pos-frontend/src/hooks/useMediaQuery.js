import { useEffect, useState } from 'react';

// Lets a component branch its rendered DOM structure (not just CSS) on the
// current breakpoint — e.g. the sidebar's persisted rail-collapsed flag must
// only ever visually collapse on desktop, never the mobile drawer, and pure
// Tailwind `lg:` classes can't express "render different markup below lg."
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handleChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
