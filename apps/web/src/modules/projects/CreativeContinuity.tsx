"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { rememberCreativeVisit } from "./creative-memory";
import { workspaceRoute } from "../workspace-route";
export function CreativeContinuity() {
  const pathname = usePathname();
  const { session } = useAuth();
  useEffect(() => {
    const { projectId } = workspaceRoute(pathname);
    if (!session || !projectId) return;
    const save = () => { if (window.location.pathname === pathname) rememberCreativeVisit(session.user.id, projectId, window.location.pathname + window.location.search); };
    save();
    document.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    return () => { save(); document.removeEventListener("visibilitychange", save); window.removeEventListener("pagehide", save); };
  }, [pathname, session]);
  return null;
}
