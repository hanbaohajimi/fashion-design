import { createContext } from "react";

export const ImageOverlayInteractionContext = createContext<
  ((active: boolean) => void) | null
>(null);
