// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BomTable } from "./TechPackTables";
import type { BomDraft } from "./tech-pack-draft";

afterEach(cleanup);
it("删除前一行不把数值草稿和 DOM 身份转移到其他材料", () => {
  function Harness() {
    const [rows, setRows] = useState<BomDraft[]>(["first", "second"].map((uiId) => ({ uiId, name: uiId, quantity: "1", material: "", unit: "米", supplier: "", source: "manual", reviewed: true })));
    return <BomTable rows={rows} onChange={setRows} disabled={false} />;
  }
  render(<Harness />);
  const second = screen.getByLabelText("BOM 2 用量");
  fireEvent.change(second, { target: { value: "1." } });
  const remove = screen.getAllByRole("button", { name: "移除" })[0];
  if (!remove) throw new Error("没有移除入口");
  fireEvent.click(remove);
  expect(screen.getByLabelText("BOM 1 用量")).toBe(second);
  expect((second as HTMLInputElement).value).toBe("1.");
  expect((screen.getByLabelText("BOM 1 已复核") as HTMLInputElement).checked).toBe(false);
});
