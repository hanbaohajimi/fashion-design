import { expect, it } from "vitest";
import { refineStatus } from "./RefineFrame";

it("只把真实任务阶段映射到视觉，不用时间伪造精修或成功", () => {
  expect(refineStatus("preparing")).toBe("queued");
  expect(refineStatus("running")).toBe("generating");
  expect(refineStatus("processing")).toBe("refining");
  expect(refineStatus("completed")).toBe("complete");
  expect(refineStatus("failed")).toBe("error");
  expect(refineStatus("canceled")).toBe("canceled");
  expect(refineStatus("paused")).toBeNull();
  expect(refineStatus("unknown")).toBeNull();
});
