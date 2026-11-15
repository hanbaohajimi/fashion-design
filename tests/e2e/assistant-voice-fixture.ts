import type { Page } from "@playwright/test";

export async function mockVoice(page: Page) {
  await page.addInitScript(() => {
    class Recognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult:
        | ((event: {
            resultIndex: number;
            results: { isFinal: boolean; 0: { transcript: string } }[];
          }) => void)
        | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      starts = 0;
      aborts = 0;
      constructor() {
        state.instances.push(this);
      }
      start() {
        this.starts++;
        queueMicrotask(() => this.onstart?.());
      }
      stop() {
        queueMicrotask(() => this.onend?.());
      }
      abort() {
        this.aborts++;
      }
      emit(text: string, final = true) {
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: final, 0: { transcript: text } }],
        });
      }
    }
    const state = {
      instances: [] as Recognition[],
      stopped: 0,
      audioClosed: 0,
      samples: 0,
      denied: false,
      pending: false,
      grant: null as (() => void) | null,
    };
    const stream = () => {
      const track = {
        kind: "audio",
        readyState: "live",
        stop() {
          if (this.readyState !== "ended") {
            state.stopped++;
            this.readyState = "ended";
          }
        },
      };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          if (state.denied)
            return Promise.reject(
              new DOMException("Test permission denial", "NotAllowedError"),
            );
          if (state.pending)
            return new Promise((resolve) => {
              state.grant = () => resolve(stream());
            });
          return Promise.resolve(stream());
        },
      },
    });
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: Recognition,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: Recognition,
    });
    class Audio {
      state = "running";
      resume() {
        return Promise.resolve();
      }
      close() {
        this.state = "closed";
        state.audioClosed++;
        return Promise.resolve();
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          getByteTimeDomainData(data: Uint8Array) {
            state.samples++;
            data.forEach((_, index) => {
              data[index] =
                128 +
                Math.round(Math.sin(index * 0.2 + state.samples * 0.08) * 30);
            });
          },
        };
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: Audio,
    });
    Object.assign(window, { voiceFixture: state });
  });
}

declare global {
  interface Window {
    voiceFixture: {
      instances: {
        emit(text: string, final?: boolean): void;
        onresult: ((event: unknown) => void) | null;
        starts: number;
        aborts: number;
      }[];
      stopped: number;
      audioClosed: number;
      samples: number;
      denied: boolean;
      pending: boolean;
      grant: (() => void) | null;
    };
  }
}
