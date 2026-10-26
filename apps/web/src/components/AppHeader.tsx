"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "../modules/auth/AuthProvider";
import { Button, Menu } from "./ui";
import { ArchiveNavigation, type ArchiveSection } from "./ArchiveNavigation";

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

function Account() {
  const { session, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;
  return (
    <div>
      <Menu label={session.user.email} trigger="账户">
        <Button
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
      </Menu>
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
