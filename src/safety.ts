// Error boundary that falls back to Steam's own UI. Adapted from Spindeck (BSD-3-Clause).
import React from "react";

const R: any = React;

class SafeBoundaryImpl extends R.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[DeckyXMB] falling back to Steam's UI after an error", error);
  }
  render() {
    const p: any = (this as any).props;
    return (this as any).state.failed ? p.fallback ?? null : p.children;
  }
}

export const SafeBoundary = SafeBoundaryImpl as unknown as (p: { fallback?: any; children?: any }) => any;
