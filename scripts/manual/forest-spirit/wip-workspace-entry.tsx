/** Manual-browser entry only. Not imported by any app route or production component. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ForestSpiritResourceHost } from "../../../apps/web/src/modules/forest-spirit/ForestSpiritResourceHost";
import { cubismResourceDependencies } from "../../../apps/web/src/modules/forest-spirit/cubism-resource-renderer";
import { SpiritInteraction } from "../../../apps/web/src/modules/forest-spirit/spirit-interaction";
import type { SpiritRenderer, SpiritRendererFactory } from "../../../apps/web/src/modules/forest-spirit/spirit-contract";
import { createReviewSpiritRenderer, reviewSpiritHostResources } from "./review-spirit-resources";

interface WipConfig {
  status: "diagnostic-candidate";
  productionApproval: false;
  apiMode: "explicit-business-fixture";
  userId: string;
  projectId: string;
  conversationId: string;
  bridgeMode?: "toolbar" | "production-callback";
  manifestUrl: string;
}
interface DiagnosticFiber {
  child?: DiagnosticFiber | null;
  sibling?: DiagnosticFiber | null;
  return?: DiagnosticFiber | null;
  type?: unknown;
  stateNode?: { current?: DiagnosticFiber };
  memoizedProps?: Record<string, unknown>;
}
interface ModelObservation {
  getParameterCount(): number;
  getParameterId(index: number): { getString(): string };
  getParameterValueByIndex(index: number): number;
  getParameterDefaultValue(index: number): number;
  getDrawableCount(): number;
  getDrawableId(index: number): { getString(): string };
}
interface ObservedRenderer extends SpiritRenderer {
  user?: { getModel(): ModelObservation };
  draw(): void;
  disposed: boolean;
  current?: string;
  paused: boolean;
  raf: number;
}
type EventRecord = { event: string; time: number } & Record<string, unknown>;
interface WipProof {
  status: string;
  events: EventRecord[];
  snapshot(): Record<string, unknown>;
  unmount(): void;
}
declare global { interface Window { forestSpiritWip?: WipProof } }

export async function mountWipSurface(config: WipConfig) {
  if (config.status !== "diagnostic-candidate" || config.productionApproval !== false || config.apiMode !== "explicit-business-fixture") throw new Error("Explicit WIP/fixture scope required");
  const hostResources = reviewSpiritHostResources(config.manifestUrl);
  if (window.forestSpiritWip) window.forestSpiritWip.unmount();
  const section = document.querySelector<HTMLElement>('section[aria-label="设计工作流画布"]');
  const panel = document.querySelector<HTMLElement>('aside[aria-label="设计助手"]');
  if (!section || !panel) throw new Error("Existing workspace and complete assistant must already be mounted");
  const existingPanel = panel;
  const bridgeMode = config.bridgeMode ?? "toolbar";
  const bridgeDifference = bridgeMode === "production-callback"
    ? "Manual-only lookup invokes the actual mounted ForestSpiritAssistant onOpenChat prop, including its existing focus request. Shared Host/resource loading is real; the separate review policy grants no production approval."
    : "Calls the existing toolbar button; unlike the production spirit callback this button does not increment assistantFocusRequest. Final production focus path remains separate.";
  function currentProductionBindings() {
    // Read-only React-version-sensitive diagnostic. Never fabricate a callback,
    // traverse hook state, modify a fiber, or add this to production code.
    const key = Object.keys(section as HTMLElement).find(key => key.startsWith("__reactFiber$"));
    if (!key) throw new Error("Mounted production React fiber was not found");
    const start = (section as unknown as Record<string, DiagnosticFiber>)[key];
    if (!start) throw new Error("Mounted production React fiber was removed");
    let node: DiagnosticFiber = start;
    while (node.return) node = node.return;
    const currentRoot = node.stateNode?.current;
    if (!currentRoot) throw new Error("Current production React root was not found");
    const found = { assistant: [] as DiagnosticFiber[], panel: [] as DiagnosticFiber[] }, pending = [currentRoot];
    let visited = 0;
    while (pending.length) {
      const fiber = pending.pop(); if (!fiber) break;
      if (++visited > 30000) throw new Error("Production fiber diagnostic traversal bound exceeded");
      const name = typeof fiber.type === "function" ? fiber.type.name : null;
      if (name === "ForestSpiritAssistant" && fiber.memoizedProps?.projectId === config.projectId) found.assistant.push(fiber);
      if (name === "WorkflowAssistantPanel" && fiber.memoizedProps?.projectId === config.projectId) found.panel.push(fiber);
      if (fiber.child) pending.push(fiber.child);
      if (fiber.sibling) pending.push(fiber.sibling);
    }
    if (found.assistant.length !== 1 || found.panel.length !== 1) throw new Error("Production callback/Panel identity is missing or ambiguous");
    const assistant = found.assistant[0]?.memoizedProps, panelProps = found.panel[0]?.memoizedProps;
    if (!assistant || !panelProps || typeof assistant.onOpenChat !== "function" || assistant.conversationId !== config.conversationId || typeof panelProps.focusRequest !== "number") throw new Error("Production callback identities or focus counter do not match this fixture session");
    return { callback: assistant.onOpenChat as () => void, projectId: assistant.projectId, conversationId: assistant.conversationId, chatOpen: assistant.chatOpen, focusRequest: panelProps.focusRequest };
  }
  if (bridgeMode === "production-callback") currentProductionBindings();
  const mount = document.createElement("div"); mount.dataset.realSpiritWipMount = ""; mount.style.display = "contents"; section.append(mount);
  const badge = document.createElement("div"); badge.dataset.realSpiritWipBanner = "";
  badge.textContent = "真实 Live2D WIP · 美术/动作未验收 · 业务 API 为 fixture";
  badge.style.cssText = "position:fixed;left:12px;bottom:8px;z-index:100000;background:#fff3ce;color:#392f12;border:1px solid #806a2d;padding:5px 8px;font:12px sans-serif;max-width:calc(100vw - 40px);pointer-events:none";
  document.body.append(badge);
  const root = createRoot(mount), events: EventRecord[] = [];
  let current: ObservedRenderer | undefined, drawCount = 0, disposed = false;
  const record = (event: string, detail: Record<string, unknown> = {}) => events.push({ event, time: performance.now(), ...detail });
  // Observe this isolated bundle's real controller without changing decisions.
  const originalEnter = SpiritInteraction.prototype.enter, originalLeave = SpiritInteraction.prototype.leave, originalVisibility = SpiritInteraction.prototype.setVisible;
  const controllerState = (controller: SpiritInteraction) => {
    const fields = controller as unknown as Record<string, unknown>;
    return Object.fromEntries(["enabled", "reducedMotion", "hoverInside", "suppressHover", "hoverPlaying", "lastHover", "hasShown"].map(key => [key, fields[key]]));
  };
  SpiritInteraction.prototype.enter = function () { record("controller-enter", { before: controllerState(this) }); originalEnter.call(this); };
  SpiritInteraction.prototype.leave = function () { record("controller-leave", { before: controllerState(this) }); originalLeave.call(this); };
  SpiritInteraction.prototype.setVisible = function (...args) { originalVisibility.apply(this, args); record("controller-visible", { args, after: controllerState(this) }); };
  const pointerUp = (event: PointerEvent) => record("pointerup", { x: event.clientX, y: event.clientY, type: event.pointerType });
  const pointerDown = (event: PointerEvent) => record("pointerdown", { x: event.clientX, y: event.clientY, type: event.pointerType });
  const pointerBoundary = (event: PointerEvent) => {
    if (event.target instanceof Element && mount.contains(event.target)) record(event.type, { x: event.clientX, y: event.clientY, type: event.pointerType, target: event.target.tagName, phase: mount.querySelector("[data-phase]")?.getAttribute("data-phase") });
  };
  window.addEventListener("pointerup", pointerUp, true);
  window.addEventListener("pointerdown", pointerDown, true);
  window.addEventListener("pointerover", pointerBoundary, true);
  window.addEventListener("pointerout", pointerBoundary, true);
  const visibility = (event: Event) => record("native-visibility", { trusted: event.isTrusted, hidden: document.hidden, visibilityState: document.visibilityState });
  const windowFocus = (event: Event) => record(`window-${event.type}`, { trusted: event.isTrusted, documentFocused: document.hasFocus() });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", windowFocus);
  window.addEventListener("focus", windowFocus);
  const rendererFactory: SpiritRendererFactory = canvas => {
    const outer = createReviewSpiritRenderer(canvas, {
      async loadCore(url) {
        record("core-load-start", { url });
        await cubismResourceDependencies.loadCore(url);
        record("core-load-complete", { url });
      },
      async importRuntime(url) {
        record("runtime-import-start", { url });
        const runtime = await cubismResourceDependencies.importRuntime(url);
        record("runtime-import-complete", { url, sdkVersion: runtime.sdkVersion });
        return { ...runtime, createCubismRenderer(target) {
          const renderer = runtime.createCubismRenderer(target) as ObservedRenderer;
          current = renderer;
          const play = renderer.play.bind(renderer), pause = renderer.pause.bind(renderer), resume = renderer.resume.bind(renderer), dispose = renderer.dispose.bind(renderer), draw = renderer.draw.bind(renderer);
          renderer.play = (name, options) => { record("play", { name, reducedMotion: options?.reducedMotion === true }); return play(name, options); };
          renderer.pause = () => { record("pause"); pause(); };
          renderer.resume = () => { record("resume"); resume(); };
          renderer.draw = () => { draw(); drawCount++; };
          renderer.dispose = () => { record("dispose", { alreadyDisposed: renderer.disposed }); dispose(); };
          return renderer;
        } };
      },
    });
    const load = outer.load.bind(outer);
    return { ...outer, async load(asset, signal) {
      record("load-start", { manifestUrl: config.manifestUrl, sharedResourceHost: true });
      try { await load(asset, signal); record("load-complete", { drawableCount: current?.user?.getModel().getDrawableCount() }); }
      catch (error) { record("load-failed", { error: String(error) }); throw error; }
    } };
  };
  function ExistingChatBridge() {
    const [chatOpen, setChatOpen] = useState(!existingPanel.hidden);
    useEffect(() => {
      const observer = new MutationObserver(() => setChatOpen(!existingPanel.hidden));
      observer.observe(existingPanel, { attributes: true, attributeFilter: ["hidden"] });
      return () => observer.disconnect();
    }, []);
    return <ForestSpiritResourceHost {...hostResources} userId={config.userId} projectId={config.projectId} conversationId={config.conversationId} chatOpen={chatOpen} rendererFactory={rendererFactory} onOpenChat={() => {
      if (bridgeMode === "production-callback") {
        const binding = currentProductionBindings();
        record("open-existing-production-callback", { projectId: binding.projectId, conversationId: binding.conversationId, focusRequestBefore: binding.focusRequest });
        binding.callback();
        return;
      }
      const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="展开设计助手"][data-guide="workspace-assistant"]');
      if (!trigger) throw new Error("Existing assistant trigger is unavailable");
      record("open-existing-chat", { panelSame: document.querySelector('aside[aria-label="设计助手"]') === panel });
      trigger.click(); // Existing handler; no new conversation or alternative chat component.
    }} />;
  }
  const proof: WipProof = {
    status: "WIP_REAL_SHARED_HOST_AND_RENDERER_BUSINESS_FIXTURE",
    events,
    snapshot() {
      const model = current?.user?.getModel();
      const production = bridgeMode === "production-callback" ? currentProductionBindings() : null;
      return {
        status: proof.status, drawCount, disposed: current?.disposed ?? null, current: current?.current ?? null, paused: current?.paused ?? null, raf: current?.raf ?? null,
        drawableCount: model?.getDrawableCount() ?? null,
        drawableIds: model ? Array.from({ length: model.getDrawableCount() }, (_, i) => String(model.getDrawableId(i).getString())).sort() : null,
        parameters: model ? Object.fromEntries(Array.from({ length: model.getParameterCount() }, (_, i) => [String(model.getParameterId(i).getString()), { value: model.getParameterValueByIndex(i), default: model.getParameterDefaultValue(i) }])) : null,
        panelSame: document.querySelector('aside[aria-label="设计助手"]') === panel, panelHidden: panel.hidden,
        phase: mount.querySelector("[data-phase]")?.getAttribute("data-phase"), characterHidden: mount.querySelector<HTMLElement>("[data-phase]")?.hidden,
        anchor: localStorage.getItem(`fashion:forest-spirit:${encodeURIComponent(config.userId)}:${encodeURIComponent(config.projectId)}`),
        documentHidden: document.hidden, visibilityState: document.visibilityState, documentFocused: document.hasFocus(),
        focusedComposer: panel.contains(document.activeElement) && document.activeElement?.tagName === "TEXTAREA",
        productionBinding: production ? { projectId: production.projectId, conversationId: production.conversationId, chatOpen: production.chatOpen, focusRequest: production.focusRequest } : null,
        bridgeMode, bridgeDifference,
      };
    },
    unmount() {
      if (disposed) return;
      disposed = true; root.unmount(); window.removeEventListener("pointerup", pointerUp, true); window.removeEventListener("pointerdown", pointerDown, true); window.removeEventListener("pointerover", pointerBoundary, true); window.removeEventListener("pointerout", pointerBoundary, true); mount.remove(); badge.remove();
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", windowFocus); window.removeEventListener("focus", windowFocus);
      SpiritInteraction.prototype.enter = originalEnter; SpiritInteraction.prototype.leave = originalLeave; SpiritInteraction.prototype.setVisible = originalVisibility;
      record("unmounted");
    },
  };
  window.forestSpiritWip = proof;
  root.render(<ExistingChatBridge />);
  return proof.status;
}
