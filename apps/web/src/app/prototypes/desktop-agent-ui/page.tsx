"use client";

import { useState } from "react";
import { useWorkspaceLayout } from "../../../modules/board/workflow/use-workspace-layout";
import { WorkspaceSplit } from "../../../components/WorkspaceSplit";
import { AssistantComposer } from "../../../components/AssistantComposer";
import { Button } from "../../../components/ui";

/** Isolated structural fixture. No project reads, writes or model calls. */
export default function DesktopAgentPrototype() {
  const { mode } = useWorkspaceLayout();
  const [view, setView] = useState("作品");
  const [open, setOpen] = useState(true);
  const [prompt, setPrompt] = useState("");
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--color-canvas)" }}>
    <header style={{ display: "flex", flexWrap: "wrap", padding: 16, gap: 12, borderBottom: "0.5px solid var(--color-border)" }}><strong>结构预览</strong>{["作品", "技术包", "项目库"].map(label => <Button key={label} aria-pressed={view === label} onClick={() => setView(label)}>{label}</Button>)}<Button onClick={() => setOpen(!open)}>{open ? "收起助手" : "打开助手"}</Button></header>
    <WorkspaceSplit docked={mode === "docked"} open={open} onOpenChange={setOpen} projectId="isolated-prototype" style={{ flex: 1 }}>
      <section style={{ display: mode === "mobile" && open ? "none" : "block", padding: 24, overflow: "auto" }}><h1 style={{ fontSize: 24 }}>{view === "作品" ? "秋冬通勤外套" : view}</h1><p>修订 3</p>{view === "技术包" ? <><h2>材料与尺寸</h2><table><tbody><tr><th>材料</th><td>棉麻混纺</td></tr><tr><th>衣长</th><td>待人工复核</td></tr></tbody></table></> : <div style={{ display: "grid", placeItems: "center", minHeight: 420, background: "var(--image-stage-background)", border: "0.5px solid var(--color-border)" }}>完整作品预览</div>}</section>
      <aside hidden={!open} style={{ display: open ? "flex" : "none", flexDirection: "column", padding: 16, background: "var(--color-paper)" }}><h2 style={{ fontSize: 16 }}>设计助手</h2><p style={{ flex: 1 }}>当前讨论对象：通勤外套</p><label htmlFor="prototype-composer">描述设计需求</label><AssistantComposer id="prototype-composer" value={prompt} onChange={event => setPrompt(event.target.value)} onSend={() => undefined} /><Button>发送需求</Button></aside>
    </WorkspaceSplit>
  </main>;
}
