// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import {
  ImageZoomControl,
  type ImageZoomControlHandle,
} from "./ImageZoomControl";

afterEach(cleanup);

it("allows transient digits and empty input, committing a valid percentage once", () => {
  const change = vi.fn();
  render(
    <ImageZoomControl
      zoom={100}
      onChange={change}
      ref={createRef<ImageZoomControlHandle>()}
    />,
  );
  const input = screen.getByRole("spinbutton", { name: "缩放比例" });
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.change(input, { target: { value: "2" } });
  expect((input as HTMLInputElement).value).toBe("2");
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "200" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  expect(change).toHaveBeenCalledExactlyOnceWith(200);
});

it("keeps an out-of-range draft, supports Escape and fits the window explicitly", () => {
  const change = vi.fn();
  render(
    <ImageZoomControl
      zoom={100}
      onChange={change}
      ref={createRef<ImageZoomControlHandle>()}
    />,
  );
  const input = screen.getByRole("spinbutton", { name: "缩放比例" });
  fireEvent.change(input, { target: { value: "401" } });
  fireEvent.blur(input);
  expect(screen.getByRole("alert").textContent).toContain("10–400");
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect((input as HTMLInputElement).value).toBe("100");
  fireEvent.click(screen.getByRole("button", { name: "适合窗口" }));
  expect(change).toHaveBeenCalledExactlyOnceWith(null);
});
