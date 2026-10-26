"use client";
// Keep requirements primary; provenance and controls use existing secondary typography.
import { useState } from "react";
import { Dialog } from "../../../components/ui";
import { userFacingError } from "../../../components/user-facing-error";
import type { WorkflowContextCorrection, WorkflowContextItem, WorkflowConversationContext } from "../agent/agent-api";
import type { WorkflowGraph } from "./workflow-api";
import styles from "./workflow-canvas.module.css";
import ui from "./assistant-context.module.css";

export function DesignRequirementsDrawer({ context, error, graph, saving, hasDraftReferences = false, onLocate, onUpdate, onRetry, onClose }: {
  readonly context: WorkflowConversationContext | null;
  readonly error: string | null;
  readonly graph: WorkflowGraph;
  readonly saving: boolean;
  readonly hasDraftReferences?: boolean;
  readonly onLocate: (id: string) => void;
  readonly onUpdate: (change: WorkflowContextCorrection) => Promise<boolean>;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}) {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [itemText, setItemText] = useState("");
  const [itemScope, setItemScope] = useState<"project" | "branch">("project");
  const entries = [
    ...(context?.state?.requirements ?? context?.requirements ?? []).map((item) => ({ item, preference: false })),
    ...(context?.state?.preferences ?? context?.preferences ?? []).map((item) => ({ item, preference: true })),
  ];
  const active = entries.filter(({ item }) => item.status !== "inactive");
  const inactive = entries.filter(({ item }) => item.status === "inactive");
  const scopeLabel = hasDraftReferences ? "已保存讨论对象" : "当前讨论对象";
  const renderItem = (item: WorkflowContextItem, preference: boolean) => <li key={item.id} data-status={item.status}>
    <span>{item.text}</span><small>{item.status === "inactive" ? "已停用" : item.origin === "inferred" ? "助手推测 · 未确认" : item.origin === "explicit" ? "明确提出" : "来源未标注"}{item.scope === "branch" ? " · 指定方案及其后续设计" : " · 整个项目"}</small>
    {item.status !== "inactive" ? <small>{item.scope === "branch" ? context?.scopedMemory?.find((entry) => entry.id === item.id)?.applicable === true ? `${scopeLabel}适用` : context?.scopedMemory?.find((entry) => entry.id === item.id)?.applicable === false ? `${scopeLabel}不适用` : "适用状态未记录" : "各会话均适用"}</small> : null}
    {item.sourceQuote ? <blockquote>{item.sourceQuote}</blockquote> : null}
    {item.sourceMessageId ? <small>来源：项目对话</small> : null}
    {item.scope === "branch" ? <small>适用对象：{(item.branchNodeIds ?? []).map((id) => graph.nodes.find((node) => node.id === id)?.title ?? "已移除对象").join("、") || "来源未标注"}。仅在讨论这些对象所在的设计分支时生效。</small> : null}
    {[...new Set([...(item.sourceNodeIds ?? []), ...(item.branchNodeIds ?? [])])].map((id) => <button className={styles.nodeLink} disabled={!graph.nodes.some((node) => node.id === id)} key={id} onClick={() => onLocate(id)} type="button">定位 {graph.nodes.find((node) => node.id === id)?.title ?? "已移除节点"}</button>)}
    {preference && item.status !== "inactive" ? <button className={styles.actionQuiet} disabled={saving} onClick={() => void onUpdate({ disabledPreferenceIds: [item.id] })} type="button">停用这条偏好</button> : null}
    {item.status !== "inactive" ? <button className={styles.actionSecondary} disabled={saving} onClick={() => { setEditingItem(item.id); setItemText(item.text); setItemScope(item.scope ?? "project"); }} type="button">{preference ? "更正这条偏好" : "更正这条要求"}</button> : null}
    {item.origin === "inferred" && item.status !== "inactive" ? <button className={styles.actionSecondary} disabled={saving} onClick={() => void onUpdate({ updatedItems: [{ id: item.id, confirm: true }] })} type="button">确认这条理解</button> : null}
    {editingItem === item.id ? <form className={styles.proposalEditor} onSubmit={(event) => { event.preventDefault(); void onUpdate({ updatedItems: [{ id: item.id, text: itemText.trim(), scope: itemScope, confirm: true }] }).then((saved) => { if (saved) setEditingItem(null); }); }}><label>更正内容<textarea aria-label="更正内容" maxLength={600} rows={2} value={itemText} onChange={(event) => setItemText(event.target.value)} /></label><label>作用范围<select aria-label="作用范围" value={itemScope} onChange={(event) => setItemScope(event.target.value as "project" | "branch")}><option value="project">整个项目</option><option disabled={!item.branchNodeIds?.length} value="branch">原分支</option></select></label><button className={styles.actionPrimary} disabled={saving || !itemText.trim()} type="submit">保存更正</button><button className={styles.actionQuiet} onClick={() => setEditingItem(null)} type="button">取消更正</button></form> : null}
  </li>;

  return <Dialog label="设计要求与偏好" onClose={onClose} returnFocusSelector="[data-assistant-requirements-trigger]" className={ui.drawer}>
    <header className={ui.drawerHeader}><h2>设计要求与偏好</h2><button className={styles.actionQuiet} onClick={onClose} type="button" aria-label="关闭设计要求与偏好">关闭</button></header>
    <div className={`${styles.contextContents} ${ui.drawerContents}`}>
      <p>让助手记住这个项目的设计要求。修改会影响后续讨论，已有设计结果保持不变。</p>
      {hasDraftReferences ? <p>你还有待发送引用。下方适用状态按已保存的讨论对象显示，发送时会根据新引用重新判断。</p> : null}
      {error ? <p role="alert">{userFacingError(error, "设计要求暂时无法读取或保存")}<button className={styles.actionSecondary} onClick={onRetry} type="button">重新读取</button></p> : null}
      {!context ? <p>直接在对话中描述你的设计要求，助手会在这里整理记录。</p> : <>
        <section><h3>项目目标</h3>{editingGoal ? <form onSubmit={(event) => { event.preventDefault(); if (goalDraft.trim()) void onUpdate({ currentObjective: goalDraft.trim() }).then((saved) => { if (saved) setEditingGoal(false); }); }}><textarea aria-label="更正项目目标" maxLength={4000} onChange={(event) => setGoalDraft(event.target.value)} rows={3} value={goalDraft} /><button className={styles.actionPrimary} disabled={saving || !goalDraft.trim()} type="submit">保存目标</button><button className={styles.actionQuiet} onClick={() => setEditingGoal(false)} type="button">取消</button></form> : <><p>{context.currentObjective || "尚未记录目标，请直接在对话中描述你想做的设计。"}</p>{context.objectiveOrigin === "inferred" ? <small>助手推测 · 未确认</small> : null}<button className={styles.actionSecondary} disabled={saving} onClick={() => { setGoalDraft(context.currentObjective ?? ""); setEditingGoal(true); }} type="button">更正项目目标</button></>}</section>
        <section><h3>明确要求</h3><small>项目记录在各会话共享；分支要求仅在适用范围内生效。</small>{active.some(({ item }) => item.origin === "explicit") ? <ul>{active.filter(({ item }) => item.origin === "explicit").map(({ item, preference }) => renderItem(item, preference))}</ul> : <p>暂无明确要求，直接在对话中告诉助手需要保留或避免什么。</p>}</section>
        <section><h3>助手推测</h3><small>这些理解尚未确认，可能参与后续规划。你可以确认或更正。</small>{active.some(({ item }) => item.origin === "inferred") ? <ul>{active.filter(({ item }) => item.origin === "inferred").map(({ item, preference }) => renderItem(item, preference))}</ul> : <p>暂无助手推测</p>}</section>
        {active.some(({ item }) => !item.origin) ? <section><h3>来源未标注的记录</h3><ul>{active.filter(({ item }) => !item.origin).map(({ item, preference }) => renderItem(item, preference))}</ul></section> : null}
        {inactive.length ? <details><summary>已停用记录（{inactive.length}）</summary><ul>{inactive.map(({ item, preference }) => renderItem(item, preference))}</ul></details> : null}
      </>}
    </div>
  </Dialog>;
}
