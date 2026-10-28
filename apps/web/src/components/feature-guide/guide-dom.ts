import { GUIDE_DEFINITIONS, guideStepCopy, type GuideSurface, type ResolvedGuideStep } from "./guide-model";

export function hasGuideLayout(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[inert],[hidden],[aria-hidden="true"]')) return false;
  const box = element.getBoundingClientRect();
  if (box.width < 2 || box.height < 2 || !element.getClientRects().length) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
  }
  return true;
}

export function guidePageRoot(surface: GuideSurface): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(`[data-guide-page="${surface}"][data-guide-ready="true"]`)].find(hasGuideLayout) ?? null;
}

export function resolveGuideSteps(surface: GuideSurface): ResolvedGuideStep[] {
  return GUIDE_DEFINITIONS[surface].steps.flatMap(step => {
    const candidates = step.anchors.flatMap(anchor => [...document.querySelectorAll<HTMLElement>(`[data-guide="${anchor}"]`)]).filter(element =>
      hasGuideLayout(element) && !element.matches(':disabled,[aria-disabled="true"]') && !element.closest('[data-feature-guide]'),
    );
    // Prefer the visible instance, rather than a hidden mobile/desktop duplicate.
    const target = candidates.find(element => {
      const box = element.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
    }) ?? candidates[0];
    if (!target) return [];
    const copy = guideStepCopy(surface, step, {
      variant: target.dataset.guideVariant,
      moduleName: target.dataset.guideTitle,
      hasObjectSwitcher: target.dataset.guideSwitcher === "true",
      hasRevision: target.dataset.guideRevision === "true",
    });
    return [{ ...step, ...copy, target }];
  });
}

export function hasGuideBlocker(): boolean {
  return [...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"],[data-popup-kind]')].some(element =>
    !element.closest("[data-feature-guide]") && hasGuideLayout(element),
  );
}

export function isGuideInputFocused(): boolean {
  return document.activeElement instanceof HTMLElement && Boolean(document.activeElement.closest('input,textarea,select,[contenteditable="true"]'));
}

export function guideLayoutSignature(steps: readonly ResolvedGuideStep[]): string {
  return steps.map(step => {
    const box = step.target.getBoundingClientRect();
    return `${step.id}:${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
  }).join("|");
}
