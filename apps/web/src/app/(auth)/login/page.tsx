"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import { Button, Input } from "../../../components/ui";
import { BrandLockup } from "../../../components/BrandLockup";
import { useSubmitFeedback } from "../../../components/interactions/use-submit-feedback";
import { motionEase, motionTime } from "../../../components/interactions/motion-policy";
import { readErrorMessage } from "../../../modules/auth/auth-api";
import styles from "./forest-login.module.css";

type FormState = "idle" | "sending" | "sent";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [formatValid, setFormatValid] = useState(false);
  const [composing, setComposing] = useState(false);
  const feedback = useSubmitFeedback();
  const flight = useRef(false);
  const validate = () => {
    const valid = emailInputRef.current?.validity.valid ?? false;
    const message = valid ? null : "请输入有效的邮箱地址。";
    setFormatError(message);
    setFormatValid(valid);
    return valid;
  };
  useEffect(() => {
    if (composing || !email.trim()) return;
    const timer = setTimeout(() => {
      const valid = emailInputRef.current?.validity.valid ?? false;
      setFormatError(valid ? null : "请输入有效的邮箱地址。");
      setFormatValid(valid);
    }, 400);
    return () => clearTimeout(timer);
  }, [email, composing]);

  async function sendLoginLink(targetEmail: string): Promise<void> {
    if (flight.current || state === "sending") {
      return;
    }

    const normalizedEmail = targetEmail.trim().toLowerCase();
    setError(null);
    setState("sending");
    flight.current = true;
    const receipt = feedback.begin("login");

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
        receipt.fail();
        return;
      }

      setEmail(normalizedEmail);
      setSentEmail(normalizedEmail);
      setState("sent");
      receipt.succeed();
    } catch {
      setError("无法连接认证服务，请检查网络后重试。");
      setState("idle");
      receipt.fail();
    } finally {
      flight.current = false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    void sendLoginLink(email);
  }

  function changeEmail(): void {
    setError(null);
    setSentEmail(null);
    setState("idle");
    setFormatError(null);
    setFormatValid(false);
    feedback.reset();
    window.setTimeout(() => emailInputRef.current?.focus(), 0);
  }

  return (
    <main className={styles.page}>
      <aside className={styles.brandPanel} aria-label="森织 设计工作室">
        <BrandLockup size={360} className={styles.brand} />
        <div className={styles.brandStory}>
          <h2>
            从灵感到交付，
            <br />
            让每一版都有来处。
          </h2>
          <p>
            收集素材、推敲方案、整理款式与技术资料。
            <br />
            登录后继续你的设计。
          </p>
        </div>
      </aside>
      <div className={styles.formRegion}>
        <section className={styles.formPanel} aria-labelledby="auth-title">
          <div className={styles.formHeader}>
            <h1 className={styles.formTitle} id="auth-title">
              登录或注册
            </h1>
            <p className={styles.intro}>
              输入邮箱，我们会向你发送一次性登录链接。首次使用的邮箱将自动完成注册。
            </p>
          </div>

          <form
            aria-busy={state === "sending"}
            className={styles.form}
            onSubmit={handleSubmit}
          >
            <label htmlFor="email">邮箱地址</label>
            <Input
              aria-describedby={
                [formatError || formatValid ? "login-format" : null, error ? "login-error" : null, sentEmail ? "login-status" : null].filter(Boolean).join(" ") || undefined
              }
              aria-invalid={Boolean(formatError) || undefined}
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
              disabled={state === "sending" || Boolean(sentEmail)}
              enterKeyHint="send"
              id="email"
              inputMode="email"
              name="email"
              onChange={(event) => { setEmail(event.target.value); setError(null); setFormatValid(!composing && Boolean(formatError) && event.target.validity.valid); if (!composing && (event.target.validity.valid || !event.target.value)) setFormatError(null); }}
              onBlur={() => { if (!composing && email) validate(); }}
              onCompositionStart={() => { setComposing(true); setFormatValid(false); }}
              onCompositionEnd={() => setComposing(false)}
              onInvalid={(event) => {
                event.preventDefault();
                setFormatError("请输入有效的邮箱地址。");
                setFormatValid(false);
                event.currentTarget.focus();
                const duration = motionTime("--motion-content-enter", 400);
                if (duration) event.currentTarget.animate?.([0, -4, 4, -2, 2, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration, easing: motionEase() });
              }}
              placeholder="designer@example.com"
              ref={emailInputRef}
              required
              spellCheck={false}
              type="email"
              value={email}
            />
            <small id="login-format" className={styles.validation} data-error={Boolean(formatError)} data-valid={formatValid} role={formatError ? "alert" : undefined}>{formatError ?? (formatValid ? <span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="m4 10 4 4 8-9" pathLength="1" stroke="currentColor" strokeWidth="1.5" /></svg>邮箱格式有效</span> : null)}</small>
            <Button
              variant="primary"
              disabled={state === "sending" || state === "sent"}
              type="submit"
              loading={state === "sending"}
              feedback={feedback.snapshot}
              feedbackAction="login"
            >
              {state === "sending"
                ? "正在发送…"
                : sentEmail
                  ? "邮件已发送"
                  : "发送登录链接"}
            </Button>
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
      </div>
    </main>
  );
}
