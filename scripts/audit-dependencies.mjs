import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const patchedBracesAdvisory = "GHSA-vfj7-8cjw-p6xm";
const severities = ["info", "low", "moderate", "high", "critical"];
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
  throw new Error(message);
};

// This handles pnpm's legacy advisory JSON only. A new/unknown report format
// must be reviewed instead of silently turning an audit failure into success.
export function evaluateAuditReport(
  report,
  { bracesPatchVerified = false } = {},
) {
  if (
    !isRecord(report) ||
    report.error !== undefined ||
    report.errors !== undefined
  ) {
    fail("Dependency audit failed or returned an invalid report");
  }
  const allowedFields = new Set(["advisories", "metadata", "actions", "muted"]);
  if (Object.keys(report).some((key) => !allowedFields.has(key))) {
    fail("Unsupported dependency audit report schema");
  }
  if (
    !isRecord(report.advisories) ||
    !isRecord(report.metadata) ||
    !isRecord(report.metadata.vulnerabilities)
  ) {
    fail("Unsupported dependency audit report schema");
  }
  if (
    Object.keys(report.metadata.vulnerabilities).some(
      (severity) => !severities.includes(severity),
    ) ||
    severities.some(
      (severity) =>
        !Number.isInteger(report.metadata.vulnerabilities[severity]) ||
        report.metadata.vulnerabilities[severity] < 0,
    )
  ) {
    fail("Invalid dependency audit vulnerability counts");
  }
  if (
    (report.actions !== undefined && !Array.isArray(report.actions)) ||
    (report.muted !== undefined && !Array.isArray(report.muted))
  ) {
    fail("Unsupported dependency audit report schema");
  }

  let patchedAdvisories = 0;
  const reviewedCounts = Object.fromEntries(
    severities.map((severity) => [severity, 0]),
  );
  for (const advisory of Object.values(report.advisories)) {
    if (
      !isRecord(advisory) ||
      typeof advisory.module_name !== "string" ||
      !severities.includes(advisory.severity) ||
      typeof advisory.github_advisory_id !== "string" ||
      !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(
        advisory.github_advisory_id,
      ) ||
      !Array.isArray(advisory.findings) ||
      advisory.findings.length === 0
    ) {
      fail("Malformed dependency audit advisory");
    }
    for (const finding of advisory.findings) {
      if (
        !isRecord(finding) ||
        typeof finding.version !== "string" ||
        !Array.isArray(finding.paths) ||
        finding.paths.length === 0 ||
        finding.paths.some(
          (path) => typeof path !== "string" || path.length === 0,
        )
      ) {
        fail("Malformed dependency audit finding");
      }
    }
    if (advisory.github_advisory_id !== patchedBracesAdvisory) {
      fail(
        `Unpatched dependency advisory: ${advisory.github_advisory_id} (${advisory.module_name}, ${advisory.severity})`,
      );
    }
    if (
      !bracesPatchVerified ||
      advisory.module_name !== "braces" ||
      advisory.findings.some((finding) => finding.version !== "3.0.3")
    ) {
      fail("Braces advisory does not match the verified local 3.0.3 patch");
    }
    patchedAdvisories += 1;
    reviewedCounts[advisory.severity] += 1;
  }
  // pnpm retains counts for ignored, CNA-rejected advisories in metadata.
  // Only the single CNA-rejected sprintf-js advisory may remain in moderate
  // metadata without a corresponding advisory object. Missing or contradictory
  // findings at any other severity must fail closed.
  for (const severity of severities) {
    const reported = report.metadata.vulnerabilities[severity];
    const reviewed = reviewedCounts[severity];
    const rejectedAllowance = severity === "moderate" ? 1 : 0;
    if (reported < reviewed || reported > reviewed + rejectedAllowance) {
      fail(`Unexplained dependency audit vulnerability count: ${severity}`);
    }
  }
  return {
    patchedAdvisories,
    advisories: Object.keys(report.advisories).length,
  };
}

export function evaluateAuditProcess(result, options) {
  if (
    !isRecord(result) ||
    result.error ||
    result.signal ||
    ![0, 1].includes(result.status)
  ) {
    fail("Dependency audit process failed; no security exception was applied");
  }
  if (typeof result.stdout !== "string" || result.stdout.trim().length === 0) {
    fail("Dependency audit returned no JSON report");
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail("Dependency audit returned an unreadable JSON report");
  }
  return evaluateAuditReport(report, options);
}

function runAudit(productionOnly) {
  const pnpmPath = process.env.npm_execpath;
  if (!pnpmPath || !existsSync(pnpmPath)) {
    fail(
      "Run this command through pnpm audit:all or pnpm audit:prod (npm_execpath is required)",
    );
  }
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const securityTest = spawnSync(
    process.execPath,
    [resolve(directory, "scripts/verify-dependency-security.mjs")],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (securityTest.stdout) process.stdout.write(securityTest.stdout);
  if (securityTest.error || securityTest.signal || securityTest.status !== 0) {
    if (securityTest.stderr) process.stderr.write(securityTest.stderr);
    fail(
      "Installed dependency security verification failed; audit exception denied",
    );
  }

  const arguments_ = ["audit", "--json", ...(productionOnly ? ["--prod"] : [])];
  const javascriptExecutable = [".js", ".cjs", ".mjs"].includes(
    extname(pnpmPath).toLowerCase(),
  );
  const command = javascriptExecutable ? process.execPath : pnpmPath;
  const argumentsWithRuntime = javascriptExecutable
    ? [pnpmPath, ...arguments_]
    : arguments_;
  // Never pass --ignore: pnpm persists that flag into workspace configuration.
  // No shell is involved, including when pnpm is a native executable on Windows.
  const audit = spawnSync(command, argumentsWithRuntime, {
    cwd: directory,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const evaluation = evaluateAuditProcess(audit, { bracesPatchVerified: true });
  console.log(
    `Dependency audit passed; verified local Braces advisories: ${evaluation.patchedAdvisories}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.slice(2).some((argument) => argument !== "--prod")) {
      fail("Usage: pnpm audit:all or pnpm audit:prod");
    }
    runAudit(process.argv.includes("--prod"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
