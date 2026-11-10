import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { productionOptions, readProductionContext } from "./production-context.mjs";

/** Program-authored curves for importing into the real cmo3 animation track.
 * These are drafts, not Cubism exports, and cannot validate absent model bindings.
 */
const { values } = parseArgs({ options: { ...productionOptions, "csv-template": { type: "string" } } });
const { repo, specPath, specification, characterId, outputRoot, isFrontV8 } = await readProductionContext(values);
const output = path.join(outputRoot, "motion-drafts");
await mkdir(output, { recursive: true });
assert.ok((await realpath(output)).startsWith((await realpath(outputRoot)) + path.sep), "Motion output must stay in the production output directory");
const fps = 60;
const defaults = {
  ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0,
  ParamBodyAngleX: 0, ParamBodyAngleZ: 0, ParamBreath: 0,
  ParamEyeLOpen: 1, ParamEyeROpen: 1,
  ParamFSHatTouch: 0, ParamFSPickup: 0, ParamFSSettle: 0,
};
const physicsOutputs = ["ParamFSHairBackSway", "ParamFSBraidSway", "ParamFSHatBrimSway", ...(!isFrontV8 ? ["ParamFSBellSway"] : []), "ParamFSScarfSway", "ParamFSSkirtSway", "ParamFSPouchSway"];
const parameterCount = Object.keys(defaults).length + physicsOutputs.length;
if (specification.parameter_count !== undefined) assert.equal(parameterCount, specification.parameter_count, "Draft parameters differ from the approved specification");
if (specification.physics_output_count !== undefined) assert.equal(physicsOutputs.length, specification.physics_output_count, "Physics owners differ from the approved specification");
const ranges = Object.fromEntries(Object.keys(defaults).map(id => [id, id.startsWith("ParamAngle") ? [-30, 30] : id.startsWith("ParamBodyAngle") ? [-10, 10] : [0, 1]]));
// Frame-index keys avoid accidentally drifting the requested duration/FPS.
const drafts = [
  { name: "Idle", id: "idle", frames: 360, loop: true, description: "Quiet 6-second breathing loop with one blink and tiny head movement; no position change.", keys: {
    ParamAngleY: [[0, 0], [180, 0.25], [360, 0]],
    ParamAngleZ: [[0, 0], [90, 0.3], [270, -0.3], [360, 0]],
    ParamBreath: [[0, 0], [180, 0.22], [360, 0]],
    ParamEyeLOpen: [[0, 1], [210, 1], [217, 0], [222, 0], [230, 1], [360, 1]],
    ParamEyeROpen: [[0, 1], [210, 1], [217, 0], [222, 0], [230, 1], [360, 1]],
  } },
  { name: "Hover", id: "hover_greet", frames: 108, loop: false, description: "Small upward acknowledgement and one hat touch; returns to neutral at 1.8 seconds.", keys: {
    ParamAngleY: [[0, 0], [15, 2], [39, 3], [57, 3], [90, 0.6], [108, 0]],
    ParamAngleZ: [[0, 0], [39, 1.5], [57, 1.5], [108, 0]],
    ParamBodyAngleZ: [[0, 0], [39, 0.6], [57, 0.6], [108, 0]],
    ParamFSHatTouch: [[0, 0], [15, 0.15], [39, 1], [57, 1], [90, 0.15], [108, 0]],
    ParamBreath: [[0, 0], [39, 0.12], [108, 0]],
  } },
  { name: "DragHold", id: "drag_hold", frames: 18, loop: false, description: "Enter the author-rigged held pose in 0.3 seconds; final pickup value stays at 1, without screen translation.", keys: {
    ParamAngleZ: [[0, 0], [18, -1.5]],
    ParamBodyAngleZ: [[0, 0], [18, -0.8]],
    ParamFSPickup: [[0, 0], [18, 1]],
  } },
  { name: "PutDown", id: "put_down", frames: 33, loop: false, description: "Begin at the held pose, set feet down and softly settle within 0.55 seconds; no rubber bounce.", keys: {
    ParamAngleZ: [[0, -1.5], [14, -0.35], [33, 0]],
    ParamBodyAngleZ: [[0, -0.8], [14, -0.15], [33, 0]],
    ParamFSPickup: [[0, 1], [15, 0], [33, 0]],
    ParamFSSettle: [[0, 0], [15, 0.28], [33, 0]],
  } },
];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const round = value => Number(value.toFixed(9));
const manifest = {
  schemaVersion: 1, characterId, specification: specPath,
  status: "program_authored_motion_drafts_pending_real_binding_editor_import_and_reexport",
  sourceMethod: "Program-authored restricted Cubism Bezier curves, not editor-recorded or editor-exported files",
  fps, plannedParameterCount: parameterCount, curveParameterCount: Object.keys(defaults).length,
  motionOwnedParameters: Object.keys(defaults), excludedPhysicsOutputParameters: physicsOutputs,
  constraints: ["Import into a native cmo3 model track after the actual parameter binding exists.", "Save the animation as can3 and re-export motion3 using Cubism; preserve these drafts separately.", "The listed physics-owned outputs must be authored as real physics, not added to these curves.", ...(isFrontV8 ? ["v8 has no bell. ParamFSScarfSway controls only the lower scarf loop; do not move or invent a scarf tail."] : []), "Closed eyes and cross highlight removal depend on actual eye rigging; curve syntax cannot prove no eyelashes or visual fidelity.", "No audio, lip-sync, P1/P2 action, autonomous walking, screen-position curve or automatic dialogue action is authored."],
  files: [],
};
for (const draft of drafts) {
  let totalSegments = 0, totalPoints = 0;
  const curves = Object.entries(defaults).map(([id, neutral]) => {
    const keys = draft.keys[id] ?? [[0, neutral], [draft.frames, neutral]];
    assert.equal(keys[0][0], 0); assert.equal(keys.at(-1)[0], draft.frames);
    const segments = [0, keys[0][1]];
    totalPoints++;
    for (let index = 1; index < keys.length; index++) {
      const [previousFrame, previousValue] = keys[index - 1], [frame, value] = keys[index];
      assert.ok(frame > previousFrame && Number.isInteger(frame));
      assert.ok(value >= ranges[id][0] && value <= ranges[id][1], `${draft.name}/${id}: out of range`);
      const from = previousFrame / fps, to = frame / fps;
      // Restricted cubic Bezier control times at thirds; endpoint derivatives zero.
      segments.push(1, round(from + (to - from) / 3), previousValue, round(from + 2 * (to - from) / 3), value, round(to), value);
      totalSegments++; totalPoints += 3;
    }
    return { Target: "Parameter", Id: id, ...(draft.id === "drag_hold" ? { FadeOutTime: 0 } : {}), Segments: segments };
  });
  const motion = {
    Version: 3,
    // The official SDK reads global fades from Meta, not the JSON root.
    Meta: { Duration: draft.frames / fps, Fps: fps, Loop: draft.loop, AreBeziersRestricted: true, CurveCount: curves.length, TotalSegmentCount: totalSegments, TotalPointCount: totalPoints, UserDataCount: 0, TotalUserDataSize: 0, FadeInTime: draft.id === "drag_hold" ? 0 : 0.12, FadeOutTime: draft.id === "drag_hold" ? 0 : 0.12 },
    Curves: curves, UserData: [],
  };
  assert.ok(curves.every(curve => !physicsOutputs.includes(curve.Id)), "A physics-owned output was accidentally animated");
  const filename = `${draft.name}.motion3.json`;
  const bytes = Buffer.from(JSON.stringify(motion, null, 2) + "\n", "utf8");
  await writeFile(path.join(output, filename), bytes);
  const readback = JSON.parse(await readFile(path.join(output, filename), "utf8"));
  assert.deepEqual(readback, motion, "Motion JSON roundtrip mismatch");
  let actualSegments = 0, actualPoints = curves.length;
  for (const curve of readback.Curves) {
    assert.equal((curve.Segments.length - 2) % 7, 0);
    actualSegments += (curve.Segments.length - 2) / 7;
    actualPoints += (curve.Segments.length - 2) / 7 * 3;
    assert.equal(curve.Segments.at(-2), draft.frames / fps);
  }
  assert.equal(actualSegments, readback.Meta.TotalSegmentCount);
  assert.equal(actualPoints, readback.Meta.TotalPointCount);
  manifest.files.push({ id: draft.id, path: filename, durationSeconds: draft.frames / fps, frames: draft.frames, fps, loop: draft.loop, description: draft.description, sha256: digest(bytes), bytes: bytes.length, curveCount: curves.length, syntaxAndCountsVerified: true, importedInEditor: false, exportedFromEditor: false, actualBindingVerified: false, visualMotionAccepted: false });
}
assert.equal(new Set(manifest.files.map(file => file.sha256)).size, 4, "Each authored motion draft must be distinct");
await writeFile(path.join(output, "motion-drafts.manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
// Use the actual Editor-exported column template when it is present. Empty GUIDs
// describe new parameters; this is intended only for the parent's fresh unbound model.
const validation = path.join(outputRoot, "validation");
await mkdir(validation, { recursive: true });
assert.ok((await realpath(validation)).startsWith((await realpath(outputRoot)) + path.sep));
const parameterRows = [
  ["ParamAngleX", "头部左右轻转", -30, 0, 30, "首版只在已绑定小范围内使用；当前四动作草稿固定0；参数数值不等于物理角度"],
  ["ParamAngleY", "头部轻抬低头", -30, 0, 30, "动作拥有；当前草稿0到3；首版安全包络建议-5到6并以实际形变验收为准"],
  ["ParamAngleZ", "头部轻歪", -30, 0, 30, "动作拥有；当前草稿-1.5到1.5；首版安全包络-5到5"],
  ["ParamBodyAngleX", "身体左右姿态", -10, 0, 10, "动作拥有；当前草稿固定0；不制作行走或屏幕位移"],
  ["ParamBodyAngleZ", "身体轻侧倾", -10, 0, 10, "动作拥有；当前草稿-0.8到0.6；首版安全包络-2到2"],
  ["ParamBreath", "低幅呼吸", 0, 0, 1, "仅动作曲线拥有；当前草稿0到0.22；不要再叠加自动呼吸"],
  ["ParamEyeLOpen", "左眼开合", 0, 1, 1, "角色解剖左眼；0为干净闭眼弧线且十字消隐；禁止睫毛；动作拥有"],
  ["ParamEyeROpen", "右眼开合", 0, 1, 1, "角色解剖右眼；0为干净闭眼弧线且十字消隐；禁止睫毛；动作拥有"],
  ["ParamFSHatTouch", "单次扶帽姿态", 0, 0, 1, "0中性1扶帽；手在帽檐前的遮挡须实际绑定；动作拥有"],
  ["ParamFSPickup", "被提起姿态", 0, 0, 1, "0站立1持起；只控制模型内部姿态；浏览器独占屏幕拖动坐标"],
  ["ParamFSSettle", "放下缓冲", 0, 0, 1, "动作拥有；草稿峰值0.28；禁止橡皮挤压与大弹跳"],
  ["ParamFSHairBackSway", "后发轻摆", -1, 0, 1, "物理输出；从低影响度开始；动作草稿不写此参数"],
  ["ParamFSBraidSway", "发辫轻摆", -1, 0, 1, "物理输出；低幅适度阻尼；动作草稿不写此参数"],
  ["ParamFSHatBrimSway", "圆帽檐轻摆", -1, 0, 1, "物理输出；适配当前已确认圆顶帽檐；没有旧帽尖参数"],
  ...(!isFrontV8 ? [["ParamFSBellSway", "铃铛轻摆", -1, 0, 1, "物理输出；轻摆无自动声音；动作草稿不写此参数"]] : []),
  ["ParamFSScarfSway", isFrontV8 ? "围巾下圈轻摆" : "围巾尾轻摆", -1, 0, 1, isFrontV8 ? "物理输出；仅围巾下圈小幅跟随；上圈贴颈不动；无围巾尾和铃铛" : "物理输出；短暂跟随后落定；无持续大风"],
  ["ParamFSSkirtSway", "裙瓣轻摆", -1, 0, 1, "物理输出；保持蕾丝和织纹连贯；动态遮挡须实际验收"],
  ["ParamFSPouchSway", "工具袋轻摆", -1, 0, 1, "物理输出；重量感幅度小；剪刀等硬工具不得弯曲"],
];
assert.equal(parameterRows.length, parameterCount);
assert.equal(new Set(parameterRows.map(row => row[0])).size, parameterCount);
assert.deepEqual(new Set(parameterRows.map(row => row[0])), new Set([...Object.keys(defaults), ...physicsOutputs]));
const templatePath = values["csv-template"] ? path.resolve(repo, values["csv-template"]) : path.join(validation, "editor-default-parameters.csv");
let template;
try { template = await readFile(templatePath, "utf8"); } catch (error) { if (values["csv-template"] || error.code !== "ENOENT") throw error; }
if (template) {
  const header = template.replace(/^\uFEFF/u, "").split(/\r?\n/u)[0];
  assert.equal(header, "GUID,类型,ID,名称,群组,最低值,基准值,最大值,循环,说明,标签颜色", "Actual Editor CSV template changed; inspect it before generating parameters");
  const escape = value => /[,"\r\n]/u.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
  const rows = parameterRows.map(([id, name, min, neutral, max, note]) => ["", "PARAMETER", id, name, "ParamGroupRoot", min, neutral, max, "false", note, ""]);
  await writeFile(path.join(validation, "production-parameters.csv"), header + "\r\n" + rows.map(row => row.map(escape).join(",")).join("\r\n") + "\r\n", "utf8");
  const motionRangeChecks = [];
  for (const file of manifest.files) {
    const motion = JSON.parse(await readFile(path.join(output, file.path), "utf8"));
    for (const curve of motion.Curves) {
      const row = parameterRows.find(row => row[0] === curve.Id);
      assert.ok(row, `${curve.Id}: CSV parameter is missing`);
      const values = [curve.Segments[1]];
      for (let index = 2; index < curve.Segments.length; index += 7) values.push(curve.Segments[index + 2], curve.Segments[index + 4], curve.Segments[index + 6]);
      assert.ok(values.every(value => value >= row[2] && value <= row[4]), `${file.path}/${curve.Id}: outside CSV range`);
      motionRangeChecks.push({ motion: file.id, id: curve.Id, minimum: Math.min(...values), maximum: Math.max(...values), withinCsvRange: true });
    }
  }
  await writeFile(path.join(validation, "production-parameters-validation.json"), JSON.stringify({ characterId, sourceTemplate: templatePath, sourceTemplateSha256: digest(Buffer.from(template, "utf8")), parameterCount, emptyGuids: true, group: "ParamGroupRoot", curveParameterCount: Object.keys(defaults).length, excludedPhysicsOutputCount: physicsOutputs.length, exactParameterSetMatchesMotionPlan: true, editorImportPerformed: false, warning: "Use only to replace/add parameters in the fresh unbound model. This CSV does not create deformations or bindings.", motionRangeChecks }, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify({ output, characterId, parameterCount, csvGenerated: Boolean(template), status: manifest.status, files: manifest.files.map(({ path, durationSeconds, curveCount }) => ({ path, durationSeconds, curveCount })), editorImports: 0, editorExports: 0, modelBindingVerified: false }, null, 2));
