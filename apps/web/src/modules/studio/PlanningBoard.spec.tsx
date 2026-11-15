// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { studioSlotSchema, type StudioDocumentView } from "@fashion/shared";
import { PlanningBoard } from "./PlanningBoard";
import { studioFixture, styleFixture } from "./studio-test-fixtures";
import { saveStudioDocument } from "./studio-api";
import { DraftScopeProvider } from "../../components/drafts/use-persistent-draft";
import {
  draftRepository,
  flushWorkspaceDrafts,
} from "../../components/drafts/draft-repository";
import { planningDraftKey } from "./planning-drafts";

vi.mock("./studio-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./studio-api")>()),
  saveStudioDocument: vi.fn(),
}));
const slot = (
  id: string,
  collectionId: string,
  version = 1,
): StudioDocumentView => {
  const payload = studioSlotSchema.parse({
    name: `${id}主推款`,
    collectionId,
    category: "外套",
    styleRevisionId: "style-r1",
  });
  const revision = {
    id: `${id}-r${version}`,
    revision: version,
    createdAt: "2026-11-15T00:00:00Z",
    payload,
  };
  return {
    id,
    type: "COLLECTION_SLOT",
    version,
    currentRevision: revision,
    revisions: [revision],
  };
};
const data = () =>
  studioFixture({
    collections: [
      { id: "a", name: "系列 A" },
      { id: "b", name: "系列 B" },
    ],
    slots: [slot("a-slot", "a"), slot("b-slot", "b")],
    styles: [styleFixture()],
  });
const props = () => ({
  projectId: "project-planning",
  data: data(),
  collectionId: "b",
  canEdit: true,
  onDirty: vi.fn(),
  beforeChange: vi.fn(async () => true),
  onSaved: vi.fn(async () => false),
});
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(async () => {
  cleanup();
  await flushWorkspaceDrafts();
});

it("只展示所选系列的位置，保存沿用原文档和确切款式修订", async () => {
  const values = props();
  const saved = slot("b-slot", "b", 2);
  saved.currentRevision.payload.name = "修改后的主推款";
  vi.mocked(saveStudioDocument).mockResolvedValue(saved);
  render(<PlanningBoard {...values} />);
  expect(screen.queryByRole("button", { name: /a-slot主推款/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /b-slot主推款/ }));
  fireEvent.change(screen.getByLabelText("位置名称"), {
    target: { value: "修改后的主推款" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await waitFor(() => expect(saveStudioDocument).toHaveBeenCalledTimes(1));
  expect(vi.mocked(saveStudioDocument).mock.calls[0]).toEqual([
    "project-planning",
    {
      type: "COLLECTION_SLOT",
      payload: expect.objectContaining({
        name: "修改后的主推款",
        collectionId: "b",
        styleRevisionId: "style-r1",
      }),
    },
    expect.any(String),
    expect.objectContaining({ id: "b-slot", version: 1 }),
  ]);
  // A failed/stale list refresh cannot undo the acknowledged revision.
  await screen.findByRole("button", { name: /修改后的主推款/ });
  expect(screen.getByLabelText("位置名称")).toHaveProperty(
    "value",
    "修改后的主推款",
  );
});

it("保存失败保留输入和请求编号，重试仍更新同一位置", async () => {
  vi.mocked(saveStudioDocument)
    .mockRejectedValueOnce(new Error("模拟保存失败"))
    .mockResolvedValueOnce(slot("b-slot", "b", 2));
  render(<PlanningBoard {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: /b-slot主推款/ }));
  fireEvent.change(screen.getByLabelText("位置名称"), {
    target: { value: "保留的草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await screen.findByText("模拟保存失败");
  expect(screen.getByLabelText("位置名称")).toHaveProperty(
    "value",
    "保留的草稿",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
  await waitFor(() => expect(saveStudioDocument).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveStudioDocument).mock.calls[1]).toEqual(
    vi.mocked(saveStudioDocument).mock.calls[0],
  );
});

it("只读成员可查看已有规划，不能新增或修改", async () => {
  render(<PlanningBoard {...props()} canEdit={false} />);
  expect(screen.getByRole("button", { name: "新增计划位置" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: /b-slot主推款/ }));
  expect(screen.getByLabelText("位置名称").closest("fieldset")).toHaveProperty(
    "disabled",
    true,
  );
  expect(saveStudioDocument).not.toHaveBeenCalled();
});

it("新位置草稿按系列隔离，切回后恢复原输入", async () => {
  const scope = {
    accountId: "planning-drafts-user",
    projectId: "project-planning",
    editor: "studio:planning",
  };
  const values = { ...props(), data: { ...data(), slots: [] } };
  const view = render(
    <DraftScopeProvider scope={scope}>
      <PlanningBoard key="a" {...values} collectionId="a" />
    </DraftScopeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "新增计划位置" }));
  fireEvent.change(await screen.findByLabelText("位置名称"), {
    target: { value: "系列 A 的新位置" },
  });
  await flushWorkspaceDrafts();
  view.rerender(
    <DraftScopeProvider scope={scope}>
      <PlanningBoard key="b" {...values} collectionId="b" />
    </DraftScopeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "新增计划位置" }));
  expect(await screen.findByLabelText("位置名称")).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText("位置名称"), {
    target: { value: "系列 B 的新位置" },
  });
  await flushWorkspaceDrafts();
  view.rerender(
    <DraftScopeProvider scope={scope}>
      <PlanningBoard key="a" {...values} collectionId="a" />
    </DraftScopeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "新增计划位置" }));
  await waitFor(() =>
    expect(screen.getByLabelText("位置名称")).toHaveProperty(
      "value",
      "系列 A 的新位置",
    ),
  );
});

it("旧版未保存位置继续使用原草稿，不迁移或覆盖其他系列与账号", async () => {
  const scope = {
    accountId: "legacy-planning-user",
    projectId: "project-planning",
    editor: "studio:planning",
  };
  const baseline = {
    name: "",
    collectionId: "a",
    category: "",
    role: "CORE",
    status: "PLANNED",
    notes: "",
  };
  const value = { ...baseline, name: "旧版未保存位置" };
  const key = JSON.stringify([
    scope.accountId,
    scope.projectId,
    scope.editor,
    "new",
  ]);
  await draftRepository.write(
    {
      key,
      accountId: scope.accountId,
      baseline: JSON.stringify(baseline),
      value,
    },
    0,
  );
  expect(await planningDraftKey(scope, "a")).toBe("new");
  expect(await planningDraftKey(scope, "b")).toBe("new:b");
  expect(
    await planningDraftKey({ ...scope, accountId: "another-user" }, "a"),
  ).toBe("new:a");
  expect((await draftRepository.read(key))?.value).toEqual(value);
  render(
    <DraftScopeProvider scope={scope}>
      <PlanningBoard
        {...props()}
        data={{ ...data(), slots: [] }}
        collectionId="a"
      />
    </DraftScopeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "新增计划位置" }));
  await waitFor(() =>
    expect(screen.getByLabelText("位置名称")).toHaveProperty(
      "value",
      "旧版未保存位置",
    ),
  );
});
