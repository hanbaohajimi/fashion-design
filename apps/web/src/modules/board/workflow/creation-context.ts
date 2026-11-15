import { createContext } from "react";

export const CreationWorkspaceContext = createContext<{
  openFunctions: () => void;
  functionsOpen: boolean;
  registerObjects: (open: () => void) => () => void;
  createNode: (kind: "image" | "text" | "video") => void;
  openResources: (tab: "upload" | "existing") => void;
  creating: boolean;
} | null>(null);
