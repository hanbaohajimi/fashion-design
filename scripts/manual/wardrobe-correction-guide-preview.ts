import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { createCorrectionSelectionGuide } from "../../apps/api/src/modules/wardrobe/wardrobe-media";

async function main() {
  const args = process.argv.slice(2);
  const required = (key: string) => {
    const index = args.indexOf(`--${key}`);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (!value) throw new Error(`缺少--${key}`);
    return resolve(value);
  };
  const sourceFile = required("source");
  const maskFile = required("mask");
  const outputFile = required("out");
  const outputRelative = relative(resolve("output"), outputFile);
  if (isAbsolute(outputRelative) || outputRelative.startsWith(".."))
    throw new Error("预览必须写入output目录");
  const source = readFileSync(sourceFile);
  const mask = readFileSync(maskFile);
  const guide = await createCorrectionSelectionGuide(source, mask);
  const sha = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  if (
    existsSync(outputFile) &&
    sha(readFileSync(outputFile)) !== sha(guide.bytes)
  )
    throw new Error("已有不同guide预览，不覆盖，请使用新输出路径");
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, guide.bytes);
  const evidence = {
    isRegisteredAsset: false,
    providerCalls: 0,
    sourceFile,
    maskFile,
    file: outputFile,
    sourceSha256: sha(source),
    maskSha256: sha(mask),
    guideSha256: sha(guide.bytes),
    algorithm: guide.algorithm,
    opacity: guide.opacity,
    color: guide.color,
    stats: guide.stats,
  };
  writeFileSync(`${outputFile}.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "guide preview failed",
  );
  process.exitCode = 1;
});
