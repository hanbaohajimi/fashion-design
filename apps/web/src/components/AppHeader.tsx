"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "../modules/auth/AuthProvider";
import { Button, Menu } from "./ui";
import { ArchiveNavigation, type ArchiveSection } from "./ArchiveNavigation";
import { useFeatureGuide } from "./feature-guide/FeatureGuideProvider";

export function AppHeader(props: {
  readonly current: ArchiveSection;
  readonly projectId?: string | undefined;
  readonly projectName?: string | undefined;
  readonly account?: ReactNode;
  readonly navigation?: ReactNode;
  readonly hideProjectReturn?: boolean;
  readonly currentIsParent?: boolean;
}) {
  return (
    <ArchiveNavigation {...props} account={props.account ?? <Account />} />
  );
}

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

function Account() {
  const guide = useFeatureGuide();
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const { session, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session || !hydrated) return null;
  return (
    <Menu label={session.user.email} trigger={session.user.name || session.user.email} guideAnchor="guide-help">
      {guide.available ? <Button onClick={guide.startGuide}>功能指引</Button> : null}
        <Button
          style={{ minHeight: 44 }}
          loading={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            void logout().catch(() => {
              setPending(false);
              setError("退出失败，请重试");
            });
          }}
        >
          退出登录
        </Button>
      {error ? <small role="alert">{error}</small> : null}
    </Menu>
  );
}
