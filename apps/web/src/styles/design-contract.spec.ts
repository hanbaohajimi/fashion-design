import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : path.endsWith(".css") && !path.endsWith("-old.module.css") ? [path] : [];
  });
}

describe("design token contract", () => {
  it("requires every non-fallback variable to be defined or supplied by a component", () => {
    const contents = filesIn(resolve(process.cwd(), "src")).map((path) => ({ path, text: readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "") }));
    const defined = new Set(contents.flatMap(({ text }) => [...text.matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1])));
    const dynamic = new Set(["--cover-color", "--similarity-alpha", "--studio-sidebar-width"]);
    const missing = contents.flatMap(({ path, text }) => [...text.matchAll(/var\(\s*(--[\w-]+)\s*\)/gu)]
      .filter((match) => !defined.has(match[1]) && !dynamic.has(match[1] ?? ""))
      .map((match) => `${path}: ${match[1]}`));
    expect([...new Set(missing)]).toEqual([]);
  });
});
