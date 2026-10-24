import { describe, expect, it } from "vitest";
import { studioFixture, styleFixture } from "./studio-test-fixtures";
import { creativeProgress } from "./creative-progress";
describe("真实修订驱动创作进展", () => {
  it("根据已有候选与款式建议下一步，不产生任务", () => {
    expect(creativeProgress(studioFixture({ assets: [] })).next.tab).toBe("tasks");
    expect(creativeProgress(studioFixture()).next.tab).toBe("styles");
    const result = creativeProgress(studioFixture({ styles: [styleFixture()] }));
    expect(result.next.tab).toBe("experiments");
    expect(result.records[0]?.id).toBe(styleFixture().currentRevision.id);
    expect(result.styles).toBe(1);
  });
});
