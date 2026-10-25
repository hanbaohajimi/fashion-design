"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface TooltipScope {
  warm(): boolean;
  open(id: string, close: () => void): void;
  close(id: string): void;
}
function createScope(): TooltipScope {
  let closedAt = -Infinity;
  let active: { id: string; close: () => void } | null = null;
  return {
    warm: () => active !== null || Date.now() - closedAt < 300,
    open: (id, close) => {
      if (active?.id !== id) active?.close();
      active = { id, close };
    },
    close: (id) => {
      if (active?.id === id) {
        active = null;
        closedAt = Date.now();
      }
    },
  };
}
const Context = createContext<TooltipScope | null>(null);
export function TooltipGroup({ children }: { readonly children: ReactNode }) {
  const [scope] = useState(createScope);
  return <Context.Provider value={scope}>{children}</Context.Provider>;
}
export function useTooltipGroup() {
  return useContext(Context);
}
