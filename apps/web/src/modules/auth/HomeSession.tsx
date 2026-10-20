"use client";

import { useAuth } from "./AuthProvider";
import styles from "../../components/feedback.module.css";

export function HomeSession() {
  const { error, loading, session } = useAuth();

  if (loading) {
    return <p className={styles.sessionStatus}>正在确认安全会话…</p>;
  }

  if (error) {
    return (
      <p className={`${styles.sessionStatus} ${styles.sessionError}`} role="alert">
        {error}
      </p>
    );
  }

  return session ? (
    <p className={styles.sessionStatus}>
      已登录为 <strong>{session.user.email}</strong>
    </p>
  ) : null;
}
