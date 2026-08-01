"use client";

import { type FormEvent, useRef, useState } from "react";

import { readErrorMessage } from "../../../modules/auth/auth-api";
import styles from "./login.module.css";

type FormState = "idle" | "sending" | "sent";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  async function sendLoginLink(targetEmail: string): Promise<void> {
    if (state === "sending") {
      return;
    }

    const normalizedEmail = targetEmail.trim().toLowerCase();
    setError(null);
    setState("sending");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ action: "send", email: normalizedEmail }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        setError(
          await readErrorMessage(response, "登录邮件发送失败，请稍后重试。"),
        );
        setState("idle");
        return;
      }

      setEmail(normalizedEmail);
      setSentEmail(normalizedEmail);
      setState("sent");
    } catch {
      setError("无法连接认证服务，请检查网络后重试。");
      setState("idle");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendLoginLink(email);
  }

  function changeEmail(): void {
    setError(null);
    setSentEmail(null);
    setState("idle");
    window.setTimeout(() => emailInputRef.current?.focus(), 0);
  }

  return (
    <main className={styles.page}>
      <section className={styles.patternPanel} aria-label="平台介绍">
        <p className={styles.brand}>AI Fashion Design / Atelier 01</p>
        <h1>
          从一根线，
          <em>生成系列。</em>
        </h1>
        <div className={styles.cutPiece} aria-hidden="true" />
      </section>

      <section className={styles.formPanel}>
        <p className={styles.step}>Secure entry · 01</p>
        <h2>回到设计台</h2>
        <p className={styles.intro}>
          输入工作邮箱。我们会发送一条一次性安全链接，无需记住密码。
        </p>

        <form
          aria-busy={state === "sending"}
          className={styles.form}
          onSubmit={handleSubmit}
        >
          <label htmlFor="email">邮箱地址</label>
          <input
            aria-describedby={
              error ? "login-error" : sentEmail ? "login-status" : undefined
            }
            autoCapitalize="none"
            autoComplete="email"
            autoFocus
            disabled={state === "sending" || Boolean(sentEmail)}
            enterKeyHint="send"
            id="email"
            inputMode="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="designer@example.com"
            ref={emailInputRef}
            required
            spellCheck={false}
            type="email"
            value={email}
          />
          <button
            disabled={state === "sending" || state === "sent"}
            type="submit"
          >
            {state === "sending"
              ? "正在发送…"
              : sentEmail
                ? "邮件已发送"
                : "发送登录链接"}
          </button>
        </form>

        {sentEmail ? (
          <>
            <p className={styles.message} id="login-status" role="status">
              请检查 {sentEmail} 的收件箱，并在同一浏览器中打开登录链接。
            </p>
            <div className={styles.messageActions}>
              <button
                disabled={state === "sending"}
                onClick={() => void sendLoginLink(sentEmail)}
                type="button"
              >
                重新发送
              </button>
              <button
                disabled={state === "sending"}
                onClick={changeEmail}
                type="button"
              >
                换个邮箱
              </button>
            </div>
          </>
        ) : null}
        {error ? (
          <p
            className={`${styles.message} ${styles.error}`}
            id="login-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
