"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/AuthProvider";
import { useGuardedRouter } from "../use-guarded-router";
import { navigateAfterSave } from "../navigation";
import { Button } from "../../components/ui";
import { useCreateProject } from "./use-projects";
import {
  canvasShortcutHref,
  projectDestinationHref,
  type HomeShortcut,
  type ProjectDestination,
} from "./workspace-tools";
import styles from "./home.module.css";

interface EntryActions {
  create: (destination?: ProjectDestination) => Promise<void>;
  start: (shortcut: HomeShortcut) => Promise<void>;
  creating: boolean;
}
const EntryContext = createContext<EntryActions>({
  create: async () => undefined,
  start: async () => undefined,
  creating: false,
});
export const useProjectEntry = () => useContext(EntryContext);

interface CreationIntent {
  target: ProjectDestination;
  shortcut: HomeShortcut | null;
}

export function ProjectEntryProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return (
    <ProjectEntrySession
      key={session?.user.id ?? "anonymous"}
      accountId={session?.user.id}
    >
      {children}
    </ProjectEntrySession>
  );
}

function ProjectEntrySession({
  accountId,
  children,
}: {
  accountId: string | undefined;
  children: ReactNode;
}) {
  const router = useGuardedRouter();
  const mutation = useCreateProject();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const intent = useRef<CreationIntent>({ target: "canvas", shortcut: null });
  const requestKeys = useRef(new Map<string, string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const runCreate = async (next: CreationIntent) => {
    if (lock.current || !accountId) return;
    lock.current = true;
    intent.current = next;
    setCreating(true);
    setError(null);
    try {
      if (!(await navigateAfterSave(() => undefined))) {
        if (alive.current) setError("当前修改尚未保存，请处理保存问题后重试。");
        return;
      }
      if (!alive.current) return;
      const storageKey = `fashion:quick-project:${accountId}:${next.shortcut ? "canvas:" : ""}${next.target}`;
      let key = requestKeys.current.get(storageKey);
      if (!key) {
        try {
          key = sessionStorage.getItem(storageKey) ?? undefined;
        } catch {
          /* In-memory retries remain available. */
        }
        key ??= crypto.randomUUID();
        requestKeys.current.set(storageKey, key);
        try {
          sessionStorage.setItem(storageKey, key);
        } catch {
          /* The request identity is retained in memory. */
        }
      }
      const project = await mutation.mutateAsync({
        name: "未命名项目",
        idempotencyKey: key,
      });
      if (!alive.current) return;
      const href = next.shortcut
        ? canvasShortcutHref(project.id, next.shortcut)
        : projectDestinationHref(project.id, next.target);
      if (await router.push(href)) {
        requestKeys.current.delete(storageKey);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Creation and navigation are confirmed. */
        }
      } else setError("项目已创建，请保存当前修改后重试进入。");
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error ? cause.message : "项目创建失败，请重试。",
        );
    } finally {
      lock.current = false;
      if (alive.current) setCreating(false);
    }
  };
  return (
    <EntryContext
      value={{
        create: (target = "canvas") => runCreate({ target, shortcut: null }),
        start: (shortcut) => runCreate({ target: shortcut, shortcut }),
        creating,
      }}
    >
      {children}
      {error ? (
        <div className={styles.creationError} role="alert">
          <span>{error}</span>
          <Button
            disabled={creating}
            onClick={() => void runCreate(intent.current)}
          >
            重试创建
          </Button>
          <Button disabled={creating} onClick={() => setError(null)}>
            关闭
          </Button>
        </div>
      ) : null}
    </EntryContext>
  );
}
