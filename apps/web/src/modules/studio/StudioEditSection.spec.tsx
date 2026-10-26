// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useState } from "react";
import { StudioEditSection } from "./StudioEditSection";
afterEach(cleanup);
function Draft() {
  const [value, setValue] = useState("原款");
  return (
    <form>
      <StudioEditSection title="编辑款式">
        <label>
          名称
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </label>
      </StudioEditSection>
    </form>
  );
}
it("keeps the same editable draft mounted when closed and reopened", () => {
  render(<Draft />);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑款式" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "袖口修改草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "收起编辑" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑款式" }));
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
    "袖口修改草稿",
  );
});
