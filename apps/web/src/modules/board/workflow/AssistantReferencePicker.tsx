"use client";
import { GridDetails } from "../../../components/GridDetails";

import { useState } from "react";
import { Button, Dialog, Input } from "../../../components/ui";
import type { WorkflowGraph, WorkflowNode } from "./workflow-api";
import { displayNodeTitle, nodeImageUrl } from "./workflow-graph";
import ui from "./assistant-context.module.css";

export const MAX_ASSISTANT_REFERENCES = 16;

function ReferencePreview({ node }: { readonly node: WorkflowNode }) {
  const [failed, setFailed] = useState(false);
  const url = nodeImageUrl(node);
  return url && !failed ? (
    // The same authenticated images are used by the workbench.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" onError={() => setFailed(true)} />
  ) : (
    <span className={ui.referencePlaceholder} aria-hidden="true">
      {node.type === "candidate"
        ? "方案"
        : node.kind === "tool"
          ? "工具"
          : "素材"}
    </span>
  );
}

export function AssistantReferencePicker({
  graph,
  selectedIds,
  onApply,
  onAddMaterial,
  onClose,
  onAfterClose,
  open = true,
}: {
  readonly open?: boolean;
  readonly graph: WorkflowGraph;
  readonly selectedIds: readonly string[];
  readonly onApply: (ids: readonly string[]) => void;
  readonly onAddMaterial: () => void;
  readonly onClose: () => void;
  readonly onAfterClose?: (() => void) | undefined;
}) {
  const [query, setQuery] = useState("");
  const [ids, setIds] = useState(() =>
    selectedIds.filter((id) => graph.nodes.some((node) => node.id === id)),
  );
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) { setQuery(""); setIds(selectedIds.filter((id) => graph.nodes.some((node) => node.id === id))); }
  }
  const availableIds = ids.filter((id) =>
    graph.nodes.some((node) => node.id === id),
  );
  const matches = graph.nodes.filter((node) =>
    displayNodeTitle(node)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const assets = matches.filter((node) => node.kind === "asset");
  const tools = matches.filter((node) => node.kind === "tool");
  const row = (node: WorkflowNode) => (
    <label className={ui.referenceOption} key={node.id}>
      <input
        type="checkbox"
        checked={availableIds.includes(node.id)}
        disabled={
          !availableIds.includes(node.id) &&
          availableIds.length >= MAX_ASSISTANT_REFERENCES
        }
        onChange={(event) =>
          setIds(
            event.target.checked
              ? [...new Set([...availableIds, node.id])]
              : availableIds.filter((id) => id !== node.id),
          )
        }
      />
      <ReferencePreview node={node} />
      <span>
        <strong>{displayNodeTitle(node)}</strong>{" "}
        <small>
          {node.type === "candidate"
            ? "服装方案"
            : node.kind === "tool"
              ? "设计工具"
              : "参考素材"}
          {graph.nodes.filter((item) => item.title === node.title).length > 1
            ? ` ${node.id}`
            : ""}
        </small>
      </span>
    </label>
  );

  return (
    <Dialog
      open={open}
      label="添加引用"
      onClose={onClose}
      onAfterClose={onAfterClose}
      returnFocusSelector="[data-assistant-reference-trigger]"
      className={ui.referencePicker}
    >
      <header className={ui.drawerHeader}>
        <h2>添加引用</h2>
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
      </header>
      <div className={ui.pickerContents}>
        <label className={ui.fieldLabel}>
          搜索项目对象
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入素材或方案名称"
          />
        </label>
        <p className={ui.helper} role="status">
          已选 {availableIds.length} / {MAX_ASSISTANT_REFERENCES} 项
          {availableIds.length >= MAX_ASSISTANT_REFERENCES
            ? "，请先取消一项再添加。"
            : "；引用将在发送需求时交给助手。"}
        </p>
        <div className={ui.referenceList}>
          {assets.map(row)}
          {!assets.length ? (
            <p>
              {query.trim()
                ? "没有匹配的素材或方案，请换个名称搜索。"
                : "项目中还没有素材或服装方案。"}
            </p>
          ) : null}
          {tools.length ? (
            <GridDetails>
              <summary>设计工具（{tools.length}）</summary>
              {tools.map(row)}
            </GridDetails>
          ) : null}
        </div>
      </div>
      <footer className={ui.pickerFooter}>
        <Button onClick={onAddMaterial}>去添加素材</Button>
        <Button variant="primary" onClick={() => onApply(availableIds)}>
          使用所选引用
        </Button>
      </footer>
    </Dialog>
  );
}
