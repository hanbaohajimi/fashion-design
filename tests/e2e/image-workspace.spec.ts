import { expect, test, type Page } from "@playwright/test";
import { seedVisualApp, PROJECT, NOW } from "../visual/fixtures";
import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowOperation,
} from "../../apps/web/src/modules/board/workflow/workflow-api";
import type { ImageFeedback } from "../../packages/shared/src/image-workspace";

function candidate(id: string, batch = "batch-a"): WorkflowNode {
  return {
    id,
    kind: "asset",
    type: "candidate",
    title: `设计 ${id}`,
    x: 800,
    y: 100,
    status: "completed",
    createdAt: NOW,
    updatedAt: NOW,
    payload: {
      assetId: id,
      executionId: batch,
      imageUrl: `/api/design-assets/${id}/content`,
    },
  };
}
async function setup(page: Page) {
  await seedVisualApp(page);
  let graph: WorkflowGraph = {
    projectId: PROJECT,
    revision: 1,
    layoutRevision: 0,
    legacyAvailable: false,
    nodes: [
      {
        ...candidate("tool"),
        kind: "tool",
        type: "generate_design",
        title: "方案生成",
        status: "running",
        payload: {},
      },
    ],
    edges: [],
  };
  let feedback: ImageFeedback = { revision: 0, annotations: [], comments: [] };
  const submitted: Record<string, unknown>[] = [];
  let shares: { id: string; expiresAt: string; revokedAt: string | null }[] =
    [];
  const append = (id: string, batch = "batch-a", producer = "tool") => {
    graph = {
      ...graph,
      revision: graph.revision + 1,
      nodes: [...graph.nodes, candidate(id, batch)],
      edges: [
        ...graph.edges,
        {
          id: `edge-${id}`,
          sourceNodeId: producer,
          targetNodeId: id,
          sourcePort: "out",
          targetPort: "source",
        },
      ],
    };
  };
  await page.route(`**/api/projects/${PROJECT}/workflow**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/tools"))
      return route.fulfill({ json: { agentVersion: 2, tools: [] } });
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as {
        operations: WorkflowOperation[];
      };
      for (const operation of patch.operations) {
        if (operation.type === "add_node")
          graph = {
            ...graph,
            nodes: [
              ...graph.nodes,
              {
                ...operation.node,
                createdAt: NOW,
                updatedAt: NOW,
                status: "ready",
              },
            ],
          };
        if (operation.type === "add_edge")
          graph = { ...graph, edges: [...graph.edges, operation.edge] };
      }
      graph = { ...graph, revision: graph.revision + 1 };
    }
    if (path.endsWith("/execute")) {
      const id = path.split("/").at(-2);
      const node = graph.nodes.find((n) => n.id === id);
      submitted.push({ type: node?.type, ...(node?.payload.params as object) });
      append(
        `edited-${submitted.length}`,
        `batch-edit-${submitted.length}`,
        id,
      );
    }
    return route.fulfill({ json: graph });
  });
  await page.route("**/api/design-assets/*/feedback", (route) => {
    if (route.request().method() === "PUT")
      feedback = {
        ...(route.request().postDataJSON() as ImageFeedback),
        revision: feedback.revision + 1,
      };
    return route.fulfill({ json: feedback });
  });
  await page.route("**/api/design-assets/*/shares**", (route) => {
    if (route.request().method() === "POST") {
      shares.push({
        id: "share-1",
        expiresAt: "2026-12-01T00:00:00Z",
        revokedAt: null,
      });
      return route.fulfill({ json: { path: `/share/${"a".repeat(43)}` } });
    }
    if (route.request().method() === "DELETE")
      shares = shares.map((s) => ({ ...s, revokedAt: NOW }));
    return route.fulfill({ json: shares });
  });
  await page.goto(`/${PROJECT}`);
  await expect(
    page.getByText("方案生成", { exact: true }).first(),
  ).toBeVisible();
  return { append, submitted, feedback: () => feedback };
}

test("首张自动打开，同批追加不抢图，标注评论和分享可完成", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const app = await setup(page);
  await expect(page.getByRole("dialog", { name: "图片工作区" })).toHaveCount(0);
  app.append("look-a");
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await expect(workspace).toBeVisible();
  await expect(
    workspace.getByAltText("设计 look-a", { exact: true }),
  ).toBeVisible();
  app.append("look-b");
  await expect(
    workspace
      .getByRole("navigation", { name: "本次生成结果" })
      .getByRole("button"),
  ).toHaveCount(2);
  await workspace.getByRole("button", { name: "标注", exact: true }).click();
  const view = workspace.getByLabel("图片查看区域");
  const box = await view.boundingBox();
  if (!box) throw new Error("图片区域不可见");
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  await workspace
    .getByRole("button", { name: "保存标注", exact: true })
    .click();
  await expect.poll(() => app.feedback().annotations.length).toBe(1);
  await workspace
    .getByRole("button", { name: "添加评论", exact: true })
    .click();
  await workspace.getByLabel("图片评论").fill("保留面料，收窄袖口");
  await workspace
    .getByRole("complementary")
    .getByRole("button", { name: "添加评论", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "保存评论", exact: true })
    .click();
  await expect.poll(() => app.feedback().comments.length).toBe(1);
  await workspace.getByRole("button", { name: "按选中意见修改" }).click();
  await expect.poll(() => app.submitted.length).toBe(1);
  expect(app.submitted[0]).toMatchObject({
    intent: "feedback",
    commentIds: [app.feedback().comments[0]?.id],
  });
  await expect(
    workspace.getByAltText("设计 edited-1", { exact: true }),
  ).toBeVisible();
  await workspace.getByRole("button", { name: "分享", exact: false }).click();
  await workspace.getByRole("button", { name: "创建只读链接" }).click();
  await expect(workspace.getByLabel("分享链接")).toHaveValue(/\/share\//u);
  await workspace.getByRole("button", { name: "撤销链接" }).click();
  await expect(workspace.getByText("已撤销", { exact: true })).toBeVisible();
  await workspace.getByRole("button", { name: "收起工具" }).click();
  await page.route("**/api/design-assets/*/file", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") }));
  const downloaded = page.waitForEvent("download");
  await workspace.getByRole("button", { name: "下载原图", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("设计 edited-1.png");
  await page.screenshot({ path: "output/image-workspace-desktop.png" });
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await expect(workspace).toBeHidden();
  app.append("look-c");
  await expect(
    page.getByText("新的设计方案已到达", { exact: true }),
  ).toBeVisible();
  await expect(workspace).toBeHidden();
});

test("手机上支持尺寸调整、扩图参数和匿名分享页面", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await setup(page);
  app.append("mobile");
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await expect(workspace).toBeVisible();
  await workspace
    .getByRole("button", { name: "调整大小", exact: true })
    .click();
  await workspace.getByLabel("输出宽度").fill("300");
  await workspace.getByRole("button", { name: "保存为新版本" }).click();
  await expect.poll(() => app.submitted.length).toBe(1);
  expect(app.submitted[0]).toMatchObject({
    type: "transform_image",
    width: 300,
    height: 400,
  });
  await expect(
    workspace.getByAltText("设计 edited-1", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "output/image-workspace-mobile.png" });
  await workspace.getByRole("button", { name: "调整大小", exact: true }).click();
  await workspace.getByLabel("调整方式").selectOption("crop");
  await workspace.getByLabel("裁剪比例").selectOption("1");
  await expect(workspace.getByRole("button", { name: "移动裁剪区域" })).toBeVisible();
  await workspace.getByRole("button", { name: "保存为新版本" }).click();
  await expect.poll(() => app.submitted.length).toBe(2);
  expect(app.submitted[1]).toMatchObject({ type: "transform_image", crop: { left: 0, top: 100, width: 600, height: 600 } });
  await expect(workspace.getByAltText("设计 edited-2", { exact: true })).toBeVisible();
  await workspace.getByRole("button", { name: "调整大小", exact: true }).click();
  await workspace.getByLabel("调整方式").selectOption("outpaint");
  await workspace.getByLabel("画布宽度").fill("1024");
  await workspace.getByLabel("画布高度").fill("1024");
  await workspace.getByLabel("原图左边距").fill("64");
  await workspace.getByLabel("原图上边距").fill("64");
  await workspace.getByRole("button", { name: "生成扩图版本" }).click();
  await expect.poll(() => app.submitted.length).toBe(3);
  expect(app.submitted[2]).toMatchObject({ type: "edit_design", intent: "outpaint", outpaint: { width: 1024, height: 1024, left: 64, top: 64 } });
  await expect(workspace.getByAltText("设计 edited-3", { exact: true })).toBeVisible();
  await page.route("**/api/image-shares/*", (route) =>
    route.fulfill({
      json: { imageUrl: "/visual-garment.svg", width: 600, height: 800 },
    }),
  );
  await page.goto(`/share/${"a".repeat(43)}`);
  await expect(page.getByAltText("分享的设计图片")).toBeVisible();
  await expect(page).toHaveURL(/\/share\//u);
});

test("编辑中到图仅提示，缩放坐标与关闭后的草稿保留", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const app = await setup(page);
  app.append("draft");
  const workspace = page.getByRole("dialog", { name: "图片工作区" });
  await expect(
    workspace.getByAltText("设计 draft", { exact: true }),
  ).toBeVisible();
  await workspace.getByLabel("缩放比例").selectOption("200");
  await workspace
    .getByRole("button", { name: "添加评论", exact: true })
    .click();
  const picture = workspace.getByAltText("设计 draft", { exact: true });
  const bounds = await picture.boundingBox();
  if (!bounds) throw new Error("图片不可见");
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await workspace.getByLabel("图片评论").fill("缩放后仍指向中心");
  app.append("arriving", "another-batch");
  await expect(
    page.getByText("新的设计方案已到达", { exact: true }),
  ).toBeVisible();
  await expect(picture).toBeVisible();
  await expect(workspace.getByLabel("缩放比例")).toHaveValue("200");
  await workspace
    .getByRole("complementary")
    .getByRole("button", { name: "添加评论", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "保存评论", exact: true })
    .click();
  await expect.poll(() => app.feedback().comments.length).toBe(1);
  expect(app.feedback().comments[0]?.point?.x).toBeCloseTo(0.5, 2);
  expect(app.feedback().comments[0]?.point?.y).toBeCloseTo(0.5, 2);
  await workspace.getByLabel("图片评论").fill("暂存的修改意见");
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await expect(workspace).toBeHidden();
  await page.getByRole("button", { name: "打开方案 设计 draft", exact: true }).click();
  await expect(workspace.getByLabel("图片评论")).toHaveValue("暂存的修改意见");
  await workspace
    .getByRole("complementary")
    .getByRole("button", { name: "添加评论", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "保存评论", exact: true })
    .click();
  await expect.poll(() => app.feedback().comments.length).toBe(2);
  await workspace.getByRole("button", { name: "关闭图片工作区" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "打开方案 设计 draft", exact: true })).toBeVisible();
  await expect(workspace).toBeHidden();
  // Refreshed history is a baseline; only a new execution may open automatically.
  app.append("fresh-after-reload", "fresh-batch");
  await expect(
    workspace.getByAltText("设计 fresh-after-reload", { exact: true }),
  ).toBeVisible();
});
