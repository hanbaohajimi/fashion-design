"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssistantStreamEvent } from "@fashion/shared";
import { UI_TIMING } from "./ui-config";
import styles from "./streaming-reply.module.css";

type Draft = { text: string; animate: boolean; pending: boolean; attemptId: string; phase?: "analyzing" | "reading" | "validating" };
const emptyDrafts: Record<string, Draft> = Object.freeze({});
export function assistantPhaseLabel(draft: Draft | undefined) {
  return draft?.phase === "reading" ? "正在补读资料" : draft?.phase === "validating" ? "正在校验回复" : draft?.text ? "正在生成回复" : "正在分析设计需求";
}
export function useAssistantStream(conversationId: string) {
  const lifetime = useRef<{ id: string; controller: AbortController } | null>(null);
  const signalFor = useCallback((id: string) => {
    if (!lifetime.current || lifetime.current.id !== id || lifetime.current.controller.signal.aborted) {
      lifetime.current?.controller.abort(); lifetime.current = { id, controller: new AbortController() };
    }
    return lifetime.current.controller.signal;
  }, []);
  useEffect(() => {
    signalFor(conversationId);
    const owned = lifetime.current;
    return () => owned?.controller.abort();
  }, [conversationId, signalFor]);
  useEffect(() => () => lifetime.current?.controller.abort(), []);
  const [state, setState] = useState<{ conversationId: string; drafts: Record<string, Draft> }>({ conversationId, drafts: emptyDrafts });
  const receive = useCallback((event: AssistantStreamEvent) => setState((previous) => {
    const update = (current: Record<string, Draft>): Record<string, Draft> => {
      const draft = current[event.messageId];
      if (event.type === "accepted") return draft?.attemptId === event.attemptId ? current : { ...current, [event.messageId]: { text: "", animate: true, pending: true, attemptId: event.attemptId } };
      if (event.type === "snapshot") return event.turn ? { ...current, [event.messageId]: { text: event.text, animate: false, pending: !event.terminal, attemptId: event.attemptId } } : current;
      if (!draft || draft.attemptId !== event.attemptId) return current;
      if (!draft.pending) return current;
      if (event.type === "phase") return { ...current, [event.messageId]: { ...draft, phase: event.phase } };
      if (event.type === "message.delta") return { ...current, [event.messageId]: { ...draft, text: draft.text + event.text } };
      if (event.type === "message.reset") return { ...current, [event.messageId]: { ...draft, text: "", phase: "analyzing" } };
      if (event.type === "message.completed" || event.type === "message.failed" || event.type === "message.canceled") return { ...current, [event.messageId]: { ...draft, text: event.type === "message.canceled" && draft.text.startsWith(event.turn.assistantMessage.content) ? draft.text : event.turn.assistantMessage.content, animate: event.type === "message.completed" && draft.text.length > 0 && event.turn.assistantMessage.content.startsWith(draft.text), pending: false } };
      return current;
    };
    return { conversationId, drafts: update(previous.conversationId === conversationId ? previous.drafts : {}) };
  }), [conversationId]);
  const stop = (messageId: string) => setState(previous => {
    const draft = previous.drafts[messageId];
    return draft ? { ...previous, drafts: { ...previous.drafts, [messageId]: { ...draft, pending: false, animate: false } } } : previous;
  });
  return { drafts: state.conversationId === conversationId ? state.drafts : emptyDrafts, receive, signalFor, stop };
}

const readReduced = () => typeof window === "undefined" || document.hidden || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const serverReduced = () => true;
const subscribeReduced = (notify: () => void) => {
  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener("change", notify);
  document.addEventListener("visibilitychange", notify);
  return () => { media?.removeEventListener("change", notify); document.removeEventListener("visibilitychange", notify); };
};

type TextNode = { type: string; value?: string; position?: { start: { offset?: number } }; children?: TextNode[]; tagName?: string; properties?: Record<string, unknown> };
const graphemes = new Intl.Segmenter("zh", { granularity: "grapheme" });
const emptyRecent: ReadonlyMap<number, number> = new Map();
const MarkdownBlock = memo(function MarkdownBlock({ content, offset, recent }: { content: string; offset: number; recent: ReadonlyMap<number, number> }) {
  const plugin = () => (tree: TextNode) => {
    const visit = (node: TextNode) => {
      if (!node.children || node.tagName === "code" || node.tagName === "pre") return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value || !recent.size) { visit(child); return [child]; }
        const start = (child.position?.start.offset ?? 0) + offset;
        const children: TextNode[] = []; let index = start; let stable = "";
        for (const { segment } of graphemes.segment(child.value)) {
          const born = recent.get(index); index += segment.length;
          if (born === undefined) stable += segment;
          else {
            if (stable) { children.push({ type: "text", value: stable }); stable = ""; }
            const age = Math.max(0, performance.now() - born);
            children.push({ type: "element", tagName: "span", properties: { className: [styles.character], style: `animation-delay: -${age}ms` }, children: [{ type: "text", value: segment }] });
          }
        }
        if (stable) children.push({ type: "text", value: stable });
        return children;
      });
    };
    visit(tree);
  };
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={recent.size ? [plugin] : []} skipHtml>{content}</ReactMarkdown>;
});

export const StreamingReply = memo(function StreamingReply({ content, draft }: { content: string; draft?: Draft | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  const received = draft?.text ?? content;
  const [shown, setShown] = useState(draft?.animate ? "" : received);
  const [skipped, setSkipped] = useState(false);
  const [recent, setRecent] = useState<ReadonlyMap<number, number>>(emptyRecent);
  const value = useRef("");
  const target = useRef(received);
  const fresh = useRef(new Map<number, number>());
  const reduce = useSyncExternalStore(subscribeReduced, readReduced, serverReduced);
  const animate = Boolean(draft?.animate && !skipped);
  const displayed = received.startsWith(shown) ? shown : "";
  const working = animate && !reduce && (displayed.length < received.length || recent.size > 0);
  useLayoutEffect(() => {
    target.current = received;
    if (!animate || reduce) { value.current = received; fresh.current.clear(); }
    else if (!received.startsWith(value.current)) { value.current = ""; fresh.current.clear(); }
  }, [received, animate, reduce, draft?.attemptId]);
  useEffect(() => {
    if (!working) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = performance.now();
      for (const [index, born] of fresh.current) if (now - born >= UI_TIMING.streamReveal) fresh.current.delete(index);
      const next = graphemes.segment(target.current.slice(value.current.length))[Symbol.iterator]().next().value?.segment;
      if (next) { fresh.current.set(value.current.length, now); value.current += next; }
      setShown(value.current);
      setRecent(new Map(fresh.current));
      timer = setTimeout(tick, UI_TIMING.streamCharacter);
    };
    timer = setTimeout(tick, UI_TIMING.streamCharacter);
    return () => clearTimeout(timer);
  }, [working, draft?.attemptId]);
  const visible = !animate || reduce ? received : displayed;
  // Complete paragraphs keep their memoized Markdown tree while the tail grows.
  const blocks: { content: string; offset: number }[] = [];
  let offset = 0; let fenced = false; let buffer = ""; let start = 0;
  for (const line of visible.split(/(?<=\n)/u)) {
    if (/^\s*(```|~~~)/u.test(line)) fenced = !fenced;
    buffer += line; offset += line.length;
    if (!fenced && /^\s*\n$/u.test(line)) { blocks.push({ content: buffer, offset: start }); buffer = ""; start = offset; }
  }
  if (buffer) blocks.push({ content: buffer, offset: start });
  const waiting = visible.length < received.length;
  const typing = animate && !reduce && (Boolean(draft?.pending) || waiting);
  const complete = !draft?.pending && !waiting && recent.size === 0;
  return <>
    <div ref={host} data-stream-body aria-hidden={typing || undefined}>
      {!animate || reduce || complete ? <MarkdownBlock content={received} offset={0} recent={emptyRecent} /> : blocks.map((block) => <MarkdownBlock key={block.offset} {...block} recent={[...recent.keys()].some((index) => index >= block.offset && index < block.offset + block.content.length) ? recent : emptyRecent} />)}
    </div>
    {typing ? <span className={styles.srOnly} role="status">{draft?.pending ? "设计助手正在生成回复" : received}</span> : null}
    {typing ? <button className={styles.skip} type="button" onClick={() => { setSkipped(true); fresh.current.clear(); setRecent(emptyRecent); }}>立即显示已收到内容</button> : null}
  </>;
});
