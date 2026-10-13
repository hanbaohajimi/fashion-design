import { expect, test, type Page } from "@playwright/test";
import type {
  AgentDesignIntelligence,
  AgentDomainActionView,
  AgentPlanStepSpec,
  AgentRunView,
} from "@fashion/shared";

const PROJECT_ID = "e2e-agent-workspace";
const NOW = "2026-08-05T06:00:00.000Z";

test.setTimeout(60_000);

test("设计工作流逐节点执行、选择第二个结果并在刷新后恢复", async ({ page }) => {
  const conversationId = "conversation-workflow";
  const recentConversation = conversation(
    "conversation-recent",
    "近期设计讨论",
  );
  const workflowConversation = conversation(conversationId, "风衣设计");
  await mockWorkspace(page, {
    conversations: [recentConversation, workflowConversation],
    messages: new Map([
      [conversationId, []],
      [recentConversation.id, []],
    ]),
    onCreateConversation: () =>
      conversation("conversation-new", "新的设计对话"),
    onSend: async () => {
      throw new Error("工作流不应调用聊天生成");
    },
  });
  let plan: AgentRunView | null = null;
  let executeCount = 0;
  let reviewedAssetId = "";
  let savedPrompt = "";
  await page.route(
    `**/api/projects/${PROJECT_ID}/agent-conversations*`,
    (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      return route.fulfill({
        json: plan
          ? {
              items: cursor ? [workflowConversation] : [recentConversation],
              nextCursor: cursor ? null : "older-page",
            }
          : {
              items: [recentConversation, workflowConversation],
              nextCursor: null,
            },
      });
    },
  );
  const imageUrl =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const candidates = [1, 2].map((index) => ({
    assetId: `workflow-asset-${index}`,
    url: `${imageUrl}#${index}`,
    thumbnailUrl: null,
    width: 768,
    height: 1024,
  }));
  await page.route(
    `**/api/agent-conversations/${conversationId}/plans`,
    (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: { items: plan ? [plan] : [] } });
      }
      const body = route.request().postDataJSON() as { content: string };
      plan = {
        id: "workflow-a",
        projectId: PROJECT_ID,
        conversationId,
        intent: body.content,
        status: "ready",
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
        error: null,
        steps: [
          {
            id: "workflow-step-1",
            ordinal: 0,
            key: "silhouette",
            tool: "generate_design",
            title: "建立通勤风衣廓形",
            instruction: "先确认宽松比例与腰线",
            prompt: "loose trench coat",
            negativePrompt: "logos",
            sourceAssetId: null,
            sourceStepKey: null,
            status: "pending",
            generationTaskId: null,
            selectedAssetId: null,
            candidates: [],
            error: null,
          },
          {
            id: "workflow-step-2",
            ordinal: 1,
            key: "fabric",
            tool: "edit_design",
            title: "细化面料表现",
            instruction: "基于选定廓形调整织物质感",
            prompt: "woven texture",
            negativePrompt: "logos",
            sourceAssetId: null,
            sourceStepKey: "silhouette",
            status: "pending",
            generationTaskId: null,
            selectedAssetId: null,
            candidates: [],
            error: null,
          },
        ],
      };
      return route.fulfill({ json: plan, status: 201 });
    },
  );
  await page.route("**/api/agent-runs/workflow-a/**", (route) => {
    if (!plan) return route.fulfill({ status: 404 });
    const endpoint = new URL(route.request().url()).pathname.split("/").at(-1);
    const body = route.request().postDataJSON() as {
      revision: number;
      prompt?: string;
      negativePrompt?: string;
      assetId?: string;
      reason?: string;
      steps?: AgentPlanStepSpec[];
    };
    expect(body.revision).toBe(plan.revision);
    if (endpoint === "plan" && body.steps) {
      const original = plan.steps;
      plan = {
        ...plan,
        revision: plan.revision + 1,
        steps: body.steps.map((spec, ordinal) => ({
          ...(original.find((step) => step.key === spec.key) ?? {
            id: `node-${spec.key}`,
            status: "pending" as const,
            generationTaskId: null,
            selectedAssetId: null,
            candidates: [],
            error: null,
          }),
          ...spec,
          ordinal,
        })),
      };
    } else if (route.request().method() === "PATCH") {
      savedPrompt = body.prompt ?? "";
      plan = {
        ...plan,
        revision: plan.revision + 1,
        steps: plan.steps.map((step) =>
          step.id === endpoint
            ? {
                ...step,
                prompt: savedPrompt,
                negativePrompt: body.negativePrompt ?? "",
              }
            : step,
        ),
      };
    } else if (endpoint === "execute") {
      executeCount += 1;
      const next = plan.steps.find((step) => step.status === "pending");
      const currentCandidates = candidates.map((candidate, index) => ({
        ...candidate,
        assetId: `workflow-asset-${executeCount}-${index + 1}`,
      }));
      plan = {
        ...plan,
        status: "waiting_review",
        revision: plan.revision + 1,
        steps: plan.steps.map((step) =>
          step.id === next?.id
            ? {
                ...step,
                status: "waiting_review",
                generationTaskId: `workflow-task-${executeCount}`,
                candidates: currentCandidates,
                canEditInputs: false,
                attempts: [
                  ...(step.attempts ?? []),
                  {
                    id: `attempt-${executeCount}`,
                    ordinal: executeCount,
                    status: "waiting_review",
                    generationTaskId: `workflow-task-${executeCount}`,
                    prompt: step.prompt,
                    negativePrompt: step.negativePrompt,
                    parentAssetId: null,
                    candidates: currentCandidates,
                    error: null,
                    createdAt: NOW,
                  },
                ],
              }
            : step,
        ),
      };
    } else if (endpoint === "reject") {
      plan = {
        ...plan,
        status: "ready",
        revision: plan.revision + 1,
        steps: plan.steps.map((step) =>
          step.status === "waiting_review"
            ? {
                ...step,
                status: "pending",
                canEditInputs: true,
                generationTaskId: null,
                candidates: [],
                attempts: step.attempts?.map((attempt) =>
                  attempt.status === "waiting_review"
                    ? {
                        ...attempt,
                        status: "rejected",
                        error: body.reason ?? "",
                      }
                    : attempt,
                ),
              }
            : step,
        ),
      };
    } else if (endpoint === "review") {
      reviewedAssetId = body.assetId ?? "";
      plan = {
        ...plan,
        status: "ready",
        revision: plan.revision + 1,
        steps: plan.steps.map((step) =>
          step.status === "waiting_review"
            ? { ...step, status: "succeeded", selectedAssetId: reviewedAssetId }
            : step,
        ),
      };
    } else if (endpoint === "pause") {
      plan = { ...plan, status: "paused", revision: plan.revision + 1 };
    } else if (endpoint === "cancel") {
      plan = { ...plan, status: "canceled", revision: plan.revision + 1 };
    }
    return route.fulfill({ json: plan });
  });
  await page.route("**/api/agent-runs/workflow-a", (route) =>
    route.fulfill({ json: plan }),
  );
  await page.route("**/api/generations/workflow-task-*", (route) =>
    route.fulfill({
      json: {
        ...generationTask(
          new URL(route.request().url()).pathname.split("/").at(-1) ??
            "workflow-task",
        ),
        output: {
          images: candidates.map((candidate, index) => ({
            ...candidate,
            assetId: `workflow-asset-${executeCount}-${index + 1}`,
            width: 3,
            height: 4,
          })),
        },
      },
    }),
  );

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/${PROJECT_ID}`);
  const agent = page.getByRole("complementary", { name: "设计助手" });
  await agent.getByRole("button", { name: "打开历史" }).click();
  await agent.getByRole("button", { name: "风衣设计" }).click();
  await agent.getByRole("tab", { name: "设计工作流" }).click();
  await agent
    .getByRole("textbox", { name: "设计目标" })
    .fill("设计宽松通勤风衣，确认廓形后细化面料");
  await agent.getByRole("button", { name: "规划设计步骤" }).click();
  await expect(
    agent.getByRole("heading", { name: "建立通勤风衣廓形" }),
  ).toBeVisible();
  expect(executeCount).toBe(0);
  await agent.getByText("查看或修改节点提示词").first().click();
  await agent
    .getByRole("textbox", { name: "节点提示词" })
    .first()
    .fill("loose trench coat with structured waist");
  await expect(
    agent.getByRole("button", { name: "执行下一节点" }),
  ).toBeDisabled();
  await agent.getByRole("button", { name: "保存节点提示词" }).first().click();
  await expect(
    agent.getByRole("button", { name: "执行下一节点" }),
  ).toBeEnabled();
  expect(savedPrompt).toContain("structured waist");
  await agent.getByRole("button", { name: "打开节点图工作区" }).click();
  const graph = page.getByRole("dialog", { name: "编辑设计节点图" });
  await graph.getByRole("button", { name: "添加节点" }).click();
  await graph.getByRole("textbox", { name: "节点标题" }).fill("细节探索");
  await graph
    .getByRole("textbox", { name: "节点提示词" })
    .fill("coat pocket details");
  await graph
    .getByRole("button", { name: "连接「建立通勤风衣廓形」的输出" })
    .click();
  await graph.getByRole("button", { name: "连接「细节探索」的输入" }).click();
  await expect(graph.getByRole("combobox", { name: "输入来源" })).toHaveValue(
    "step:silhouette",
  );
  await graph.getByRole("button", { name: "上移节点" }).click();
  await graph.getByRole("button", { name: "下移节点" }).click();
  await graph
    .locator('[class*="nodeBody"]')
    .filter({ hasText: "建立通勤风衣廓形" })
    .click();
  await graph.getByRole("button", { name: "删除节点" }).click();
  await expect(graph.getByRole("alert")).toContainText("先重新连接");
  await graph
    .locator('[class*="nodeBody"]')
    .filter({ hasText: "细节探索" })
    .click();
  await graph.getByRole("button", { name: "保存节点图" }).click();
  await expect(
    graph.getByRole("button", { name: "保存节点图" }),
  ).toBeDisabled();
  await page.screenshot({ path: "output/playwright/agent-graph-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    graph.getByRole("navigation", { name: "移动端节点列表" }),
  ).toBeVisible();
  await graph
    .getByRole("navigation", { name: "移动端节点列表" })
    .getByRole("button", { name: /细节探索/ })
    .click();
  await expect(graph.getByRole("combobox", { name: "输入来源" })).toHaveValue(
    "step:silhouette",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "output/playwright/agent-graph-mobile.png" });
  await graph.getByRole("button", { name: "关闭节点编辑器" }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await agent.getByRole("button", { name: "执行下一节点" }).dblclick();
  await expect(
    agent.getByText("等待你选择结果", { exact: true }),
  ).toBeVisible();
  expect(executeCount).toBe(1);
  await agent.getByText("查看执行提示词").first().click();
  await agent
    .getByRole("textbox", { name: "选择或调整理由（否决时必填）" })
    .fill("面料反光过强，需要哑光表现");
  await agent.getByRole("button", { name: "结果不满意，重新调整" }).click();
  await expect(
    agent.getByRole("button", { name: "执行下一节点" }),
  ).toBeVisible();
  expect(executeCount).toBe(1);
  await agent.getByText("查看每次尝试与反馈").first().click();
  await expect(
    agent.getByText("调整原因：面料反光过强，需要哑光表现"),
  ).toBeVisible();
  await agent.getByText("查看或修改节点提示词").first().click();
  await agent
    .getByRole("textbox", { name: "节点提示词" })
    .first()
    .fill("loose trench coat with matte fabric");
  await agent.getByRole("button", { name: "保存节点提示词" }).first().click();
  await agent.getByRole("button", { name: "执行下一节点" }).click();
  await expect(
    agent.getByText("等待你选择结果", { exact: true }),
  ).toBeVisible();
  expect(executeCount).toBe(2);
  await agent.getByRole("radio", { name: "选择节点 1 的结果 2" }).check();
  await page.screenshot({
    path: "output/playwright/agent-workflow-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(agent).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "output/playwright/agent-workflow-mobile.png",
  });
  await agent.getByRole("button", { name: "采用结果并完成节点" }).click();
  await expect(
    agent.getByRole("button", { name: "执行下一节点" }),
  ).toBeVisible();
  expect(reviewedAssetId).toBe("workflow-asset-2-2");
  expect(executeCount).toBe(2);
  await page.reload();
  await expect(agent.locator("header strong").first()).toHaveText("风衣设计");
  await expect(agent.getByRole("tab", { name: "设计工作流" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    agent.getByText("已采用", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    agent.getByRole("button", { name: "执行下一节点" }),
  ).toBeVisible();
  expect(executeCount).toBe(2);
  await agent.getByRole("button", { name: "暂停计划" }).click();
  await expect(
    agent.getByRole("button", { name: "继续执行下一节点" }),
  ).toBeVisible();
  await agent.getByRole("button", { name: "取消计划" }).click();
  await expect(agent.getByText("已取消", { exact: true })).toBeVisible();
});

test("领域Agent按真实候选检查，反馈修订先预览后应用且不自动生成", async ({
  page,
}) => {
  const conversationId = "conversation-intelligence";
  await mockWorkspace(page, {
    conversations: [conversation(conversationId, "通勤风衣设计")],
    messages: new Map([[conversationId, []]]),
    onCreateConversation: () => conversation(conversationId, "通勤风衣设计"),
    onSend: async () => {
      throw new Error("领域工作流不应走聊天生成");
    },
  });
  const intelligence: AgentDesignIntelligence = {
    version: "fashion-agents/1",
    brief: {
      summary: "保留宽松通勤风衣的廓形，逐步确认面料与展示方式",
      garmentType: "风衣",
      constraints: [
        {
          id: "shape",
          dimension: "silhouette",
          requirement: "保持宽松廓形",
          mode: "preserve",
          priority: "must",
          origin: "explicit",
          verification: "visual",
          evidenceIds: ["intent"],
          sourceQuote: "保持宽松",
        },
        {
          id: "matte",
          dimension: "material",
          requirement: "面料呈现自然哑光质感",
          mode: "change",
          priority: "prefer",
          origin: "interpretation",
          verification: "visual",
          evidenceIds: ["intent"],
          sourceQuote: null,
        },
        {
          id: "water",
          dimension: "function",
          requirement: "确认面料防水性能",
          mode: "require",
          priority: "must",
          origin: "explicit",
          verification: "requires_measurement",
          evidenceIds: ["intent"],
          sourceQuote: "防水",
        },
      ],
      unknowns: ["尚未提供面料性能检测资料"],
    },
    evidence: [
      {
        id: "intent",
        kind: "intent",
        label: "设计师本次需求",
        text: "设计保持宽松的通勤风衣，并确认防水性能",
        assetId: null,
      },
    ],
    rationales: [
      {
        stepKey: "silhouette",
        goal: "先稳定宽松比例与通勤轮廓",
        constraintIds: ["shape", "matte"],
        acceptanceChecks: [
          "肩部和腰线保留宽松余量",
          "观察面料表面反光是否自然",
        ],
      },
    ],
    audit: {
      coverage: [
        { constraintId: "shape", stepKeys: ["silhouette"], status: "assigned" },
        { constraintId: "matte", stepKeys: ["silhouette"], status: "assigned" },
        { constraintId: "water", stepKeys: [], status: "unassigned" },
      ],
      warnings: ["防水性能需要实测，不能单凭生成图确认"],
    },
    actions: [],
  };
  let plan: AgentRunView = {
    id: "intelligence-run",
    projectId: PROJECT_ID,
    conversationId,
    intent: "设计宽松通勤风衣，修正面料过度反光",
    status: "ready",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    error: null,
    intelligence,
    steps: [
      {
        id: "intelligence-step",
        ordinal: 0,
        key: "silhouette",
        tool: "generate_design",
        title: "稳定通勤风衣廓形",
        instruction: "保留宽松比例，观察面料表现",
        prompt: "loose trench coat with natural woven fabric",
        negativePrompt: "logos",
        sourceAssetId: null,
        sourceStepKey: null,
        status: "pending",
        generationTaskId: null,
        selectedAssetId: null,
        candidates: [],
        error: null,
        canEditInputs: true,
      },
    ],
  };
  let executeCount = 0;
  let domainCount = 0;
  let appliedCount = 0;
  let pendingEvaluation: AgentDomainActionView | null = null;
  let pollCount = 0;
  const imageUrl =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const updateActions = (actions: readonly AgentDomainActionView[]) => {
    plan = { ...plan, intelligence: { ...intelligence, actions } };
  };
  await page.route(
    `**/api/agent-conversations/${conversationId}/plans`,
    (route) => route.fulfill({ json: { items: [plan] } }),
  );
  await page.route("**/api/agent-runs/intelligence-run", (route) => {
    if (pendingEvaluation && ++pollCount >= 2) {
      const completed = {
        ...pendingEvaluation,
        status: "completed" as const,
        completedAt: NOW,
        evaluation: {
          stepId: "intelligence-step",
          attemptId: "intelligence-attempt-1",
          assetId: pendingEvaluation.assetId!,
          summary: "廓形保持稳定，面料反光与防水性能需进一步确认",
          checks: [
            {
              constraintId: "shape",
              status: "met" as const,
              observation: "肩线与腰线保留明显宽松余量",
            },
            {
              constraintId: "matte",
              status: "concern" as const,
              observation: "衣身出现较强镜面反光，需要减弱",
            },
            {
              constraintId: "water",
              status: "unknown" as const,
              observation: "图像无法验证防水性能",
            },
          ],
          nextActions: ["调整面料表面表现，并查看实物检测资料"],
        },
      };
      plan = { ...plan, revision: plan.revision + 1 };
      updateActions(
        (plan.intelligence?.actions ?? []).map((action) =>
          action.id === completed.id ? completed : action,
        ),
      );
      pendingEvaluation = null;
    }
    return route.fulfill({ json: plan });
  });
  await page.route("**/api/agent-runs/intelligence-run/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as {
      revision: number;
      clientRequestId?: string;
      kind?: AgentDomainActionView["kind"];
      stepId?: string;
      assetId?: string;
      reason?: string;
    };
    expect(body.revision).toBe(plan.revision);
    const current = plan.steps[0];
    if (!current) throw new Error("缺少节点");
    if (path.endsWith("/agent-actions")) {
      domainCount += 1;
      expect(body.clientRequestId).toBeTruthy();
      expect(body.stepId).toBe(current.id);
      const action: AgentDomainActionView = {
        id: `domain-${domainCount}`,
        kind: body.kind!,
        stepId: current.id,
        assetId: body.assetId ?? null,
        status: body.kind === "evaluate_candidate" ? "running" : "completed",
        createdAt: new Date(Date.parse(NOW) + domainCount * 1000).toISOString(),
        completedAt: body.kind === "evaluate_candidate" ? null : NOW,
        error: null,
        evaluation: null,
        refinement:
          body.kind === "refine_step"
            ? {
                stepId: current.id,
                attemptId: current.attempts?.at(-1)?.id ?? "",
                originalPrompt: current.prompt,
                originalNegativePrompt: current.negativePrompt,
                prompt:
                  "loose trench coat with matte woven fabric and soft diffuse lighting",
                negativePrompt:
                  "logos, glossy coating, harsh specular reflection",
                summary: "针对反光反馈调整表面与光线，维持已确定的廓形",
                changes: ["面料改为哑光织物", "减弱强反光，使用柔和漫射光"],
                preserve: ["保留宽松通勤廓形", "保留原肩线与腰线比例"],
              }
            : null,
      };
      if (action.kind === "evaluate_candidate") {
        expect(
          current.candidates.some(
            (candidate) => candidate.assetId === body.assetId,
          ),
        ).toBe(true);
        pendingEvaluation = action;
        pollCount = 0;
      }
      plan = { ...plan, revision: plan.revision + 1 };
      updateActions([...(plan.intelligence?.actions ?? []), action]);
    } else if (path.endsWith("/apply")) {
      const actionId = path.split("/").at(-2);
      const action = plan.intelligence?.actions.find(
        (item) => item.id === actionId,
      );
      if (!action?.refinement) throw new Error("缺少修订建议");
      expect(current.prompt).toBe(action.refinement.originalPrompt);
      appliedCount += 1;
      plan = {
        ...plan,
        revision: plan.revision + 1,
        steps: [
          {
            ...current,
            prompt: action.refinement.prompt,
            negativePrompt: action.refinement.negativePrompt,
          },
        ],
      };
      updateActions(
        (plan.intelligence?.actions ?? []).map((item) =>
          item.id === action.id ? { ...item, status: "applied" } : item,
        ),
      );
    } else if (path.endsWith("/execute")) {
      executeCount += 1;
      const candidates = [1, 2].map((index) => ({
        assetId: `domain-asset-${executeCount}-${index}`,
        url: imageUrl,
        thumbnailUrl: null,
        width: 768,
        height: 1024,
      }));
      const taskId = `domain-task-${executeCount}`;
      plan = {
        ...plan,
        status: "waiting_review",
        revision: plan.revision + 1,
        steps: [
          {
            ...current,
            status: "waiting_review",
            generationTaskId: taskId,
            canEditInputs: false,
            candidates,
            attempts: [
              ...(current.attempts ?? []),
              {
                id: `intelligence-attempt-${executeCount}`,
                ordinal: executeCount,
                status: "waiting_review",
                generationTaskId: taskId,
                prompt: current.prompt,
                negativePrompt: current.negativePrompt,
                parentAssetId: null,
                candidates,
                error: null,
                createdAt: NOW,
              },
            ],
          },
        ],
      };
    } else if (path.endsWith("/reject")) {
      plan = {
        ...plan,
        status: "ready",
        revision: plan.revision + 1,
        steps: [
          {
            ...current,
            status: "pending",
            generationTaskId: null,
            candidates: [],
            canEditInputs: true,
            attempts: current.attempts?.map((attempt) =>
              attempt.id === current.attempts?.at(-1)?.id
                ? { ...attempt, status: "rejected", error: body.reason ?? "" }
                : attempt,
            ),
          },
        ],
      };
    } else if (path.endsWith("/review")) {
      plan = {
        ...plan,
        status: "completed",
        revision: plan.revision + 1,
        steps: [
          {
            ...current,
            status: "succeeded",
            selectedAssetId: body.assetId ?? null,
          },
        ],
      };
    }
    return route.fulfill({ json: plan });
  });
  await page.route("**/api/generations/domain-task-*", (route) =>
    route.fulfill({
      json: {
        ...generationTask(
          new URL(route.request().url()).pathname.split("/").at(-1) ??
            "domain-task",
        ),
        output: {
          images:
            plan.steps[0]?.candidates.map((candidate) => ({
              ...candidate,
              width: 3,
              height: 4,
            })) ?? [],
        },
      },
    }),
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/${PROJECT_ID}`);
  const agent = page.getByRole("complementary", { name: "设计助手" });
  await agent.getByRole("tab", { name: "设计工作流" }).click();
  await agent.getByText("设计简报 · 3 项条件").click();
  await expect(agent.getByText("你明确提出的要求")).toBeVisible();
  await expect(agent.getByText("Agent 对需求的解释")).toBeVisible();
  await expect(agent.getByText("计划尚未绑定的要求")).toBeVisible();
  await expect(agent.getByText("尚未提供面料性能检测资料")).toBeVisible();
  await agent.getByText("设计简报 · 3 项条件").click();
  await agent.getByText("本节点的设计依据").click();
  await expect(agent.getByText("先稳定宽松比例与通勤轮廓")).toBeVisible();
  await agent.getByText("本节点的设计依据").click();
  await agent.getByRole("button", { name: "执行下一节点" }).click();
  const secondCheck = agent.getByRole("region", { name: "结果 2 的领域检查" });
  await secondCheck.getByRole("button", { name: "领域 Agent 检查" }).dblclick();
  await expect(secondCheck.getByText("领域 Agent 分析中")).toBeVisible();
  expect(domainCount).toBe(1);
  await agent.getByRole("radio", { name: "选择节点 1 的结果 2" }).check();
  await expect(
    agent.getByRole("button", { name: "采用结果并完成节点" }),
  ).toBeEnabled();
  await expect(secondCheck.getByText("发现偏离")).toBeVisible();
  await expect(secondCheck.getByText("图像观察符合")).toBeVisible();
  await expect(secondCheck.getByText("待确认")).toBeVisible();
  expect(plan.steps[0]?.selectedAssetId).toBeNull();
  await agent
    .getByRole("textbox", { name: "选择或调整理由（否决时必填）" })
    .fill("面料反光过强，请保持宽松比例，减弱亮面涂层");
  await agent.getByRole("button", { name: "结果不满意，重新调整" }).click();
  expect(executeCount).toBe(1);
  await agent.getByRole("button", { name: "根据反馈提出修订" }).dblclick();
  const refinement = agent.getByRole("region", { name: "针对反馈的节点修订" });
  await expect(refinement.getByText("建议提示词")).toBeVisible();
  await expect(refinement.getByText("保留宽松通勤廓形")).toBeVisible();
  expect(domainCount).toBe(2);
  expect(appliedCount).toBe(0);
  expect(executeCount).toBe(1);
  await refinement.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/agent-intelligence-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await refinement.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "output/playwright/agent-intelligence-mobile.png",
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await refinement.getByRole("button", { name: "应用修订建议" }).dblclick();
  await expect(refinement.getByText("建议已应用")).toBeVisible();
  expect(appliedCount).toBe(1);
  expect(executeCount).toBe(1);
  expect(plan.steps[0]?.prompt).toContain("matte woven fabric");
  await page.reload();
  await expect(agent.getByText("建议已应用")).toBeVisible();
  await agent.getByRole("button", { name: "执行下一节点" }).click();
  expect(executeCount).toBe(2);
  await expect(
    agent.getByRole("button", { name: "采用结果并完成节点" }),
  ).toBeDisabled();
  await agent.getByRole("radio", { name: "选择节点 1 的结果 2" }).check();
  await agent.getByRole("button", { name: "采用结果并完成节点" }).click();
  await expect(
    agent.getByRole("status").filter({ hasText: "设计计划已完成" }),
  ).toBeVisible();
  expect(plan.steps[0]?.selectedAssetId).toBe("domain-asset-2-2");
});

test("pending 助手消息会自动同步为终态", async ({ page }) => {
  const conversationId = "conversation-pending";
  const conversations = [conversation(conversationId, "自动同步测试")];
  const userMessage = message({
    clientRequestId: "request-pending",
    content: "请生成",
    id: "user-pending",
    role: "user",
  });
  const pendingMessage = message({
    content: "正在理解你的设计需求…",
    id: "assistant-pending",
    replyToId: userMessage.id,
    role: "assistant",
    status: "pending",
  });
  const messages = new Map<string, unknown[]>([
    [conversationId, [userMessage, pendingMessage]],
  ]);
  await mockWorkspace(page, {
    conversations,
    messages,
    onCreateConversation: () =>
      conversation("conversation-new", "新的设计对话"),
    onSend: async () => {
      throw new Error("本用例不应发送 Agent 消息");
    },
  });

  await page.setViewportSize({ height: 1080, width: 1920 });
  await page.goto(`/${PROJECT_ID}`);
  const agent = page.getByRole("complementary", { name: "设计助手" });
  await expect(agent.getByText("理解需求", { exact: true })).toBeVisible();

  messages.set(conversationId, [
    userMessage,
    message({
      content: "已创建生成任务。",
      generationTaskId: "task-pending",
      id: "assistant-pending",
      replyToId: userMessage.id,
      role: "assistant",
    }),
  ]);

  await expect(agent.getByText("已创建生成任务。")).toBeVisible({
    timeout: 10_000,
  });
  await expect(agent.getByText("理解需求", { exact: true })).toHaveCount(0);
});

test("长备注自动扩展便签且不出现内部滚动", async ({ page }) => {
  const conversations = [conversation("conversation-note", "便签测试")];
  await mockWorkspace(page, {
    conversations,
    messages: new Map([["conversation-note", []]]),
    onCreateConversation: () =>
      conversation("conversation-new", "新的设计对话"),
    onSend: async () => {
      throw new Error("本用例不应发送 Agent 消息");
    },
  });

  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto(`/${PROJECT_ID}`);

  const toolDock = page.getByRole("complementary", { name: "工具条" });
  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();

  const noteEditor = page.getByRole("textbox", { name: "备注内容" });
  const initialHeight = (await noteEditor.boundingBox())?.height ?? 0;
  await noteEditor.fill(
    "全身正面平视视角，一位身材纤细、气场干练的短发亚裔女模特，身穿短款雕塑感通勤夹克。" +
      "模特双臂自然下垂，双手轻插裤袋，以凸显短款利落的腰线和衣身的立体建筑感折痕。" +
      "纯白无影棚拍摄，柔光箱均匀布光，高清晰度，商业服装摄影，超写实。",
  );

  await expect
    .poll(async () => (await noteEditor.boundingBox())?.height ?? 0)
    .toBeGreaterThan(initialHeight);
  await expect
    .poll(async () =>
      noteEditor.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1,
      ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      noteEditor.evaluate((element) => getComputedStyle(element).overflowY),
    )
    .toBe("hidden");
});

test("白板悬浮工作区与 Chat Agent 在桌面和窄屏保持完整交互", async ({
  page,
}) => {
  const conversations = [conversation("conversation-1", "新的设计对话")];
  const initialUserMessage = message({
    clientRequestId: "request-existing",
    content: "生成一组强调面料垂坠感的风衣方案",
    id: "user-existing",
    role: "user",
  });
  const initialAssistantMessage = message({
    content: "已完成本轮风衣候选，请直接在这里筛选方案。",
    generationTaskId: "task-existing",
    id: "assistant-existing",
    replyToId: initialUserMessage.id,
    role: "assistant",
  });
  const messages = new Map<string, unknown[]>([
    ["conversation-1", [initialUserMessage, initialAssistantMessage]],
  ]);
  let conversationSequence = 1;
  let sendCount = 0;
  let sentShapeIds: readonly string[] = [];

  await mockWorkspace(page, {
    conversations,
    generationTasks: [generationTask("task-existing")],
    messages,
    onCreateConversation: () => {
      conversationSequence += 1;
      const created = conversation(
        `conversation-${conversationSequence}`,
        "新的设计对话",
      );
      conversations.unshift(created);
      messages.set(created.id, []);
      return created;
    },
    onSend: async (conversationId, body) => {
      sendCount += 1;
      sentShapeIds = body.shapeIds;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const userMessage = message({
        clientRequestId: body.clientRequestId,
        content: body.content,
        context: { fileAssetIds: [], shapeIds: body.shapeIds },
        id: `user-${sendCount}`,
        role: "user",
      });
      const assistantMessage = message({
        content: "已整理为三个可执行的廓形与面料方向。",
        id: `assistant-${sendCount}`,
        replyToId: userMessage.id,
        role: "assistant",
      });
      messages.set(conversationId, [userMessage, assistantMessage]);
      conversations[0] = {
        ...conversations[0],
        messageCount: 2,
        title: body.content.slice(0, 24),
        updatedAt: NOW,
      };
      return { assistantMessage, taskId: null, userMessage };
    },
  });

  await page.setViewportSize({ height: 1080, width: 1920 });
  await page.goto(`/${PROJECT_ID}`);

  const agent = page.getByRole("complementary", { name: "设计助手" });
  const toolDock = page.getByRole("complementary", { name: "工具条" });
  await expect(agent).toBeVisible();
  await expect(toolDock).toBeVisible();
  await expect(page.getByText("AGENT 工作区验收项目")).toBeVisible();
  await expect(page.locator(".tlui-main-toolbar")).toHaveCount(0);
  await expect(page.locator('[class*="generationBar"]')).toHaveCount(0);
  const toolOrder = await toolDock
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  const swatchToolIndex = toolOrder.indexOf("添加色卡");
  expect(toolOrder[swatchToolIndex]).toBe("添加色卡");
  expect(["红色图钉固定工具", "固定素材", "请先选择素材"]).toContain(
    toolOrder[swatchToolIndex + 1],
  );

  const linkedReply = agent.locator("article").filter({
    hasText: "已完成本轮风衣候选，请直接在这里筛选方案。",
  });
  await expect(
    linkedReply.getByRole("region", { name: "本轮生成候选" }),
  ).toHaveCount(0);
  await expect(linkedReply).toContainText("成图已放到画布");
  await expect(linkedReply.getByRole("img", { name: "候选设计" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "打开历史" }).click();
  const generationHistory = page.getByRole("region", { name: "历史记录" });
  await expect(generationHistory).toBeVisible();
  await page.getByRole("tab", { name: "生成" }).click();
  const historyCandidates = generationHistory.getByRole("region", {
    name: "生成候选",
  });
  await expect(
    historyCandidates.getByRole("img", { name: "候选设计" }),
  ).toHaveCount(3);
  await expect(
    historyCandidates.getByRole("button", { name: "采纳" }),
  ).toHaveCount(0);
  await historyCandidates
    .getByRole("button", { name: "更多候选操作" })
    .first()
    .click();
  await historyCandidates.getByRole("button", { name: "丢弃" }).first().click();
  await expect(
    historyCandidates.getByRole("img", { name: "候选设计" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "返回对话" }).click();

  const desktopAgentBox = await agent.boundingBox();
  const desktopDockBox = await toolDock.boundingBox();
  expect(desktopAgentBox?.width).toBeGreaterThanOrEqual(395);
  expect(desktopAgentBox?.x).toBeGreaterThan(1500);
  expect(desktopDockBox?.y).toBeGreaterThan(970);

  await page.getByRole("button", { name: "AGENT 工作区验收项目" }).click();
  const projectNavigation = page.getByRole("navigation", { name: "项目导航" });
  await expect(
    projectNavigation.getByRole("link", { name: "返回项目库" }),
  ).toBeVisible();
  await expect(projectNavigation).not.toContainText("画布元素");

  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();
  const context = page.getByLabel("已附加内容");
  await expect(context).toContainText("灵感");
  await expect(context.locator("img")).toHaveCount(0);
  const attachmentChip = context.getByRole("button", {
    name: "灵感，设计备注",
  });
  expect(
    await context.evaluate((element) => getComputedStyle(element).flexWrap),
  ).toBe("wrap");
  const contextBox = await context.boundingBox();
  const inputBox = await page
    .getByRole("textbox", { name: "编辑描述" })
    .boundingBox();
  expect(inputBox?.height).toBeGreaterThanOrEqual(44);
  expect(inputBox?.y).toBeGreaterThanOrEqual(
    (contextBox?.y ?? 0) + (contextBox?.height ?? 0) - 1,
  );
  await attachmentChip.hover();
  const attachmentPreview = page.getByRole("tooltip");
  await expect(attachmentPreview).toBeVisible();
  await expect(attachmentPreview).toContainText("灵感");
  await attachmentPreview.hover();
  await page.waitForTimeout(150);
  await expect(attachmentPreview).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(attachmentPreview).toHaveCount(0);
  await context.getByRole("button", { name: "移除 灵感" }).click();
  await expect(context).toHaveCount(0);

  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();
  await expect(page.getByLabel("已附加内容")).toContainText("灵感");
  await page.mouse.click(620, 260);
  await expect(page.getByLabel("已附加内容")).toContainText("灵感");

  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(agent.locator("header strong").first()).toHaveText(
    "新的设计对话",
  );

  const composer = page.getByRole("textbox", { name: "编辑描述" });
  await composer.fill("请分析这个廓形并给出三个面料方向");
  const sendButton = page.getByRole("button", { name: "发送", exact: true });
  await expect(sendButton).toBeDisabled();
  await expect(sendButton).toBeEnabled();
  await composer.press("Enter");
  await composer.press("Enter");
  await expect.poll(() => sendCount).toBe(1);
  await expect(agent).toContainText("已整理为三个可执行的廓形与面料方向。");
  expect(sentShapeIds).toHaveLength(1);
  await expect(composer).toHaveValue("");
  await expect(page.getByLabel("已附加内容")).toHaveCount(0);

  await page.getByRole("button", { name: "管理当前会话" }).click();
  await page.getByRole("button", { name: "重命名会话" }).click();
  await page.getByRole("textbox", { name: "会话标题" }).fill("面料方向讨论");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(agent.locator("header strong").first()).toHaveText(
    "面料方向讨论",
  );

  await page.getByRole("button", { name: "管理当前会话" }).click();
  await page.getByRole("button", { name: "归档会话" }).click();
  await page.getByRole("button", { name: "再次点击确认归档" }).click();
  await expect(agent.locator("header strong").first()).toHaveText(
    "新的设计对话",
  );

  await page.getByRole("button", { name: "折叠设计助手" }).click();
  const collapsed = page.getByRole("complementary", {
    name: "设计助手（已折叠）",
  });
  await expect(collapsed).toBeVisible();
  expect((await collapsed.boundingBox())?.width).toBeLessThanOrEqual(50);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("fashion-board-agent-collapsed"),
      ),
    )
    .toBe("1");

  await page.reload();
  await expect(collapsed).toBeVisible();
  await page.getByRole("button", { name: "展开设计助手" }).click();
  await expect(agent).toBeVisible();
  await toolDock.getByRole("button", { name: "添加灵感便签" }).click();
  const inspector = page.locator('[data-label-design-panel="true"]');
  await expect(inspector).toHaveCount(0);
  await page.getByRole("button", { name: "编辑标签：灵感" }).click();
  await expect(inspector).toBeVisible();
  await expect(
    inspector.getByRole("radio", { name: "风格参考" }),
  ).toBeVisible();
  await expect(inspector.getByRole("radio", { name: "参考衣" })).toBeVisible();

  for (const viewport of [
    { height: 900, width: 1440 },
    { height: 768, width: 1024 },
    { height: 1024, width: 768 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(agent).toBeVisible();
    await expect(toolDock).toBeVisible();
    const agentBox = await agent.boundingBox();
    const dockBox = await toolDock.boundingBox();
    expect(Math.round((agentBox?.x ?? 0) + (agentBox?.width ?? 0))).toBe(
      viewport.width,
    );
    expect((agentBox?.width ?? 0) <= viewport.width).toBe(true);
    expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height - 10,
    );
    const inspectorBox = await inspector.boundingBox();
    expect(inspectorBox).not.toBeNull();
    expect((inspectorBox?.x ?? 0) >= 0).toBe(true);
    expect(
      (inspectorBox?.x ?? 0) + (inspectorBox?.width ?? 0),
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      (inspectorBox?.y ?? 0) + (inspectorBox?.height ?? 0),
    ).toBeLessThanOrEqual(viewport.height - 76);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  }
  await expect(
    page.getByRole("button", { name: "关闭设计助手" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "折叠设计助手" }).click();
  await expect(collapsed).toBeVisible();
});

async function mockWorkspace(
  page: Page,
  options: {
    readonly conversations: Array<ReturnType<typeof conversation>>;
    readonly generationTasks?: readonly unknown[];
    readonly messages: Map<string, unknown[]>;
    readonly onCreateConversation: () => ReturnType<typeof conversation>;
    readonly onSend: (
      conversationId: string,
      body: {
        readonly clientRequestId: string;
        readonly content: string;
        readonly shapeIds: readonly string[];
      },
    ) => Promise<unknown>;
  },
) {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        credits: { limit: 600, remaining: 527, used: 73 },
        user: {
          authId: "auth-agent-e2e",
          avatar: null,
          createdAt: NOW,
          deletedAt: null,
          email: "agent-e2e@example.com",
          id: "user-agent-e2e",
          name: "Agent E2E",
        },
      },
    }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}`, (route) =>
    route.fulfill({
      json: {
        archived: false,
        assetCount: 0,
        coverAssetId: null,
        coverUrl: null,
        createdAt: NOW,
        id: PROJECT_ID,
        name: "AGENT 工作区验收项目",
        updatedAt: NOW,
      },
    }),
  );
  await page.route(`**/api/collections?projectId=${PROJECT_ID}`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/projects/${PROJECT_ID}/board`, (route) =>
    route.fulfill({
      json:
        route.request().method() === "PATCH"
          ? { batchId: "agent-e2e-save", revision: 1, savedAt: NOW }
          : { elements: [], revision: 0, snapshot: null },
    }),
  );
  await page.route("**/api/generations?*", (route) =>
    route.fulfill({
      json: { items: options.generationTasks ?? [], nextCursor: null },
    }),
  );
  await page.route("**/api/generations/*/candidates/*", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route(
    `**/api/projects/${PROJECT_ID}/agent-conversations*`,
    (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          json: options.onCreateConversation(),
          status: 201,
        });
      }
      return route.fulfill({
        json: { items: options.conversations, nextCursor: null },
      });
    },
  );
  await page.route("**/api/agent-conversations/*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const conversationId = new URL(route.request().url()).pathname
      .split("/")
      .at(-1);
    const body = route.request().postDataJSON() as {
      readonly archived?: boolean;
      readonly title?: string;
    };
    const index = options.conversations.findIndex(
      (conversation) => conversation.id === conversationId,
    );
    const current = options.conversations[index];
    if (!current) return route.fulfill({ status: 404 });
    const updated = {
      ...current,
      archivedAt: body.archived ? NOW : current.archivedAt,
      title: body.title ?? current.title,
      updatedAt: NOW,
    };
    if (body.archived) options.conversations.splice(index, 1);
    else options.conversations[index] = updated;
    return route.fulfill({ json: updated });
  });
  await page.route("**/api/agent-conversations/*/messages*", async (route) => {
    const match = new URL(route.request().url()).pathname.match(
      /agent-conversations\/([^/]+)\/messages$/u,
    );
    const conversationId = match?.[1] ?? "";
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        readonly clientRequestId: string;
        readonly content: string;
        readonly shapeIds: readonly string[];
      };
      return route.fulfill({
        json: await options.onSend(conversationId, body),
        status: 201,
      });
    }
    return route.fulfill({
      json: {
        items: options.messages.get(conversationId) ?? [],
        nextCursor: null,
      },
    });
  });
}

function conversation(id: string, title: string) {
  return {
    archivedAt: null,
    createdAt: NOW,
    id,
    messageCount: 0,
    projectId: PROJECT_ID,
    title,
    updatedAt: NOW,
  };
}

function message(input: {
  readonly clientRequestId?: string | null;
  readonly content: string;
  readonly context?: {
    readonly fileAssetIds: readonly string[];
    readonly shapeIds: readonly string[];
  } | null;
  readonly id: string;
  readonly generationTaskId?: string | null;
  readonly replyToId?: string | null;
  readonly role: "assistant" | "user";
  readonly status?: "completed" | "failed" | "pending";
}) {
  return {
    clientRequestId: input.clientRequestId ?? null,
    content: input.content,
    context: input.context ?? null,
    createdAt: NOW,
    error: null,
    generationTaskId: input.generationTaskId ?? null,
    id: input.id,
    replyToId: input.replyToId ?? null,
    role: input.role,
    status: input.status ?? "completed",
    updatedAt: NOW,
  };
}

function generationTask(id: string) {
  const image = (index: number) => ({
    assetId: `asset-${index}`,
    height: 4,
    url: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==#${index}`,
    width: 3,
  });
  return {
    createdAt: NOW,
    error: null,
    id,
    output: { images: [image(1), image(2), image(3)] },
    request: {
      height: 1024,
      projectId: PROJECT_ID,
      prompt: "强调面料垂坠感的风衣方案",
      shapeIds: [],
      taskType: "t2i",
      width: 768,
    },
    status: "succeeded",
    taskType: "t2i",
    updatedAt: NOW,
  };
}
