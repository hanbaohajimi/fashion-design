// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PrintWorkbench } from "./PrintWorkbench";
import { studioFixture } from "./studio-test-fixtures";
import {
  studioPrintPatternSchema,
  type StudioDocumentView,
} from "@fashion/shared";
const pattern: StudioDocumentView = {
  id: "pattern-1",
  type: "PRINT_PATTERN",
  version: 2,
  currentRevision: {
    id: "pattern-r2",
    revision: 2,
    createdAt: "2026-10-21T02:00:00Z",
    payload: studioPrintPatternSchema.parse({
      name: "细条纹",
      sourceAssetId: "asset-front",
      reviewed: true,
    }),
  },
  revisions: [],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("invalidates manual review after a visual parameter changes", async () => {
  const onDirty = vi.fn();
  render(
    <PrintWorkbench
      projectId="project-1"
      assets={studioFixture().assets}
      documents={[pattern]}
      onDirty={onDirty}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "细条纹 · 修订 2" }));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText(/重复尺度/), {
    target: { value: "2" },
  });
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
});
it("stores confirmed production repeat dimensions in a new immutable revision", async () => {
  const onRefresh = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ ...pattern, version: 3 }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(
    <PrintWorkbench
      projectId="project-1"
      assets={studioFixture().assets}
      documents={[pattern]}
      onRefresh={onRefresh}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "细条纹 · 修订 2" }));
  fireEvent.change(screen.getByLabelText(/生产重复宽度/), {
    target: { value: "25.5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存新修订" }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    type: "PRINT_PATTERN",
    documentId: "pattern-1",
    expectedVersion: 2,
    payload: { tileWidthCm: 25.5, reviewed: false },
  });
});
it("keeps the draft when switching saved patterns is declined", async () => {
  const beforeChange = vi.fn(async () => false);
  render(
    <PrintWorkbench
      projectId="project-1"
      assets={studioFixture().assets}
      documents={[pattern]}
      beforeChange={beforeChange}
    />,
  );
  fireEvent.change(screen.getByLabelText("方案名称"), {
    target: { value: "未保存的新方案" },
  });
  fireEvent.click(screen.getByRole("button", { name: "细条纹 · 修订 2" }));
  await waitFor(() => expect(beforeChange).toHaveBeenCalledTimes(1));
  expect((screen.getByLabelText("方案名称") as HTMLInputElement).value).toBe(
    "未保存的新方案",
  );
});
