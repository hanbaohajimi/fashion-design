"use client";

import { createContext, useContext } from "react";

/** A canvas may stay mounted while the user visits another workspace view. */
export const CanvasMediaActivity = createContext(true);
export const useCanvasMediaActivity = () => useContext(CanvasMediaActivity);
