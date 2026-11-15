export type VoicePhase = "idle" | "requesting" | "listening" | "finishing";
interface RecognitionResult {
  isFinal: boolean;
  readonly [index: number]: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
export interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
}
interface RecognitionConstructor {
  new (): BrowserRecognition;
  available?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<string>;
}
export function browserRecognition(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
export function voiceError(code: string) {
  return (
    (
      {
        "not-allowed": "未获得麦克风权限，请允许麦克风后重试。",
        "audio-capture": "无法使用麦克风，请检查设备连接。",
        "no-speech": "没有识别到语音，请靠近麦克风后重试。",
        network: "语音识别服务连接失败，请检查网络后重试。",
        "service-not-allowed": "浏览器未允许语音识别服务，请检查浏览器设置。",
        "language-not-supported": "当前语音服务不支持中文识别。",
        unsupported: "当前浏览器不支持语音输入，可继续使用键盘输入。",
        insecure: "语音输入需要 HTTPS 或 localhost 安全连接。",
        timeout: "语音识别服务没有响应，请重试。",
      } as Record<string, string>
    )[code] ?? "语音识别未完成，原有草稿已保留。"
  );
}

/** Owns one recording only; canceled/late events can never write into another conversation. */
let cancelActiveVoice: (() => void) | null = null;
export class BrowserVoiceSession {
  private started = false;
  private readonly cancelOwner = () => this.cancel();
  private closed = false;
  private finishing = false;
  private recognition: BrowserRecognition | null = null;
  private stream: MediaStream | null = null;
  private finalParts: string[] = [];
  private latestText = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly events: {
      phase: (phase: VoicePhase) => void;
      stream: (stream: MediaStream | null) => void;
      interim: (text: string) => void;
      result: (text: string) => void;
      error: (message: string) => void;
    },
    private readonly environment = {
      recognition: browserRecognition,
      getMedia: () =>
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
    },
  ) {}

  async start() {
    if (this.started || this.closed) return;
    this.started = true;
    cancelActiveVoice?.();
    cancelActiveVoice = this.cancelOwner;
    this.events.phase("requesting");
    try {
      const Constructor = this.environment.recognition();
      if (!Constructor) throw new Error("unsupported");
      const recognition = new Constructor();
      this.recognition = recognition;
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      // Use an already-installed local model when available. Never download one silently.
      if (Constructor.available && "processLocally" in recognition) {
        try {
          recognition.processLocally =
            (await Constructor.available({
              langs: ["zh-CN"],
              processLocally: true,
            })) === "available";
        } catch {
          recognition.processLocally = false;
        }
      }
      if (this.closed) return;
      const stream = await this.environment.getMedia();
      if (this.closed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.events.stream(stream);
      recognition.onstart = () => {
        if (!this.closed) {
          clearTimeout(this.timer);
          this.events.phase("listening");
        }
      };
      recognition.onresult = (event) => {
        if (this.closed) return;
        const words: string[] = [];
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index];
          const text = result?.[0]?.transcript ?? "";
          if (result?.isFinal) this.finalParts[index] = text;
          words.push(text);
        }
        this.latestText = words.join("").trim();
        this.events.interim(this.latestText);
      };
      recognition.onerror = (event) => {
        if (this.closed) return;
        if (event.error === "aborted" && this.finishing) {
          this.finish();
          return;
        }
        this.finish(voiceError(event.error));
      };
      recognition.onend = () => {
        if (!this.closed) this.finish();
      };
      this.timer = setTimeout(() => {
        if (!this.closed) {
          this.events.error(voiceError("timeout"));
          this.cancel();
        }
      }, 12000);
      recognition.start(stream.getAudioTracks()[0]);
    } catch (cause) {
      if (this.closed) return;
      const code =
        cause instanceof DOMException &&
        ["NotAllowedError", "SecurityError"].includes(cause.name)
          ? "not-allowed"
          : cause instanceof DOMException && cause.name === "NotFoundError"
            ? "audio-capture"
            : cause instanceof Error
              ? cause.message
              : "unknown";
      this.events.error(voiceError(code));
      this.cancel();
    }
  }
  stop() {
    if (this.closed || this.finishing) return;
    this.finishing = true;
    clearTimeout(this.timer);
    this.events.phase("finishing");
    try {
      this.recognition?.stop();
    } catch {
      this.finish();
    }
    this.releaseStream();
    if (!this.closed)
      this.timer = setTimeout(() => this.finish(voiceError("timeout")), 5000);
  }
  cancel() {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
    this.events.phase("idle");
    this.events.interim("");
  }
  private finish(error?: string) {
    if (this.closed) return;
    const confirmed = this.finalParts.join("").trim();
    const text = this.latestText || confirmed;
    this.closed = true;
    this.cleanup();
    this.events.phase("idle");
    this.events.interim("");
    if (text) this.events.result(text);
    if (error)
      this.events.error(
        text ? `${error} 已保留已识别的部分文字，请核对。` : error,
      );
    else if (text && text !== confirmed)
      this.events.error("已保留语音服务尚未确认的文字，请核对后发送。");
    else if (!text) this.events.error(voiceError("no-speech"));
  }
  private releaseStream() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.events.stream(null);
  }
  private cleanup() {
    if (cancelActiveVoice === this.cancelOwner) cancelActiveVoice = null;
    clearTimeout(this.timer);
    if (this.recognition) {
      this.recognition.onstart = null;
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      try {
        this.recognition.abort();
      } catch {
        /* Already ended. */
      }
    }
    this.releaseStream();
  }
}

export interface DictationAnchor {
  value: string;
  start: number;
  end: number;
}
export function insertDictation(
  current: string,
  anchor: DictationAnchor,
  speech: string,
  limit: number,
) {
  const same = current === anchor.value;
  const start = same ? anchor.start : current.length,
    end = same ? anchor.end : current.length;
  const addition =
    !same && current && !/\s$/u.test(current) ? `\n${speech}` : speech;
  const value = current.slice(0, start) + addition + current.slice(end);
  return value.length > limit
    ? null
    : { value, caret: start + addition.length };
}
