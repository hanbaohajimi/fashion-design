import type { ProjectTaskActivity, ProjectTaskPage, ProjectTaskTerminal } from "@fashion/shared";
import { CharacterDialogue, type CharacterSpeech, type CharacterStatus } from "./character-dialogue";

export interface ChatActivity {
  readonly conversationId: string | null;
  readonly phase: "idle" | "sending" | "replying" | "awaiting_confirmation" | "uncertain";
}
export const IDLE_CHAT_ACTIVITY: ChatActivity = { conversationId: null, phase: "idle" };
export interface CharacterPresentation {
  readonly scene: "idle" | "thinking" | "working" | "needs_attention";
  readonly label: string;
  readonly status: CharacterStatus;
  readonly speech?: CharacterSpeech;
  readonly activityKey: string;
  readonly feedback?: { readonly id: string; readonly kind: "success" | "failure"; readonly label: string };
}

/** Old servers can still describe active work, but cannot establish a terminal event. */
function legacyActivity(page?: ProjectTaskPage): ProjectTaskActivity {
  let preparing = 0, queued = 0, executing = 0;
  const waiting = { input: 0, confirmation: 0, resume: 0 };
  for (const item of page?.items ?? []) {
    const state = item.rawStatus.toLowerCase();
    if (["waiting_input", "needs_attention"].includes(state)) waiting.input += 1;
    else if (["ready", "awaiting_approval", "awaiting_review", "waiting_review", "pending_approval"].includes(state)) waiting.confirmation += 1;
    else if (state === "paused") waiting.resume += 1;
    else if (item.group === "running") {
      if (["running", "executing", "processing"].includes(state) && item.domain !== "workflow") executing += 1;
      else { preparing += 1; if (state === "queued") queued += 1; }
    }
  }
  preparing = Math.max(preparing, (page?.counts.running ?? 0) - executing);
  return { preparing, queued, executing, awaitingUser: waiting.input + waiting.confirmation + waiting.resume, waiting, recent: [] };
}

export function projectPresentation(page: ProjectTaskPage | undefined, chat: ChatActivity): CharacterPresentation {
  const activity = page?.activity ?? legacyActivity(page);
  const activityKey = JSON.stringify([
    activity.preparing, activity.queued, activity.executing, activity.awaitingUser,
    activity.waiting.input, activity.waiting.confirmation, activity.waiting.resume,
    (page?.items ?? []).filter(item => item.group === "running").map(item => item.id).sort(),
    chat.conversationId, chat.phase,
  ]);
  if (activity.awaitingUser || chat.phase === "awaiting_confirmation" || chat.phase === "uncertain") {
    const status = chat.phase === "uncertain" ? "uncertain" : activity.waiting.input ? "input"
      : activity.waiting.confirmation || chat.phase === "awaiting_confirmation" ? "confirmation" : "resume";
    const label = { uncertain: "发送待核对", input: "等你补充", confirmation: "等你确认", resume: "等你继续" }[status];
    return { scene: "needs_attention", status, label, activityKey };
  }
  if (activity.executing) {
    const creative = page?.items.some(item => ["generation", "runway"].includes(item.domain) && ["running", "executing", "processing"].includes(item.rawStatus?.toLowerCase()));
    return { scene: "working", status: creative ? "creating" : "executing", label: creative ? "正在创作" : "处理中", activityKey };
  }
  if (activity.preparing || chat.phase === "sending" || chat.phase === "replying") {
    const onlyQueued = activity.queued > 0 && activity.queued === activity.preparing && chat.phase === "idle";
    return { scene: "thinking", status: onlyQueued ? "queued" : "thinking", label: onlyQueued ? "排队中" : "思考中", activityKey };
  }
  return { scene: "idle", status: "idle", label: "", activityKey };
}

/** No inferred success from disappearance, transport failure or an old snapshot. */
export class ProjectActivityTracker {
  private visible = false;
  private everVisible = false;
  private needsBaseline = true;
  private needsTerminalBaseline = true;
  private baselineVersion = 0;
  private lastVersion = 0;
  private latestTime = "";
  private seen = new Map<string, ProjectTaskTerminal["outcome"]>();
  private previousKey = "";
  private feedback: CharacterPresentation["feedback"];
  private speech: CharacterSpeech | undefined;
  private dialogue = new CharacterDialogue();
  private previousStatus: CharacterStatus = "idle";

  setVisible(visible: boolean, version: number) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.needsBaseline = true;
    this.needsTerminalBaseline = true;
    this.baselineVersion = visible && !this.everVisible ? version - 1 : version;
    if (visible) this.everVisible = true;
    this.feedback = undefined;
    this.speech = undefined;
  }

  observe(page: ProjectTaskPage | undefined, chat: ChatActivity, version: number): CharacterPresentation {
    const base = projectPresentation(page, chat);
    const canSpeak = this.visible && !this.needsBaseline;
    if (base.activityKey !== this.previousKey) {
      if (this.feedback || base.status !== this.previousStatus) this.speech = undefined;
      this.feedback = undefined;
    }
    if (canSpeak && base.status !== this.previousStatus && base.status !== "idle") this.speech = this.dialogue.say(base.status);
    this.previousStatus = base.status;
    this.previousKey = base.activityKey;
    const recent = page?.activity?.recent;
    if (recent && (version !== this.lastVersion || this.needsBaseline && version > this.baselineVersion)) {
      const fresh: ProjectTaskTerminal[] = [];
      // Seeing a new active attempt permits a later explicit terminal on a reused ID.
      for (const item of page.items) if (item.group === "running") this.seen.delete(item.id);
      for (const item of recent) {
        if (this.visible && !this.needsBaseline && !this.needsTerminalBaseline && item.updatedAt >= this.latestTime && this.seen.get(item.id) !== item.outcome) fresh.push(item);
        this.seen.set(item.id, item.outcome);
      }
      for (const item of recent) if (item.updatedAt > this.latestTime) this.latestTime = item.updatedAt;
      // Terminal history needs its own baseline when an old server gains activity support.
      if (this.visible && version > this.baselineVersion) this.needsTerminalBaseline = false;
      this.lastVersion = version;
      while (this.seen.size > 512) {
        const first = this.seen.keys().next().value;
        if (first === undefined) break;
        this.seen.delete(first);
      }
      const successes = fresh.filter(item => item.outcome === "completed").length;
      const failures = fresh.filter(item => item.outcome === "failed").length;
      if ((successes || failures) && base.scene !== "needs_attention") {
        const creative = successes === 1 && fresh.some(item => item.outcome === "completed" && ["generation", "runway"].includes(item.domain));
        this.feedback = {
        id: fresh.map(item => `${item.id}:${item.outcome}:${item.updatedAt}`).sort().join("|"),
        kind: failures ? "failure" : "success",
        label: failures ? successes ? `${successes} 项已完成，${failures} 项需查看` : `${failures} 项任务未完成，请查看`
          : successes === 1 ? "做好了，给你看看" : `${successes} 项任务已完成`,
        };
        this.speech = this.dialogue.say(failures ? "failure" : creative ? "creative_success" : "success",
          successes + failures > 1 ? this.feedback.label : undefined);
      }
    }
    // A valid legacy page still establishes the current state, but cannot prove a terminal event.
    if (page && this.visible && this.needsBaseline && version > this.baselineVersion) this.needsBaseline = false;
    return { ...base, ...(this.visible && this.feedback ? { feedback: this.feedback } : {}), ...(canSpeak && this.speech ? { speech: this.speech } : {}) };
  }
}
