// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StudioDocumentView } from "@fashion/shared";
import { BrandLibrary } from "./BrandLibrary";
import { studioFixture } from "./studio-test-fixtures";
import { fetchWorkflow, patchWorkflow } from "../board/workflow/workflow-api";
vi.mock("../board/workflow/workflow-api", () => ({
  fetchWorkflow: vi.fn(),
  patchWorkflow: vi.fn(),
}));
const brand: StudioDocumentView = {
  id: "brand-1",
  type: "BRAND_PROFILE",
  version: 2,
  currentRevision: {
    id: "brand-r2",
    revision: 2,
    createdAt: "2026-10-21T02:00:00Z",
    payload: {
      name: "山岚",
      colors: [],
      silhouettes: ["宽松短款"],
      signatureDetails: [],
      fabricPreferences: [],
      avoid: ["大面积标志"],
      notes: "保留自然肌理",
      referenceAssetIds: [],
    },
  },
  revisions: [],
};
const props = () => ({
  projectId: "project-1",
  data: studioFixture({ brandProfiles: [brand] }),
  canEdit: true,
  onDirty: vi.fn(),
  onSaved: vi.fn(async () => {}),
  beforeChange: vi.fn(async () => true),
});
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(fetchWorkflow).mockResolvedValue({
    projectId: "project-1",
    revision: 4,
    layoutRevision: 0,
    nodes: [],
    edges: [],
    legacyAvailable: false,
  });
  vi.mocked(patchWorkflow).mockResolvedValue({
    projectId: "project-1",
    revision: 5,
    layoutRevision: 0,
    nodes: [],
    edges: [],
    legacyAvailable: false,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("replays the exact brand patch after losing a successful response", async () => {
  vi.mocked(patchWorkflow).mockRejectedValueOnce(new Error("响应丢失"));
  render(<BrandLibrary {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: /山岚.*r2/ }));
  await screen.findByDisplayValue("山岚");
  fireEvent.click(screen.getByRole("button", { name: "将此修订加入画布" }));
  await screen.findByText("响应丢失");
  fireEvent.click(screen.getByRole("button", { name: "将此修订加入画布" }));
  await screen.findByText(/品牌规则与认可案例已加入画布/);
  expect(fetchWorkflow).toHaveBeenCalledTimes(1);
  expect(patchWorkflow).toHaveBeenCalledTimes(2);
  expect(vi.mocked(patchWorkflow).mock.calls[0]).toEqual(
    vi.mocked(patchWorkflow).mock.calls[1],
  );
  expect(vi.mocked(patchWorkflow).mock.calls[0]?.[1]).toMatchObject({
    baseRevision: 4,
    operations: [
      {
        type: "add_node",
        node: {
          type: "reference_text",
          payload: { studioRevisionId: "brand-r2" },
        },
      },
    ],
  });
});
it("imports an accessible source revision with a stable retry key", async () => {
  const values = props();
  const fetcher = vi
    .mocked(fetch)
    .mockResolvedValueOnce(
      new Response(JSON.stringify([brand]), { status: 200 }),
    )
    .mockRejectedValueOnce(new Error("响应丢失"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...brand, id: "brand-copy" }), {
        status: 200,
      }),
    );
  render(<BrandLibrary {...values} />);
  fireEvent.click(
    screen.getByRole("button", { name: "从其他项目复用品牌资料" }),
  );
  const reuse = await screen.findByRole("button", { name: "山岚 · 修订 2" });
  fireEvent.click(reuse);
  await screen.findByText("响应丢失");
  fireEvent.click(reuse);
  await waitFor(() => expect(values.onSaved).toHaveBeenCalledTimes(1));
  const posts = fetcher.mock.calls
    .filter(([, options]) => options?.method === "POST")
    .map(([, options]) => JSON.parse(String(options?.body)));
  expect(posts).toHaveLength(2);
  expect(posts[0]).toEqual(posts[1]);
  expect(posts[0].revisionId).toBe("brand-r2");
  expect(fetcher.mock.calls[0]?.[0]).toContain("/brands/library");
});
