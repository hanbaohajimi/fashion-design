export type AssistantPresentation = "floating" | "docked";
export interface AssistantBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WorkspaceSize {
  width: number;
  height: number;
}

export const ASSISTANT_WINDOW = {
  width: 400,
  height: 640,
  minWidth: 360,
  maxWidth: 600,
  minHeight: 440,
  gap: 16,
  canvasMin: 640,
  separator: 6,
} as const;

export function constrainAssistantBounds(
  bounds: AssistantBounds,
  size: WorkspaceSize,
): AssistantBounds {
  const gap = Math.min(ASSISTANT_WINDOW.gap, size.width / 4, size.height / 4);
  const availableWidth = Math.max(0, size.width - gap * 2);
  const availableHeight = Math.max(0, size.height - gap * 2);
  const width = Math.min(
    availableWidth,
    Math.max(
      ASSISTANT_WINDOW.minWidth,
      Math.min(ASSISTANT_WINDOW.maxWidth, bounds.width),
    ),
  );
  const height = Math.min(
    availableHeight,
    Math.max(ASSISTANT_WINDOW.minHeight, bounds.height),
  );
  return {
    width,
    height,
    x: Math.max(gap, Math.min(size.width - gap - width, bounds.x)),
    y: Math.max(gap, Math.min(size.height - gap - height, bounds.y)),
  };
}

export function initialAssistantBounds(size: WorkspaceSize): AssistantBounds {
  return constrainAssistantBounds(
    {
      x: size.width - ASSISTANT_WINDOW.width - ASSISTANT_WINDOW.gap,
      y: size.height - ASSISTANT_WINDOW.height - ASSISTANT_WINDOW.gap,
      width: ASSISTANT_WINDOW.width,
      height: ASSISTANT_WINDOW.height,
    },
    size,
  );
}

export type AssistantResizeEdge =
  "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export function resizeAssistantBounds(
  start: AssistantBounds,
  edge: AssistantResizeEdge,
  dx: number,
  dy: number,
  size: WorkspaceSize,
): AssistantBounds {
  const gap = ASSISTANT_WINDOW.gap;
  const right = start.x + start.width,
    bottom = start.y + start.height;
  const maxWidth = Math.min(
    ASSISTANT_WINDOW.maxWidth,
    edge.includes("w") ? right - gap : size.width - gap - start.x,
  );
  const maxHeight = edge.includes("n")
    ? bottom - gap
    : size.height - gap - start.y;
  const width = Math.min(
    maxWidth,
    Math.max(
      Math.min(ASSISTANT_WINDOW.minWidth, maxWidth),
      start.width + (edge.includes("w") ? -dx : edge.includes("e") ? dx : 0),
    ),
  );
  const height = Math.min(
    maxHeight,
    Math.max(
      Math.min(ASSISTANT_WINDOW.minHeight, maxHeight),
      start.height + (edge.includes("n") ? -dy : edge.includes("s") ? dy : 0),
    ),
  );
  return constrainAssistantBounds(
    {
      width,
      height,
      x: edge.includes("w") ? right - width : start.x,
      y: edge.includes("n") ? bottom - height : start.y,
    },
    size,
  );
}
