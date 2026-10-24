import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sourcesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sourcesIn(path)
      : /\.(?:tsx?|css)$/u.test(path)
        ? [path]
        : [];
  });
}

/** Historical themes cannot satisfy a required token in a real route. */
function activeStyles() {
  const visited = new Set<string>();
  const styles = new Map<string, string>();
  const visit = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    if (path.endsWith(".css")) styles.set(path, source);
    const imports = path.endsWith(".css")
      ? [...source.matchAll(/@import\s+["']([^"']+)["']/gu)]
      : [
          ...source.matchAll(
            /\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/gu,
          ),
        ];
    for (const match of imports) {
      const specifier = match[1];
      if (!specifier?.startsWith(".")) continue;
      const base = resolve(dirname(path), specifier);
      const target = [
        base,
        `${base}.tsx`,
        `${base}.ts`,
        resolve(base, "index.tsx"),
        resolve(base, "index.ts"),
      ].find(
        (candidate) =>
          existsSync(candidate) && /\.(?:tsx?|css)$/u.test(candidate),
      );
      if (target) visit(target);
    }
  };
  for (const route of sourcesIn(resolve(process.cwd(), "src/app")).filter(
    (path) => path.endsWith(".tsx"),
  ))
    visit(route);
  return styles;
}

describe("active design token contract", () => {
  it("resolves required tokens from styles actually imported by a route", () => {
    const styles = activeStyles();
    expect(
      styles.has(resolve(process.cwd(), "src/styles/design-system.css")),
    ).toBe(true);
    expect(
      styles.has(resolve(process.cwd(), "src/styles/design-tokens.css")),
    ).toBe(false);
    const supplied = [
      "--cover-color",
      "--similarity-alpha",
      "--studio-sidebar-width",
    ];
    const defined = new Set([
      ...supplied,
      ...[...styles.values()].flatMap((text) =>
        [...text.matchAll(/(--[\w-]+)\s*:/gu)].map((match) => match[1]),
      ),
    ]);
    const missing = [...styles].flatMap(([path, text]) =>
      [...text.matchAll(/var\(\s*(--[\w-]+)\s*\)/gu)]
        .filter((match) => !defined.has(match[1]))
        .map((match) => `${path}: ${match[1]}`),
    );
    expect([...new Set(missing)]).toEqual([]);
  });
});
