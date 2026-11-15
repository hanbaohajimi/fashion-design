"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { emptyCanvasCreationDraft, type CanvasCreation, type CanvasCreationDraft, type CreationInputBinding, type CreationResultView } from "@fashion/shared";
import { createImeGuard } from "../../../components/assistant-ime";
import { VoicePill } from "../../../components/VoicePill";
import { insertDictation, type DictationAnchor } from "../../../components/browser-voice";
import { useDraftScope, usePersistentDraft } from "../../../components/drafts/use-persistent-draft";
import type { WorkflowGraph, WorkflowNode } from "./workflow-api";
import { displayNodeTitle, nodeImageUrl } from "./workflow-graph";
import styles from "./creation-workspace.module.css";
import { Tooltip } from "../../../components/ui";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { creationReferenceView, creationReferenceToken } from "./creation-reference";
import { AssistantReferencePreview, referenceLabel } from "./AssistantReferencePreview";
import referenceStyles from "./assistant-redesign.module.css";
import WarmTooltip from "../../../components/WarmTooltip";
import { CanvasAction } from "./CanvasAction";

export function nodeInput(node: WorkflowNode): CreationInputBinding {
  return { id: crypto.randomUUID(), nodeId: node.id, ...(typeof node.payload.assetId === "string" ? { assetId: node.payload.assetId } : {}) };
}

export interface CreationComposerHandle { targetKey: string; openReferences: () => void; openUpload: () => void; focusPrompt: () => void; checkpoint: (draft: CanvasCreationDraft, baseline?: string) => Promise<void>; setRevision: (revision: number) => void; captureAssistantDraft: () => { draft: CanvasCreationDraft; revision: number | undefined }; acknowledgeAssistantDraft: (draft: CanvasCreationDraft, revision: number) => Promise<void> }
interface Props {
  ref?: Ref<CreationComposerHandle> | undefined;
  creation: CanvasCreation | undefined;
  source: WorkflowNode | undefined;
  value: CanvasCreationDraft | undefined;
  graph: WorkflowGraph;
  canEdit: boolean;
  pending: boolean;
  submitting: boolean;
  pendingSave: boolean;
  onRetrySave: () => Promise<void>;
  style: CSSProperties;
  onChange: (draft: CanvasCreationDraft) => void;
  onSave: (draft: CanvasCreationDraft, revision?: number) => Promise<void>;
  onGenerate: (draft: CanvasCreationDraft, revision?: number) => Promise<void>;
  onUpload: (files: readonly File[]) => Promise<CreationInputBinding[]>;
  onDraftState?: (state: { key: string; ready: boolean }) => void;
  creations?: readonly CanvasCreation[];
  onVisitReference?: ((nodeId: string) => boolean) | undefined;
  onPreviewReference?: (view: CreationResultView, actions: { insert: () => void; remove?: (() => void) | undefined }) => void;
}

export function CreationComposer({ ref, creation, source, value, graph, canEdit, pending, submitting, pendingSave, onRetrySave, style, onChange, onSave, onGenerate, onUpload, onDraftState, creations = [], onVisitReference, onPreviewReference }: Props) {
  const [initial] = useState(() => value ?? creation?.draft ?? (() => {
    const draft = emptyCanvasCreationDraft();
    if (source) { const input = nodeInput(source); draft.inputs.push(input); draft.basedOnInputId = nodeImageUrl(source) ? input.id : null; }
    return draft;
  })());
  const [localDraft, setLocalDraft] = useState(initial);
  const draft = value ?? localDraft;
  const latestDraft = useRef(draft);
  useLayoutEffect(() => { latestDraft.current = draft; }, [draft]);
  const baseline = JSON.stringify(creation?.draft ?? initial);
  const revision = useRef(creation?.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOption, setActiveOption] = useState(0);
  const [mention, setMention] = useState<{ start: number; end: number } | null>(null);
  const [settings, setSettings] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const settingsId = useId();
  const settingsPanel = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (settings) settingsPanel.current?.querySelector("select")?.focus({ preventScroll: true }); }, [settings]);
  useEffect(() => {
    if (!settings) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !settingsPanel.current?.contains(event.target) && !settingsTrigger.current?.contains(event.target)) setSettings(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [settings]);
  const input = useRef<HTMLTextAreaElement>(null);
  const [voiceFeedback, setVoiceFeedback] = useState<HTMLDivElement | null>(null);
  const voiceAnchor = useRef<DictationAnchor>({ value: "", start: 0, end: 0 });
  const [voiceBusy, setVoiceBusy] = useState(false);
  const draftScope = useDraftScope();
  const files = useRef<HTMLInputElement>(null);
  const ime = useRef(createImeGuard());
  const flight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!settings && !expanded) return;
    const closePanel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || voiceBusy) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (settings) { setSettings(false); settingsTrigger.current?.focus({ preventScroll: true }); }
      else { setExpanded(false); input.current?.focus({ preventScroll: true }); }
    };
    window.addEventListener("keydown", closePanel, true);
    return () => window.removeEventListener("keydown", closePanel, true);
  }, [settings, expanded, voiceBusy]);
  const change = (next: CanvasCreationDraft) => {
    if (JSON.stringify(latestDraft.current) === baseline) revision.current = creation?.revision;
    latestDraft.current = next;
    setLocalDraft(next); onChange(next);
  };
  const recovery = usePersistentDraft({ value: draft, restore: change, baseline, objectKey: `creation:${creation?.id ?? `source:${source?.id ?? "new"}`}`, enabled: canEdit });
  const ownResults = new Set(creation?.runs.flatMap((run) => run.results.map((result) => result.nodeId)) ?? []);
  const referenceNodes = graph.nodes.filter((node) => !ownResults.has(node.id) && node.kind === "asset" && node.type !== "legacy" && node.type !== "media" && node.status !== "proposed");
  const available = referenceNodes.filter(node => !query || `${displayNodeTitle(node)} ${node.title}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const candidates = available.slice(0, 60);
  const runActive = creation?.runs.some((run) => ["preparing", "queued", "running"].includes(run.status));
  const transform = draft.operation?.toolKey === "transform_image";
  const maskedEdit = draft.operation?.parameters.taskType === "inpaint";
  const imageGeneration = !creation || creation.module === "image";
  const actionLabel = transform ? "处理" : creation?.module === "text" ? "起草" : creation?.module === "analysis" ? "分析" : creation?.module === "evaluation" ? "评估" : "生成";
  const hasGenerated = creation?.runs.some(run => creation.module !== "text" || run.draft.textMode !== "manual");
  const submitLabel = busy || submitting ? "正在提交" : pending ? "确认上次提交" : runActive ? `${actionLabel}中` : hasGenerated ? `重新${actionLabel}` : actionLabel;
  const ratio = ({ "768:1024": "3:4", "1024:1024": "1:1", "1024:768": "4:3", "1536:864": "16:9", "864:1536": "9:16" } as Record<string, string>)[`${draft.parameters.width}:${draft.parameters.height}`] ?? `${draft.parameters.width}×${draft.parameters.height}`;
  const qualityLabel = { auto: "自动", low: "快速", medium: "标准", high: "高清" }[draft.parameters.quality];
  const targetKey = creation?.id ?? source?.id ?? "";
  useImperativeHandle(ref, () => ({ targetKey, openReferences: () => { if (canEdit && !transform && !maskedEdit) { setPicker(true); setMention(null); setQuery(""); } }, openUpload: () => { if (canEdit && !transform && !maskedEdit) files.current?.click(); }, focusPrompt: () => input.current?.focus({ preventScroll: true }), checkpoint: (value, nextBaseline) => recovery.checkpoint(value, nextBaseline ?? baseline), setRevision: value => { revision.current = value; },
    captureAssistantDraft: () => {
      if (canEdit && !recovery.ready || recovery.conflict || flight.current || busy || voiceBusy) throw new Error("当前创作草稿尚在恢复、上传或保存，请完成后再发送给助手。");
      return { draft: structuredClone(latestDraft.current), revision: revision.current ?? creation?.revision };
    },
    acknowledgeAssistantDraft: async (value, savedRevision) => { revision.current = savedRevision; await recovery.acknowledge(value); },
  }), [canEdit, maskedEdit, targetKey, transform, recovery, baseline, busy, voiceBusy, creation?.revision]);
  const disabled = !canEdit || busy || !recovery.ready || Boolean(recovery.conflict);
  useEffect(() => { onDraftState?.({ key: targetKey, ready: !disabled }); }, [onDraftState, targetKey, disabled]);
  const addReference = (node: WorkflowNode) => {
    const present = draft.inputs.findIndex((binding) => binding.nodeId === node.id);
    if (present < 0 && draft.inputs.length >= 16) { setError("每次最多引用16项素材"); return; }
    const next = present < 0 ? { ...draft, inputs: [...draft.inputs, nodeInput(node)] } : { ...draft };
    if (mention) {
      const token = creationReferenceToken(present < 0 ? next.inputs.length - 1 : present, next.inputs, graph, creations);
      next.prompt = `${draft.prompt.slice(0, mention.start)}${token}${draft.prompt.slice(mention.end)}`;
      const caret = mention.start + token.length;
      requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(caret, caret); });
    }
    change({ ...next }); setPicker(false); setMention(null); setQuery("");
  };
  const insertReference = (bindingId: string) => {
    const draft = latestDraft.current;
    const index = draft.inputs.findIndex(input => input.id === bindingId);
    if (index < 0) { setError("这项引用已被移除，请重新选择"); return; }
    const start = mention?.start ?? input.current?.selectionStart ?? draft.prompt.length;
    const end = mention?.end ?? input.current?.selectionEnd ?? draft.prompt.length;
    const token = creationReferenceToken(index, draft.inputs, graph, creations);
    const prompt = draft.prompt.slice(0, start) + token + draft.prompt.slice(end);
    if (prompt.length > 4000) { setError("输入已到上限，请先缩短正文。"); return; }
    change({ ...draft, prompt }); setPicker(false); setMention(null);
    requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.setSelectionRange(start + token.length, start + token.length); });
  };
  const submit = async (execute: boolean) => {
    if (flight.current || disabled || voiceBusy || execute && (submitting || !pending && runActive)) return;
    flight.current = true; setBusy(true); setError(null);
    const submitted = structuredClone(draft);
    try {
      await recovery.checkpoint(submitted, baseline);
      if (execute) await onGenerate(submitted, revision.current);
      else await onSave(submitted, revision.current);
      if (mounted.current && (!execute || !pending)) { revision.current = undefined; await recovery.acknowledge(submitted); }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "操作失败，输入已保留"); }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className={styles.composer} style={expanded ? { ...style, top: 80, left: 20, width: "calc(100% - 40px)", height: "calc(100% - 176px)" } : style} aria-label={creation?.module === "text" ? "文本创作框" : "图片创作框"} data-expanded={expanded} data-voice-active={voiceBusy || undefined} data-guide="workspace-creation" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape" && settings) { event.preventDefault(); setSettings(false); settingsTrigger.current?.focus({ preventScroll: true }); } else if (event.key === "Escape" && expanded) { event.preventDefault(); setExpanded(false); } }}>
    <div className={styles.composerActions}>
      <CanvasAction className={styles.referenceChip} label="上传参考" text="上传" icon="add" disabled={disabled || transform || maskedEdit} onClick={() => files.current?.click()} />
      <CanvasAction className={styles.referenceChip} label="画布参考" text="画布参考" icon="reference" disabled={disabled || transform || maskedEdit} aria-expanded={picker} onClick={() => { setPicker(!picker); setMention(null); setQuery(""); }} />
      {creation ? <CanvasAction label="保存要求" icon="save" disabled={disabled || voiceBusy || JSON.stringify(draft) === baseline} onClick={() => void submit(false)} /> : null}
      <span className={styles.composerExpand}><CanvasAction label={expanded ? "收起创作框" : "展开创作框"} icon={expanded ? "collapse" : "expand"} aria-expanded={expanded} onClick={() => setExpanded(value => !value)} /></span>
    </div>
    {draft.inputs.length ? <ol className={styles.referenceThumbnails} aria-label="本次输入素材">{draft.inputs.map((binding, index) => {
      const view = creationReferenceView(binding, graph, creations);
      const token = creationReferenceToken(index, draft.inputs, graph, creations);
      const remove = () => { const current = latestDraft.current; change({ ...current, inputs: current.inputs.filter(item => item.id !== binding.id), basedOnInputId: current.basedOnInputId === binding.id ? null : current.basedOnInputId }); };
      const preview = () => onPreviewReference?.(view, { insert: () => insertReference(binding.id), remove: disabled || transform || maskedEdit ? undefined : remove });
      return <li key={binding.id} data-creation-reference={binding.id}>
        <Tooltip closeOnClick className={referenceStyles.imageTooltip} content={view.imageUrl ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={view.imageUrl} alt={view.title} /><span>双击定位到画布</span>
        </> : view.title}><button className={styles.referenceThumbnail} type="button" aria-label={`${token} ${view.title}`} onClick={event => { if (event.detail === 0 || matchMedia("(hover: none), (pointer: coarse), (max-width: 767px)").matches) preview(); }} onDoubleClick={event => { event.stopPropagation(); if (!onVisitReference?.(view.nodeId)) preview(); }} onContextMenu={event => { event.preventDefault(); preview(); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {view.imageUrl ? <img src={view.imageUrl} alt="" /> : <WorkspaceIcon name="requirements" />}
          <span className={referenceStyles.referenceNumber}>{token.replace("图", "").replace("素材", "参")}</span>
        </button></Tooltip>
        <Tooltip closeOnClick content={`移除${token}`}><button className={styles.referenceRemove} type="button" aria-label={`移除${token}`} disabled={disabled || transform || maskedEdit} onClick={remove}><WorkspaceIcon name="close" /></button></Tooltip>
        <Tooltip closeOnClick content={`插入${token}引用`}><button className={styles.referenceMention} type="button" aria-label={`插入${token}引用`} disabled={disabled || transform} onClick={() => insertReference(binding.id)}><WorkspaceIcon name="mention" /></button></Tooltip>
      </li>;
    })}</ol> : null}
    <div ref={setVoiceFeedback} className={styles.voiceFeedback} />
    <textarea ref={input} aria-label="本次创作要求" value={draft.prompt} readOnly={transform} disabled={!canEdit} maxLength={4000} placeholder={creation?.module === "text" ? "描述要起草的文字，或选择参考后输入改写要求…" : "描述想创作的画面，或对参考图片提出修改要求…"}
      onCompositionStart={() => ime.current.start()} onCompositionEnd={() => ime.current.end()}
      onChange={(event) => {
        const prompt = event.currentTarget.value;
        change({ ...draft, prompt });
        const end = event.currentTarget.selectionStart;
        const found = prompt.slice(0, end).match(/(?:^|[^\w@])@([^@\s]*)$/u);
        if (found) { setMention({ start: end - (found[1]?.length ?? 0) - 1, end }); setQuery(found[1] ?? ""); setPicker(true); setActiveOption(0); }
        else if (mention) { setMention(null); setPicker(false); }
      }}
      onKeyDown={(event) => {
        if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
        if (ime.current.blocks(event.nativeEvent)) return;
        if (picker && mention) {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setActiveOption((index) => Math.max(0, Math.min(candidates.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))); }
          if (event.key === "Escape") { event.preventDefault(); setPicker(false); setMention(null); }
          if (["Enter", "Tab"].includes(event.key)) { event.preventDefault(); const node = candidates[activeOption]; if (node) addReference(node); }
          return;
        }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit(true); }
      }} />
    {picker ? <div className={styles.referencePicker}>
      <div><input aria-label="搜索画布素材" value={query} onChange={(event) => { setQuery(event.target.value); setActiveOption(0); }} /><button type="button" aria-label="关闭素材选择" onClick={() => { setPicker(false); setMention(null); }}>×</button></div>
      <div role="listbox" aria-label="可引用素材">{candidates.map((node, index) => <button type="button" role="option" aria-selected={index === activeOption} key={node.id} onClick={() => addReference(node)} title={referenceLabel(node, referenceNodes)}><AssistantReferencePreview node={node} compact /><span>{referenceLabel(node, referenceNodes)}</span></button>)}{!candidates.length ? <p>没有匹配的素材</p> : null}</div>
    </div> : null}
    <div className={styles.composerFooter}>
      <span className={styles.creationKind}><WorkspaceIcon name={imageGeneration ? "image" : "requirements"} /><span>{imageGeneration ? "图片创作" : creation?.module === "text" ? "文本起草" : creation?.module === "analysis" ? "需求分析" : "方案评估"}</span></span>
      {imageGeneration ? <WarmTooltip content={`${draft.parameters.width} × ${draft.parameters.height}，${qualityLabel}质量，${draft.parameters.count}张`}><button ref={settingsTrigger} className={styles.parameterTrigger} aria-label="生成参数" type="button" disabled={transform || voiceBusy} aria-expanded={settings} aria-controls={settings ? settingsId : undefined} onClick={() => setSettings(!settings)}><WorkspaceIcon name="frame" /><span>{ratio}</span><span className={styles.qualityValue}>{qualityLabel}</span><span>{draft.parameters.count}张</span><WorkspaceIcon name="chevron" /></button></WarmTooltip> : null}
      <span className={styles.footerSpacer} />
      <VoicePill scopeKey={`${draftScope?.accountId ?? "anonymous"}:${graph.projectId}:${targetKey}`} disabled={disabled || transform} feedbackHost={voiceFeedback} onPhaseChange={setVoiceBusy}
        onStart={() => { const field = input.current; voiceAnchor.current = { value: field?.value ?? draft.prompt, start: field?.selectionStart ?? draft.prompt.length, end: field?.selectionEnd ?? draft.prompt.length }; }}
        onCommit={text => {
          const result = insertDictation(input.current?.value ?? draft.prompt, voiceAnchor.current, text, 4000);
          if (!result) return "语音文字超出输入上限，已保留识别结果。精简草稿后可再次加入。";
          change({ ...latestDraft.current, prompt: result.value });
          requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.setSelectionRange(result.caret, result.caret); });
          return null;
        }} />

      <WarmTooltip content={submitLabel} shortcut="Ctrl ↵"><button type="button" className={styles.generate} aria-label={submitLabel} aria-busy={busy || submitting || runActive || undefined} disabled={disabled || voiceBusy || submitting || !draft.prompt.trim() || !pending && runActive} onClick={() => void submit(true)}><WorkspaceIcon name={busy || submitting || runActive ? "spinner" : "send"} /></button></WarmTooltip>
      <span className={styles.srOnly} role="status">{busy || submitting || runActive ? submitLabel : ""}</span>
    </div>
    {settings && imageGeneration ? <div ref={settingsPanel} id={settingsId} role="group" className={styles.settings} aria-label="生成参数" onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !settingsTrigger.current?.contains(event.relatedTarget)) setSettings(false); }}>
      <label>画面比例<select value={`${draft.parameters.width}:${draft.parameters.height}`} onChange={(event) => { const [width, height] = event.target.value.split(":").map(Number); if (width && height) change({ ...draft, parameters: { ...draft.parameters, width, height } }); }}>
        <option value="768:1024">3:4</option><option value="1024:1024">1:1</option><option value="1024:768">4:3</option><option value="1536:864">16:9</option><option value="864:1536">9:16</option>
      </select></label>
      <label>质量<select value={draft.parameters.quality} onChange={(event) => change({ ...draft, parameters: { ...draft.parameters, quality: event.target.value as CanvasCreationDraft["parameters"]["quality"] } })}><option value="auto">自动</option><option value="low">快速</option><option value="medium">标准</option><option value="high">高清</option></select></label>
      <label>数量<select value={draft.parameters.count} onChange={(event) => change({ ...draft, parameters: { ...draft.parameters, count: Number(event.target.value) } })}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}张</option>)}</select></label>
    </div> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {pendingSave && !busy ? <button type="button" onClick={() => { setBusy(true); void onRetrySave().then(() => { revision.current = undefined; setError(null); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "保存回执仍未确认")).finally(() => setBusy(false)); }}>确认上次保存，保留当前输入</button> : null}
    <input ref={files} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={(event) => {
      const selected = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = "";
      if (selected.length + draft.inputs.length > 16) { setError("每次最多引用16项素材"); return; }
      setBusy(true); setError(null);
      void onUpload(selected).then((inputs) => {
        if (!mounted.current) return;
        const current = latestDraft.current;
        if (current.inputs.length + inputs.length > 16) throw new Error("素材已上传，本次引用已达16项，请先移除部分参考后从画布选择。");
        change({ ...current, inputs: [...current.inputs, ...inputs] });
      }).catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : "上传失败"); }).finally(() => { if (mounted.current) setBusy(false); });
    }} />
  </section>;
}
