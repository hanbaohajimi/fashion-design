// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TryOnReferenceEntry } from "./TryOnReferenceEntry";

const actions = vi.hoisted(() => ({ import: vi.fn(), push: vi.fn(), navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: actions.push }) }));
vi.mock("../generation/collection-api", () => ({ importDesignAsset: actions.import }));
vi.mock("../../navigation", () => ({ navigateAfterSave: actions.navigate }));

beforeEach(() => {
  actions.import.mockResolvedValue({ id: "design-asset" });
  actions.navigate.mockImplementation(async (navigate: () => void) => { navigate(); return true; });
});
afterEach(() => { cleanup(); Object.values(actions).forEach((mock) => mock.mockReset()); });

it("does not import automatically and registers the selected file only after the user clicks", async () => {
  render(<TryOnReferenceEntry projectId="project" fileAssetId="selected-file" canEdit />);
  expect(actions.import).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "实时试穿这张图片" }));
  fireEvent.click(screen.getByRole("button", { name: "实时试穿这张图片" }));
  await waitFor(() => expect(actions.push).toHaveBeenCalledWith("/project/studio?tab=presentation&mode=realtime&assetId=design-asset"));
  expect(actions.import).toHaveBeenCalledTimes(1);
  expect(actions.import).toHaveBeenCalledWith("project", "selected-file");
  expect(actions.navigate).toHaveBeenCalledTimes(1);
});

it("keeps a readonly reference image in place without importing", () => {
  render(<TryOnReferenceEntry projectId="project" fileAssetId="file" canEdit={false} />);
  const button = screen.getByRole("button", { name: "实时试穿这张图片" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(button);
  expect(actions.import).not.toHaveBeenCalled();
  expect(actions.push).not.toHaveBeenCalled();
});

it("stays on the canvas when import fails and allows a manual retry", async () => {
  actions.import.mockRejectedValueOnce(new Error("图片登记失败"));
  render(<TryOnReferenceEntry projectId="project" fileAssetId="file" canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "实时试穿这张图片" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(actions.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "实时试穿这张图片" }));
  await waitFor(() => expect(actions.push).toHaveBeenCalledTimes(1));
});

it("preserves the existing canvas save guard when navigation is blocked", async () => {
  actions.navigate.mockResolvedValue(false);
  render(<TryOnReferenceEntry projectId="project" fileAssetId="file" canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "实时试穿这张图片" }));
  await screen.findByText(/画布尚未保存/);
  expect(actions.push).not.toHaveBeenCalled();
});

it("does not navigate after the selected node is closed during import", async () => {
  let resolve!: (value: { id: string }) => void;
  actions.import.mockImplementation(() => new Promise<{ id: string }>((done) => { resolve = done; }));
  const view = render(<TryOnReferenceEntry projectId="project" fileAssetId="file" canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "实时试穿这张图片" }));
  view.unmount();
  resolve({ id: "late" });
  await Promise.resolve();
  expect(actions.push).not.toHaveBeenCalled();
});
