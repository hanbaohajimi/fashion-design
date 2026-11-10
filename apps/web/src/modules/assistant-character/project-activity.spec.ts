import { describe, expect, it } from "vitest";
import type { ProjectTaskActivity, ProjectTaskPage, ProjectTaskTerminal, ProjectTaskView } from "@fashion/shared";
import { IDLE_CHAT_ACTIVITY, ProjectActivityTracker, projectPresentation } from "./project-activity";

const end = (id: string, outcome: ProjectTaskTerminal["outcome"] = "completed", second = 1): ProjectTaskTerminal => ({ id: `generation:${id}`, domain: "generation", outcome, updatedAt: `2026-11-08T10:00:${String(second).padStart(2, "0")}.000Z` });
const page = (changes: Partial<ProjectTaskActivity> = {}, items: ProjectTaskView[] = []): ProjectTaskPage => ({
  items, nextCursor: null, counts: { running: (changes.preparing ?? 0) + (changes.executing ?? 0), attention: changes.awaitingUser ?? 0 },
  activity: { preparing: 0, queued: 0, executing: 0, awaitingUser: 0, waiting: { input: 0, confirmation: 0, resume: 0 }, recent: [], ...changes },
});

describe("织芽的真实项目状态", () => {
  it("只在真实变化时说话，同状态轮询和计数变化不重选；再次开始使用另一句", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0);
    expect(tracker.observe(page(), IDLE_CHAT_ACTIVITY, 1).speech).toBeUndefined();
    const first = tracker.observe(page({ preparing: 1 }), IDLE_CHAT_ACTIVITY, 2).speech;
    expect(first).toMatchObject({ text: "让我理一理思路。", duration: 4000 });
    expect(tracker.observe(page({ preparing: 1 }), IDLE_CHAT_ACTIVITY, 3).speech).toEqual(first);
    expect(tracker.observe(page({ preparing: 2 }), IDLE_CHAT_ACTIVITY, 4).speech).toEqual(first);
    tracker.observe(page(), IDLE_CHAT_ACTIVITY, 5);
    expect(tracker.observe(page({ preparing: 1 }), IDLE_CHAT_ACTIVITY, 6).speech?.text).not.toBe(first?.text);
  });
  it("恢复显示吸收状态话语，等待处理不会被成功结果覆盖，未知任务用通用措辞", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0);
    expect(tracker.observe(page({ executing: 1 }), IDLE_CHAT_ACTIVITY, 1)).toMatchObject({ label: "处理中", status: "executing" });
    tracker.setVisible(false, 1);
    tracker.observe(page({ preparing: 1, queued: 1 }), IDLE_CHAT_ACTIVITY, 2);
    tracker.setVisible(true, 2);
    expect(tracker.observe(page({ preparing: 1, queued: 1 }), IDLE_CHAT_ACTIVITY, 3).speech).toBeUndefined();
    const waiting = tracker.observe(page({ awaitingUser: 1, waiting: { input: 1, confirmation: 0, resume: 0 }, recent: [end("done")] }), IDLE_CHAT_ACTIVITY, 4);
    expect(waiting.speech).toMatchObject({ text: "还差一点资料，想请你补充。", duration: 6000 });
    expect(waiting.feedback).toBeUndefined();
  });
  it("已确认的图片任务才能使用创作措辞，成功和失败复用终态去重", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0); tracker.observe(page(), IDLE_CHAT_ACTIVITY, 1);
    const item = { id: "generation:art", domain: "generation", group: "running", rawStatus: "running" } as ProjectTaskView;
    expect(tracker.observe(page({ executing: 1 }, [item]), IDLE_CHAT_ACTIVITY, 2).speech?.text).toBe("我来把这一版做出来。");
    const success = tracker.observe(page({ recent: [end("art")] }), IDLE_CHAT_ACTIVITY, 3);
    expect(success.speech?.text).toBe("做好啦，来看看这一版。");
    expect(tracker.observe(page({ recent: [end("art", "completed", 2)] }), IDLE_CHAT_ACTIVITY, 4).speech).toEqual(success.speech);
  });
  it("实际执行优先于思考，待确认优先于执行；排队使用独立文案", () => {
    expect(projectPresentation(page({ preparing: 2, queued: 2 }), IDLE_CHAT_ACTIVITY)).toMatchObject({ scene: "thinking", label: "排队中" });
    expect(projectPresentation(page({ preparing: 2, queued: 2 }), { conversationId: "c", phase: "replying" }).label).toBe("思考中");
    expect(projectPresentation(page({ preparing: 2, executing: 1 }), IDLE_CHAT_ACTIVITY).scene).toBe("working");
    expect(projectPresentation(page({ executing: 2, awaitingUser: 1, waiting: { confirmation: 1, input: 0, resume: 0 } }), IDLE_CHAT_ACTIVITY)).toMatchObject({ scene: "needs_attention", label: "等你确认" });
  });

  it("历史失败、旧接口和暂时缺失的列表不会被解释为新成功或持续疑惑", () => {
    expect(projectPresentation(page({ recent: [end("old", "failed")] }), IDLE_CHAT_ACTIVITY).scene).toBe("idle");
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0);
    const old: ProjectTaskPage = { items: [], nextCursor: null, counts: { running: 1, attention: 12 } };
    expect(tracker.observe(old, IDLE_CHAT_ACTIVITY, 1).scene).toBe("thinking");
    expect(tracker.observe({ ...old, counts: { running: 0, attention: 12 } }, IDLE_CHAT_ACTIVITY, 2)).toMatchObject({ scene: "idle" });
    expect(tracker.observe(page(), IDLE_CHAT_ACTIVITY, 3).feedback).toBeUndefined();
  });

  it("旧接口建立状态基线后仍响应新话语，列表消失不推断结果", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0);
    const legacy: ProjectTaskPage = { items: [], nextCursor: null, counts: { running: 0, attention: 0 } };
    expect(tracker.observe(legacy, IDLE_CHAT_ACTIVITY, 1).speech).toBeUndefined();
    const queued: ProjectTaskPage = {
      ...legacy,
      counts: { running: 1, attention: 0 },
      items: [{ id: "generation:new", domain: "generation", group: "running", rawStatus: "queued" } as ProjectTaskView],
    };
    const first = tracker.observe(queued, IDLE_CHAT_ACTIVITY, 2);
    expect(first.speech?.text).toBe("这份任务还在排队。");
    expect(tracker.observe(queued, IDLE_CHAT_ACTIVITY, 3).speech).toEqual(first.speech);
    expect(tracker.observe(legacy, IDLE_CHAT_ACTIVITY, 4)).toMatchObject({ status: "idle" });
    expect(tracker.observe(legacy, IDLE_CHAT_ACTIVITY, 5).feedback).toBeUndefined();
    expect(tracker.observe(legacy, { conversationId: "c", phase: "replying" }, 5).speech?.text).toBe("让我理一理思路。");
  });

  it("旧响应升级到活动摘要时吸收历史结果，之后才反馈新终态", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0);
    const legacy: ProjectTaskPage = { items: [], nextCursor: null, counts: { running: 0, attention: 0 } };
    tracker.observe(legacy, IDLE_CHAT_ACTIVITY, 1);
    const firstSummary = tracker.observe(page({ recent: [end("history")] }), IDLE_CHAT_ACTIVITY, 2);
    expect(firstSummary.feedback).toBeUndefined();
    expect(firstSummary.speech).toBeUndefined();
    expect(tracker.observe(page({ recent: [end("new", "completed", 2)] }), IDLE_CHAT_ACTIVITY, 3).feedback?.kind).toBe("success");
  });

  it("没有摘要时恢复显示仍建立基线，不补播隐藏状态，之后的新变化正常说话", () => {
    const tracker = new ProjectActivityTracker();
    const legacy: ProjectTaskPage = { items: [], nextCursor: null, counts: { running: 0, attention: 0 } };
    const busy: ProjectTaskPage = { ...legacy, counts: { running: 1, attention: 0 } };
    tracker.setVisible(true, 0);
    tracker.observe(legacy, IDLE_CHAT_ACTIVITY, 1);
    tracker.setVisible(false, 1);
    tracker.observe(busy, IDLE_CHAT_ACTIVITY, 2);
    tracker.setVisible(true, 2);
    expect(tracker.observe(busy, IDLE_CHAT_ACTIVITY, 2).speech).toBeUndefined();
    expect(tracker.observe(busy, IDLE_CHAT_ACTIVITY, 3).speech).toBeUndefined();
    expect(tracker.observe(busy, { conversationId: "c", phase: "awaiting_confirmation" }, 3).speech?.text).toBe("这一步，想听听你的选择。");
  });

  it("首次载入建立基线，新终态同批合并，重复响应和更新时间变化不重复反馈", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0);
    expect(tracker.observe(page({ recent: [end("history")] }), IDLE_CHAT_ACTIVITY, 1).feedback).toBeUndefined();
    const result = tracker.observe(page({ recent: [end("one", "completed", 2), end("two", "completed", 2), end("history")] }), IDLE_CHAT_ACTIVITY, 2);
    expect(result.feedback).toMatchObject({ kind: "success", label: "2 项任务已完成" });
    expect(tracker.observe(page({ recent: [end("one", "completed", 3), end("two", "completed", 2)] }), IDLE_CHAT_ACTIVITY, 3).feedback?.id).toBe(result.feedback?.id);
    expect(tracker.observe(page({ recent: [end("history")] }), IDLE_CHAT_ACTIVITY, 4).feedback?.id).toBe(result.feedback?.id);
  });

  it("新任务打断完成反馈，取消保持平静，随后失败只反馈一次", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0); tracker.observe(page(), IDLE_CHAT_ACTIVITY, 1);
    expect(tracker.observe(page({ recent: [end("one")] }), IDLE_CHAT_ACTIVITY, 2).feedback?.kind).toBe("success");
    expect(tracker.observe(page({ executing: 1, recent: [end("one")] }), IDLE_CHAT_ACTIVITY, 3)).toMatchObject({ scene: "working" });
    expect(tracker.observe(page({ recent: [end("cancel", "canceled", 2)] }), IDLE_CHAT_ACTIVITY, 4).feedback).toBeUndefined();
    const failed = tracker.observe(page({ recent: [end("fail", "failed", 3)] }), IDLE_CHAT_ACTIVITY, 5);
    expect(failed.feedback?.kind).toBe("failure");
    expect(tracker.observe(page({ recent: [end("fail", "failed", 3)] }), IDLE_CHAT_ACTIVITY, 6).feedback?.id).toBe(failed.feedback?.id);
    expect(failed.scene).toBe("idle");
  });

  it("重新显示吸收隐藏期间的结果，接着到达的新结果仍能反馈", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0); tracker.observe(page(), IDLE_CHAT_ACTIVITY, 1);
    tracker.setVisible(false, 1);
    expect(tracker.observe(page({ recent: [end("hidden")] }), IDLE_CHAT_ACTIVITY, 2).feedback).toBeUndefined();
    tracker.setVisible(true, 2);
    expect(tracker.observe(page({ recent: [end("hidden")] }), IDLE_CHAT_ACTIVITY, 2).feedback).toBeUndefined();
    expect(tracker.observe(page({ recent: [end("gap", "completed", 2)] }), IDLE_CHAT_ACTIVITY, 3).feedback).toBeUndefined();
    expect(tracker.observe(page({ recent: [end("visible", "completed", 3)] }), IDLE_CHAT_ACTIVITY, 4).feedback?.kind).toBe("success");
  });

  it("第一次显示可以采用已读取的缓存作为基线，不吞掉下一次新结果", () => {
    const tracker = new ProjectActivityTracker();
    tracker.observe(page({ recent: [end("history")] }), IDLE_CHAT_ACTIVITY, 1);
    tracker.setVisible(true, 1);
    expect(tracker.observe(page({ recent: [end("history")] }), IDLE_CHAT_ACTIVITY, 1).feedback).toBeUndefined();
    expect(tracker.observe(page({ recent: [end("new", "completed", 2)] }), IDLE_CHAT_ACTIVITY, 2).feedback?.kind).toBe("success");
  });

  it("重试进入实际活动后可以接收新终态；新的项目从自己的基线开始", () => {
    const tracker = new ProjectActivityTracker();
    tracker.setVisible(true, 0); tracker.observe(page({ recent: [end("retry", "failed")] }), IDLE_CHAT_ACTIVITY, 1);
    const running = { id: "generation:retry", group: "running" } as ProjectTaskView;
    tracker.observe(page({ executing: 1 }, [running]), IDLE_CHAT_ACTIVITY, 2);
    expect(tracker.observe(page({ recent: [end("retry", "failed", 3)] }), IDLE_CHAT_ACTIVITY, 3).feedback?.kind).toBe("failure");
    const other = new ProjectActivityTracker(); other.setVisible(true, 0);
    expect(other.observe(page({ recent: [end("other", "completed", 4)] }), IDLE_CHAT_ACTIVITY, 4).feedback).toBeUndefined();
  });
});
