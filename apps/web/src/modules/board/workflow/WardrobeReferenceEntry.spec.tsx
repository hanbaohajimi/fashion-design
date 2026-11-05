// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WardrobeReferenceEntry } from "./WardrobeReferenceEntry";

const actions = vi.hoisted(() => ({ import: vi.fn(), push: vi.fn(), navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: actions.push }) }));
vi.mock("../generation/collection-api", () => ({ importDesignAsset: actions.import }));
vi.mock("../../navigation", () => ({ navigateAfterSave: actions.navigate }));

beforeEach(() => {
  actions.import.mockResolvedValue({ id: "design-asset" });
  actions.navigate.mockImplementation(async (navigate: () => void) => { navigate(); return true; });
});
afterEach(() => { cleanup(); Object.values(actions).forEach((mock) => mock.mockReset()); });

it("requires explicit action, imports once and opens preparation instead of publishing a garment", async () => {
  render(<WardrobeReferenceEntry projectId="project" fileAssetId="source-file" canEdit />);
  expect(actions.import).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "加入衣架" }));
  fireEvent.click(screen.getByRole("button", { name: "加入衣架" }));
  await waitFor(() => expect(actions.push).toHaveBeenCalledWith("/project/studio?tab=presentation&mode=wardrobe&assetId=design-asset"));
  expect(actions.import).toHaveBeenCalledTimes(1);
  expect(actions.import).toHaveBeenCalledWith("project", "source-file");
});

it("honors the existing save guard and read-only role", async () => {
  const view = render(<WardrobeReferenceEntry projectId="project" fileAssetId="file" canEdit={false} />);
  fireEvent.click(screen.getByRole("button", { name: "加入衣架" }));
  expect(actions.import).not.toHaveBeenCalled();
  view.rerender(<WardrobeReferenceEntry projectId="project" fileAssetId="file" canEdit />);
  actions.navigate.mockResolvedValue(false);
  fireEvent.click(screen.getByRole("button", { name: "加入衣架" }));
  await screen.findByText(/画布尚未保存/);
  expect(actions.push).not.toHaveBeenCalled();
});

it("allows retry on failure and ignores completion after unmount", async () => {
  actions.import.mockRejectedValueOnce(new Error("图片登记失败"));
  const view = render(<WardrobeReferenceEntry projectId="project" fileAssetId="file" canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "加入衣架" }));
  await screen.findByRole("alert");
  expect(actions.push).not.toHaveBeenCalled();
  let resolve!: (value: { id: string }) => void;
  actions.import.mockImplementation(() => new Promise<{ id: string }>((done) => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: "加入衣架" }));
  view.unmount();
  resolve({ id: "late" });
  await Promise.resolve();
  expect(actions.push).not.toHaveBeenCalled();
});
