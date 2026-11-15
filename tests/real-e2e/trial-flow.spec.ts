import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chooseValue, valueControl } from "../e2e/choice-control";
import { seedReturningFeatureGuideUser } from "../e2e/feature-guide-fixture";
import { canvasAction } from "../e2e/canvas-workspace-controls";
import { openCanvasFunction } from "../e2e/canvas-function-navigation";

type Node = { id: string; kind: string; type: string; title: string; status: string; payload: Record<string, unknown>; x: number; y: number };
type Graph = { revision: number; layoutRevision: number; nodes: Node[]; edges: { sourceNodeId: string; targetNodeId: string }[] };

test("真实登录、上传、执行、刷新、副本继续设计、系列扩展和后台导出", async ({ page }, testInfo) => {
  test.skip(process.env.TRIAL_E2E !== "1", "只能通过隔离验收启动器运行");
  // Exercise the new canvas against real auth, DB, queue and private storage.
  const email = `trial-${randomUUID()}@example.com`;
  await page.goto("/login");
  await page.getByLabel("邮箱地址").fill(email);
  await page.getByRole("button", { name: "发送登录链接" }).click();
  const mailOrigin = process.env.TRIAL_MAIL_URL;
  if (!mailOrigin) throw new Error("缺少隔离邮件服务地址");
  let messageId = "";
  await expect.poll(async () => {
    const response = await page.request.get(`${mailOrigin}/api/v1/messages`);
    const data = await response.json() as { messages: { ID: string; To: { Address: string }[] }[] };
    messageId = data.messages.find((message) => message.To.some((to) => to.Address === email))?.ID ?? "";
    return messageId;
  }).not.toBe("");
  const message = await (await page.request.get(`${mailOrigin}/api/v1/message/${messageId}`)).json() as { HTML: string; Text: string };
  const link = (message.HTML + message.Text).match(/http:\/\/localhost:4300\/auth\/confirm\?[^\s"<>]+/u)?.[0]?.replaceAll("&amp;", "&");
  expect(link).toBeTruthy();
  if (!link) throw new Error("登录邮件缺少确认链接");
  await page.goto(link);
  await expect(page).not.toHaveURL(/\/auth\/confirm/u);
  const sessionResponse = await page.request.get("/api/me");
  expect(sessionResponse.ok()).toBe(true);
  const session = await sessionResponse.json() as { user: { id: string } };
  await seedReturningFeatureGuideUser(page, [session.user.id]);
  await page.goto("/");
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.request().method() === "POST"),
    page.getByRole("button", { name: /^新建项目创作/u }).click(),
  ]);
  const project = await created.json() as { id: string };
  await page.goto(`/${project.id}`);
  await expect(page.getByRole("complementary", { name: "工具条", exact: true })).toBeVisible();
  const origin = "http://localhost:4300";
  const json = async (path: string, data?: unknown, method = "POST") => {
    const response = await page.request.fetch(`/api${path}`, { method, ...(data ? { data } : {}), headers: { Origin: origin, "Idempotency-Key": randomUUID() } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const graph = async (id: string): Promise<Graph> => json(`/projects/${id}/workflow/sync`, undefined, "GET") as Promise<Graph>;
  const command = async (id: string, data: unknown) => json(`/projects/${id}/canvas/commands`, data) as Promise<{ nodeId: string; graph: Graph }>;
  // Real signed upload from the browser; no platform route interception.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("group", { name: "添加节点选项", exact: true }).getByRole("button", { name: "上传", exact: true }).click();
  await page.getByLabel("选择上传资源", { exact: true }).setInputFiles({ name: "trial-reference.png", mimeType: "image/png", buffer: png });
  await expect.poll(async () => (await graph(project.id)).nodes.filter((node) => node.type === "reference_image").length).toBe(1);
  const reference = (await graph(project.id)).nodes.find((node) => node.type === "reference_image");
  if (!reference) throw new Error("上传未创建参考图片节点");
  await expect(page.getByRole("dialog", { name: "添加资源", exact: true })).toHaveCount(0);
  const beforeLayout = await graph(project.id);
  const material = page.locator(`[data-canvas-node-id="${reference.id}"]`);
  await expect(material).toBeVisible();
  const bounds = await material.boundingBox();
  if (!bounds) throw new Error("上传素材尚未投影到白板");
  const layoutSaved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${project.id}/canvas` && response.request().method() === "PATCH" && response.ok());
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  await layoutSaved;
  // Stop the live autosave writer before testing an explicit saved-revision replay.
  await page.goto("/");
  type Canvas = { revision: number; snapshot: { document?: { store: Record<string, { typeName: string; x?: number; y?: number }> } }; bindings: { shapeId: string; nodeId: string; removed: boolean }[] };
  const canvas = async (): Promise<Canvas> => json(`/projects/${project.id}/canvas`, undefined, "GET");
  await expect.poll(async () => Boolean((await canvas()).snapshot.document)).toBe(true);
  const saved = await canvas();
  const layoutRequest = { baseRevision: saved.revision, mutationId: randomUUID(), snapshot: saved.snapshot, bindings: saved.bindings.filter(binding => !binding.removed).map(({ shapeId, nodeId }) => ({ shapeId, nodeId })) };
  await json(`/projects/${project.id}/canvas`, layoutRequest, "PATCH");
  await json(`/projects/${project.id}/canvas`, layoutRequest, "PATCH");
  expect((await canvas()).revision).toBe(saved.revision + 1);
  expect((await graph(project.id)).revision).toBe(beforeLayout.revision);
  const forbidden = await page.request.patch(`/api/projects/${project.id}/workflow`, { data: { mode: "layout", baseLayoutRevision: 0, mutationId: randomUUID(), positions: [{ nodeId: reference.id, x: 160, y: 220 }] }, headers: { Origin: origin } });
  expect(forbidden.status()).toBe(403);
  const goal = await command(project.id, { type: "create_material", mutationId: randomUUID(), materialType: "brief", title: "设计目标", payload: { text: "藏蓝通勤外套" } });
  const generation = { type: "run_tool", mutationId: randomUUID(), toolKey: "generate_design", title: "试用生成", parameters: { prompt: "藏蓝通勤外套", count: 1 }, inputs: [{ nodeId: goal.nodeId, port: "goal" }, { nodeId: reference.id, port: "reference" }] };
  const first = await command(project.id, generation);
  expect((await command(project.id, generation)).nodeId).toBe(first.nodeId);
  await expect.poll(async () => (await graph(project.id)).nodes.filter((item) => item.type === "candidate").length, { timeout: 90000 }).toBe(1);
  await page.goto(`/${project.id}`);
  await page.reload();
  const firstCandidate = (await graph(project.id)).nodes.find(node => node.type === "candidate");
  if (!firstCandidate) throw new Error("首次生成缺少图片结果");
  await expect(page.locator(`[data-canvas-node-id="${firstCandidate.id}"]`)).toBeVisible();
  const before = await graph(project.id);
  const copy = await json(`/projects/${project.id}/duplicate`, {}) as { id: string };
  const copied = await graph(copy.id);
  expect(copied.nodes).toHaveLength(before.nodes.length);
  expect(copied.edges).toHaveLength(before.edges.length);
  expect(copied.nodes.every((item) => !before.nodes.some((old) => old.id === item.id))).toBe(true);
  const copiedGoal = copied.nodes.find((item) => item.type === "brief" && item.title === "设计目标");
  if (!copiedGoal) throw new Error("副本缺少原始设计目标");
  const { nodeId: next } = await command(copy.id, { type: "run_tool", mutationId: randomUUID(), toolKey: "generate_design", title: "副本继续生成", parameters: { prompt: "藏蓝通勤外套新分支", count: 1 }, inputs: [{ nodeId: copiedGoal.id, port: "goal" }] });
  await expect.poll(async () => (await graph(copy.id)).nodes.filter((item) => item.type === "candidate").length, { timeout: 90000 }).toBe(2);
  const finished = await graph(copy.id);
  const recoveryOutput = finished.edges.find((item) => item.sourceNodeId === next)?.targetNodeId;
  const recoveryAsset = finished.nodes.find((item) => item.id === recoveryOutput)?.payload.assetId;
  const exportBody = { sourceType: "asset", assetId: recoveryAsset, format: "png", quality: "standard" };
  const recoveryKey = randomUUID();
  const recoveryHeaders = { Origin: origin, "Idempotency-Key": recoveryKey };
  let pendingExport;
  // Pause only the explicitly named isolated Redis container. No shared queue is flushed.
  execFileSync("docker", ["pause", "fashion-trial-redis-1"]);
  try {
    pendingExport = page.request.post("/api/exports", { data: exportBody, headers: recoveryHeaders });
    await expect.poll(async () => {
      const query = new URLSearchParams({ projectId: copy.id, sourceType: "asset", sourceId: String(recoveryAsset) });
      const response = await page.request.get(`/api/exports?${query}`);
      return (await response.json() as { total: number }).total;
    }).toBe(1);
  } finally { execFileSync("docker", ["unpause", "fashion-trial-redis-1"]); }
  const admitted = await pendingExport;
  expect(admitted?.ok()).toBe(true);
  const queuedExport = await admitted?.json() as { id: string };
  const replay = await page.request.post("/api/exports", { data: exportBody, headers: recoveryHeaders });
  expect((await replay.json() as { id: string }).id).toBe(queuedExport.id);
  await expect.poll(async () => (await json(`/exports/${queuedExport.id}`, undefined, "GET") as { status: string }).status).toBe("succeeded");
  await page.goto(`/${copy.id}`);
  await canvasAction(page, "查看全图");
  const primaryCandidate = copied.nodes.find((item) => item.type === "candidate");
  if (!primaryCandidate) throw new Error("副本缺少原候选");
  const primaryCard = page.locator(`[data-canvas-node-id="${primaryCandidate.id}"]`);
  const openCandidate = async () => {
    await expect(primaryCard).toBeVisible();
    const shapeId = await primaryCard.evaluate(element => element.closest(".tl-shape")?.getAttribute("data-shape-id"));
    if (!shapeId) throw new Error("副本图片缺少摆放实例");
    await openCanvasFunction(page, "画布对象");
    const objects = page.getByRole("region", { name: "画布对象", exact: true });
    await objects.locator(`[data-canvas-object-id="${shapeId}"]`).getByRole("button", { name: /^选择 /u }).click();
    await objects.getByRole("button", { name: "关闭画布对象", exact: true }).click();
    await page.getByRole("toolbar", { name: "常用图片工具", exact: true }).getByRole("button", { name: "移除背景", exact: true }).click();
  };
  await openCandidate();
  const workspace = page.getByRole("dialog", { name: "图片工作区", exact: true }).filter({ visible: true });
  await expect(workspace).toBeVisible();
  await page.getByRole("button", { name: "关闭图片工作区", exact: true }).click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await expect(page.getByRole("group", { name: "添加节点选项", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await openCandidate();
  await workspace.getByRole("button", { name: "导出", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await workspace.getByRole("button", { name: "下载图片", exact: true }).click();
  const download = await downloadEvent;
  const path = testInfo.outputPath("look.png");
  await download.saveAs(path);
  expect((await readFile(path)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  await testInfo.attach("export", { path, contentType: "image/png" });
  await workspace.getByRole("button", { name: "关闭图片工作区", exact: true }).click();
  // Create through the real domain API; the retired image metadata menu is no longer an entry.
  const collection = await json("/collections", { heroAssetId: primaryCandidate.payload.assetId }) as { id: string; name: string };
  await page.goto(`/${copy.id}?collectionId=${collection.id}`);
  const series = page.getByRole("dialog", { name: "系列工作台", exact: true });
  await expect(series).toBeVisible();
  await chooseValue(valueControl(series, "服装类型"), "jacket");
  await series.getByLabel("廓形关键词，以逗号或换行分隔").fill("宽松直线廓形");
  await series.getByLabel("面料关键词，以逗号或换行分隔").fill("哑光棉布");
  await series.getByLabel("情绪关键词，以逗号或换行分隔").fill("克制通勤");
  await expect(series.getByRole("status").filter({ hasText: /^已保存$/ })).toBeVisible();
  const looksTab = series.getByRole("tab", { name: "系列扩展", exact: true });
  await looksTab.click();
  await expect(series.getByText("还没有扩展款", { exact: true })).toBeVisible();
  await chooseValue(valueControl(series, "服装类型"), "dress");
  await series.getByRole("button", { name: "生成", exact: true }).click();
  // A running Look continues when the designer edits another series panel.
  await series.getByRole("tab", { name: "设计方向", exact: true }).click();
  await looksTab.click();
  await expect(series.getByRole("img", { name: "连衣裙", exact: true })).toBeVisible({ timeout: 90_000 });
  await series.getByRole("button", { name: "导出 PDF", exact: true }).click();
  await page.getByRole("button", { name: "开始导出", exact: true }).click();
  const pdfLink = page.getByRole("link", { name: "下载 PDF", exact: true });
  await expect(pdfLink).toBeVisible();
  const pdfDownload = page.waitForEvent("download");
  await pdfLink.click();
  const pdfPath = testInfo.outputPath("collection-lookbook.pdf");
  await (await pdfDownload).saveAs(pdfPath);
  const pdfBytes = await readFile(pdfPath);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  // PDFKit emits plain page dictionaries. This is a format-specific smoke check;
  // the saved sample is also extracted and rendered during delivery review.
  expect([...pdfBytes.toString("latin1").matchAll(/\/Type\s+\/Page\b/gu)]).toHaveLength(2);
  const savedSeries = await json(`/collections/${collection.id}`, undefined, "GET") as { name: string; dna: { silhouettes: string[] } };
  expect(savedSeries.name).toBe(collection.name);
  expect(savedSeries.dna.silhouettes).toEqual(["宽松直线廓形"]);
  await testInfo.attach("series-pdf", { path: pdfPath, contentType: "application/pdf" });
  await page.screenshot({ path: testInfo.outputPath("completed.png") });
});
