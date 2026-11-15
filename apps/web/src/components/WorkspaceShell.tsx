"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Profiler, useMemo, type ReactNode } from "react";
import { useAuth } from "../modules/auth/AuthProvider";
import { profileWorkspaceCommit } from "./workspace-profiler";
import { DraftScopeProvider } from "./drafts/use-persistent-draft";
import { WorkspaceChrome } from "./WorkspaceChrome";
import { workspaceRoute } from "../modules/workspace-route";

/** Shared context; each page retains its document-flow or viewport scrolling contract. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const pathname = usePathname();
  const query = useSearchParams();
  const route = workspaceRoute(pathname);
  const { projectId, document: documentLayout, independent } = route;
  const editor = route.studio ? `studio:${query.get("tab") ?? "tasks"}` : "workspace";
  const scope = useMemo(() => session && projectId
    ? { accountId: session.user.id, projectId, editor } : null, [session, projectId, editor]);
  return <Profiler id="workspace" onRender={profileWorkspaceCommit}><DraftScopeProvider scope={scope}><div data-workspace-shell data-workspace-layout={documentLayout ? "document" : "viewport"} style={{ display: "contents" }}>
    <WorkspaceChrome accountId={independent ? null : session?.user.id ?? null} navigation={route.canvas ? "none" : "standard"} kind={documentLayout ? "document" : "creation"} routeKey={`${pathname}?${query.toString()}`}>{children}</WorkspaceChrome>
  </div></DraftScopeProvider></Profiler>;
}
