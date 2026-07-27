"use client";

import { useAuth } from "./AuthProvider";

export function HomeSession() {
  const { error, loading, session } = useAuth();

  if (loading) {
    return <p className="session-status">正在确认安全会话…</p>;
  }

  if (error) {
    return (
      <p className="session-status session-status-error" role="alert">
        {error}
      </p>
    );
  }

  return session ? (
    <p className="session-status">
      已登录为 <strong>{session.user.email}</strong>
    </p>
  ) : null;
}
