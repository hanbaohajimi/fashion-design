"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpiritInteraction } from "./spirit-interaction";
import { anchorToPoint, pointToAnchor, readSpiritAnchor, type SpiritAnchor, type SpiritPhase, type SpiritPoint, type SpiritRenderAsset, type SpiritRenderer, type SpiritRendererFactory } from "./spirit-contract";
import styles from "./ForestSpiritAssistant.module.css";

interface Props {
  projectId: string;
  conversationId: string | null;
  chatOpen: boolean;
  suspended?: boolean;
  onOpenChat(): void;
}

/** Shared presentation. The production Host and official adapter enforce approval separately. */
export function ForestSpiritSurface({ asset, userId, projectId, conversationId, chatOpen, suspended = false, onOpenChat, rendererFactory }: Props & { asset: SpiritRenderAsset; userId: string; rendererFactory: SpiritRendererFactory }) {
  const layer = useRef<HTMLDivElement>(null);
  const character = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hit = useRef<SVGSVGElement>(null);
  const renderer = useRef<SpiritRenderer | null>(null);
  const interaction = useRef<SpiritInteraction | null>(null);
  const capture = useRef<number | null>(null);
  const hoverPointer = useRef<{ x: number; y: number; type: string } | null>(null);
  const anchor = useRef<SpiritAnchor>({ xRatio: 1, yRatio: 1 });
  const point = useRef<SpiritPoint>({ x: 0, y: 0 });
  const available = useRef<SpiritPoint>({ x: 0, y: 0 });
  const storageKey = `fashion:forest-spirit:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [hasSpace, setHasSpace] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [phase, setPhase] = useState<SpiritPhase>("loading");
  const openChat = useRef(onOpenChat);
  useEffect(() => { openChat.current = onOpenChat; }, [onOpenChat]);
  const visible = ready && !failed && hasSpace && !chatOpen && !suspended && documentVisible;
  const releaseCapture = useCallback(() => {
    const id = capture.current;
    capture.current = null;
    if (id !== null && hit.current?.hasPointerCapture(id)) hit.current.releasePointerCapture(id);
  }, []);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setDocumentVisible(!document.hidden); setReducedMotion(media.matches); };
    const rememberPointer = (event: PointerEvent) => { hoverPointer.current = { x: event.clientX, y: event.clientY, type: event.pointerType }; };
    document.addEventListener("visibilitychange", update);
    media.addEventListener("change", update);
    window.addEventListener("pointermove", rememberPointer, { capture: true, passive: true });
    window.addEventListener("pointerdown", rememberPointer, { capture: true, passive: true });
    update();
    return () => {
      document.removeEventListener("visibilitychange", update); media.removeEventListener("change", update);
      window.removeEventListener("pointermove", rememberPointer, true); window.removeEventListener("pointerdown", rememberPointer, true);
    };
  }, []);

  useEffect(() => {
    const target = canvas.current;
    const host = layer.current;
    if (!target || !host) return;
    const abort = new AbortController();
    let alive = true;
    let instance: SpiritRenderer;
    try { instance = rendererFactory(target); }
    catch {
      queueMicrotask(() => { if (alive) setFailed(true); });
      return () => { alive = false; abort.abort(); };
    }
    let disposed = false;
    const disposeInstance = () => { if (!disposed) { disposed = true; instance.dispose(); } };
    renderer.current = instance;
    anchor.current = readSpiritAnchor(storageKey);
    const place = (next: SpiritPoint) => {
      point.current = { x: Math.max(0, Math.min(available.current.x, next.x)), y: Math.max(0, Math.min(available.current.y, next.y)) };
      if (character.current) character.current.style.transform = `translate(${point.current.x}px, ${point.current.y}px)`;
    };
    const controller = new SpiritInteraction({
      phase: value => { if (alive) setPhase(value); },
      play: name => instance.play(name, { interrupt: true, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }),
      move: place,
      persist: () => {
        anchor.current = pointToAnchor(point.current, available.current, anchor.current);
        try { localStorage.setItem(storageKey, JSON.stringify(anchor.current)); } catch { /* Keep the in-memory anchor. */ }
      },
      openChat: () => { releaseCapture(); instance.pause(); openChat.current(); },
    });
    interaction.current = controller;
    const resize = () => {
      controller.cancel();
      releaseCapture();
      const rect = host.getBoundingClientRect();
      const ratio = asset.hitArea.viewBox[0] / asset.hitArea.viewBox[1];
      const height = Math.max(0, Math.min(220, rect.height, rect.width / ratio));
      const width = height * ratio;
      setHasSpace(width >= 44 && height >= 44);
      if (character.current) { character.current.style.width = `${width}px`; character.current.style.height = `${height}px`; }
      available.current = { x: Math.max(0, rect.width - width), y: Math.max(0, rect.height - height) };
      place(anchorToPoint(anchor.current, available.current));
      instance.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const blur = () => { controller.cancel(); releaseCapture(); };
    const contextLost = () => { if (!alive) return; blur(); controller.setVisible(false); instance.pause(); disposeInstance(); setFailed(true); };
    window.addEventListener("blur", blur);
    target.addEventListener("webglcontextlost", contextLost);
    target.addEventListener("forest-spirit-error", contextLost);
    resize();
    void instance.load(asset, abort.signal).then(() => {
      if (!alive) return;
      resize();
      setReady(true);
    }).catch(() => { if (alive && !abort.signal.aborted) { setFailed(true); controller.setVisible(false); instance.pause(); disposeInstance(); } });
    return () => {
      alive = false;
      abort.abort();
      controller.dispose();
      releaseCapture();
      observer.disconnect();
      window.removeEventListener("blur", blur);
      target.removeEventListener("webglcontextlost", contextLost);
      target.removeEventListener("forest-spirit-error", contextLost);
      disposeInstance();
      if (renderer.current === instance) renderer.current = null;
      if (interaction.current === controller) interaction.current = null;
    };
  }, [asset, storageKey, rendererFactory, releaseCapture]);

  useEffect(() => {
    const pointer = hoverPointer.current;
    // Query the browser's polygon hit target only on restoration; no per-move pixel reads.
    const pointerInside = visible && (pointer
      ? pointer.type !== "touch" && Boolean(hit.current?.contains(document.elementFromPoint(pointer.x, pointer.y)))
      : Boolean(hit.current?.matches(":hover")));
    interaction.current?.setVisible(visible, reducedMotion, pointerInside);
    if (visible) {
      renderer.current?.resume();
      void renderer.current?.play("idle", { interrupt: true, reducedMotion }).catch(() => setFailed(true));
    } else { releaseCapture(); renderer.current?.pause(); }
  }, [visible, reducedMotion, releaseCapture]);

  return <div className={styles.layer} ref={layer} data-forest-spirit-host data-project-id={projectId} data-conversation-id={conversationId ?? undefined}>
    <div className={styles.character} ref={character} hidden={!visible} data-phase={phase}>
      <canvas className={styles.canvas} ref={canvas} aria-hidden="true" />
      <svg ref={hit} className={styles.hit} viewBox={`0 0 ${asset.hitArea.viewBox.join(" ")}`} role="button" tabIndex={visible ? 0 : -1} aria-label="展开设计助手" data-forest-spirit-hit
        onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !event.repeat) { event.preventDefault(); event.stopPropagation(); interaction.current?.open(); } }}
        onClick={event => { event.preventDefault(); if (event.detail === 0) interaction.current?.open(); }}
        onPointerDown={event => {
          if (!interaction.current?.down(event.pointerId, { x: event.clientX, y: event.clientY }, point.current, event.isPrimary, event.button)) return;
          event.preventDefault(); event.stopPropagation();
          try { event.currentTarget.setPointerCapture(event.pointerId); capture.current = event.pointerId; } catch { interaction.current.cancel(); }
        }}
        onPointerMove={event => interaction.current?.move(event.pointerId, { x: event.clientX, y: event.clientY })}
        onPointerUp={event => { if (capture.current !== event.pointerId) return; interaction.current?.up(event.pointerId, { x: event.clientX, y: event.clientY }); releaseCapture(); }}
        onPointerCancel={event => { if (capture.current !== event.pointerId) return; interaction.current?.cancel(); releaseCapture(); }}
        onLostPointerCapture={event => { if (capture.current === event.pointerId) { capture.current = null; interaction.current?.cancel(); } }}>
        <g onPointerEnter={event => { if (event.pointerType !== "touch") interaction.current?.enter(); }} onPointerLeave={() => interaction.current?.leave()}>
          {asset.hitArea.polygons.map((polygon, index) => <polygon className={styles.polygon} points={polygon.map(p => p.join(",")).join(" ")} key={index} />)}
        </g>
      </svg>
    </div>
  </div>;
}
