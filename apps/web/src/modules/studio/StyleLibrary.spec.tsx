// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StyleLibrary } from "./StyleLibrary";
import { studioFixture, styleFixture } from "./studio-test-fixtures";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = () => ({
  projectId: "project-1",
  data: studioFixture(),
  canEdit: true,
  onDirty: vi.fn(),
  onSaved: vi.fn(async () => {}),
  beforeChange: vi.fn(async () => true),
});

function fillNewStyle() {
  fireEvent.change(screen.getByLabelText("款号"), {
    target: { value: "JK-027" },
  });
  fireEvent.change(screen.getByLabelText("款式名称"), {
    target: { value: "褶线夹克" },
  });
  fireEvent.change(screen.getByLabelText("品类"), {
    target: { value: "夹克" },
  });
  fireEvent.change(screen.getByLabelText(/^采用理由/), {
    target: { value: "双口袋与短衣长符合需求" },
  });
}

it("saves a preselected candidate with its adoption reason and an immutable initial view", async () => {
  const values = props();
  const fetcher = vi
    .mocked(fetch)
    .mockResolvedValue(
      new Response(JSON.stringify(styleFixture()), { status: 200 }),
    );
  render(<StyleLibrary {...values} initialAssetId="asset-front" />);
  fillNewStyle();
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await waitFor(() => expect(values.onSaved).toHaveBeenCalledTimes(1));
  const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({
    sourceAssetId: "asset-front",
    changeNote: "双口袋与短衣长符合需求",
    status: "DESIGNING",
    views: [{ kind: "front", assetId: "asset-front", reviewed: false }],
  });
  expect(body.requestKey).toEqual(expect.any(String));
});

it("reuses the same request key when a creation response is lost", async () => {
  const values = props();
  const fetcher = vi
    .mocked(fetch)
    .mockRejectedValueOnce(new Error("响应丢失"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(styleFixture()), { status: 200 }),
    );
  render(<StyleLibrary {...values} initialAssetId="asset-front" />);
  fillNewStyle();
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await screen.findByText("响应丢失");
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await waitFor(() => expect(values.onSaved).toHaveBeenCalledTimes(1));
  const bodies = fetcher.mock.calls.map(([, options]) =>
    JSON.parse(String(options?.body)),
  );
  expect(bodies).toHaveLength(2);
  expect(bodies[0].requestKey).toBe(bodies[1].requestKey);
});

it("preserves local edits when a newer server revision conflicts", async () => {
  const values = props();
  values.data = studioFixture({ styles: [styleFixture()] });
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ message: "资料已更新" }), { status: 409 }),
  );
  render(<StyleLibrary {...values} />);
  fireEvent.click(screen.getByRole("button", { name: /JK-027 · 褶线夹克/ }));
  await screen.findByDisplayValue("褶线夹克");
  fireEvent.change(screen.getByLabelText("款式名称"), {
    target: { value: "褶线夹克改款" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await screen.findByText(/此资料已有新修订/);
  expect((screen.getByLabelText("款式名称") as HTMLInputElement).value).toBe(
    "褶线夹克改款",
  );
  expect(values.onSaved).not.toHaveBeenCalled();
  expect(
    JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
      .expectedVersion,
  ).toBe(1);
});

it("does not expose an editable approval status", async () => {
  const values = props();
  values.data = studioFixture({
    styles: [{ ...styleFixture(), status: "APPROVED" }],
  });
  render(<StyleLibrary {...values} />);
  fireEvent.click(screen.getByRole("button", { name: /JK-027 · 褶线夹克/ }));
  await screen.findByDisplayValue("褶线夹克");
  expect(screen.queryByRole("option", { name: "已定稿" })).toBeNull();
  expect((screen.getByLabelText(/^状态/) as HTMLSelectElement).value).toBe(
    "REVIEW",
  );
});
