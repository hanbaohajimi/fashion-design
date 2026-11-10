"""Build a local evidence viewer; it never grants model or visual approval."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
from urllib.parse import quote


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quality-report", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--playback-report", type=Path, required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--note", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise FileExistsError(f"Preserve previous review: {output}")
    report_path = args.quality_report.resolve(strict=True)
    report = json.loads(report_path.read_text(encoding="utf-8-sig"))
    video = args.video.resolve(strict=True)
    playback = args.playback_report.resolve(strict=True)
    json.loads(playback.read_text(encoding="utf-8-sig"))
    inputs = [report_path, video, playback]
    pictures = []
    for key in ("reference", "candidate"):
        item = report[key]
        path = Path(item["snapshot"]["frozenPath"]).resolve(strict=True)
        if sha(path) != item["sha256"]:
            raise ValueError(f"Frozen image hash mismatch: {key}")
        if (item["width"], item["height"]) != (971, 1620):
            raise ValueError("Only the locked v8 canvas is supported")
        pictures.append(path)
        inputs.append(path)
    artifacts = {}
    for item in report["artifacts"]:
        path = (report_path.parent / item["path"]).resolve(strict=True)
        if path.name in ("fixed-rois.png", "fixed-material-rois.png", "alpha-error.png", "delta-e00.png") or path.name.startswith("ssim-loss-"):
            if sha(path) != item["sha256"]:
                raise ValueError(f"Evidence hash mismatch: {path}")
            artifacts[path.name] = path
            inputs.append(path)

    def link(path: Path) -> str:
        return html.escape(quote(Path(os.path.relpath(path, output.parent)).as_posix(), safe="/"), quote=True)

    def esc(value: object) -> str:
        return html.escape(str(value), quote=True)

    backgrounds = report["metrics"]["ssim"]["backgrounds"]
    names = list(next(iter(backgrounds.values()))["regions"])
    rows = []
    for region in [None, *names]:
        values = [background["global"] if region is None else background["regions"][region] for background in backgrounds.values()]
        scores = "".join(f"<td>{item['score']:.6f}</td>" for item in values)
        rows.append(f"<tr><th>{esc(region or '整体')}</th>{scores}<td>{'通过' if all(item['passed'] for item in values) else '未通过'}</td></tr>")
    headers = "".join(f"<th>{esc(name)}</th>" for name in backgrounds)
    artifact_links = " · ".join(f'<a href="{link(path)}">{esc(name)}</a>' for name, path in artifacts.items())
    hashes = "".join(f"<tr><td>{esc(path.name)}</td><td><code>{sha(path)}</code></td></tr>" for path in dict.fromkeys(inputs))
    data = {
        "schemaVersion": 1,
        "stage": args.stage,
        "scope": "evidence-viewer-only",
        "productionApproval": False,
        "visualAcceptance": False,
        "note": args.note,
        "inputs": [{"path": str(path), "sha256": sha(path)} for path in dict.fromkeys(inputs)],
    }
    document = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>森林布偶 v8 · 阶段证据审阅</title><style>
:root{font:16px/1.6 system-ui,sans-serif;color:#24382b;background:#f8f7f2}body{max-width:1100px;margin:auto;padding:28px}h1{font-size:26px;margin:0 0 12px}h2{font-size:20px;margin-top:36px}.status{padding:16px;border:1px solid #ab7159;background:#fff6ef;color:#683c29}.controls{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0}select{font:inherit;padding:5px}a{color:#245841}figure{margin:0}figcaption{font-weight:600;padding:8px 0}.compare{display:flex;gap:20px;align-items:flex-start;overflow:auto;padding-bottom:12px}.image{display:block;width:auto;height:540px;max-width:none;background:#fff}.video{width:100%;max-height:680px;background:#183522}table{border-collapse:collapse;font-size:14px;width:100%;margin:12px 0}th,td{border-bottom:1px solid #d5dbd2;text-align:left;padding:8px}td code{word-break:break-all;font-size:12px}.scroll{overflow:auto}.note{color:#59675b;font-size:14px}button{font:inherit} @media(max-width:600px){body{padding:16px}.compare{gap:10px}.image{height:280px}h1{font-size:22px}}
</style><main>
<h1>森林布偶 v8 · __STAGE__</h1>
<p class="status"><strong>阶段审阅，尚未完成最终验收。</strong><br>__NOTE__</p>
<h2>冻结母图与真实模型中性渲染</h2>
<p class="note">两图采用相同画布与显示比例。下列控制仅改变审阅尺寸及背景，不移动、配准、调色或重新评分。SSIM 达标不等于人眼认可 95% 相似。</p>
<div class="controls"><label>背景 <select id="background"><option value="#ffffff">白</option><option value="#e0ead8">浅绿</option><option value="#1a3525">深绿</option></select></label><label>显示高度 <select id="size"><option>160</option><option>220</option><option>280</option><option selected>540</option><option>1620</option></select> CSS px</label></div>
<div class="compare"><figure><figcaption>v8 冻结母图</figcaption><img class="image" src="__REFERENCE__" alt="v8冻结母图" width="971" height="1620"></figure><figure><figcaption>实际 Core 中性渲染</figcaption><img class="image" src="__CANDIDATE__" alt="实际Core中性渲染" width="971" height="1620"></figure></div>
<h2>实际动作录屏</h2><p class="note">真实播放录像；静态参考图没有做人物动画。此视频所属阶段与静态报告的来源分别列在下方，录像本身不自动表示视觉通过。</p>
<video class="video" controls preload="metadata" src="__VIDEO__"></video>
<p><a href="__PLAYBACK__">真实播放检查 JSON</a> · <a href="__QUALITY__">完整固定质量报告</a></p>
<h2>固定区域 SSIM</h2><div class="scroll"><table><thead><tr><th>区域</th>__HEADERS__<th>数值结果</th></tr></thead><tbody>__ROWS__</tbody></table></div>
<p>轮廓、透明度、材质色差及参数详见完整报告。动态接缝、遮颈、手部接触、无睫毛与交互须独立验收，不能用本表分数豁免。</p><p>__ARTIFACTS__</p>
<details><summary>原始输入 SHA-256</summary><table><tbody>__HASHES__</tbody></table></details>
</main><script>
const pictures=[...document.querySelectorAll('.image')];
if(window.matchMedia('(max-width:600px)').matches){document.querySelector('#size').value='280';}
document.querySelector('#background').addEventListener('change',e=>pictures.forEach(i=>{i.style.background=e.target.value;}));
document.querySelector('#size').addEventListener('change',e=>pictures.forEach(i=>{i.style.height=e.target.value+'px';}));
</script></html>"""
    replacements = {
        "__STAGE__": esc(args.stage), "__NOTE__": esc(args.note),
        "__REFERENCE__": link(pictures[0]), "__CANDIDATE__": link(pictures[1]),
        "__VIDEO__": link(video), "__PLAYBACK__": link(playback),
        "__QUALITY__": link(report_path), "__HEADERS__": headers,
        "__ROWS__": "".join(rows), "__ARTIFACTS__": artifact_links, "__HASHES__": hashes,
    }
    for token, value in replacements.items():
        document = document.replace(token, value)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
    output.with_suffix(".inputs.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"page": str(output), "sha256": sha(output), "inputCount": len(data["inputs"]), "productionApproval": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
