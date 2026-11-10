"""Freeze a self-contained 72-layer WIP raster input; never declare model ready."""
from __future__ import annotations
import argparse,hashlib,json,shutil
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[3]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--metadata",default="output/forest-spirit-production-v2/front-v8/fullbody/pouch-study/p4/metadata.json");ap.add_argument("--revision",default="b9");args=ap.parse_args()
    mp=ROOT/args.metadata;d=json.loads(mp.read_text(encoding="utf-8"));out=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/revisions"/args.revision
    assert not out.exists(),"Do not overwrite frozen revisions"
    for s in ("layers","source-visible","evidence","qa"):(out/s).mkdir(parents=True)
    def resolve(p):return p if p.is_absolute() else mp.parent/p
    provenance=[];seen_groups=[];last=None
    for layer in sorted(d["layers"],key=lambda p:p["order"]):
        if layer["group"]!=last:
            assert layer["group"] not in seen_groups,"PSD groups must be contiguous"
            seen_groups.append(layer["group"]);last=layer["group"]
        src=resolve(Path(layer["path"]));dst=out/"layers"/f"{layer['id']}.png";before=sha(src);shutil.copyfile(src,dst)
        assert before==sha(src)==sha(dst)
        with Image.open(dst) as im:
            assert im.mode=="RGBA" and im.size==(971,1620) and im.getchannel("A").getbbox()
            active=int(np.count_nonzero(np.asarray(im.getchannel("A"))))
        layer["path"]=dst.relative_to(out).as_posix();layer["sha256"]=before;layer["rgbaNonemptyPixels"]=active
        provenance.append({"id":layer["id"],"frozenPath":layer["path"],"originalPath":str(src),"sha256":before,"nonzeroAlphaPixels":active})
        if layer.get("sourceVisible"):
            s=resolve(Path(layer["sourceVisible"]))
            if s.exists():
                q=out/"source-visible"/f"{layer['id']}.png";shutil.copyfile(s,q);layer["sourceVisible"]=q.relative_to(out).as_posix();layer["sourceVisiblePath"]=layer["sourceVisible"]
        for key in ("sourceMask","uncompletedOcclusionMask","alphaCleanupMask","hiddenBlendMask"):
            if layer.get(key):
                s=resolve(Path(layer[key]))
                if s.exists():
                    q=out/"evidence"/f"{layer['id']}-{key}{s.suffix}";shutil.copyfile(s,q);layer[key]=q.relative_to(out).as_posix()
        if layer.get("patchMasks"):
            masks=[]
            for i,p in enumerate(layer["patchMasks"]):
                s=resolve(Path(p))
                if s.exists():
                    q=out/"evidence"/f"{layer['id']}-patch-{i}{s.suffix}";shutil.copyfile(s,q);masks.append(q.relative_to(out).as_posix())
            layer["patchMasks"]=masks
        # Legacy baseline required-area counts are not reevaluated merely by
        # replacing a hidden texture. Preserve them as evidence, not false QC.
        if "uncompletedOcclusionPixels" in layer:layer["baselineUncompletedOcclusionPixels"]=layer.pop("uncompletedOcclusionPixels")
        layer["hiddenCoverageAcceptance"]="pending_actual_native_pose_review"
    assert len(d["layers"])==72 and len({p["id"] for p in d["layers"]})==72 and not any(p.get("temporary") for p in d["layers"])
    d["layers"].sort(key=lambda p:p["order"]);d["status"]="FROZEN_72_LAYER_WIP_NATIVE_BINDING_INPUT_NOT_VISUALLY_ACCEPTED";d["stage"]="production-p0";d["freezeSourceMetadata"]=str(mp);d["freezeSourceSha256"]=sha(mp);d["artProductionAccepted"]=False;d["modelAccepted"]=False
    d.setdefault("revisionChain",["b8 original 52 body parts + r9 face/scarf", "a6 original sleeve ownership, complete right shoulder/elbow + masked local donor, native hidden garment weave", "o3 original cheek pixels to Face_Base, neutral RGBA unchanged", "p4 continuous roll roots, clean strap ownership and correct rolled-lip draw order, neutral RGBA unchanged"])
    if args.revision!="b9":d["revisionChain"].append(f"{args.revision}: independent frozen candidate from {mp.relative_to(ROOT).as_posix()}")
    (out/"fullbody-with-r9.metadata.json").write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding="utf-8")
    (out/"source-provenance.json").write_text(json.dumps({"sourceMetadata":str(mp),"layers":provenance},indent=2),encoding="utf-8")
    shutil.copyfile(mp.parent/"qa/neutral-candidate.png",out/"qa/72-part-neutral-candidate.png")
    shutil.copyfile(mp.parent/"qa/audit.json",out/"qa/material-revision-audit.json")
    # These are original material diagnostics, not screenshots or Cubism frames.
    for p in (mp.parent/"qa").glob("*-source-before-after-200pct.png"):shutil.copyfile(p,out/"qa"/p.name)
    for p in (mp.parent/"qa").glob("*-before-mask-after-300pct.png"):shutil.copyfile(p,out/"qa"/p.name)
    if d.get("localHiddenBoundaryReview"):
        h2=ROOT/"output/forest-spirit-production-v2/front-v8/fullbody/hidden-seams/h2/qa"
        for p in h2.glob("*-before-mask-after-300pct.png"):
            if not (out/"qa"/p.name).exists():shutil.copyfile(p,out/"qa"/p.name)
    summary={"type":"FROZEN_REAL_RASTER_INPUT_NOT_MODEL","layers":72,"groups":seen_groups,"nonempty":True,"temporaryLayers":0,"metadataSha256":sha(out/"fullbody-with-r9.metadata.json"),"neutralSha256":sha(out/"qa/72-part-neutral-candidate.png"),"relativeLayerPaths":True,"productionAccepted":False,"modelAccepted":False}
    (out/"freeze-audit.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    readme="""# b9 — 72 个真实图层，原生绑定研究输入

本目录不是完成的生产模型。72 个 P0 ID 均有非空、971×1620 RGBA 图层，没有临时整图层；PNG 和导入 metadata 已独立冻结。母图、b8、r9 均未覆盖。

## 本轮实际完成

- a6：完整右上臂和肩肘重叠，前臂/手原像素重分配，辫梢 666 个袖布像素归回手臂；局部 imagegen donor 只经指定隐藏/披肩阴影蒙版合并，生成 alpha 未使用。右臂原 source-visible 提取 0 像素改动，最终可见阴影区有 2,220 像素定向修复。固定袖 ROI 三背景 SSIM 最小 0.9583386427。
- o3：Hair_Side_R/L 的 2,171 / 2,190 原脸布像素回到 Face_Base，修正下层刘海隐藏垫边；相对 a6 中性复合 RGBA 0 变化。
- p4：三纸卷主筒均有真实隐藏根部，Roll_B 原大断层补齐。Roll_B 仍带两小组原边缘像素，边缘清洁尚待独立蒙版；不能据此宣称完整视觉通过。纸卷末端袋口棕像素归回袋口；Pouch_Back 实际含正面卷边，因此层序改为工具前、前袋面后，去除原隐藏垫边覆盖。原 strap 上 1,377 个异物衣料像素归回衣料、填连续隐藏皮革，原钮扣投影仍为局部原纹理。相对 a6 中性复合 RGBA 0 变化。
- 所有补画都是独立蒙版内原材质延展或已记录的局部 donor，没有整脸或整个人物重生成。

## 原生绑定范围及未验收项

- 右肩 (341,747)、肘 (276,929)、掌心 (195,1025)，扶帽目标 (182,493)。两段长度 193.26 / 125.61 px，目标距离 299.66 px；无需拉伸。完整几何和两种 IK 解见 `../../arm-study/a6/ik-plan.json`。
- 两刚体光栅肘缝不能作为最终模型判据；原生需要上/下臂共享肘邻域平滑网格、父子变形和袖口遮挡。须独立检查 Idle/Hover/DragHold/PutDown 实际关键帧。
- 纸卷 A/C 隐藏接缝处的纹理/明暗过渡、strap 钮扣下影子、左腰片与裙片揭露形状均待原生姿态局部审核。大面积 Hair_BackMass、Skirt_Base 等完全遮挡部分仍未补齐，不能大幅转头/掀裙。
- 真实 r11 围巾接缝证据要求：x370..690,y726..746 下层衣料至少 5–8 px 连续隐藏重叠；x738..760,y676..723 右发/衣袋交界连续补齐。这些仍是后续覆盖检查，未宣称通过。
- 源图帽沿、工具外沿、袜靴周围红绿 alpha 杂边保留。需独立清洁蒙版，不全局去绿。
- 固定规范的静态数字结果：`../../../quality/fullbody-b9-material-candidate/report.json`，numeric thresholds met，manual review pending，model not evaluated。静态分数不替代材质、隐藏层或动作审核。

PSD 构建应写入明确的 WIP 子目录；不得复制到 public ready 资产路径或把结构校验当作模型验收。
"""
    if args.revision!="b9":
        readme=readme.replace("# b9 —",f"# {args.revision} —")
        readme=readme.replace("- 源图帽沿、工具外沿、袜靴周围红绿 alpha 杂边保留。需独立清洁蒙版，不全局去绿。","- e1 以独立 alpha 蒙版清除 3,008 个源边缘污染坐标；全部图层 RGB 0 改，保护内部区 0 触碰，真实苔绿和浅金发保留。源 master/b9 不变。多数污染原 alpha 仅 1–7，不能把直看 RGBA 的亮度混同真实背景合成效果。左裙边约 x145..225,y1080..1170 的白色破片仍待修，未宣称所有边缘已通过。")
        readme=readme.replace("../../../quality/fullbody-b9-material-candidate/report.json","../../../quality/fullbody-edge-e1/report.json")
        readme+="""\n## 本次新增 h2 / e1 证据

- e1 三个固定验收背景与全部固定 ROI 数字均过：global SSIM 最低 0.9974464863，所有 ROI 最低 0.9928943101，IoU 0.9997257412，foreground-union alpha MAE 0.0081502575，11 材质 DeltaE 中位/p95 都为 0。完整报告见上述路径；原生模型未评。
- h2 将 strap 边缘 476 个原钮扣投影像素移到 Chest_Button，将纸卷 A/C 根部 142 / 258 个原袋口投影像素移到 Pouch_Back，并在露出的隐藏底补连续原材质。保留的原 visible RGBA 0 改；相对 e1 中性复合逐 RGBA 0 改。
- h2 实际看三联图：明显的原投影横缝减轻，A/C 内部织纹相位与轮廓仍非完美，strap 中部仍可辨补画衔接；这些是可继续原生绑定研究的候选，不是人工生产验收通过。纸卷/钮扣需要连同对应投影层保持合理遮挡。
- e1 边缘清洁来源及每簇坐标：`../../edge-cleanup/e1/qa/audit.json`，白/深绿/中性完整背景和局部差异图在同目录。h2 补画来源：`../../hidden-seams/h2/qa/audit.json`，本目录 qa 同时冻结三张 before/mask/after 局部图。
"""
    if "exposedHiddenFillCorrection" in d:
        readme=readme.replace("左裙边约 x145..225,y1080..1170 的白色破片仍待修，未宣称所有边缘已通过。","e2 已修正左裙边白色破片；根因是 a6 隐藏补画误露出原轮廓，原母图没有这个缺陷。")
        readme=readme.replace("../../../quality/fullbody-edge-e1/report.json","../../../quality/fullbody-edge-e2/report.json")
        readme+="""\n## 本次 e2 显露填边纠正

- Skirt_Petal_Side_R 删除 352 个不属于原 source-visible 且在母图实心轮廓外的隐藏填边像素，范围 [141,1023,258,1182)。原可见 RGBA 和全部图层 RGB 均未修改，修复蒙版独立保留。
- 中性超出原图透明轮廓的 alpha>16 前景像素由 198 变为 0；source/before/mask/after 四联图在 qa。实际白碎边已消失，原裙瓣和手的抗锯齿轮廓保留。
- 最新固定三背景/ROI 数字报告是 fullbody-edge-e2，全部门槛通过；旧 e1 指标仅记录其阶段证据。该修复不把其余隐藏纹理或原生动作标为通过。
"""
    (out/"README.md").write_text(readme,encoding="utf-8");print(json.dumps(summary,indent=2))

if __name__=="__main__":main()
