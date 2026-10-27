// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { chooseValue } from "../../test/choose-value";
import { PresentationSets } from "./PresentationSets";
import { studioFixture, styleFixture } from "./studio-test-fixtures";
vi.mock("./TechPackExportButton", () => ({
  TechPackExportButton: () => <span>PDF 导出任务</span>,
}));
const props = () => ({
  projectId: "project-1",
  data: studioFixture({ styles: [styleFixture()] }),
  canEdit: true,
  onDirty: vi.fn(),
  onSaved: vi.fn(async () => {}),
  beforeChange: vi.fn(async () => true),
  onGenerate: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("requires manual image review before completing a presentation set", async () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<PresentationSets {...props()} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "春夏夹克详情页" },
  });
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  fireEvent.click(screen.getByRole("button", { name: "逐图核对" }));
  fireEvent.change(screen.getByLabelText("图片 1 说明"), {
    target: { value: "夹克正面展示" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核对并完成展示包" }));
  await screen.findByText("交付前请逐张人工核对商品外观");
  expect(fetch).not.toHaveBeenCalled();
});
it("saves a reviewed set against the exact style revision", async () => {
  const values = props();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: "presentation-1" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<PresentationSets {...values} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "春夏夹克详情页" },
  });
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  fireEvent.click(screen.getByRole("button", { name: "逐图核对" }));
  chooseValue("图片 1 视图", "front");
  fireEvent.change(screen.getByLabelText("图片 1 说明"), {
    target: { value: "夹克正面展示" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "核对并完成展示包" }));
  await waitFor(() => expect(values.onSaved).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    type: "PRESENTATION_SET",
    payload: {
      status: "READY",
      styleRevisionId: "style-r1",
      channel: "marketplace",
      items: [
        {
          assetId: "asset-front",
          kind: "front",
          label: "夹克正面展示",
          reviewed: true,
        },
      ],
    },
  });
});
it("opens the dedicated generation flow without dispatching from the library", () => {
  const values = props();
  vi.stubGlobal("fetch", vi.fn());
  render(<PresentationSets {...values} />);
  fireEvent.click(screen.getByRole("button", { name: "生成展示候选" }));
  expect(values.onGenerate).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("resets an unsaved new set after discard is confirmed", async () => {
  const values = props();
  render(<PresentationSets {...values} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "未保存展示包" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新建展示包" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("展示包名称") as HTMLInputElement).value,
    ).toBe(""),
  );
  expect(values.beforeChange).toHaveBeenCalledTimes(1);
});
it("keeps an unsaved new set when discard is declined", async () => {
  const values = props();
  values.beforeChange.mockResolvedValue(false);
  render(<PresentationSets {...values} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "未保存展示包" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新建展示包" }));
  await waitFor(() => expect(values.beforeChange).toHaveBeenCalledTimes(1));
  expect((screen.getByLabelText("展示包名称") as HTMLInputElement).value).toBe(
    "未保存展示包",
  );
});

it("distinguishes a new unsaved set from edits and explains missing prerequisites", () => {
  render(<PresentationSets {...props()} data={studioFixture()} />);
  expect(screen.getByText("新展示包尚未保存")).toBeTruthy();
  expect(screen.getByText("保存前需关联款式修订")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "前往款式档案" }).getAttribute("href"),
  ).toBe("/project-1/studio?tab=styles");
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  expect(screen.getByText("有未保存的修改")).toBeTruthy();
});

it("preserves insertion order, removes only the chosen item, and saves a draft without completing review", async () => {
  const values = props();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: "presentation-1" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<PresentationSets {...values} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "商品展示" },
  });
  for (const index of [2, 1, 2, 2])
    fireEvent.click(screen.getByRole("button", { name: `选择图片 ${index}` }));
  fireEvent.submit(screen.getByRole("form", { name: "商品展示包工作区" }));
  await waitFor(() => expect(values.onSaved).toHaveBeenCalledOnce());
  const payload = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).payload;
  expect(payload.status).toBe("DRAFT");
  expect(
    payload.items.map((item: { assetId: string }) => item.assetId),
  ).toEqual(["asset-front", "asset-back"]);
  expect(
    payload.items.every((item: { reviewed: boolean }) => !item.reviewed),
  ).toBe(true);
});

it("caps selection at twelve while leaving image viewing available", () => {
  const assets = Array.from({ length: 13 }, (_, index) => ({
    id: `asset-${index}`,
    url: `/image-${index}.png`,
    thumbnailUrl: null,
  }));
  render(<PresentationSets {...props()} data={studioFixture({ assets })} />);
  const selectionButtons = screen.getAllByRole("button", {
    name: /^选择图片 \d+$/,
  });
  expect(selectionButtons).toHaveLength(13);
  for (const button of selectionButtons.slice(0, 12)) fireEvent.click(button);
  expect(
    (screen.getByRole("button", { name: "选择图片 13" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "查看大图：设计图片 13",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  expect(
    (screen.getByRole("button", { name: "选择图片 13" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it("retains image metadata across views and resets review after a description change", () => {
  render(<PresentationSets {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  fireEvent.click(screen.getByRole("button", { name: "逐图核对" }));
  fireEvent.change(screen.getByLabelText("图片 1 说明"), {
    target: { value: "正面细节" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "整理素材" }));
  fireEvent.click(screen.getByRole("button", { name: "逐图核对" }));
  expect((screen.getByLabelText("图片 1 说明") as HTMLInputElement).value).toBe(
    "正面细节",
  );
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText("图片 1 说明"), {
    target: { value: "修改后的说明" },
  });
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
});

it("keeps read-only material viewable without enabling selection or saving", () => {
  render(<PresentationSets {...props()} canEdit={false} />);
  expect(screen.getByText("只读资料")).toBeTruthy();
  for (const name of ["选择图片 1", "保存修订", "核对并完成展示包"])
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: /查看大图：.*母图/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

it("preserves drafts and retry identity on request failure", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ message: "保存暂时失败" }), {
      status: 500,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<PresentationSets {...props()} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "保留这个草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("展示包名称") as HTMLInputElement).value).toBe(
    "保留这个草稿",
  );
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body).requestKey).toBe(
    JSON.parse(fetcher.mock.calls[1]?.[1]?.body).requestKey,
  );
});

it("keeps conflicting edits until the existing leave guard permits reload", async () => {
  const values = props();
  values.beforeChange.mockResolvedValue(false);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "版本冲突" }), { status: 409 }),
      ),
  );
  render(<PresentationSets {...values} />);
  fireEvent.change(screen.getByLabelText("展示包名称"), {
    target: { value: "发生冲突的草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "选择图片 1" }));
  fireEvent.submit(screen.getByRole("form"));
  const reload = await screen.findByRole("button", { name: "重新载入" });
  fireEvent.click(reload);
  await waitFor(() => expect(values.beforeChange).toHaveBeenCalledOnce());
  expect(values.onSaved).not.toHaveBeenCalled();
  expect((screen.getByLabelText("展示包名称") as HTMLInputElement).value).toBe(
    "发生冲突的草稿",
  );
  values.beforeChange.mockResolvedValue(true);
  fireEvent.click(reload);
  await waitFor(() => expect(values.onSaved).toHaveBeenCalledOnce());
});
