"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "../../../components/AppHeader";
import { Button, ChoiceSelect, Notice, Skeleton } from "../../../components/ui";
import { DraftScopeProvider } from "../../../components/drafts/use-persistent-draft";
import { useAuth } from "../../auth/AuthProvider";
import { useGuardedRouter } from "../../use-guarded-router";
import { useProjectEntry } from "../../projects/ProjectEntryProvider";
import {
  readCreativeVisit,
  rememberCreativeVisit,
} from "../../projects/creative-memory";
import {
  fetchProject,
  fetchProjects,
  ProjectApiError,
} from "../../projects/projects-api";
import type { Project } from "../../projects/project-types";
import { workspaceRoute } from "../../workspace-route";
import { fetchStudio } from "../studio-api";
import { useStudioLeaveGuard } from "../studio-ui";
import { StudioHeaderContext } from "../StudioPageHeader";
import { WardrobeWorkspace } from "./WardrobeWorkspace";
import styles from "./wardrobe-page.module.css";

export function WardrobePage() {
  const { session, loading } = useAuth();
  const router = useGuardedRouter();
  useEffect(() => {
    if (!loading && !session) void router.replace("/login");
  }, [loading, session, router]);
  if (!session)
    return (
      <main className={styles.page}>
        <p role="status">正在打开衣橱…</p>
      </main>
    );
  return <ProjectWardrobe key={session.user.id} accountId={session.user.id} />;
}

/** Fetch every authorized page so the compact searchable selector never hides older projects. */
async function projectOptions(signal: AbortSignal) {
  const items: Project[] = [];
  let page = 1;
  for (;;) {
    const result = await fetchProjects(page, "", "active", signal);
    items.push(...result.items.filter((item) => !item.optimistic));
    if (!result.hasMore) return items;
    page += 1;
  }
}

function ProjectWardrobe({ accountId }: { accountId: string }) {
  const router = useGuardedRouter();
  const entry = useProjectEntry();
  const requested = useSearchParams().get("projectId");
  const [remembered, setRemembered] = useState(
    () => readCreativeVisit(accountId)?.projectId ?? null,
  );
  const [dirty, setDirty] = useState(false);
  const [switching, setSwitching] = useState(false);
  const guard = useStudioLeaveGuard(dirty);
  const projects = useQuery({
    queryKey: ["wardrobe-project-options", accountId],
    queryFn: ({ signal }) => projectOptions(signal),
  });
  const projectId = requested ?? remembered ?? projects.data?.[0]?.id ?? null;
  const validProjectId =
    projectId && workspaceRoute(`/${projectId}`).projectId === projectId;
  const selected = useQuery({
    queryKey: ["wardrobe-project", accountId, projectId],
    enabled: Boolean(validProjectId),
    queryFn: async ({ signal }) => {
      if (!projectId || !validProjectId) throw new Error("项目地址无效");
      const project = await fetchProject(projectId);
      const studio = await fetchStudio(projectId, signal);
      return { project, studio };
    },
    retry: false,
  });
  // Discard only an invalid default selection before committing a new view.
  if (
    !requested &&
    remembered &&
    selected.error instanceof ProjectApiError &&
    [403, 404].includes(selected.error.status)
  )
    setRemembered(null);
  useEffect(() => {
    if (selected.data && projectId)
      rememberCreativeVisit(
        accountId,
        projectId,
        `/${encodeURIComponent(projectId)}`,
      );
  }, [accountId, projectId, selected.data]);
  const scope = useMemo(
    () =>
      projectId
        ? { accountId, projectId, editor: "studio:presentation" }
        : null,
    [accountId, projectId],
  );
  const options = (projects.data ?? []).map((project) => ({
    value: project.id,
    label: project.name,
  }));
  if (
    selected.data &&
    !options.some((item) => item.value === selected.data.project.id)
  )
    options.unshift({
      value: selected.data.project.id,
      label: selected.data.project.name,
    });
  const currentOption = options.find((item) => item.value === projectId);
  if (currentOption)
    options.splice(0, 0, ...options.splice(options.indexOf(currentOption), 1));
  const heading = (
    <div className={styles.heading}>
      <h1>衣橱</h1>
      <ChoiceSelect
        aria-label="衣橱项目"
        compact
        searchable
        motionVariant="glide"
        value={projectId ?? ""}
        placeholder={projects.isPending ? "正在读取项目…" : "选择项目"}
        options={options}
        pending={switching}
        disabled={!options.length}
        className={styles.projectSelect}
        onValueChange={(id) => {
          if (id === projectId || switching) return;
          setSwitching(true);
          void router
            .push(`/wardrobe?projectId=${encodeURIComponent(id)}`)
            .then((moved) => {
              if (moved) {
                setDirty(false);
                setRemembered(id);
              }
            })
            .finally(() => setSwitching(false));
        }}
      />
    </div>
  );
  return (
    <main className={styles.page}>
      <AppHeader current="wardrobe" {...(projectId ? { projectId } : {})} />
      {projects.isError ? (
        <Notice tone="error">
          项目列表读取失败。
          <Button onClick={() => void projects.refetch()}>重新读取</Button>
        </Notice>
      ) : null}
      {selected.data ? (
        <DraftScopeProvider scope={scope}>
          <StudioHeaderContext
            value={{
              readOnly: !selected.data.studio.capabilities.edit,
              actions: (
                <Button
                  onClick={() =>
                    void router.push(
                      `/${encodeURIComponent(selected.data.project.id)}`,
                    )
                  }
                >
                  返回画布
                </Button>
              ),
            }}
          >
            <WardrobeWorkspace
              key={projectId}
              projectId={selected.data.project.id}
              heading={heading}
              assets={selected.data.studio.assets}
              styles={selected.data.studio.styles}
              canEdit={selected.data.studio.capabilities.edit}
              onDirty={setDirty}
              onSaved={async () => {
                await selected.refetch();
              }}
            />
          </StudioHeaderContext>
        </DraftScopeProvider>
      ) : (
        <>
          {heading}
          {projectId && !validProjectId ? (
            <Notice tone="error">项目地址无效，请选择一个可访问的项目。</Notice>
          ) : selected.isError ? (
            <Notice tone="error">
              衣橱未能打开：{selected.error.message}
              <Button onClick={() => void selected.refetch()}>重试</Button>
            </Notice>
          ) : projects.isPending || projectId ? (
            <Skeleton label="正在读取项目衣橱" className={styles.skeleton} />
          ) : !projects.isError ? (
            <div className={styles.empty}>
              <h2>从第一个项目开始整理衣橱</h2>
              <p>每个项目分别保存单品与搭配。</p>
              <Button
                variant="primary"
                loading={entry.creating}
                onClick={() => void entry.create("wardrobe")}
              >
                新建项目
              </Button>
            </div>
          ) : null}
        </>
      )}
      {guard.dialog}
    </main>
  );
}
