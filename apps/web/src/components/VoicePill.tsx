"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  BrowserVoiceSession,
  browserRecognition,
  type VoicePhase,
} from "./browser-voice";
import { Tooltip } from "./ui";
import { WorkspaceIcon } from "../modules/board/workflow/WorkspaceIcon";
import styles from "./voice-pill.module.css";
import { useMotionActivity } from "./motion/use-motion-activity";

/** VoicePill reference: the waveform uses actual microphone samples, never simulated speech. */
interface VoicePillProps {
  scopeKey: string;
  disabled: boolean;
  active?: boolean;
  feedbackHost: HTMLDivElement | null;
  onStart: () => void;
  onCommit: (text: string) => string | null;
  onPhaseChange: (busy: boolean) => void;
}
const subscribeSupport = () => () => {};
const supportsVoice = () =>
  Boolean(browserRecognition() && navigator.mediaDevices?.getUserMedia);
const serverSupport = () => false;
export function VoicePill(props: VoicePillProps) {
  return <VoicePillSession key={props.scopeKey} {...props} />;
}
function VoicePillSession({
  disabled,
  active = true,
  feedbackHost: portal,
  onStart,
  onCommit,
  onPhaseChange,
}: VoicePillProps) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const phaseRef = useRef<VoicePhase>("idle");
  const supported = useSyncExternalStore(
    subscribeSupport,
    supportsVoice,
    serverSupport,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [retained, setRetained] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const session = useRef<BrowserVoiceSession | null>(null);
  const host = useRef<HTMLButtonElement>(null);
  const { visible, reduced } = useMotionActivity(host);
  const alive = useRef(true),
    clock = useRef<HTMLSpanElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onStart, onCommit, onPhaseChange });
  useEffect(() => {
    callbacks.current = { onStart, onCommit, onPhaseChange };
  });
  useEffect(() => {
    if (disabled || !active || !visible) session.current?.cancel();
  }, [active, disabled, visible]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      session.current?.cancel();
      callbacks.current.onPhaseChange(false);
    };
  }, []);
  const commit = (text: string) => {
    const error = callbacks.current.onCommit(text);
    setRetained(error ? text : "");
    setNotice(error);
  };
  const toggle = (fromKeyboard: boolean) => {
    setKeyboard(fromKeyboard);
    if (phaseRef.current === "requesting") {
      session.current?.cancel();
      return;
    }
    if (phaseRef.current === "listening") {
      session.current?.stop();
      return;
    }
    if (phaseRef.current !== "idle" || disabled || !supported || retained)
      return;
    session.current?.cancel();
    if (clock.current) clock.current.textContent = "0:00";
    callbacks.current.onStart();
    setNotice(null);
    setTranscript("");
    const next = new BrowserVoiceSession({
      phase: (value) => {
        if (alive.current && session.current === next) {
          phaseRef.current = value;
          setPhase(value);
          callbacks.current.onPhaseChange(value !== "idle");
        }
      },
      stream: (value) => {
        if (alive.current && session.current === next) setStream(value);
      },
      interim: (value) => {
        if (alive.current && session.current === next) setTranscript(value);
      },
      result: (value) => {
        if (alive.current && session.current === next) commit(value);
      },
      error: (value) => {
        if (alive.current && session.current === next)
          setNotice((current) => (current ? `${current}\n${value}` : value));
      },
    });
    session.current = next;
    void next.start();
  };
  useEffect(() => {
    if (phase === "idle") return;
    const cancel = () => session.current?.cancel();
    const hide = () => {
      if (document.hidden) cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const blur = () => {
      if (phase === "listening") cancel();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
    };
  }, [phase]);
  useEffect(() => {
    if (phase !== "listening") return;
    const start = performance.now();
    const paint = () => {
      const seconds = Math.floor((performance.now() - start) / 1000);
      if (clock.current)
        clock.current.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    };
    paint();
    const timer = setInterval(paint, 1000);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const element = canvas.current;
    if (!stream || phase !== "listening" || !element || reduced) return;
    let context: AudioContext | null = null,
      source: MediaStreamAudioSourceNode | null = null,
      frame = 0;
    try {
      context = new AudioContext();
      if (context.state === "suspended")
        void context.resume().catch(() => undefined);
      source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(256),
        history: number[] = [];
      const drawing = element.getContext("2d");
      if (!drawing) throw new Error("canvas unavailable");
      element.width = 128;
      element.height = 40;
      let previous = performance.now(),
        level = 0,
        ticks = 0;
      const ink = getComputedStyle(element).color;
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(data);
        const target = Math.min(
          1,
          Math.sqrt(
            data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) /
              data.length,
          ) * 4,
        );
        const delta = Math.min(0.05, (now - previous) / 1000);
        previous = now;
        level +=
          (target - level) *
          (1 - Math.exp(-delta / (target > level ? 0.04 : 0.24)));
        if (++ticks % 4 === 0) {
          history.push(level);
          if (history.length > 36) history.shift();
        }
        drawing.clearRect(0, 0, 128, 40);
        drawing.fillStyle = ink;
        history.forEach((value, index) => {
          const x = 128 - (history.length - index) * 6,
            h = Math.max(4, value * 36);
          drawing.globalAlpha = Math.min(1, (x + 6) / 50);
          drawing.beginPath();
          drawing.roundRect(x, (40 - h) / 2, 3, h, 1.5);
          drawing.fill();
        });
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } catch {
      /* Dictation remains usable if audio visualization is unavailable. */
    }
    return () => {
      cancelAnimationFrame(frame);
      source?.disconnect();
      if (context && context.state !== "closed")
        void context.close().catch(() => undefined);
    };
  }, [phase, reduced, stream]);
  const busy = phase !== "idle";
  const label = !supported
    ? "当前浏览器不支持语音输入"
    : phase === "requesting"
      ? "取消连接麦克风"
      : phase === "finishing"
        ? "正在完成语音识别"
        : phase === "listening"
          ? "结束语音输入"
          : "开始语音输入";
  return (
    <>
      <Tooltip
        content={
          !supported || busy
            ? label
            : "语音输入，由浏览器识别，可能使用在线服务"
        }
      >
        <button
          ref={host}
          type="button"
          className={styles.pill}
          data-voice-state={phase}
          data-keyboard={keyboard || undefined}
          disabled={
            disabled || !supported || phase === "finishing" || Boolean(retained)
          }
          aria-label={label}
          aria-pressed={busy}
          onClick={(event) => toggle(event.detail === 0)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              if (!event.repeat && !event.nativeEvent.isComposing) toggle(true);
            }
          }}
        >
          <span className={styles.capsule} aria-hidden="true" />
          <canvas ref={canvas} className={styles.wave} aria-hidden="true" />
          <span ref={clock} className={styles.clock} aria-hidden="true">
            0:00
          </span>
          <span className={styles.microphone}>
            <WorkspaceIcon name="microphone" />
          </span>
          <span className={styles.stop} aria-hidden="true" />
        </button>
      </Tooltip>
      {portal && (busy || notice || retained)
        ? createPortal(
            <div className={styles.feedback}>
              {busy ? (
                <div className={styles.phase}>
                  <span role="status">
                    {phase === "requesting"
                      ? "正在连接麦克风…"
                      : phase === "finishing"
                        ? "正在整理语音…"
                        : "正在聆听，再次点击麦克风结束"}
                  </span>
                  <button
                    type="button"
                    onClick={() => session.current?.cancel()}
                  >
                    取消
                  </button>
                </div>
              ) : null}
              {transcript ? (
                <p className={styles.transcript}>{transcript}</p>
              ) : null}
              {notice ? (
                <div className={styles.phase}>
                  <p role="alert">{notice}</p>
                  {!retained ? (
                    <button
                      type="button"
                      aria-label="关闭语音提示"
                      onClick={() => setNotice(null)}
                    >
                      <WorkspaceIcon name="close" />
                    </button>
                  ) : null}
                </div>
              ) : null}
              {retained ? (
                <>
                  <p className={styles.transcript}>{retained}</p>
                  <div className={styles.recovery}>
                    <button type="button" onClick={() => commit(retained)}>
                      加入草稿
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(retained)
                          .catch(() =>
                            setNotice("复制失败，请选择识别文字后手动复制。"),
                          )
                      }
                    >
                      复制文字
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRetained("");
                        setNotice(null);
                      }}
                    >
                      放弃这段语音
                    </button>
                  </div>
                </>
              ) : null}
            </div>,
            portal,
          )
        : null}
    </>
  );
}
