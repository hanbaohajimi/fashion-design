// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PaletteExplorer } from "./PaletteExplorer";
import { DNACard } from "../board/generation/DNACard";
import { WorkflowMaterialEntry } from "../board/workflow/WorkflowMaterialDialogs";
import type { CollectionDna } from "../board/generation/collection-types";

HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
afterEach(cleanup);
const colors = [
  { hex: "#40536D", name: "雾蓝" },
  { hex: "#E6D8C6", name: "暖象牙" },
] as const;
const open = () =>
  fireEvent.click(screen.getByRole("button", { name: "探索配色" }));

it("预览与取消不更新宿主，应用只追加并保留原色名称与顺序", () => {
  const onApply = vi.fn();
  render(<PaletteExplorer colors={colors} onApply={onApply} />);
  open();
  expect(onApply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消预览" }));
  expect(onApply).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "探索配色" }),
  );
  open();
  fireEvent.change(screen.getByLabelText("建议色 1 名称"), {
    target: { value: "  晨雾  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用配色" }));
  expect(onApply).toHaveBeenCalledTimes(1);
  const next = onApply.mock.calls[0]?.[0];
  expect(next).toHaveLength(5);
  expect(next.slice(0, 2)).toEqual(colors);
  expect(next[2].name).toBe("晨雾");
});

it("宿主改变会重算预览，使用最新颜色而非旧草稿", () => {
  const onApply = vi.fn();
  const { rerender } = render(
    <PaletteExplorer colors={colors} onApply={onApply} />,
  );
  open();
  const oldPreview = screen.getByRole("list", { name: "建议颜色" }).textContent;
  const next = [{ hex: "#991155", name: "莓红" }];
  rerender(<PaletteExplorer colors={next} onApply={onApply} />);
  expect(screen.getByRole("list", { name: "建议颜色" }).textContent).not.toBe(
    oldPreview,
  );
  fireEvent.click(screen.getByRole("button", { name: "应用配色" }));
  expect(onApply.mock.calls[0]?.[0][0]).toEqual(next[0]);
  expect(onApply.mock.calls[0]?.[0]).toHaveLength(4);
});

it("空色板、满额、锁定禁止探索，预览中锁定也不能应用", () => {
  const onApply = vi.fn();
  const { rerender } = render(
    <PaletteExplorer colors={[]} onApply={onApply} />,
  );
  expect(
    (screen.getByRole("button", { name: "探索配色" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <PaletteExplorer
      colors={Array.from({ length: 12 }, () => colors[0])}
      onApply={onApply}
    />,
  );
  expect(screen.getByText(/已达 12 色上限/)).toBeTruthy();
  rerender(<PaletteExplorer colors={colors} onApply={onApply} />);
  open();
  rerender(<PaletteExplorer colors={colors} disabled onApply={onApply} />);
  expect(screen.queryByRole("button", { name: "应用配色" })).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});

it("切换策略和数量更新候选，空白名称禁止应用，近似原色只提示", () => {
  render(
    <PaletteExplorer
      colors={[...colors, { hex: "#40536e", name: "近似蓝" }]}
      onApply={vi.fn()}
    />,
  );
  open();
  const oldPreview = screen.getByRole("list", { name: "建议颜色" }).textContent;
  fireEvent.change(screen.getByLabelText("配色策略"), {
    target: { value: "complementary" },
  });
  expect(screen.getByRole("list", { name: "建议颜色" }).textContent).not.toBe(
    oldPreview,
  );
  fireEvent.change(screen.getByLabelText("追加数量"), {
    target: { value: "1" },
  });
  expect(
    within(screen.getByRole("list", { name: "建议颜色" })).getAllByRole(
      "listitem",
    ),
  ).toHaveLength(1);
  expect(screen.getByText(/颜色接近：/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("建议色 1 名称"), {
    target: { value: "   " },
  });
  expect(
    (screen.getByRole("button", { name: "应用配色" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("工作流应用配色不直接保存，保存失败保留追加结果并可重试", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("保存失败，请重试"))
    .mockResolvedValue(undefined);
  render(
    <WorkflowMaterialEntry
      type="swatch"
      initialTitle="通勤色卡"
      initialPayload={{ colors }}
      busy={false}
      onClose={vi.fn()}
      onAdd={save}
    />,
  );
  open();
  fireEvent.click(screen.getByRole("button", { name: "应用配色" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "加入工作流" }));
  await screen.findByRole("alert");
  expect(
    (screen.getByLabelText("颜色名称 5") as HTMLInputElement).value,
  ).not.toBe("");
  fireEvent.click(screen.getByRole("button", { name: "加入工作流" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
  expect(save.mock.calls[1]?.[1].colors.slice(0, 2)).toEqual(colors);
  expect(save.mock.calls[1]?.[1].color).toBe(colors[0].hex);
});

it("DNA 仅在应用后修改色板，其他字段和锁定行为保持一致", () => {
  const dna: CollectionDna = {
    extractionStatus: "ready",
    fabrics: ["羊毛"],
    locks: {
      fabrics: false,
      palette: false,
      moodWords: false,
      silhouettes: false,
    },
    moodWords: ["克制"],
    palette: colors,
    referenceFileIds: [],
    signatureDetails: [],
    silhouettes: ["直筒"],
    updatedAt: "2026-10-25",
  };
  const onChange = vi.fn();
  const { rerender } = render(<DNACard dna={dna} onChange={onChange} />);
  open();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "应用配色" }));
  expect(onChange).toHaveBeenCalledWith({ ...dna, palette: expect.any(Array) });
  expect(onChange.mock.calls[0]?.[0].palette).toHaveLength(5);
  rerender(
    <DNACard
      dna={{ ...dna, locks: { ...dna.locks, palette: true } }}
      onChange={onChange}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "探索配色" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
