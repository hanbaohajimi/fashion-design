import type { CoutureEffect } from "./presets";
import { isTaskActive } from "../task-feedback-state";

// Short-lived UI receipts only; no persistence and no historical replay.
const receipts = new Map<
  string,
  { effect: CoutureEffect; at: number; eventKey: string }
>();
export function markMotion(
  key: string,
  effect: CoutureEffect,
  eventKey = key,
): void {
  receipts.set(key, { effect, eventKey, at: Date.now() });
  const oldest = receipts.keys().next().value;
  if (receipts.size > 100 && oldest) receipts.delete(oldest);
}
export function takeMotion(key: string) {
  const receipt = receipts.get(key);
  receipts.delete(key);
  return receipt && Date.now() - receipt.at < 10_000 ? receipt : undefined;
}

const taskStates = new Map<string, string>();
let sequence = 0;
/** Multiple views may observe one task, but only one may claim its transition. */
export function claimTaskMotion(key: string, status: string, changed: boolean) {
  const receipt = takeMotion(key);
  const prior = taskStates.get(key);
  taskStates.set(key, status);
  const oldest = taskStates.keys().next().value;
  if (taskStates.size > 200 && oldest) taskStates.delete(oldest);
  const active = isTaskActive(status);
  if (receipt && (receipt.effect !== "needle" || active)) return receipt;
  if (changed && active && prior !== status)
    return {
      effect: "thread" as const,
      eventKey: `${key}:${status}:${++sequence}`,
    };
  return undefined;
}
