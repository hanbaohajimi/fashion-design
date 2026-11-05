import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Side-by-side evidence only. Keep original frame timing; never imply time-synchronized gestures.
const [sourceArg, captureArg, targetArg, fixtureDescription] = process.argv.slice(2);
if (!sourceArg || !captureArg) throw new Error("用法：node scripts/manual/compare-wardrobe-video.mjs <参考视频> <浏览器录屏> [输出mp4] [素材说明]");
const source = resolve(sourceArg);
const capture = resolve(captureArg);
if (!existsSync(source) || !existsSync(capture)) throw new Error("参考视频或浏览器录屏不存在");
const target = targetArg ? resolve(targetArg) : resolve(import.meta.dirname, "../../output/wardrobe-tryon/browser/video-comparison.mp4");
mkdirSync(dirname(target), { recursive: true });
const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-i", capture,
  "-filter_complex", "[0:v]scale=960:720:force_original_aspect_ratio=decrease,pad=960:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=30[left];[1:v]scale=960:720:force_original_aspect_ratio=decrease,pad=960:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=30[right];[left][right]hstack=inputs=2[out]",
  "-map", "[out]", "-an", "-t", "25", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", target], { stdio: "inherit", windowsHide: true });
if (result.status !== 0) throw new Error("视频并排生成失败，请确认本机 ffmpeg 可用");
writeFileSync(target.replace(/\.mp4$/u, ".json"), JSON.stringify({ left: source, right: capture, timing: "original speed, independent gestures; short clip holds final frame", fixture: fixtureDescription ?? "Right side uses labeled geometric test garments, not real model output", supplierRequests: 0 }, null, 2) + "\n", "utf8");
console.log(target);
