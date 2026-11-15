import { Fragment, type ReactNode } from "react";
import { Tooltip } from "../../../components/ui";
import {
  StatusMark,
  type StatusMarkState,
} from "../../../components/StatusMark";
import type { AssistantFeedbackModel } from "./assistant-action-feedback";
import styles from "./assistant-action-feedback.module.css";

function FeedbackName({ name }: { name: string }) {
  const characters = Array.from(name);
  if (characters.length <= 36) return <>{name}</>;
  return (
    <span className={styles.resourceName}>
      <Tooltip content={name} className={styles.fullNameTooltip}>
        <span tabIndex={0} aria-label={name} className={styles.nameTrigger}>
          {characters.slice(0, 36).join("")}…
        </span>
      </Tooltip>
    </span>
  );
}

export function AssistantActionFeedback({
  model,
  actionId,
  live = false,
  children,
}: {
  model: AssistantFeedbackModel;
  actionId?: string;
  live?: boolean;
  children?: ReactNode;
}) {
  const names = model.names.length > 4 ? model.names.slice(0, 3) : model.names;
  const stackedNames =
    names.length > 1 && names.some((name) => Array.from(name).length > 36);
  const mark: StatusMarkState =
    model.state === "succeeded"
      ? "done"
      : model.state === "pending"
        ? model.waiting
          ? "pending"
          : "running"
        : model.state === "partial_failed"
          ? "partial"
          : model.state === "unconfirmed"
            ? "unconfirmed"
            : model.state === "canceled"
              ? "cancelled"
              : "failed";
  return (
    <div
      className={styles.feedback}
      data-assistant-feedback
      data-canvas-action-id={actionId}
      data-state={model.state}
      data-presentation={model.block && !model.compact ? "block" : "inline"}
      data-compact={model.compact || undefined}
      title={model.compact ? model.names.join("、") : undefined}
      aria-label={model.compact ? [model.title, model.names.join("、"), model.method].filter(Boolean).join("，") : undefined}
      role={live && model.state === "failed" ? "alert" : "status"}
      aria-live={live ? "polite" : "off"}
      aria-atomic="true"
    >
      <div className={styles.heading}>
        <span className={styles.mark} data-feedback-mark={model.state}>
          <StatusMark status={mark} decorative />
        </span>
        <strong className={styles.title} data-feedback-title>
          {model.title}
        </strong>
      </div>
      {model.compact && model.method ? <span className={styles.inlineMethod}>{model.method}</span> : null}
      {!model.compact && (names.length || model.destination || model.method) ? (
        <div className={styles.scope} data-feedback-scope>
          {names.length ? (
            <span className={stackedNames ? styles.stackedNames : undefined}>
              {names.map((name, index) => (
                <Fragment key={`${index}:${name}`}>
                  {index && !stackedNames ? "、" : null}
                  <FeedbackName name={name} />
                </Fragment>
              ))}
              {model.names.length > names.length
                ? `，另有 ${model.names.length - names.length} 项`
                : ""}
            </span>
          ) : null}
          {model.destination ? (
            <span className={styles.destination}>
              {names.length ? (
                <>
                  <span className={styles.direction} aria-hidden="true">
                    →
                  </span>
                  <span className={styles.sr}>连接到</span>
                </>
              ) : null}
              <span>
                <FeedbackName name={model.destination} />
              </span>
            </span>
          ) : null}
          {model.method ? (
            <span className={styles.method}>{model.method}</span>
          ) : null}
        </div>
      ) : null}
      {model.note ? (
        <p className={styles.note} data-feedback-note>
          {model.note}
        </p>
      ) : null}
      {model.error ? <p className={styles.reason}>{model.error}</p> : null}
      {children ? <div className={styles.actions}>{children}</div> : null}
    </div>
  );
}
