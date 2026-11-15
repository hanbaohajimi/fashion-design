// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FabricCard } from "./FabricCard";
import type { Fabric } from "./fabric-types";

const fabric: Fabric = {
  id: "fabric-flip",
  canManage: true,
  mainFileId: "file-flip",
  mainImageUrl: "/fabric.png",
  scope: "user",
  tags: ["春夏", "透气"],
  createdAt: "2026-11-14T00:00:00Z",
  updatedAt: "2026-11-14T00:00:00Z",
  details: {
    name: "棉麻斜纹",
    code: "FM-017",
    category: "梭织",
    composition: [
      { fiber: "棉", percent: 60 },
      { fiber: "亚麻", percent: 40 },
    ],
    weightGsm: 185,
    widthCm: 148,
    stretch: "微弹",
    weave: "斜纹",
    supplier: "苏州面料工坊",
  },
};

beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

afterEach(cleanup);

describe("面料库双面卡片", () => {
  it("正面只有图片，翻面后展示真实规格并将焦点移到当前面", () => {
    render(<FabricCard fabric={fabric} />);
    const article = screen.getByRole("article", { name: "棉麻斜纹，面料卡片" });
    const front = screen.getByRole("button", {
      name: "查看面料规格：棉麻斜纹",
    });
    expect(article.draggable).toBe(false);
    expect(
      screen.queryByRole("button", { name: "完整档案：棉麻斜纹" }),
    ).toBeNull();
    expect(
      within(front.parentElement ?? article).getByRole("img", {
        name: "棉麻斜纹",
      }),
    ).toBeTruthy();
    expect(front.parentElement?.textContent).toBe("");

    fireEvent.click(front);
    const back = screen.getByRole("button", { name: "返回面料图片：棉麻斜纹" });
    expect(document.activeElement).toBe(back);
    for (const value of [
      "棉 60% / 亚麻 40%",
      "185 g/m²",
      "148 cm",
      "微弹",
      "斜纹",
      "苏州面料工坊",
    ]) {
      expect(within(back).getByText(value)).toBeTruthy();
    }
    expect(front.closest("[aria-hidden]")?.hasAttribute("inert")).toBe(true);
    fireEvent.click(within(back).getByText("185 g/m²"));
    expect(document.activeElement).toBe(front);
    expect(
      screen.queryByRole("button", { name: "完整档案：棉麻斜纹" }),
    ).toBeNull();
  });

  it("加入项目和打开档案不会同时翻面，处理中禁止重复加入", () => {
    const add = vi.fn();
    const { rerender } = render(<FabricCard fabric={fabric} onAdd={add} />);
    fireEvent.click(
      screen.getByRole("button", { name: "查看面料规格：棉麻斜纹" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "加入当前项目" }));
    expect(add).toHaveBeenCalledExactlyOnceWith(fabric);
    expect(
      screen.getByRole("button", { name: "返回面料图片：棉麻斜纹" }),
    ).toBeTruthy();

    rerender(<FabricCard fabric={fabric} onAdd={add} adding addDisabled />);
    const adding = screen.getByRole("button", {
      name: "正在加入…",
    }) as HTMLButtonElement;
    expect(adding.disabled).toBe(true);
    fireEvent.click(adding);
    expect(add).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "完整档案：棉麻斜纹" }));
    expect(screen.getByRole("dialog", { name: "管理或删除面料" })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "返回面料图片：棉麻斜纹",
        hidden: true,
      }),
    ).toBeTruthy();
  });

  it("没有规格或图片加载失败时仍能查看背面，不推测面料物性", () => {
    render(<FabricCard fabric={{ ...fabric, details: null }} />);
    fireEvent.error(screen.getByRole("img", { name: "春夏、透气" }));
    expect(screen.getByText("图片暂时无法加载")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "查看面料规格：春夏、透气" }),
    );
    const back = screen.getByRole("button", {
      name: "返回面料图片：春夏、透气",
    });
    expect(within(back).getByText("未命名面料")).toBeTruthy();
    expect(within(back).getAllByText("未填写")).toHaveLength(6);
  });

  it("长名称和多成分资料原样保留", () => {
    const name = "长名称棉麻混纺面料".repeat(8);
    const fibers = Array.from({ length: 12 }, (_, index) => ({
      fiber: `纤维${index + 1}`,
      percent: index === 11 ? 12 : 8,
    }));
    render(
      <FabricCard
        fabric={{
          ...fabric,
          details: { ...fabric.details, name, composition: fibers },
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `查看面料规格：${name}` }),
    );
    expect(screen.getByText(name).getAttribute("title")).toBe(name);
    const back = screen.getByRole("button", { name: `返回面料图片：${name}` });
    expect(back.textContent).toContain("纤维12 12%");
  });

  it("紧凑卡片继续展示原有管理、加入和白板拖拽能力", () => {
    render(<FabricCard compact fabric={fabric} onAdd={vi.fn()} />);
    expect(
      screen.getByRole("article", { name: "棉麻斜纹，拖拽到白板" }).draggable,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "管理面料：棉麻斜纹" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "加入当前项目" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "查看面料规格：棉麻斜纹" }),
    ).toBeNull();
  });
});
