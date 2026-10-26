import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runwayActionSchema, runwayDraftSchema } from "@fashion/shared";

// This exact file also runs against Python Pydantic inside the frozen container.
const fixtures = JSON.parse(readFileSync(resolve(__dirname, "../../../../runway/tests/fixtures/contracts.json"), "utf8")) as {
  name: string; schema: "draft" | "action"; valid: boolean; input: unknown; expected?: unknown;
}[];
describe("服装秀跨语言 JSON 契约", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const schema = fixture.schema === "draft" ? runwayDraftSchema : runwayActionSchema;
      const result = schema.safeParse(fixture.input);
      expect(result.success).toBe(fixture.valid);
      if (result.success && fixture.expected) expect(result.data).toEqual(fixture.expected);
    });
  }
});
