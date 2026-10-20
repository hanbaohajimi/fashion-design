import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const sharp = require("sharp");
if (process.env.TRIAL_E2E !== "1" || process.env.AMUX_API_KEY !== "trial-local-only") throw new Error("AI 替身仅供隔离验收");
const image = await sharp({ create: { width: 768, height: 1024, channels: 3, background: "#40536d" } }).png().toBuffer();
function sample(schema, root = schema) {
  if (schema.$ref) return sample(schema.$ref.split("/").slice(1).reduce((value, key) => value[key], root), root);
  if ("const" in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf || schema.oneOf) return sample((schema.anyOf ?? schema.oneOf).find((value) => value.type === "null") ?? (schema.anyOf ?? schema.oneOf)[0], root);
  if (schema.type === "null") return null;
  if (schema.type === "object" || schema.properties) return Object.fromEntries((schema.required ?? Object.keys(schema.properties ?? {})).map((key) => [key, sample(schema.properties[key], root)]));
  if (schema.type === "array") return Array.from({ length: schema.minItems ?? 0 }, () => sample(schema.items, root));
  if (schema.type === "number" || schema.type === "integer") return schema.minimum ?? 1;
  if (schema.type === "boolean") return false;
  return "试用设计样本".repeat(Math.ceil((schema.minLength ?? 1) / 6)).slice(0, schema.maxLength ?? 100);
}
const server = createServer(async (request, response) => {
  const send = (status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
  if (request.url === "/health") return send(200, { ok: true });
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    if (request.url?.includes("/images/")) return send(200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: image.toString("base64") }] });
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const tool = body.tools?.[0];
    let result = sample(tool.input_schema);
    if (tool.name === "generated_image_moderation") result = { status: "approved", categories: [] };
    if (tool.name === "fashion_design_brief") result = { summary: "藏蓝通勤外套", garmentType: "外套", constraints: [], unknowns: ["材质和尺寸需规格验证"] };
    if (tool.name === "fashion_workflow_collaboration") result = { kind: "reply", message: "已读取当前画布，结果需设计师确认。", plan: null, objectiveUpdate: null, preferences: [] };
    send(200, { id: "trial-message", type: "message", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "trial-call", name: tool.name, input: result }] });
  } catch { send(500, { error: { message: "Trial provider schema unsupported" } }); }
});
server.listen(4302, "127.0.0.1");
