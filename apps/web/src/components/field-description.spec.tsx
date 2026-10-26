// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field, Input } from "./ui";
afterEach(cleanup);

it("字段提示与既有说明合并，错误替换提示并标明无效", () => {
  const { rerender } = render(
    <Field label="名称" hint="填写公开名称">
      <Input aria-describedby="existing" />
    </Field>,
  );
  const input = screen.getByRole("textbox");
  const hintId = input.getAttribute("aria-describedby")?.split(" ")[1];
  expect(input.getAttribute("aria-describedby")).toContain("existing");
  expect(document.getElementById(hintId ?? "")?.textContent).toBe(
    "填写公开名称",
  );
  rerender(
    <Field label="名称" hint="填写公开名称" error="名称不能为空">
      <Input aria-describedby="existing" />
    </Field>,
  );
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(hintId ?? "")?.textContent).toBe(
    "名称不能为空",
  );
});
