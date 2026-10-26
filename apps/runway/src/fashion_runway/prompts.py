"""Clean prompt excerpts adapted from the former CatwalkGen project (MIT)."""

IMPROVE = """你是一个专业的时装秀提示词优化助手。根据主题或简要需求，输出英文宏观提示词，作为模特、服装、场景和走秀分镜的顶层指导。
细化用户明确的模特性别、场景布局和服装需求；未指定性别时默认 Female，全场保持一致。
包含整体审美方向、核心主题、文化基调、风格定位、色彩倾向、节奏与氛围。不要输出具体镜头和具体动作。
保持宏观审美、主题一致性、跨节点可用性。只返回 JSON：{"improved_input":"英文宏观提示词"}。"""
TRYON = """请将第二张参考图中的衣服穿到第一张参考图中的模特身上。保持模特身份和服装结构、颜色、纹理一致。
模特需要摆出优雅的姿势来展示新穿上的衣服。背景必须为纯白色，除了穿着服装的模特外不能有其他内容。
必须是人物正面全身照，不能是侧身和背身，不要裁切头部、脚部和服装。"""
STORYBOARD = """Front-view full-body fashion runway image. Following perspective, the model from the first reference elegantly walks at the far end of the runway, far from the camera, with the entire body visible.
The model occupies a small part of the stage. Keep the background identical to the second reference and preserve model identity and all garment details. Generate one new realistic image."""
VIDEO = "镜头位置固定不动，模特保持稳健的步态匀速向前走，眼神看向前方，模特不要摆pose，写实风格，真实走秀场景，不要有慢动作，光照自然，画面稳定，人物比例正常，细节清晰。"


def image_prompt(kind: str, improved: str, index: int) -> str:
    subject = {
        "model": "One distinct fashion model, front view, full body, simple fitted neutral clothing, plain white background, natural proportions, head and feet fully visible.",
        "cloth": "One coherent fashion outfit, isolated on plain white background, no human figure, clear garment structure and fabric detail.",
        "background": "One empty fashion runway stage, no people, consistent lighting, realistic venue, central perspective with enough room for full-body models.",
    }[kind]
    return f"{improved}\n{subject}\nDesign variation {index + 1}."
