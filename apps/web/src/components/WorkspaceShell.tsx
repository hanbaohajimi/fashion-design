"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Profiler, useMemo, type ReactNode } from "react";
import { useAuth } from "../modules/auth/AuthProvider";
import { profileWorkspaceCommit } from "./workspace-profiler";
import { DraftScopeProvider } from "./drafts/use-persistent-draft";

/** Shared context; each page retains its document-flow or viewport scrolling contract. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const pathname = usePathname();
  const query = useSearchParams();
  const projectId = pathname.split("/")[1] ?? "";
  const documentLayout = !projectId || ["login", "auth", "fabrics", "trends", "share", "prototypes"].includes(projectId) || pathname.endsWith("/studio");
  const editor = pathname.endsWith("/studio") ? `studio:${query.get("tab") ?? "tasks"}` : "workspace";
  const scope = useMemo(() => session && projectId && !["login", "auth", "fabrics", "trends", "share", "prototypes"].includes(projectId)
    ? { accountId: session.user.id, projectId, editor } : null, [session, projectId, editor]);
  return <Profiler id="workspace" onRender={profileWorkspaceCommit}><DraftScopeProvider scope={scope}><div data-workspace-shell data-workspace-layout={documentLayout ? "document" : "viewport"} style={{ display: "contents" }}>{children}</div></DraftScopeProvider></Profiler>;
}
