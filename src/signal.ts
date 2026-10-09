import { useEffect, useState } from "react";

/** A module's "something changed" signal: notify() re-renders every component that use()s it. */
export function signal() {
  const listeners = new Set<() => void>();
  let changes = 0;
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  return {
    notify: () => {
      changes++;
      listeners.forEach((l) => l());
    },
    subscribe,
    /** Re-renders on each change; returns a counter that changes with it. */
    use(): number {
      const [n, force] = useState(0);
      const seen = changes; // (as of the first render)
      useEffect(() => {
        const stop = subscribe(() => force((v) => v + 1));
        // A change between the first render and now (a fast reply, before this listened) would otherwise be missed.
        if (changes !== seen) force((v) => v + 1);
        return stop;
      }, []);
      return n;
    },
  };
}
