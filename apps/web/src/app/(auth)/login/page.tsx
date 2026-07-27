"use client";

import { type FormEvent, useState } from "react";

import { readErrorMessage } from "../../../modules/auth/auth-api";
import styles from "./login.module.css";

type FormState = "idle" | "sending" | "sent";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setState("sending");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ action: "send", email }),
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

      setState("sent");
    } catch {
      setError("无法连接认证服务，请检查网络后重试。");
      setState("idle");
    }
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

        <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor="email">邮箱地址</label>
          <input
            autoComplete="email"
            autoFocus
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="designer@example.com"
            required
            type="email"
            value={email}
          />
          <button
            disabled={state === "sending" || state === "sent"}
            type="submit"
          >
            {state === "sending"
              ? "正在发送…"
              : state === "sent"
                ? "邮件已发送"
                : "发送登录链接"}
          </button>
        </form>

        {state === "sent" ? (
          <p className={styles.message} role="status">
            请检查 {email} 的收件箱，并在同一浏览器中打开登录链接。
          </p>
        ) : null}
        {error ? (
          <p className={`${styles.message} ${styles.error}`} role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
