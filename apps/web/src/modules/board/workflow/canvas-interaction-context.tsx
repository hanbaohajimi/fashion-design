import { createContext, useContext } from "react";
import type { TLShapeId } from "tldraw";
export const CanvasInteractionContext = createContext<{
  open: (shapeId: TLShapeId) => void;
} | null>(null);
export const useCanvasInteraction = () => useContext(CanvasInteractionContext);
