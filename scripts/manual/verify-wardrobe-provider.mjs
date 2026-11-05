import { createRequire } from "node:module";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { readJson, writeJson } from "./wardrobe-provider-journal.mjs";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const command = args[0] ?? "plan";
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const out = resolve(root, option("out", "output/wardrobe-provider"));
const attempt = option("attempt", "");
if (attempt && !/^[a-z0-9-]+$/u.test(attempt))
  throw new Error("attempt必须为小写字母数字短横线");
if (attempt && command === "source" && !args.includes("--new-source"))
  throw new Error(
    "返工默认复用source；明确重建设计源须带--new-source并保留旧源",
  );
const evidenceOut = attempt ? resolve(out, "attempts", attempt) : out;
const sourceAttempt = option("source-attempt", "");
const sourceEditAttempt = option("source-edit-attempt", "");
if (
  sourceEditAttempt &&
  (!attempt ||
    command !== "source" ||
    sourceAttempt ||
    !/^[a-z0-9-]+$/u.test(sourceEditAttempt))
)
  throw new Error(
    "源局部编辑仅允许独立attempt的source命令及明确历史source-edit-attempt",
  );
const sourceCandidateAttempt = option("source-candidate-attempt", "");
const materialRawAttempt = option("material-raw-attempt", "");
const materialSideAttempt = option("material-side-attempt", "");
const withoutDiagnostic = args.includes("--without-diagnostic");
if (
  withoutDiagnostic &&
  (command !== "material-derive" || !materialSideAttempt)
)
  throw new Error(
    "without-diagnostic仅用于先生成待审核侧派生候选，不代表独立诊断通过",
  );
if (
  materialSideAttempt &&
  (!["material-derive", "material-probe"].includes(command) ||
    !/^[a-z0-9-]+$/u.test(materialSideAttempt))
)
  throw new Error("material-side-attempt仅用于明确真实侧挂准备的透明处理");
if (
  command === "material-probe" &&
  (!attempt ||
    !materialSideAttempt ||
    !option("mask", "") ||
    sourceCandidateAttempt ||
    option("side-source-attempt", "") ||
    option("pose-reference", "") ||
    args.includes("--material-reference") ||
    args.includes("--structure-guide"))
)
  throw new Error(
    "material-probe仅接受明确已登记side母图与审核mask，细节由生产服务裁取",
  );
if (
  command === "material-derive" &&
  (!attempt || !/^[a-z0-9-]+$/u.test(materialRawAttempt))
)
  throw new Error("material-derive需要独立attempt与明确material-raw-attempt");
const sideSourceAttempt = option("side-source-attempt", "");
const sideReview = option("side-review", "side-review.json");
if (
  !/^[a-z0-9][a-z0-9.-]*\.json$/u.test(sideReview) ||
  (sideReview !== "side-review.json" && !sideSourceAttempt)
)
  throw new Error("side-review必须为明确侧图来源目录内的JSON文件名");
const structureGuide = args.includes("--structure-guide");
if (
  structureGuide &&
  (command !== "inpaint" ||
    !sideSourceAttempt ||
    args.includes("--material-reference") ||
    option("pose-reference", ""))
)
  throw new Error(
    "原创结构guide仅用于明确native侧图inpaint，不能混用材质或姿态参考",
  );
const allowProbeParent = args.includes("--allow-probe-parent");
if (
  allowProbeParent &&
  !(
    (["inpaint", "audit-native-source"].includes(command) &&
      sideSourceAttempt) ||
    (command === "material-probe" && materialSideAttempt)
  )
)
  throw new Error(
    "allow-probe-parent仅允许显式下一阶段侧图inpaint或生产局部编辑，不能确认探针",
  );
if (
  sideSourceAttempt &&
  (!attempt ||
    !["side", "inpaint", "side-cutout", "audit-native-source"].includes(
      command,
    ) ||
    sourceAttempt ||
    sourceCandidateAttempt ||
    option("pose-reference", "") ||
    (args.includes("--material-reference") && command !== "inpaint") ||
    !/^[a-z0-9-]+$/u.test(sideSourceAttempt))
)
  throw new Error(
    "side-source-attempt仅用于独立side或inpaint修正，不能混用姿态/材质/其他来源",
  );
if (
  args.includes("--material-reference") &&
  (!["prepare", "inpaint"].includes(command) ||
    (command === "prepare" && sourceCandidateAttempt) ||
    (sideSourceAttempt && command !== "inpaint"))
)
  throw new Error("同源材质参考仅用于正常front prepare或明确母图的inpaint");
const sourceKind = option(
  "source-kind",
  sourceCandidateAttempt ? "isolated" : "sketch",
);
if (command === "side-cutout" && (!sideSourceAttempt || option("mask", "")))
  throw new Error(
    "side-cutout需要明确native侧图来源，不能再次提交蒙版或参考图",
  );
const preparationMode = option(
  "mode",
  sourceCandidateAttempt ? "extract" : "complete",
);
if (
  sourceCandidateAttempt &&
  (!attempt ||
    !["prepare", "inpaint"].includes(command) ||
    sourceAttempt ||
    !/^[a-z0-9-]+$/u.test(sourceCandidateAttempt) ||
    sourceKind !== "isolated" ||
    preparationMode !== "extract")
)
  throw new Error(
    "candidate修正仅允许独立attempt的prepare/inpaint isolated+extract，不能混用source-attempt",
  );
if (
  command === "inpaint" &&
  ((!sourceCandidateAttempt && !sideSourceAttempt) ||
    !option("mask", "") ||
    option("pose-reference", ""))
)
  throw new Error("inpaint需要明确失败candidate和已审核mask，不能混用姿态图");
const inpaintBackground = option("inpaint-background", "transparent");
if (
  !["transparent", "opaque"].includes(inpaintBackground) ||
  (command !== "inpaint" && inpaintBackground !== "transparent")
)
  throw new Error("inpaint-background仅允许蒙版任务显式选transparent/opaque");
if (
  !sourceCandidateAttempt &&
  (sourceKind !== "sketch" || preparationMode !== "complete")
)
  throw new Error("来源模式覆盖仅用于明确的source-candidate-attempt修正");
const sourceReview = option("source-review", "source-review.json");
if (!/^[a-z0-9][a-z0-9.-]*\.json$/u.test(sourceReview))
  throw new Error("source-review必须为对应来源目录内的JSON文件名");
if (sourceAttempt && !/^[a-z0-9-]+$/u.test(sourceAttempt))
  throw new Error("source-attempt格式不合法");
const within = relative(resolve(root, "output"), out);
if (!within || within.startsWith("..") || isAbsolute(within))
  throw new Error("输出必须位于工作区 output 子目录");
const casesFile = resolve(
  root,
  option("cases", "scripts/manual/wardrobe-provider-cases.json"),
);
const cases = readJson(casesFile);
if (!cases?.items?.length) throw new Error("缺少实际服装验证清单");
const ids = option(
  "ids",
  cases.items
    .filter((item) => item.pilot)
    .slice(0, 1)
    .map((item) => item.id)
    .join(","),
)
  .split(",")
  .filter(Boolean);
if (
  !ids.length ||
  ids.some((id) => !cases.items.some((item) => item.id === id))
)
  throw new Error("请选择清单内的款式 --ids");
const envFile = (name) =>
  existsSync(resolve(root, name))
    ? dotenv.parse(readFileSync(resolve(root, name)))
    : {};
const env = { ...envFile(".env.example"), ...envFile(".env"), ...process.env };
if (
  sourceEditAttempt &&
  !["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(env.S3_ENDPOINT).hostname,
  )
)
  throw new Error("源局部编辑参考仅允许保存到本机隔离MinIO");
const stateFile = resolve(out, "run.json");
const state = readJson(stateFile) ?? {
  schemaVersion: 1,
  runId: randomUUID(),
  schema: `wardrobe_provider_${Date.now()}`,
  createdAt: new Date().toISOString(),
};
const safeEndpoint = new URL(env.AMUX_BASE_URL || "https://gateway.amux.ai/v1");
if (
  safeEndpoint.protocol !== "https:" ||
  safeEndpoint.username ||
  safeEndpoint.password
)
  throw new Error("真实供应商需要无内嵌凭证的HTTPS endpoint");
const baseConfig = {
  provider: "amux",
  endpoint: safeEndpoint.origin + safeEndpoint.pathname,
  model: env.AMUX_IMAGE_MODEL || "openai/gpt-image-2.5-sunburst",
  quality: env.AMUX_IMAGE_QUALITY || "high",
  keyConfigured: Boolean(env.AMUX_API_KEY),
  configuredImageUsd: Number(env.AMUX_IMAGE_COST_USD) || null,
  configuredEditUsd: Number(env.AMUX_EDIT_COST_USD) || null,
  actualCost: "unknown-until-provider-billing",
};
const attemptConfigFile = resolve(evidenceOut, "attempt-config.json");
const priorAttemptConfig = attempt ? readJson(attemptConfigFile) : null;
const overrideModel = option("model", priorAttemptConfig?.model ?? "");
if (
  overrideModel &&
  (!attempt ||
    ![
      "openai/gpt-image-2.5-sunburst",
      "openai/gpt-image-2.5-flare",
      "openai/gpt-image-1.5",
      "openai/gpt-image-2",
    ].includes(overrideModel))
)
  throw new Error(
    "model对照只允许命名attempt及已核对的Sunburst/Flare/GPT Image 1.5/2模型",
  );
const config = { ...baseConfig, model: overrideModel || baseConfig.model };
console.log(
  JSON.stringify({ command, ids, out: evidenceOut, attempt, config }, null, 2),
);
if (command === "plan" || command === "status") {
  console.log(
    JSON.stringify(
      cases.items
        .filter((item) => ids.includes(item.id))
        .map((item) => ({
          id: item.id,
          stages: Object.fromEntries(
            ["source", "candidate", "side"].map((stage) => [
              stage,
              readJson(
                resolve(
                  stage === "source" ? out : evidenceOut,
                  item.id,
                  `${stage}-call.json`,
                ),
              )?.status ?? "not-started",
            ]),
          ),
          frontConfirmed: Boolean(
            (
              readJson(resolve(out, item.id, "current-confirmed.json")) ??
              readJson(resolve(out, item.id, "confirmed.json"))
            )?.item,
          ),
          sideConfirmed: Boolean(
            (
              readJson(resolve(out, item.id, "current-confirmed.json")) ??
              readJson(resolve(out, item.id, "side-confirmed.json"))
            )?.item?.currentRevision?.presentation?.sideDisplay?.reviewed,
          ),
        })),
      null,
      2,
    ),
  );
  process.exit(0);
}
if (
  ![
    "source",
    "prepare",
    "confirm",
    "side",
    "side-cutout",
    "confirm-side",
    "calibrate-front",
    "inpaint",
    "material-derive",
    "material-probe",
    "register-side",
    "audit-native-source",
  ].includes(command)
)
  throw new Error(
    "命令为 plan/status/source/prepare/inpaint/confirm/side/confirm-side/calibrate-front",
  );
if (
  [
    "source",
    "prepare",
    "side",
    "inpaint",
    "side-cutout",
    "material-probe",
  ].includes(command) &&
  !args.includes("--execute-paid")
)
  throw new Error("真实调用须传 --execute-paid；不修改全局开关");
if (!config.keyConfigured) throw new Error("未配置 AMUX_API_KEY");
const concurrency = Number(option("concurrency", "1"));
if (![1, 2].includes(concurrency)) throw new Error("并发只允许1或2");
mkdirSync(out, { recursive: true });
const lock = resolve(out, "runner.lock");
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8"));
  try {
    process.kill(pid, 0);
    throw new Error(`验证进程 ${pid} 仍运行，禁止并发重复启动`);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  unlinkSync(lock);
}
const descriptor = openSync(lock, "wx");
writeFileSync(descriptor, String(process.pid));
closeSync(descriptor);
let status = 1;
try {
  if (
    state.config &&
    JSON.stringify(state.config) !== JSON.stringify(baseConfig)
  )
    throw new Error("供应商配置已改变；请选择新的output目录，不能覆盖原有证据");
  writeJson(stateFile, { ...state, config: baseConfig });
  if (attempt) {
    if (
      priorAttemptConfig &&
      JSON.stringify(priorAttemptConfig) !== JSON.stringify(config)
    )
      throw new Error("同attempt模型配置已冻结，不可改写");
    writeJson(attemptConfigFile, config);
  }
  const childEnv = {
    ...env,
    AMUX_IMAGE_MODEL: config.model,
    WARDROBE_PROVIDER_ALLOW_PROBE_PARENT: allowProbeParent ? "true" : "false",
    WARDROBE_PROVIDER_MATERIAL_RAW_OUT: materialRawAttempt
      ? resolve(out, "attempts", materialRawAttempt)
      : "",
    WARDROBE_PROVIDER_MATERIAL_SIDE_OUT: materialSideAttempt
      ? resolve(out, "attempts", materialSideAttempt)
      : "",
    WARDROBE_PROVIDER_WITHOUT_DIAGNOSTIC: withoutDiagnostic ? "true" : "",
    WARDROBE_PROVIDER_MATCH_PROMPT: option("match-prompt", "")
      ? resolve(root, option("match-prompt", ""))
      : "",
    WARDROBE_PROVIDER_OUT: evidenceOut,
    WARDROBE_PROVIDER_BASE_OUT: out,
    WARDROBE_PROVIDER_ATTEMPT: attempt,
    WARDROBE_PROVIDER_SOURCE_REVIEW: sourceReview,
    WARDROBE_PROVIDER_SOURCE_EDIT_OUT: sourceEditAttempt
      ? resolve(out, "attempts", sourceEditAttempt)
      : "",
    WARDROBE_PROVIDER_SOURCE_CANDIDATE_OUT: sourceCandidateAttempt
      ? resolve(out, "attempts", sourceCandidateAttempt)
      : "",
    WARDROBE_PROVIDER_SIDE_SOURCE_OUT: sideSourceAttempt
      ? resolve(out, "attempts", sideSourceAttempt)
      : "",
    WARDROBE_PROVIDER_SIDE_REVIEW: sideReview,
    WARDROBE_PROVIDER_SIDE_REVIEW_EXPLICIT: String(
      args.includes("--side-review"),
    ),
    WARDROBE_PROVIDER_MATERIAL_REFERENCE: args.includes("--material-reference")
      ? "true"
      : "",
    WARDROBE_PROVIDER_STRUCTURE_GUIDE: structureGuide ? "true" : "",
    WARDROBE_PROVIDER_MASK: option("mask", "")
      ? resolve(root, option("mask", ""))
      : "",
    WARDROBE_PROVIDER_INPAINT_BACKGROUND: inpaintBackground,
    WARDROBE_PROVIDER_SOURCE_KIND: sourceKind,
    WARDROBE_PROVIDER_PREPARATION_MODE: preparationMode,
    WARDROBE_PROVIDER_SOURCE_OUT: sourceAttempt
      ? resolve(out, "attempts", sourceAttempt)
      : "",
    WARDROBE_PROVIDER_POSE_REFERENCE: option("pose-reference", "")
      ? resolve(root, option("pose-reference", ""))
      : "",
    WARDROBE_PROVIDER_CASES: casesFile,
    WARDROBE_PROVIDER_IDS: ids.join(","),
    WARDROBE_PROVIDER_COMMAND: command,
    WARDROBE_PROVIDER_CONCURRENCY: String(concurrency),
  };
  if (command !== "source") {
    const db = new URL(env.DATABASE_URL);
    for (const address of [
      db,
      new URL(env.REDIS_URL),
      new URL(env.S3_ENDPOINT),
    ])
      if (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname))
        throw new Error("验证数据只允许本机独立schema/Redis/MinIO");
    db.searchParams.set("schema", state.schema);
    db.searchParams.set("options", `-c search_path=${state.schema}`);
    Object.assign(childEnv, {
      DATABASE_URL: db.toString(),
      WARDROBE_ENABLED: "true",
      WARDROBE_PREPARATION_ENABLED: "true",
      WARDROBE_STATIC_TRYON_ENABLED: "false",
      WARDROBE_REALTIME_OUTFIT_ENABLED: "false",
    });
    const dbRequire = createRequire(resolve(root, "packages/db/package.json"));
    const migrated =
      command === "audit-native-source"
        ? { status: 0 }
        : spawnSync(
            process.execPath,
            [dbRequire.resolve("prisma/build/index.js"), "migrate", "deploy"],
            {
              cwd: resolve(root, "packages/db"),
              env: childEnv,
              stdio: "inherit",
              windowsHide: true,
            },
          );
    if (migrated.status !== 0)
      throw new Error("隔离schema迁移失败；没有发起生成");
  }
  const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
  const child = spawnSync(
    process.execPath,
    [
      apiRequire.resolve("tsx/cli"),
      "--tsconfig",
      resolve(root, "apps/api/tsconfig.json"),
      resolve(root, "scripts/manual/wardrobe-provider-runner.ts"),
    ],
    { cwd: root, env: childEnv, stdio: "inherit", windowsHide: true },
  );
  status = child.status ?? 1;
} finally {
  const http = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/-http\.json$/u.test(entry.name)) {
        const evidence = readJson(file);
        http.push({
          file: relative(out, file).replaceAll("\\", "/"),
          ...evidence,
        });
      }
    }
  };
  visit(out);
  writeJson(resolve(out, "run-summary.json"), {
    updatedAt: new Date().toISOString(),
    runId: state.runId,
    externalImageRequests: http.filter((item) =>
      item.file.endsWith("-image-http.json"),
    ).length,
    externalModerationRequests: http.filter((item) =>
      item.file.endsWith("-moderation-http.json"),
    ).length,
    httpSuccesses: http.filter((item) => item.status === 200).length,
    usageTotals: {
      inputTokens: http.reduce(
        (sum, item) => sum + Number(item.usage?.input_tokens || 0),
        0,
      ),
      outputTokens: http.reduce(
        (sum, item) => sum + Number(item.usage?.output_tokens || 0),
        0,
      ),
    },
    actualCost: "unknown-until-provider-billing",
    configuredZeroIsNotFree: true,
    requests: http,
  });
  unlinkSync(lock);
}
process.exitCode = status;
