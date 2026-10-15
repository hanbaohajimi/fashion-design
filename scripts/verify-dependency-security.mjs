import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  evaluateAuditProcess,
  evaluateAuditReport,
  patchedBracesAdvisory,
} from "./audit-dependencies.mjs";

// Resolve the workspace's declared dependency, including pnpm's patch-specific
// symlink. An explicit directory is only for isolated pre/post-patch checks.
const require = createRequire(new URL("../package.json", import.meta.url));
const directoryArgument = process.argv.indexOf("--package-dir");
if (directoryArgument !== -1 && !process.argv[directoryArgument + 1]) {
  throw new Error(
    "--package-dir requires an installed braces package directory",
  );
}
const packagePath = require.resolve(
  directoryArgument !== -1
    ? resolve(process.argv[directoryArgument + 1])
    : "braces",
);
const braces = require(packagePath);
const maximumDepth = 100;

// Use the already-declared ESLint toolchain's YAML parser. No new dependency is
// needed, and a missing parser causes the security gate to fail closed.
const eslintRequire = createRequire(require.resolve("eslint/package.json"));
const yaml = eslintRequire("js-yaml");
const lock = yaml.load(
  readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
);
const workspace = yaml.load(
  readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"),
);
const patchContents = readFileSync(
  new URL("../patches/braces@3.0.3.patch", import.meta.url),
);
const patchHash = createHash("sha256").update(patchContents).digest("hex");
const patchedVersion = `3.0.3(patch_hash=${patchHash})`;

// SHA-256 of the original 3.0.3 files, verified against the npm tarball whose
// SHA-512 integrity is recorded in pnpm-lock.yaml. Reversing every current patch
// hunk must recover these files exactly, including code outside the diff context.
// This detects stale or partially applied copies without relying on pnpm's
// platform-dependent (and sometimes truncated) patch_hash directory names.
const originalFileHashes = {
  "lib/parse.js":
    "e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310",
  "lib/compile.js":
    "dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f",
  "lib/expand.js":
    "41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7",
  "lib/stringify.js":
    "379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a",
};

function verifyInstalledPatch(patchText, readInstalledFile) {
  const sections = patchText.split(/(?=^diff --git )/m);
  const files = [];
  for (const section of sections) {
    const lines = section.replace(/\n$/, "").split("\n");
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[0]);
    assert.ok(
      header && header[1] === header[2],
      "Only same-path text patches are supported",
    );
    const file = header[1];
    assert.ok(
      Object.hasOwn(originalFileHashes, file) || file === "lib/depth.js",
      "Review unexpected patch targets",
    );
    assert.ok(!files.includes(file), "Duplicate patch targets are unsupported");
    files.push(file);
    const addedFile = file === "lib/depth.js";
    assert.ok(lines.includes(addedFile ? "--- /dev/null" : `--- a/${file}`));
    assert.ok(lines.includes(`+++ b/${file}`));
    const installed = readInstalledFile(file).split("\n");
    const original = [];
    let cursor = 0;
    let hunks = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].startsWith("@@")) continue;
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(
        lines[index],
      );
      assert.ok(hunk, "Review unknown patch hunk formats");
      const oldCount = Number(hunk[2] ?? 1);
      const newCount = Number(hunk[4] ?? 1);
      const oldLines = [];
      const newLines = [];
      while (index + 1 < lines.length && !lines[index + 1].startsWith("@@")) {
        const line = lines[++index];
        assert.ok(/^[ +\-]/.test(line), "Review unsupported patch content");
        if (!line.startsWith("+")) oldLines.push(line.slice(1));
        if (!line.startsWith("-")) newLines.push(line.slice(1));
      }
      assert.equal(oldLines.length, oldCount);
      assert.equal(newLines.length, newCount);
      // pnpm applies hunks by their context even when line numbers have an
      // offset. Require an unambiguous, complete match and then verify the
      // entire reconstructed original file, rather than trusting offsets.
      const matches = [];
      for (
        let start = cursor;
        start + newCount <= installed.length;
        start += 1
      ) {
        if (
          newLines.every((line, offset) => installed[start + offset] === line)
        )
          matches.push(start);
      }
      assert.equal(
        matches.length,
        1,
        `${file} must contain the current patch hunk exactly once`,
      );
      const start = matches[0];
      original.push(...installed.slice(cursor, start));
      original.push(...oldLines);
      cursor = start + newCount;
      hunks += 1;
    }
    assert.ok(hunks > 0, "Every patch target must contain a hunk");
    original.push(...installed.slice(cursor));
    const originalSource = original.join("\n");
    if (addedFile) {
      assert.equal(
        originalSource,
        "",
        "The added guard must exactly match the current patch",
      );
    } else {
      assert.equal(
        createHash("sha256").update(originalSource).digest("hex"),
        originalFileHashes[file],
        `${file} contains unexpected or stale installed code`,
      );
    }
  }
  assert.deepEqual(
    files.toSorted(),
    [...Object.keys(originalFileHashes), "lib/depth.js"].toSorted(),
  );
}

test("lockfile contains only Braces 3.0.3 and every reference uses the current patch", () => {
  assert.equal(
    String(lock.lockfileVersion),
    "9.0",
    "Review an unknown pnpm lock format before allowing an audit exception",
  );
  assert.equal(lock.patchedDependencies?.["braces@3.0.3"], patchHash);
  assert.equal(
    workspace.patchedDependencies?.["braces@3.0.3"],
    "patches/braces@3.0.3.patch",
  );
  assert.deepEqual(
    Object.keys(lock.packages).filter((key) => key.startsWith("braces@")),
    ["braces@3.0.3"],
  );
  assert.deepEqual(
    Object.keys(lock.snapshots).filter((key) => key.startsWith("braces@")),
    [`braces@${patchedVersion}`],
  );
  let references = 0;
  const pending = [lock.importers, lock.snapshots];
  while (pending.length > 0) {
    const record = pending.pop();
    if (!record || typeof record !== "object") continue;
    for (const [key, value] of Object.entries(record)) {
      if (key === "braces") {
        references += 1;
        assert.equal(
          typeof value === "string" ? value : value.version,
          patchedVersion,
          "An unpatched Braces reference cannot receive an audit exception",
        );
      } else if (value && typeof value === "object") {
        pending.push(value);
      }
    }
  }
  assert.ok(
    references >= 2,
    "The root dependency and transitive Braces references must both be present",
  );
  assert.equal(
    lock.importers["."].devDependencies.braces.version,
    patchedVersion,
  );
  const actualDirectory = dirname(realpathSync(packagePath));
  assert.equal(
    JSON.parse(readFileSync(resolve(actualDirectory, "package.json"), "utf8"))
      .version,
    "3.0.3",
  );
  verifyInstalledPatch(patchContents.toString("utf8"), (file) =>
    readFileSync(resolve(actualDirectory, file), "utf8"),
  );
});

test("installed patch validation rejects stale, partial and unexpectedly modified files", () => {
  const actualDirectory = dirname(realpathSync(packagePath));
  const installed = new Map(
    [...Object.keys(originalFileHashes), "lib/depth.js"].map((file) => [
      file,
      readFileSync(resolve(actualDirectory, file), "utf8"),
    ]),
  );
  const patchText = patchContents.toString("utf8");
  assert.doesNotThrow(() =>
    verifyInstalledPatch(patchText, (file) => installed.get(file)),
  );
  for (const file of installed.keys()) {
    assert.throws(() =>
      verifyInstalledPatch(
        patchText,
        (name) =>
          installed.get(name) +
          (name === file ? "// unexpected installed change\n" : ""),
      ),
    );
  }
  const stalePatch = patchText.replace(
    "+const MAX_DEPTH = 100;",
    "+const MAX_DEPTH = 99;",
  );
  assert.notEqual(stalePatch, patchText);
  assert.throws(() =>
    verifyInstalledPatch(stalePatch, (file) => installed.get(file)),
  );
  assert.throws(() =>
    verifyInstalledPatch(patchText, (file) =>
      installed.get(file).replace("  validateAst(ast);\n", ""),
    ),
  );
  assert.throws(() =>
    verifyInstalledPatch(
      patchText.split("diff --git a/lib/stringify.js")[0],
      (file) => installed.get(file),
    ),
  );
});

test("reachable transitive Braces dependencies resolve to the verified installed copy", () => {
  const chains = [
    [
      "eslint-config-next",
      "@next/eslint-plugin-next",
      "fast-glob",
      "micromatch",
    ],
    [
      "eslint-config-next",
      "eslint-import-resolver-typescript",
      "globby",
      "fast-glob",
      "micromatch",
    ],
    [
      "eslint-config-next",
      "eslint-plugin-import",
      "eslint-module-utils",
      "eslint-import-resolver-typescript",
      "globby",
      "fast-glob",
      "micromatch",
    ],
  ];
  for (const chain of chains) {
    let loader = require;
    for (const dependency of chain) {
      let entry;
      try {
        entry = loader.resolve(`${dependency}/package.json`);
      } catch (error) {
        if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
        entry = loader.resolve(dependency);
      }
      loader = createRequire(entry);
    }
    assert.equal(
      realpathSync(loader.resolve("braces")),
      realpathSync(packagePath),
      `Unverified Braces copy reachable through ${chain.join(" > ")}`,
    );
  }
});

test("audit configuration cannot globally suppress unrejected advisories", () => {
  assert.deepEqual(workspace.auditConfig, {
    ignoreGhsas: ["GHSA-hp3w-g68c-fv3c"],
  });
});

function auditFixture(advisories = {}) {
  const vulnerabilities = {
    info: 0,
    low: 0,
    moderate: 1,
    high: 0,
    critical: 0,
  };
  for (const advisory of Object.values(advisories)) {
    if (Object.hasOwn(vulnerabilities, advisory.severity))
      vulnerabilities[advisory.severity] += 1;
  }
  return {
    advisories,
    metadata: { vulnerabilities },
  };
}
function bracesFinding(version = "3.0.3") {
  return {
    module_name: "braces",
    severity: "high",
    github_advisory_id: patchedBracesAdvisory,
    findings: [
      { version, paths: [".>eslint-config-next>fast-glob>micromatch>braces"] },
    ],
  };
}

test("audit evaluator permits only the verified Braces finding, including stale rejected counts", () => {
  const report = auditFixture({ 1240992: bracesFinding() });
  assert.deepEqual(evaluateAuditReport(report, { bracesPatchVerified: true }), {
    patchedAdvisories: 1,
    advisories: 1,
  });
  assert.throws(() => evaluateAuditReport(report), /verified local/);
  assert.deepEqual(evaluateAuditReport(auditFixture()), {
    patchedAdvisories: 0,
    advisories: 0,
  });
});

test("audit evaluator rejects new advisories and unpatched Braces versions", () => {
  assert.throws(
    () =>
      evaluateAuditReport(auditFixture({ 1: bracesFinding("2.3.2") }), {
        bracesPatchVerified: true,
      }),
    /verified local/,
  );
  const newAdvisory = {
    ...bracesFinding(),
    module_name: "another-package",
    github_advisory_id: "GHSA-abcd-1234-efgh",
  };
  assert.throws(
    () =>
      evaluateAuditReport(
        auditFixture({ 1: bracesFinding(), 2: newAdvisory }),
        { bracesPatchVerified: true },
      ),
    /Unpatched dependency advisory/,
  );
  assert.throws(
    () =>
      evaluateAuditReport(
        auditFixture({
          1: { ...bracesFinding(), module_name: "wrong-package" },
        }),
        { bracesPatchVerified: true },
      ),
    /verified local/,
  );
});

test("audit evaluator rejects unexplained counts and contradictory missing findings", () => {
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    const report = auditFixture();
    report.metadata.vulnerabilities[severity] += 1;
    assert.throws(
      () => evaluateAuditReport(report, { bracesPatchVerified: true }),
      /Unexplained/,
    );
  }
  const report = auditFixture({ 1: bracesFinding() });
  report.metadata.vulnerabilities.high = 0;
  assert.throws(
    () => evaluateAuditReport(report, { bracesPatchVerified: true }),
    /Unexplained/,
  );
  report.metadata.vulnerabilities.high = 2;
  assert.throws(
    () => evaluateAuditReport(report, { bracesPatchVerified: true }),
    /Unexplained/,
  );
});

test("audit evaluator rejects network errors, missing findings and unknown report schemas", () => {
  for (const report of [
    undefined,
    {},
    { error: { message: "network timeout" } },
    { ...auditFixture(), errors: ["network timeout"] },
    { vulnerabilities: {}, metadata: auditFixture().metadata },
    { ...auditFixture(), unknownReportVersion: 2 },
    { ...auditFixture(), metadata: {} },
    {
      ...auditFixture(),
      metadata: {
        vulnerabilities: {
          ...auditFixture().metadata.vulnerabilities,
          unknown: 1,
        },
      },
    },
    auditFixture({ 1: { ...bracesFinding(), findings: [] } }),
    auditFixture({
      1: { ...bracesFinding(), findings: [{ version: "3.0.3" }] },
    }),
    auditFixture({ 1: { ...bracesFinding(), severity: "unknown" } }),
  ]) {
    assert.throws(() =>
      evaluateAuditReport(report, { bracesPatchVerified: true }),
    );
  }
});

test("audit process evaluator fails closed on process errors and invalid JSON", () => {
  const report = JSON.stringify(auditFixture({ 1: bracesFinding() }));
  assert.deepEqual(
    evaluateAuditProcess(
      { status: 1, stdout: report },
      { bracesPatchVerified: true },
    ),
    { patchedAdvisories: 1, advisories: 1 },
  );
  for (const result of [
    undefined,
    { status: 2, stdout: report },
    { status: 1, stdout: "" },
    { status: 0, stdout: "not JSON" },
    { status: 0, stdout: "{}" },
    { status: 1, stdout: report, error: new Error("network") },
    { status: null, stdout: report, signal: "SIGTERM" },
  ]) {
    assert.throws(() =>
      evaluateAuditProcess(result, { bracesPatchVerified: true }),
    );
  }
});

const nestedPattern = (open, close, depth) =>
  open.repeat(depth) + "x" + close.repeat(depth);
const assertDepthRejected = (operation) =>
  assert.throws(operation, (error) => {
    assert.ok(
      error instanceof SyntaxError,
      `Expected controlled SyntaxError, received ${error.name}`,
    );
    assert.equal(error.code, "ERR_BRACES_MAX_DEPTH");
    assert.match(error.message, /100/);
    return true;
  });
const assertCycleRejected = (operation) =>
  assert.throws(operation, (error) => {
    assert.ok(
      error instanceof SyntaxError,
      `Expected controlled SyntaxError, received ${error.name}`,
    );
    assert.equal(error.code, "ERR_BRACES_INVALID_AST");
    return true;
  });

function assertStackSafe(method, pattern) {
  // A fresh process with a smaller stack makes the original overflow
  // reproducible independently of V8's warm-up and optimization decisions.
  const source = `
    const braces = require(process.argv[1]);
    try {
      braces[process.argv[2]](process.argv[3]);
      throw new Error('Expected a depth rejection');
    } catch (error) {
      if (!(error instanceof SyntaxError) || error.code !== 'ERR_BRACES_MAX_DEPTH') {
        throw error;
      }
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--stack_size=512", "-e", source, packagePath, method, pattern],
    {
      encoding: "utf8",
      timeout: 2000,
    },
  );
  assert.equal(result.error, undefined, "Deep patterns must reject promptly");
  assert.equal(
    result.status,
    0,
    result.stderr || "Expected controlled SyntaxError",
  );
}

function nestedAst(depth) {
  const root = { type: "root", nodes: [] };
  let parent = root;
  for (let index = 0; index < depth; index += 1) {
    const node = {
      type: "paren",
      parent,
      nodes: [{ type: "text", value: "(" }],
    };
    parent.nodes.push(node);
    parent = node;
  }
  parent.nodes.push({ type: "text", value: "x" });
  for (let node = parent; node !== root; node = node.parent) {
    node.nodes.push({ type: "text", value: ")" });
  }
  return root;
}

for (const method of ["compile", "expand", "stringify"]) {
  for (const [name, open, close] of [
    ["braces", "{", "}"],
    ["parentheses", "(", ")"],
  ]) {
    test(`${method}: deeply nested ${name} reject before exhausting the stack`, () => {
      assertStackSafe(method, nestedPattern(open, close, 4999));
    });
    test(`${method}: ${name} accept depth 100 and reject depth 101`, () => {
      assert.doesNotThrow(() =>
        braces[method](nestedPattern(open, close, maximumDepth)),
      );
      assertDepthRejected(() =>
        braces[method](nestedPattern(open, close, maximumDepth + 1)),
      );
    });
  }
  test(`${method}: mixed braces and parentheses share the depth limit`, () => {
    assert.doesNotThrow(() =>
      braces[method](nestedPattern("{(", ")}", maximumDepth / 2)),
    );
    assertDepthRejected(() =>
      braces[method]("(" + nestedPattern("{(", ")}", maximumDepth / 2) + ")"),
    );
  });
  test(`${method}: caller-supplied deep AST receives the same depth guard`, () => {
    assertDepthRejected(() => braces[method](nestedAst(6000)));
    assertDepthRejected(() => braces[method](nestedAst(maximumDepth + 1)));
    assert.doesNotThrow(() => braces[method](nestedAst(maximumDepth)));
    assert.deepEqual(
      braces[method](nestedAst(2)),
      method === "expand" ? ["((x))"] : "((x))",
    );
  });
  test(`${method}: cyclic child AST is rejected without recursion`, () => {
    const root = { type: "root", nodes: [] };
    root.nodes.push(root);
    assertCycleRejected(() => braces[method](root));
  });
}

test("parse: excessive and unclosed nesting receives the depth guard", () => {
  assertDepthRejected(() => braces.parse(nestedPattern("{", "}", 4999)));
  assertDepthRejected(() => braces.parse("(".repeat(maximumDepth + 1)));
  assertDepthRejected(() => braces.parse("{".repeat(maximumDepth + 1)));
});

test("main entry points cannot bypass the depth limit", () => {
  const pattern = nestedPattern("{", "}", maximumDepth + 1);
  assertDepthRejected(() => braces(pattern));
  assertDepthRejected(() => braces([pattern]));
  assertDepthRejected(() => braces.create(pattern));
  assertDepthRejected(() => braces(pattern, { expand: true }));
  assertDepthRejected(() =>
    braces.compile(pattern, { maxDepth: Infinity, maxLength: Infinity }),
  );
});

test("expand: external parent cycle cannot hang the parent traversal", () => {
  const source = `
    const braces = require(process.argv[1]);
    const parent = { type: 'paren', nodes: [] };
    parent.parent = parent;
    const root = { type: 'root', nodes: [{ type: 'paren', parent, nodes: [] }] };
    try {
      braces.expand(root);
      process.exitCode = 1;
    } catch (error) {
      if (!(error instanceof SyntaxError) || error.code !== 'ERR_BRACES_INVALID_AST') {
        throw error;
      }
    }
  `;
  const result = spawnSync(process.execPath, ["-e", source, packagePath], {
    encoding: "utf8",
    timeout: 2000,
  });
  assert.equal(
    result.error,
    undefined,
    "Parent cycles must reject promptly instead of hanging",
  );
  assert.equal(
    result.status,
    0,
    result.stderr || "Expected controlled SyntaxError",
  );
});

test("ordinary alternatives, ranges, escapes and quotes preserve existing results", () => {
  const examples = [
    ["a/{b,c}/d", "a/(b|c)/d", ["a/b/d", "a/c/d"], "a/{b,c}/d"],
    ["{01..03}", "(0[1-3])", ["01", "02", "03"], "{01..03}"],
    ["{a..c}", "([a-c])", ["a", "b", "c"], "{a..c}"],
    ["{a,{b,c}}", "(a|(b|c))", ["a", "b", "c"], "{a,{b,c}}"],
    ["\\{a,b\\}", "{a,b}", ["{a,b}"], "{a,b}"],
    ['"{a,b}"', "{a,b}", ["{a,b}"], "{a,b}"],
    ["[{}]", "[{}]", ["[{}]"], "[{}]"],
    ["${a,b}", "${a,b}", ["${a,b}"], "${a,b}"],
    ["{a,b", "{a,b", ["{a,b"], "{a,b"],
  ];
  for (const [pattern, compiled, expanded, stringified] of examples) {
    assert.equal(braces.compile(pattern), compiled, `compile ${pattern}`);
    assert.deepEqual(braces.expand(pattern), expanded, `expand ${pattern}`);
    assert.equal(
      braces.stringify(pattern),
      stringified,
      `stringify ${pattern}`,
    );
  }
  assert.deepEqual(braces.expand("x{1..3..2}"), ["x1", "x3"]);
  assert.equal(braces.stringify('"{a,b}"', { keepQuotes: true }), '"{a,b}"');
  assert.equal(
    braces.stringify("\\{a,b\\}", { keepEscaping: true }),
    "\\{a,b\\}",
  );
  assert.deepEqual(
    braces(["{a,b}", "{b,c}"], { expand: true, nodupes: true }),
    ["a", "b", "c"],
  );
  assert.equal(braces.compile("{x}", { escapeInvalid: true }), "\\{x\\}");
  assert.equal(braces.stringify("{x}", { escapeInvalid: true }), "{x}");
  assert.equal(braces.stringify("{a,b", { escapeInvalid: true }), "{a,b");
  assert.throws(() => braces.expand("{1..1001}"), RangeError);
});

test("shared child nodes in a noncyclic AST remain supported", () => {
  for (const method of ["compile", "expand", "stringify"]) {
    const shared = { type: "text", value: "x" };
    const root = { type: "root", nodes: [shared, shared] };
    assert.deepEqual(braces[method](root), method === "expand" ? ["xx"] : "xx");
  }
});

test("quoted, escaped and square-bracket contents are not counted as AST nesting", () => {
  const literal = nestedPattern("{", "}", maximumDepth + 1);
  assert.equal(braces.stringify('"' + literal + '"'), literal);
  assert.equal(braces.stringify("[" + literal + "]"), "[" + literal + "]");
  const escaped =
    "\\{".repeat(maximumDepth + 1) + "x" + "\\}".repeat(maximumDepth + 1);
  assert.equal(braces.stringify(escaped), literal);
});
