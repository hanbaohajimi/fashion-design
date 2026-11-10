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
  await screen.findByDisplayValue("褶线夹克");
  expect(screen.queryByRole("option", { name: "已定稿" })).toBeNull();
  expect(screen.getByRole("radio", { name: "待评审" }).getAttribute("aria-checked")).toBe("true");
});

it("保存结果直接成为当前款式，列表刷新失败后继续编辑使用 PATCH", async () => {
  const values = props();
  values.onSaved.mockRejectedValue(new Error("资料刷新失败"));
  const saved = styleFixture();
  const fetcher = vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(saved), { status: 200 }));
  render(<StyleLibrary {...values} initialAssetId="asset-front" />);
  fillNewStyle();
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await screen.findByText(/款式已经保存，资料列表暂未刷新/);
  expect(screen.getByRole("heading", { name: "褶线夹克" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "保存修订" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("款式名称"), { target: { value: "褶线夹克新袖口" } });
  fetcher.mockResolvedValue(new Response(JSON.stringify({ ...saved, name: "褶线夹克新袖口", version: 2, currentRevision: { ...saved.currentRevision, id: "style-r2", revision: 2, payload: { ...saved.currentRevision.payload, name: "褶线夹克新袖口" } } }), { status: 200 }));
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1]?.[0]).toBe("/api/projects/project-1/studio/styles/style-1");
  expect(fetcher.mock.calls[1]?.[1]?.method).toBe("PATCH");
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ expectedVersion: 1, name: "褶线夹克新袖口" });
});

function twoRevisions() {
  const first = styleFixture();
  const latest = { ...first.currentRevision, id: "style-r2", revision: 2, payload: { ...first.currentRevision.payload, name: "新版夹克", description: "较长的衣身" } };
  return { ...first, name: "新版夹克", version: 2, currentRevision: latest, revisions: [latest, first.currentRevision] };
}

it("修订链接定位历史资料，后续工作使用该版，继续修改生成新修订", async () => {
  const values = props();
  values.data = studioFixture({ styles: [twoRevisions()] });
  const onTechPack = vi.fn();
  render(<StyleLibrary {...values} initialStyleRevisionId="style-r1" onTechPack={onTechPack} />);
  expect(screen.getByRole("heading", { name: "褶线夹克" })).toBeTruthy();
  expect(screen.getByLabelText("款式名称").matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "继续创作与交付" }));
  fireEvent.click(screen.getByRole("button", { name: "继续技术包" }));
  expect(onTechPack).toHaveBeenCalledWith("style-r1");
  fireEvent.click(screen.getByRole("button", { name: "以此修订继续" }));
  await waitFor(() => expect(screen.getByLabelText("款式名称").matches(":disabled")).toBe(false));
  expect((screen.getByLabelText("款式名称") as HTMLInputElement).value).toBe("褶线夹克");
  fireEvent.click(screen.getByRole("button", { name: "继续创作与交付" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "继续技术包" }) as HTMLButtonElement).disabled).toBe(true));
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(twoRevisions()), { status: 200 }));
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({ expectedVersion: 2, name: "褶线夹克", changeNote: "基于 r1 继续修改" });
});

it("从白板带回改图更新已有款式，并重置替换视图的复核状态", async () => {
  const values = props();
  const saved = styleFixture();
  const firstView = saved.currentRevision.payload.views[0];
  if (!firstView) throw new Error("缺少款式视图测试数据");
  firstView.reviewed = true;
  values.data = studioFixture({ styles: [saved] });
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(saved), { status: 200 }));
  render(<StyleLibrary {...values} initialAssetId="asset-back" initialStyleRevisionId="style-r1" />);
  expect((screen.getByLabelText("款式名称") as HTMLInputElement).value).toBe("褶线夹克");
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe("PATCH");
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({ sourceAssetId: "asset-back", views: [{ assetId: "asset-back", reviewed: false }], expectedVersion: 1 });
});

it("不存在的修订不静默选择第一款", () => {
  const values = props();
  values.data = studioFixture({ styles: [styleFixture()] });
  render(<StyleLibrary {...values} initialStyleRevisionId="missing" />);
  expect(screen.getByText(/这份款式修订不存在或已无法访问/)).toBeTruthy();
  expect(screen.queryByLabelText("款式名称")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("暂时缺失的修订在重载后恢复准确对象，随后失去修订时不回退最新版", () => {
  const values = props();
  const view = render(<StyleLibrary {...values} initialStyleRevisionId="style-r1" />);
  expect(screen.queryByLabelText("款式名称")).toBeNull();
  view.rerender(<StyleLibrary {...values} data={studioFixture({ styles: [twoRevisions()] })} initialStyleRevisionId="style-r1" />);
  expect(screen.getByLabelText("款式名称")).toHaveProperty("value", "褶线夹克");
  expect(screen.getByLabelText("款式名称").matches(":disabled")).toBe(true);
  const latest = twoRevisions();
  latest.revisions = [latest.currentRevision];
  view.rerender(<StyleLibrary {...values} data={studioFixture({ styles: [latest] })} initialStyleRevisionId="style-r1" />);
  expect(screen.queryByLabelText("款式名称")).toBeNull();
  expect(screen.getByText(/这份款式修订不存在或已无法访问/)).toBeTruthy();
});

it("拒绝切换历史修订保留当前修改，陈旧列表不覆盖刚保存的修订", async () => {
  const values = props();
  values.data = studioFixture({ styles: [twoRevisions()] });
  values.beforeChange.mockResolvedValue(false);
  const view = render(<StyleLibrary {...values} />);
  fireEvent.change(screen.getByLabelText("款式名称"), { target: { value: "改动尚未保存" } });
  fireEvent.click(screen.getByText(/修订历史/));
  fireEvent.click(screen.getByRole("button", { name: "查看 r1" }));
  await waitFor(() => expect(values.beforeChange).toHaveBeenCalled());
  expect(screen.getByLabelText("款式名称")).toHaveProperty("value", "改动尚未保存");
  const third = twoRevisions();
  third.version = 3;
  third.name = "改动尚未保存";
  third.currentRevision = { ...third.currentRevision, id: "style-r3", revision: 3, payload: { ...third.currentRevision.payload, name: third.name } };
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(third), { status: 200 }));
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await screen.findByText(/r3 已保存/);
  view.rerender(<StyleLibrary {...values} data={studioFixture({ styles: [styleFixture()] })} />);
  expect(screen.getByLabelText("款式名称")).toHaveProperty("value", "改动尚未保存");
  expect(screen.getByRole("button", { name: "保存修订" })).toHaveProperty("disabled", true);
});

it("已定稿的历史修订可只读查看，继续修改必须重新评审", async () => {
  const values = props();
  const style = twoRevisions();
  const historicalRevision = style.revisions[1];
  if (!historicalRevision) throw new Error("缺少历史修订测试数据");
  historicalRevision.payload.status = "APPROVED";
  values.data = studioFixture({ styles: [style] });
  render(<StyleLibrary {...values} initialStyleRevisionId="style-r1" />);
  expect(screen.getByRole("button", { name: "状态" }).textContent).toContain("已定稿");
  fireEvent.click(screen.getByRole("button", { name: "以此修订继续" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "待评审" }).getAttribute("aria-checked")).toBe("true"));
  expect(screen.queryByRole("radio", { name: "已定稿" })).toBeNull();
});

it("从白板原样返回当前主图不产生新草稿或保存请求", () => {
  const values = props();
  values.data = studioFixture({ styles: [styleFixture()] });
  render(<StyleLibrary {...values} initialStyleRevisionId="style-r1" initialAssetId="asset-front" />);
  expect(screen.getByRole("button", { name: "保存修订" })).toHaveProperty("disabled", true);
  expect(fetch).not.toHaveBeenCalled();
});

it("历史主图不在最近素材列表时，仍使用修订自带的图片来源", () => {
  const values = props();
  const style = twoRevisions();
  values.data = studioFixture({ styles: [style], assets: [] });
  render(<StyleLibrary {...values} initialStyleRevisionId="style-r1" />);
  expect(screen.getByAltText("当前款式主设计图").getAttribute("src")).toBe(style.revisions[1]?.views[0]?.url);
  expect(screen.getByLabelText("款式名称").matches(":disabled")).toBe(true);
});
