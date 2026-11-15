// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FabricVirtualGrid } from "./FabricVirtualGrid";
import type { Fabric } from "./fabric-types";

vi.mock("react-virtuoso", () => ({
  VirtuosoGrid: ({
    data,
    itemContent,
  }: {
    data: readonly Fabric[];
    itemContent: (index: number, fabric: Fabric) => ReactNode;
  }) => (
    <div>
      {data.map((fabric, index) => (
        <div key={fabric.id}>{itemContent(index, fabric)}</div>
      ))}
    </div>
  ),
}));

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
});

afterEach(cleanup);

function sample(id: string): Fabric {
  return {
    id,
    canManage: false,
    mainFileId: id,
    mainImageUrl: `/${id}.png`,
    scope: "preset",
    tags: [id],
    createdAt: "2026-11-14T00:00:00Z",
    updatedAt: "2026-11-14T00:00:00Z",
    details: { name: id },
  };
}

describe("面料虚拟列表的翻面状态", () => {
  it("按面料ID独立保留状态，卸载重挂及排序不会串卡片", () => {
    const a = sample("面料A");
    const b = sample("面料B");
    const { rerender, unmount } = render(
      <FabricVirtualGrid fabrics={[a, b]} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "查看面料规格：面料A" }),
    );
    expect(
      screen.getByRole("button", { name: "查看面料规格：面料B" }),
    ).toBeTruthy();
    rerender(<FabricVirtualGrid fabrics={[b]} />);
    expect(
      screen.queryByRole("button", { name: "返回面料图片：面料A" }),
    ).toBeNull();
    rerender(<FabricVirtualGrid fabrics={[b, a]} />);
    expect(
      screen.getByRole("button", { name: "返回面料图片：面料A" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "查看面料规格：面料B" }),
    );
    expect(
      screen.getAllByRole("button", { name: /返回面料图片：/ }),
    ).toHaveLength(2);
    unmount();
    render(<FabricVirtualGrid fabrics={[a, b]} />);
    expect(
      screen.getAllByRole("button", { name: /查看面料规格：/ }),
    ).toHaveLength(2);
  });
});
