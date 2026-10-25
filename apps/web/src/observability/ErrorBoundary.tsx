"use client";

import * as Sentry from "@sentry/nextjs";
import styles from "../components/feedback.module.css";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";

interface ErrorBoundaryProps {
  readonly area: "board" | "collection" | "generation";
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.withScope((scope) => {
      scope.setTag("area", this.props.area);
      scope.setTag("runtime", "browser");
      Sentry.captureException(error, {
        contexts: {
          react: {
            component_stack_present: Boolean(info.componentStack),
          },
        },
      });
    });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section
        aria-live="assertive"
        className={styles.card}
        data-area={this.props.area}
        role="alert"
      >
        <span className={styles.brand}>森织 设计工作室</span>
        <strong>出现了一点问题，已自动上报</strong>
        <p>你的项目数据仍会保留，可以重新载入这一部分继续工作。</p>
        <button
          onClick={() => this.setState({ failed: false })}
          type="button"
        >
          重试
        </button>
      </section>
    );
  }
}
