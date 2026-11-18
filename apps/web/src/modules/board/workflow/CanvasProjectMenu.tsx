"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, Input, Menu, Notice } from "../../../components/ui";
import { MotionReceipt } from "../../../components/motion/MotionReceipt";
import { useGuardedRouter } from "../../use-guarded-router";
import {
  useDeleteProject,
  useUpdateProject,
} from "../../projects/use-projects";
import { useProjectEntry } from "../../projects/ProjectEntryProvider";
import { validateProjectName } from "../../projects/project-name";
import { navigateAfterSave } from "../../navigation";
import { fetchStudio } from "../../studio/studio-api";
import { useAuth } from "../../auth/AuthProvider";
import {
  clearActiveBoardId,
  readActiveBoardId,
} from "../../trends/active-board";
import styles from "./workflow-canvas.module.css";

export function CanvasProjectMenu({
  projectId,
  projectName,
  canEdit,
}: {
  projectId: string;
  projectName: string;
  canEdit: boolean;
}) {
  const router = useGuardedRouter();
  const entry = useProjectEntry();
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <Menu
        label="项目菜单"
        className={styles.canvasProjectMenu}
        trigger={
          <>
            <MotionReceipt receiptKey={`project:${projectId}`}>
              <span title={projectName}>{projectName}</span>
            </MotionReceipt>
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="m7 10 5 5 5-5" />
            </svg>
          </>
        }
      >
        <button type="button" onClick={() => void router.push("/")}>
          回到主页
        </button>
        <button type="button" onClick={() => void router.push("/projects")}>
          全部项目
        </button>
        <hr />
        <button
          type="button"
          disabled={entry.creating}
          onClick={() => void entry.create()}
        >
          {entry.creating ? "正在创建…" : "创建新项目"}
        </button>
        <button
          type="button"
          disabled={!canEdit || entry.creating}
          onClick={() => setDeleting(true)}
        >
          删除项目
        </button>
      </Menu>
      {deleting ? (
        <DeleteProjectDialog
          projectId={projectId}
          projectName={projectName}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </>
  );
}

function DeleteProjectDialog({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const mutation = useDeleteProject();
  const permission = useQuery({
    queryKey: ["project-delete-permission", session?.user.id, projectId],
    queryFn: ({ signal }) => fetchStudio(projectId, signal),
    enabled: Boolean(session),
    staleTime: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const canDelete =
    permission.isSuccess &&
    !permission.isFetching &&
    permission.data.role === "OWNER";
  return (
    <Dialog
      label="删除项目"
      onClose={() => {
        if (!lock.current) onClose();
      }}
      returnFocusSelector="[data-canvas-chrome] summary"
    >
      <div className={styles.projectNameForm}>
        <h2>删除「{projectName}」？</h2>
        <p>项目及其设计资料将从工作区移除，此操作无法撤销。</p>
        {permission.isPending ? (
          <p role="status">正在确认项目权限…</p>
        ) : permission.isError ? (
          <Notice tone="error">
            无法确认删除权限。
            <Button onClick={() => void permission.refetch()}>重新读取</Button>
          </Notice>
        ) : !canDelete ? (
          <Notice>只有项目所有者可以删除项目。</Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div>
          <Button disabled={pending} onClick={onClose}>
            保留项目
          </Button>
          <Button
            variant="danger"
            disabled={!canDelete || pending}
            loading={pending}
            onClick={() => {
              if (lock.current || !canDelete) return;
              lock.current = true;
              setPending(true);
              setError(null);
              void (async () => {
                try {
                  if (!(await navigateAfterSave(() => undefined)))
                    throw new Error("画布尚未保存，请处理保存问题后重试删除。");
                  await mutation.mutateAsync(projectId);
                  if (readActiveBoardId() === projectId) clearActiveBoardId();
                  // Saving happened before deletion; do not save the removed project again.
                  router.replace("/");
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "删除项目失败，请重试。",
                  );
                  lock.current = false;
                  setPending(false);
                }
              })();
            }}
          >
            确认删除
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function RenameProjectDialog({
  projectId,
  projectName,
  onRename,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const mutation = useUpdateProject();
  const [name, setName] = useState(projectName);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  return (
    <Dialog
      label="重命名项目"
      onClose={() => {
        if (!lock.current) onClose();
      }}
      returnFocusSelector='[data-guide="workspace-functions"]'
    >
      <form
        className={styles.projectNameForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (lock.current) return;
          const problem = validateProjectName(name);
          if (problem) {
            setError(problem);
            return;
          }
          lock.current = true;
          setError(null);
          void mutation
            .mutateAsync({ id: projectId, input: { name: name.trim() } })
            .then((project) => {
              onRename(project.name);
              onClose();
            })
            .catch((cause) =>
              setError(
                cause instanceof Error ? cause.message : "重命名失败，请重试。",
              ),
            )
            .finally(() => {
              lock.current = false;
            });
        }}
      >
        <h2>重命名项目</h2>
        <label htmlFor="canvas-project-name">项目名称</label>
        <Input
          id="canvas-project-name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          disabled={mutation.isPending}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div>
          <Button disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={mutation.isPending}
            disabled={mutation.isPending}
          >
            保存名称
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
