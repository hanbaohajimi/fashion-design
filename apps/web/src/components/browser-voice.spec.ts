// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  BrowserVoiceSession,
  insertDictation,
  type BrowserRecognition,
} from "./browser-voice";

class Recognition implements BrowserRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: BrowserRecognition["onstart"] = null;
  onresult: BrowserRecognition["onresult"] = null;
  onerror: BrowserRecognition["onerror"] = null;
  onend: BrowserRecognition["onend"] = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();
  static last: Recognition;
  constructor() {
    Recognition.last = this;
  }
}
const sessions: BrowserVoiceSession[] = [];
afterEach(() => {
  sessions.forEach((session) => session.cancel());
  sessions.length = 0;
  vi.useRealTimers();
});
function setup(getMedia?: () => Promise<MediaStream>) {
  const stop = vi.fn();
  const track = {
    kind: "audio",
    readyState: "live",
    stop,
  } as unknown as MediaStreamTrack;
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const events = {
    phase: vi.fn(),
    stream: vi.fn(),
    interim: vi.fn(),
    result: vi.fn(),
    error: vi.fn(),
  };
  const session = new BrowserVoiceSession(events, {
    recognition: () => Recognition,
    getMedia: getMedia ?? (() => Promise.resolve(stream)),
  });
  sessions.push(session);
  return { session, events, stop, stream };
}
it("停止后只交付一次最终文字，并立即释放麦克风", async () => {
  const view = setup();
  await view.session.start();
  const recognition = Recognition.last;
  recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: false, 0: { transcript: "设计一件" } }],
  });
  expect(view.events.result).not.toHaveBeenCalled();
  recognition.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "设计一件风衣" } }],
  });
  view.session.stop();
  expect(view.stop).toHaveBeenCalledOnce();
  const end = recognition.onend;
  end?.();
  end?.();
  expect(view.events.result).toHaveBeenCalledExactlyOnceWith("设计一件风衣");
  expect(view.events.phase).toHaveBeenLastCalledWith("idle");
});
it("取消后迟到的权限回执立即关闭，不开始识别", async () => {
  let resolve!: (stream: MediaStream) => void;
  const view = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const started = view.session.start();
  view.session.cancel();
  resolve(view.stream);
  await started;
  expect(view.stop).toHaveBeenCalledOnce();
  expect(Recognition.last.start).not.toHaveBeenCalled();
  expect(view.events.result).not.toHaveBeenCalled();
});
it("取消和换会话后的迟到结果不会提交", async () => {
  const view = setup();
  await view.session.start();
  const receive = Recognition.last.onresult,
    end = Recognition.last.onend;
  view.session.cancel();
  receive?.({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: "旧会话内容" } }],
  });
  end?.();
  expect(view.events.result).not.toHaveBeenCalled();
  expect(view.stop).toHaveBeenCalledOnce();
});
it("同页只有一段录音拥有麦克风，开始第二段会取消第一段", async () => {
  const first = setup();
  await first.session.start();
  const original = Recognition.last;
  const second = setup();
  await second.session.start();
  expect(original.abort).toHaveBeenCalledOnce();
  expect(first.stop).toHaveBeenCalledOnce();
  expect(first.events.result).not.toHaveBeenCalled();
});
it("权限被拒绝时给出真实错误，没有识别文字", async () => {
  const view = setup(() =>
    Promise.reject(new DOMException("denied", "NotAllowedError")),
  );
  await view.session.start();
  expect(view.events.error).toHaveBeenCalledWith(
    expect.stringContaining("麦克风权限"),
  );
  expect(view.events.phase).toHaveBeenLastCalledWith("idle");
  expect(view.events.result).not.toHaveBeenCalled();
});
it("网络中断时保留已识别内容，标明需要核对", async () => {
  const view = setup();
  await view.session.start();
  Recognition.last.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: false, 0: { transcript: "藏蓝色" } }],
  });
  Recognition.last.onerror?.({ error: "network" });
  expect(view.events.result).toHaveBeenCalledWith("藏蓝色");
  expect(view.events.error).toHaveBeenCalledWith(
    expect.stringContaining("请核对"),
  );
  expect(view.stop).toHaveBeenCalledOnce();
});
it("语音在原选区插入；录音期间编辑过草稿则追加，不覆盖新输入", () => {
  const anchor = { value: "设计红色风衣", start: 2, end: 4 };
  expect(insertDictation(anchor.value, anchor, "蓝色", 100)).toEqual({
    value: "设计蓝色风衣",
    caret: 4,
  });
  expect(insertDictation("新的草稿", anchor, "蓝色风衣", 100)?.value).toBe(
    "新的草稿\n蓝色风衣",
  );
  expect(insertDictation("原草稿", anchor, "超出上限", 4)).toBeNull();
});

it("结束识别超时时保留末尾临时文字，提示核对并释放麦克风", async () => {
  vi.useFakeTimers();
  const view = setup();
  await view.session.start();
  Recognition.last.onresult?.({
    resultIndex: 0,
    results: [
      { isFinal: true, 0: { transcript: "蓝色" } },
      { isFinal: false, 0: { transcript: "长风衣" } },
    ],
  });
  view.session.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(view.events.result).toHaveBeenCalledExactlyOnceWith("蓝色长风衣");
  expect(view.events.error).toHaveBeenCalledWith(
    expect.stringContaining("请核对"),
  );
  expect(view.stop).toHaveBeenCalledOnce();
});

it("自然结束时临时文字仍可恢复，不静默丢弃", async () => {
  const view = setup();
  await view.session.start();
  Recognition.last.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: false, 0: { transcript: "短款夹克" } }],
  });
  Recognition.last.onend?.();
  expect(view.events.result).toHaveBeenCalledExactlyOnceWith("短款夹克");
  expect(view.events.error).toHaveBeenCalledWith(
    expect.stringContaining("尚未确认"),
  );
});
