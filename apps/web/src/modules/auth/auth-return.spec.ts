import { describe, expect, it } from "vitest";
import { loginPathWithReturnTo, safeAuthReturnTo } from "./auth-return";

describe("登录后的站内返回地址", () => {
  it.each([
    undefined, null, "", "https://outside.test/a", "//outside.test/a",
    "/\\outside.test/a", "/\\\\outside.test/a", "/\t/outside.test/a",
    "/\n/outside.test/a", "/a\r/b", "/a\u0000/b", "/login?returnTo=/project",
    "/auth/confirm?token_hash=old", "javascript:alert(1)",
  ])("拒绝站外、控制字符与认证循环：%j", (value) => {
    expect(safeAuthReturnTo(value)).toBe("/");
  });

  it.each(["/", "/project?conversationId=abc#result", "/trends?from=board&boardId=project", "/project?q=%E9%A3%8E%E8%A1%A3"])("保留站内目标：%s", (value) => {
    expect(safeAuthReturnTo(value)).toBe(value);
  });

  it("在保存认证入口参数前同样校验返回地址", () => {
    expect(loginPathWithReturnTo("/\\outside.test")).toBe("/login?returnTo=%2F");
    expect(loginPathWithReturnTo("/project?tab=design")).toBe("/login?returnTo=%2Fproject%3Ftab%3Ddesign");
  });
});
