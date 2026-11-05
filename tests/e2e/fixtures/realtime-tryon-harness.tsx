import { createRoot } from "react-dom/client";
import { RealtimeTryOnPanel } from "../../../apps/web/src/modules/studio/realtime-tryon/RealtimeTryOnPanel";
import { RealtimeTryOnController } from "../../../apps/web/src/modules/studio/realtime-tryon/realtime-tryon-machine";
import { realtimeTryOnApi } from "../../../apps/web/src/modules/studio/realtime-tryon/realtime-tryon-api";
import type { TryOnAdapter, TryOnGenerationState } from "../../../apps/web/src/modules/studio/realtime-tryon/realtime-tryon-types";
import "../../../apps/web/src/styles/design-system.css";

/** This entry is bundled ONLY by the Playwright fixture; there is no application route. */
const fixture = {
  connections: 0,
  updates: 0,
  disconnects: 0,
  cameraRequests: 0,
  localStopped: 0,
  remoteStopped: 0,
  generationSeconds: 0,
  statePayloads: [] as Array<{ image: boolean; prompt: string; enhance: boolean }>,
};
declare global { interface Window { __tryonFixture: typeof fixture } }
window.__tryonFixture = fixture;

function simulatedStream(kind: "local" | "remote") {
  const canvas = document.createElement("canvas");
  canvas.width = kind === "remote" ? 960 : 640;
  canvas.height = kind === "remote" ? 720 : 480;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Simulated browser fixture requires a Canvas 2D context");
  let frame = 0;
  const paint = () => {
    frame += 1;
    context.fillStyle = kind === "remote" ? (["#d8e1d5", "#e3d8c5", "#d1dce4"][fixture.updates % 3] ?? "#d8e1d5") : "#ece9e0";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#20332e";
    context.font = "28px sans-serif";
    context.fillText(kind === "remote" ? "SIMULATED AI OUTPUT / NO MODEL" : "SIMULATED LOCAL CAMERA", 24, 60);
    context.fillText(`Frame ${frame} / Garment revision ${fixture.updates}`, 24, 108);
    context.fillRect(100 + frame % 100, 170, 240, 330);
  };
  paint();
  const timer = setInterval(paint, 33);
  const stream = canvas.captureStream(30);
  for (const track of stream.getTracks()) {
    const original = track.stop.bind(track);
    track.stop = () => {
      if (track.readyState !== "ended") {
        if (kind === "remote") fixture.remoteStopped += 1;
        else fixture.localStopped += 1;
      }
      clearInterval(timer);
      original();
    };
  }
  return stream;
}

function recordState(state: TryOnGenerationState) {
  fixture.statePayloads.push({ image: state.image instanceof File, prompt: state.prompt, enhance: state.enhance });
}

const fakeAdapter: TryOnAdapter = {
  connect: async ({ initialState, onRemoteStream, onGeneration }) => {
    fixture.connections += 1;
    recordState(initialState);
    const remote = simulatedStream("remote");
    let disconnected = false;
    onRemoteStream(remote);
    const ticks = setInterval(() => { fixture.generationSeconds += 1; onGeneration(fixture.generationSeconds); }, 1000);
    return {
      set: async (state) => {
        recordState(state);
        // A visible delay exercises the update/capture gate and latest-only queue.
        await new Promise<void>((resolve) => setTimeout(resolve, 180));
        fixture.updates += 1;
      },
      disconnect: () => {
        if (disconnected) return;
        disconnected = true;
        fixture.disconnects += 1;
        clearInterval(ticks);
        remote.getTracks().forEach((track) => track.stop());
      },
    };
  },
};

const root = document.getElementById("root");
if (!root) throw new Error("Missing simulated browser fixture root");
const uiCase = new URLSearchParams(location.search).get("case");
createRoot(root).render(<>
  <p style={{ padding: "16px 24px", fontSize: 14, background: "#e7eee2" }}>模拟验证：视频为 Canvas 测试流，不调用真实模型。</p>
  <main style={{ padding: 24 }}>
    <RealtimeTryOnPanel
      projectId="tryon-fixture-project" canEdit={uiCase !== "readonly"}
      assets={(uiCase === "empty" ? [] : ["a", "b", "c"]).map((id) => ({ id, url: `/__tryon-test/garment/${id}.png`, thumbnailUrl: null }))}
      controllerFactory={() => new RealtimeTryOnController(realtimeTryOnApi, fakeAdapter, async () => {
        fixture.cameraRequests += 1;
        return simulatedStream("local");
      })}
    />
  </main>
</>);
