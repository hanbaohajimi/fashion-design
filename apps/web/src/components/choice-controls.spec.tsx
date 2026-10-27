// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChoiceSelect,
  Select,
  Switch,
  type ChoiceOption,
} from "./choice-controls";
import { Menu } from "./command-menu";
import { popupSession } from "./interactions/adaptive-popup";

const options = (count: number): ChoiceOption[] =>
  Array.from({ length: count }, (_, index) => ({
    value: String(index),
    label: `选项 ${index + 1}`,
  }));
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("value controls", () => {
  it.each([2, 4])(
    "flattens %i values into an exclusive radio group",
    (count) => {
      const change = vi.fn();
      render(
        <ChoiceSelect
          label="图像质量"
          value="0"
          options={options(count)}
          onValueChange={change}
        />,
      );
      const group = screen.getByRole("radiogroup", { name: "图像质量" });
      expect(within(group).getAllByRole("radio")).toHaveLength(count);
      fireEvent.click(within(group).getByRole("radio", { name: "选项 2" }));
      expect(change).toHaveBeenCalledExactlyOnceWith("1");
    },
  );

  it.each([5, 10])(
    "uses a bounded list without a search field for %i values",
    (count) => {
      render(
        <ChoiceSelect
          label="类型"
          value="0"
          options={options(count)}
          onValueChange={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "类型" }));
      expect(screen.getAllByRole("option")).toHaveLength(count);
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(
        screen
          .getByRole("listbox")
          .closest("[data-popup-kind]")
          ?.getAttribute("data-popup-kind"),
      ).toBe("anchored");
    },
  );

  it("adds search at eleven values and keeps the selected label when filtering", () => {
    render(
      <ChoiceSelect
        label="修订"
        value="0"
        options={options(11)}
        onValueChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "修订" });
    fireEvent.click(trigger);
    const search = screen.getByRole("combobox", { name: "搜索修订" });
    fireEvent.change(search, { target: { value: "选项 11" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(trigger.textContent).toBe("选项 1");
    fireEvent.change(search, { target: { value: "没有这条记录" } });
    expect(screen.getByRole("status").textContent).toContain("已加载");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps growing record selectors searchable even with two records", () => {
    const change = vi.fn();
    const { rerender } = render(
      <ChoiceSelect
        label="历史"
        searchable
        value="1"
        options={options(2)}
        onValueChange={change}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    expect(screen.getByRole("combobox")).toBeTruthy();
    rerender(
      <ChoiceSelect
        label="历史"
        searchable
        value="1"
        options={options(12)}
        onValueChange={change}
      />,
    );
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });

  it("counts real empty values, but excludes a placeholder", () => {
    const { rerender } = render(
      <Select aria-label="范围" value="" onChange={vi.fn()}>
        <option value="">请选择</option>
        {options(4).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    rerender(
      <Select aria-label="范围" value="" onChange={vi.fn()}>
        <option value="">全部</option>
        {options(4).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>,
    );
    expect(screen.getByRole("button", { name: "范围" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("bridges existing form handlers once without submitting the form", () => {
    const change = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    function Form() {
      const [value, setValue] = useState("0");
      return (
        <form aria-label="草稿" onSubmit={submit}>
          <Select
            name="quality"
            aria-label="质量"
            value={value}
            onChange={(event) => {
              change(event.currentTarget.value);
              setValue(event.currentTarget.value);
            }}
          >
            {options(2).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </form>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByRole("radio", { name: "选项 2" }));
    expect(change).toHaveBeenCalledExactlyOnceWith("1");
    expect(submit).not.toHaveBeenCalled();
    expect(
      new FormData(screen.getByRole("form") as HTMLFormElement).get("quality"),
    ).toBe("1");
  });

  it("skips disabled options with the keyboard and commits only on Enter", () => {
    const change = vi.fn();
    const list = options(5).map((option, index) => ({
      ...option,
      disabled: index === 1,
    }));
    render(
      <ChoiceSelect
        label="参数"
        value="0"
        options={list}
        onValueChange={change}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "参数" }), {
      key: "ArrowDown",
    });
    const popup = screen.getByRole("listbox");
    fireEvent.keyDown(popup, { key: "ArrowDown" });
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(popup, { key: "Enter" });
    expect(change).toHaveBeenCalledExactlyOnceWith("2");
  });

  it("does not commit an IME confirmation or a disabled option", () => {
    const change = vi.fn();
    render(
      <ChoiceSelect
        label="名称"
        searchable
        value=""
        options={[
          { value: "a", label: "春夏", disabled: true },
          { value: "b", label: "秋冬" },
        ]}
        onValueChange={change}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "名称" }));
    const search = screen.getByRole("combobox");
    fireEvent.compositionStart(search);
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    fireEvent.click(screen.getByRole("option", { name: "春夏" }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.compositionEnd(search);
    fireEvent.change(search, { target: { value: "秋冬" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(change).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("preserves missing values rather than selecting the first available record", () => {
    const change = vi.fn();
    render(
      <ChoiceSelect
        label="修订"
        searchable
        value="deleted"
        options={options(2)}
        onValueChange={change}
      />,
    );
    expect(screen.getByRole("button", { name: "修订" }).textContent).toContain(
      "已不可用",
    );
    expect(change).not.toHaveBeenCalled();
  });

  it("retains required validation and routes invalid focus to the visible control", () => {
    const { container } = render(
      <ChoiceSelect
        label="角色"
        required
        value=""
        options={options(2)}
        onValueChange={vi.fn()}
        error="请选择角色"
      />,
    );
    expect(container.querySelector("select")?.checkValidity()).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "选项 1" }),
    );
    expect(
      screen.getByRole("radiogroup").getAttribute("aria-describedby"),
    ).toBe(screen.getByRole("alert").id);
  });

  it("cannot change a field disabled through its enclosing fieldset", () => {
    const change = vi.fn();
    render(
      <fieldset disabled>
        <ChoiceSelect
          label="范围"
          value="0"
          options={options(2)}
          onValueChange={change}
        />
      </fieldset>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "选项 2" }));
    expect(change).not.toHaveBeenCalled();
  });

  it("keeps compact table cells as selects even with three units", () => {
    render(
      <ChoiceSelect
        label="单位"
        compact
        value="0"
        options={options(3)}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "单位" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("toggles a boolean once without submitting", () => {
    const change = vi.fn();
    render(
      <Switch label="启用自动预览" checked={false} onCheckedChange={change} />,
    );
    const control = screen.getByRole("switch", { name: "启用自动预览" });
    fireEvent.click(control);
    expect(change).toHaveBeenCalledExactlyOnceWith(true);
    expect(control.getAttribute("type")).toBe("button");
  });
});

describe("popup and command policies", () => {
  it("uses downward menus at the phone top and sheets at the bottom or without space", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const rect = vi.spyOn(trigger, "getBoundingClientRect");
    rect.mockReturnValue(new DOMRect(10, 20, 100, 40));
    expect(popupSession(trigger, 264).sheet).toBe(false);
    rect.mockReturnValue(new DOMRect(10, 700, 100, 40));
    expect(popupSession(trigger, 264).sheet).toBe(true);
    trigger.remove();
  });

  it("portals into the owning native dialog", () => {
    const dialog = document.createElement("dialog");
    dialog.open = true;
    const trigger = document.createElement("button");
    dialog.append(trigger);
    document.body.append(dialog);
    expect(popupSession(trigger, 100).container).toBe(dialog);
    dialog.remove();
  });

  it("searches command collections without executing on typing and executes a click once", () => {
    const command = vi.fn();
    render(
      <Menu label="操作">
        {options(11).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => command(option.value)}
          >
            {option.label}
          </button>
        ))}
      </Menu>,
    );
    fireEvent.click(screen.getByText("操作"));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索操作" }), {
      target: { value: "选项 11" },
    });
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选项 11" }));
    expect(command).toHaveBeenCalledExactlyOnceWith("10");
    expect(screen.queryByRole("group", { name: "操作选项" })).toBeNull();
  });
});
