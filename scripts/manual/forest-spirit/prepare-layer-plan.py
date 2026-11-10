"""Write a v2 production plan and metadata; does not create layers or PSD files."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
PRODUCTION = ROOT / "doc/design/forest-spirit/production"
MASTER = PRODUCTION / "master/forest-spirit-approved-v2.png"
APPROVED_MASTER_SHA256 = "58204e57ce352964d33cbb3078872092a5ccb47ecb962cf575929fc880107c7a"


def main() -> None:
    master_sha256 = hashlib.sha256(MASTER.read_bytes()).hexdigest()
    if master_sha256 != APPROVED_MASTER_SHA256:
        raise ValueError("Master differs from the user-approved v2 image; this script cannot approve replacement artwork.")
    original = json.loads((PRODUCTION.parent / "handoff-v1/specs/layers.manifest.json").read_text(encoding="utf-8"))
    with Image.open(MASTER) as image:
        size, mode = list(image.size), image.mode
        alpha = list(image.getchannel("A").getextrema())
    metadata = {
        "file": "master/forest-spirit-approved-v2.png", "sha256": master_sha256,
        "bytes": MASTER.stat().st_size, "size": size, "mode": mode, "alpha_extrema": alpha,
        "status": "user_approved_flat_transparent_master", "approved_on": "2026-11-05",
        "approval_scope": "User approved v2 appearance and instructed preparation for layer separation.",
        "production_layers_exist": False, "psd_exists": False, "cubism_model_exists": False,
        "source": "output/forest-spirit-art/candidates/forest-spirit-cross-eyes-v2.png",
        "generation_record": "generation.txt",
        "generation_method": "built-in image_gen; transparent_background=true; this image was approved after generation",
        "limitations": "A generated flat image, not pixel-identical to the earlier board. Approval does not create hidden pixels, editable parts or a Cubism rig.",
    }
    (PRODUCTION / "master/metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    rules = {
        "Hair_Back": "完整独立发束；补齐新圆顶帽下发根、耳后和颈后遮挡；发饰与发辫分开；边缘不得带背景色。",
        "Legs_Boots": "保留批准母图棕靴、木扣和罗纹袜；补齐裙后腿袜及靴口下连接，鞋体不随软裙大幅变形。",
        "Body_Garment": "按 v2 短披肩、合身橄榄绿上身、花瓣裙片拆层；补齐相邻衣片、袖子、围巾与工具袋遮挡部分，内外叠层留连续织纹。",
        "Arms_Hands": "依 v2 可见手袖重建完整上臂、前臂和布偶手，补袖内与腋下；抬手时不能露洞或生成新指节。",
        "Scarf": "围巾结和飘带独立；补齐被头发和帽遮挡的围绕颈部结构，保留格纹与缝线连续性。",
        "Face": "按批准脸型描取独立部件；无睫毛无眼线；原眉毛保留，十字只在棕眼内；禁止同时烘焙到脸底。",
        "Hair_Front": "每一前发/侧发束独立透明；补额头与帽下隐藏段，原浅金色和分缕方向不变。",
        "Hat": "使用已批准低圆顶、短波浪檐帽；按帽内衬/圆顶/前后帽檐/花叶果/带/铃拆层，补发下帽内侧，不保留尖帽顶。",
        "Pouch": "保持观者右侧；补完整肩带、袋后衣服、工具隐藏端；袋前遮住纸卷剪刀下端，剪刀和纸卷保持刚性。",
        "Props_Optional": "P2 非首批必须；只有制作道具动作时才另交完整独立部件，不从当前母图假装提取。",
    }
    renamed = {"Hat_Crown": ("Hat_Dome", "低圆顶帽冠"), "Skirt_OlivePanel": ("Bodice_Olive", "橄榄绿合身上身")}
    overrides = {
        "Face_Base": "完整无五官脸底，补眼、十字、眉、鼻、嘴和头发遮挡处的连续织纹；不得残留任何五官像素。",
        "Eye_L_Open": "仅左棕色绣眼椭圆，无十字、睫毛、眼线和眼白；独立于脸底与闭眼弧。",
        "Eye_R_Open": "仅右棕色绣眼椭圆，无十字、睫毛、眼线和眼白；独立于脸底与闭眼弧。",
        "Eye_L_Closed": "新绘左闭眼单弧，无外翘短线或十字；全闭状态完全替换左开眼。",
        "Eye_R_Closed": "新绘右闭眼单弧，无外翘短线或十字；全闭状态完全替换右开眼。",
        "Hat_Dome": "完整低圆顶软帽，包括前檐和花叶遮住的帽冠；取消尖顶，不以旧 Hat_Tip 代替。",
        "Hat_Brim_Front": "完整短波浪前帽檐与植物刺绣，补花叶、发丝和抬手可能遮住的部分。",
        "Hat_Brim_Back": "完整短波浪后帽檐，补头发与圆顶遮挡处及内外缘连接。",
        "Bodice_Olive": "完整橄榄绿上身，补披肩、围巾、肩带与工具袋遮挡处，不与裙花瓣或腰片合并。",
        "Cape_L": "左半短圆润波浪披肩；补全袖子和发辫遮挡，保留花枝刺绣，不恢复旧长尖披肩。",
        "Cape_R": "右半短圆润波浪披肩；补全肩带和工具袋遮挡，不恢复旧长尖披肩。",
        "Cape_Back": "短披肩后部，补全颈发后轮廓；摆动不得拉成长披风。",
        "Skirt_Base": "连续乳白内裙底，覆盖全部花瓣及红格插片背后的区域并补到腰部。",
        "Skirt_RedPanel": "独立中央锈红格纹插片，补乳白花瓣覆盖的两侧与腰部。",
        "Lace_Hem": "连续蕾丝内裙边，补完整花瓣覆盖部分；细孔保留 alpha。",
    }
    layers = []
    for item in original["layers"]:
        if item["id"] == "Hat_Tip":
            continue
        item = dict(item)
        if item["id"] in renamed:
            item["id"], item["label"] = renamed[item["id"]]
        item["status"] = "missing_production_art"
        item["source"] = "approved_v2_flat_master_requires_separation_and_repaint"
        item["delivery_file"] = f"layers/{item['id']}.png"
        item["pixel_delivery"] = overrides.get(item["id"], item["notes"]) + " " + rules.get(item["group"], "独立可编辑透明部件，不可用矩形裁图代替。")
        item["notes"] = item["pixel_delivery"]
        if item["group"] == "Hat":
            item["group_label"] = "已批准低圆顶短波浪檐帽"
        layers.append(item)
    for side in ("L", "R"):
        layers.append({"id": f"Eye_{side}_Cross", "group": "Face", "label": f"{side}眼内浅色十字",
                       "phase": "P0", "pixel_delivery": "仅批准母图的两笔+形浅色绣线，完全在棕眼内，透明外部；不烘焙进开眼或脸底。与对应开眼共用形变和裁切；闭眼完全消隐，不能变成睫毛。"})
    for garment, label in (("Peplum", "橄榄绿短腰片"), ("Skirt_Petal", "乳白绣花裙瓣")):
        for side in ("L", "Center", "R"):
            layers.append({"id": f"{garment}_{side}", "group": "Body_Garment", "label": f"{label}{side}",
                           "phase": "P0", "pixel_delivery": "按批准母图实际边界交付完整独立衣片，补齐相邻衣片、披肩和袋子遮挡部分；保留连续织纹刺绣；相邻衣片重叠范围需支持轻微摆动不露洞，拆层说明标注覆盖关系。"})
    for item in layers:
        item.setdefault("status", "missing_production_art")
        item.setdefault("source", "approved_v2_flat_master_requires_separation_and_repaint")
        item.setdefault("delivery_file", f"layers/{item['id']}.png")
    plan = {
        "status": "approved_master_separation_plan_only_no_layer_pixels_created",
        "source_master": metadata["file"], "source_sha256": metadata["sha256"],
        "layer_count": len(layers), "p0_count": sum(item["phase"] == "P0" for item in layers),
        "p2_count": sum(item["phase"] == "P2" for item in layers),
        "working_canvas": size, "canvas_note": "Keep all parts aligned on this actual approved canvas. Upscaling is not new detail; a higher-resolution redraw requires its own recorded review.",
        "format": "RGBA PNG part files + RGB/8bit sRGB editable separation PSD and Cubism import PSD",
        "coordinate_convention": "All PNGs use identical full canvas and origin (0,0); L/R is anatomical, not viewer side. Do not globally mirror.",
        "draw_order": "Per-part placement and occlusion must be documented during separation. Group order is not final Cubism draw order.",
        "removed_original_layers": ["Hat_Tip"], "renamed_original_layers": renamed,
        "parameter_changes": "Do not wire old ParamFSHatTipSway to a non-existent pointed hat. Use a new mild dome/brim deformation after actual rigging; keep cross opacity tied to each eye-open parameter.",
        "acceptance": ["Composite of neutral layers matches the approved master except documented hidden-pixel repaint.", "No duplicate eye/cross/brow pixels in Face_Base.", "Fully closed eyes contain only clean arcs; no cross or lashes.", "Hat, sleeve, petal-skirt and pouch overlaps remain filled in planned P0 poses.", "Fine edges checked over white, pale green and dark green."],
        "layers": layers,
    }
    (PRODUCTION / "layers-v2.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"master": metadata, "layer_count": len(layers), "p0_count": plan["p0_count"], "p2_count": plan["p2_count"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
