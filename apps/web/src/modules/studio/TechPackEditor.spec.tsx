// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TechPackEditor } from "./TechPackEditor";
import {
  studioFixture,
  styleFixture,
  techPackFixture,
} from "./studio-test-fixtures";
vi.mock("./TechPackExportButton", () => ({
  TechPackExportButton: () => <span>导出任务</span>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = () => ({
  projectId: "project-1",
  data: studioFixture({ styles: [styleFixture()] }),
  canEdit: true,
  onDirty: vi.fn(),
  onSaved: vi.fn(async () => {}),
  beforeChange: vi.fn(async () => true),
});

it("小数中间态与非法草稿跨章节保留，失败输入不会保存旧数值", async () => {
  const values = props();
  vi.stubGlobal("fetch", vi.fn());
  render(<TechPackEditor {...values} />);
  fireEvent.change(screen.getByLabelText("技术包名称"), { target: { value: "边界资料" } });
  fireEvent.click(screen.getByRole("button", { name: "BOM" }));
  fireEvent.click(screen.getByRole("button", { name: "添加材料" }));
  fireEvent.change(screen.getByLabelText("BOM 1 名称"), { target: { value: "主料" } });
  const quantity = screen.getByLabelText("BOM 1 用量") as HTMLInputElement;
  fireEvent.change(quantity, { target: { value: "1." } });
  expect(quantity.value).toBe("1.");
  fireEvent.click(screen.getByLabelText("BOM 1 已复核"));
  fireEvent.change(quantity, { target: { value: "1e" } });
  expect((screen.getByLabelText("BOM 1 已复核") as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "POM" }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await screen.findByText(/BOM 1 用量需为/);
  expect(fetch).not.toHaveBeenCalled();
  expect(quantity.value).toBe("1e");
  expect(quantity.closest("[data-tech-chapter]")?.hasAttribute("hidden")).toBe(false);
});

it("blocks publication until missing production facts are manually confirmed", async () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<TechPackEditor {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "复核并发布" }));
  expect((await screen.findByRole("alert")).textContent).toContain("BOM 需要已复核的材料和用量");
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps unknown measurements and usage empty in a draft", async () => {
  const values = props();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(techPackFixture()), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<TechPackEditor {...values} />);
  fireEvent.change(screen.getByLabelText("技术包名称"), {
    target: { value: "夹克技术资料" },
  });
  fireEvent.click(screen.getByRole("button", { name: "BOM" }));
  fireEvent.click(screen.getByRole("button", { name: "添加材料" }));
  fireEvent.change(screen.getByLabelText("BOM 1 名称"), {
    target: { value: "主面料" },
  });
  fireEvent.click(screen.getByRole("button", { name: "POM" }));
  fireEvent.click(screen.getByRole("button", { name: "添加测量部位" }));
  fireEvent.change(screen.getByLabelText("POM 1 部位"), {
    target: { value: "胸围" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await waitFor(() => expect(values.onSaved).toHaveBeenCalledTimes(1));
  const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
  expect(body.payload).toMatchObject({
    status: "DRAFT",
    reviewConfirmed: false,
    bom: [{ quantity: null, reviewed: false, source: "manual" }],
    pom: [{ value: null, tolerance: null, reviewed: false }],
  });
});

it("保留评审者的人工确认权限，编辑权限不会扩大", () => {
  const values = props();
  render(
    <TechPackEditor
      {...values}
      canEdit={false}
      data={studioFixture({
        role: "REVIEWER",
        capabilities: { edit: false, review: true, manageMembers: false },
        styles: [styleFixture()],
        techPacks: [techPackFixture()],
      })}
    />,
  );
  expect(
    (screen.getByLabelText("技术包名称") as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "复核发布" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: /我已人工复核本次资料/ }),
  );
  expect(
    (screen.getByRole("button", { name: "复核并发布" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(
    (screen.getByRole("button", { name: "保存修订" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("invalidates anchor review when a linked view image changes", async () => {
  const values = props();
  values.data = studioFixture({
    styles: [styleFixture()],
    techPacks: [
      techPackFixture({
        annotations: [
          {
            assetId: "asset-front",
            x: 0.2,
            y: 0.6,
            text: "双针线",
            reviewed: true,
          },
        ],
        reviewConfirmed: true,
      }),
    ],
  });
  render(<TechPackEditor {...values} />);
  await screen.findByDisplayValue("双针线");
  fireEvent.change(screen.getByLabelText("关联图片"), {
    target: { value: "asset-back" },
  });
  await screen.findByText(/相关锚点已标为待复核/);
  expect(
    (screen.getByLabelText("已复核工艺标注") as HTMLInputElement).checked,
  ).toBe(false);
  expect((screen.getByLabelText("标注图片") as HTMLSelectElement).value).toBe(
    "asset-back",
  );
});
