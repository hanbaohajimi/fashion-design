import os
import re
import json
import uuid
import asyncio
import time
import urllib.request
import traceback
from datetime import datetime, timedelta
from http import HTTPStatus
from typing import Optional, AsyncGenerator, Tuple
from collections import defaultdict

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from starlette.datastructures import UploadFile as StarletteUploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from PIL import Image

from dashscope.aigc.image_generation import ImageGeneration
from dashscope import MultiModalConversation
import dashscope
from openai import OpenAI

app = FastAPI(title="AI Fashion Design Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.environ.get("DASHSCOPE_API_KEY", "sk-84a7430369064d0daa73c568b9b19a1d")
dashscope.api_key = API_KEY

client = OpenAI(
    api_key=API_KEY or "unset",
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

OUTPUTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

SKETCH_MODEL = "wan2.6-t2i"
EDIT_MODEL = "qwen-image-edit-max"
LLM_MODEL = "qwen-plus"
VISION_MODEL = "qwen-vl-max"
MAX_HISTORY = 56
MAX_RETRIES = 2
SESSION_TTL_HOURS = 4
MAX_TOOL_ROUNDS = 8
RATE_LIMIT_PER_MINUTE = 12
MAX_UPLOAD_BATCH = 12

sessions: dict = {}
rate_limiter: dict[str, list[float]] = defaultdict(list)

# ─── Negative prompts per tool ───

NEGATIVE_PROMPTS = {
    "text_to_image": "watermark, text overlay, blurry, low quality, deformed anatomy, extra fingers, cropped, out of frame",
    "draw_sketch": "color, photo, watermark, text, blurry, low quality, deformed anatomy",
    "generate_model": "watermark, text, blurry, low quality, deformed anatomy, extra fingers, disfigured face",
}

IMAGE_SIZES = {
    "square": "1024*1024",
    "portrait": "720*1280",
    "landscape": "1280*720",
}

# 附加给图像编辑模型：防止「仅改色」被扩写成写实棚拍
EDIT_STYLE_LOCK_SUFFIX = (
    "[STYLE REQUIREMENT] Apply ONLY the minimal change requested in the first sentence above. "
    "Preserve the input image's existing visual style (sketch, flat color fill, line art, illustration level of detail — keep as-is). "
    "Do NOT convert to photorealistic fashion photography, do NOT add studio lighting or new backgrounds, "
    "do NOT replace the garment with a re-rendered realistic version unless the user explicitly asked for photoreal / photo / 写实渲染."
)

# ─── System prompt ───

SYSTEM_PROMPT = (
    "你是一位高级时尚设计智能助手，名叫「AI Fashion Studio」。\n"
    "用户可能从任意环节开始、跳过步骤、或来回迭代——**不要假设必须按固定顺序**（不必先草图再渲染）。\n\n"

    "## 你的能力（可独立或组合使用）\n"
    "1. **tool_text_to_image** — 纯文字生成任意时尚相关图像：写实成衣、场景图、概念图、细节图等（不限于线稿）\n"
    "2. **tool_draw_sketch** — 专门生成黑白服装线稿/草图\n"
    "3. **tool_edit_image** — 基于**任意一张已有图**做修改；**改色/微调/局部改**与**整图写实渲染**要区分（图来自下方资源表）\n"
    "4. **tool_transfer_pattern** — 将参考图上的花纹/Logo 应用到指定服装图上\n"
    "5. **tool_generate_model** — 生成展示用男/女模特（可与服装图无关，也可后续用于试穿）\n"
    "6. **tool_try_on** — 将一张服装图与一张模特图合成试穿效果\n\n"

    "## 选图与路径规则（核心）\n"
    "- 每条用户消息末尾会附带 **【会话状态快照】** 与 **【会话图片资源表】**。\n"
    "- 调用需要图片的工具时：**从表中复制完整路径**填入参数；若用户明确指「上一张」「刚生成的」「上传的」，对照表选择对应项。\n"
    "- 若参数中的路径留空或无效，系统会回退到「当前默认服装/模特」——但**优先**显式填表内路径，避免用错图。\n"
    "- 用户只想要「直接生成一张成品/照片」且无需基于旧图编辑时，用 **tool_text_to_image** 或 **tool_draw_sketch**（线稿），不要用编辑工具硬凑。\n"
    "- 用户上传的参考图路径也会在表中；图案迁移时 pattern 通常用上传图，服装用表中的设计图。\n"
    "- **多图上传**：同一条消息可附带多张图，资源表中以 **用户上传·第1张、第2张…** 编号（与上传顺序一致）。"
    "用户在正文里写的 @图1、图2、第二张、最后一张 等均指此顺序；调用工具时请从表中取对应完整路径。\n\n"

    "## 标准工作流（按前置条件选工具，避免无效调用）\n"
    "- **虚拟试穿**：必须同时有「服装图」和「模特图」。状态快照若显示缺模特，**先** `tool_generate_model`（或与用户确认性别/姿势需求），**再** `tool_try_on`；不要反复单独调用试穿直到模特已就绪。\n"
    "- **基于图编辑**：状态显示缺主服装图时，先 `tool_text_to_image` / `tool_draw_sketch` 或提示用户上传，再 `tool_edit_image`。\n"
    "- **图案迁移**：需要目标服装图 + 图案参考图；无上传图时可用资源表中其它图案类条目，否则提示用户上传。\n"
    "- **同一用户指令多步**：若逻辑上必须先 A 后 B（如先模特再试穿），可在**连续多轮**工具调用中完成，或在一轮内按正确顺序调用（若 API 允许并行则只对互不依赖的工具并行）。\n\n"

    "## 系统同步消息\n"
    "- 你会收到以 **[系统同步]** 开头的短消息，出现在**若干工具执行完成之后**，用于刷新会话状态。\n"
    "- 请根据最新快照决定下一步工具或最终回复，**不要把 [系统同步] 整段复述给用户**。\n\n"

    "## 提示词优化（按工具区分，禁止一刀切）\n"
    "- **tool_text_to_image / tool_draw_sketch**：可把简短中文扩展为详细英文，可补充面料、光线、场景等。\n"
    "- **tool_edit_image（重要）**：\n"
    "  - 用户仅要求**换色/改色/改成某色/调亮一点**等局部、非写实需求时：`instruction` 用**简短英文**即可，例如 "
    "`Change the garment color to blue only, keep the same illustration/sketch style and composition.`\n"
    "  - **禁止**在用户未说「写实/照片/渲染/棚拍/电商大片」时，擅自把 instruction 扩写成真丝面料、棚拍柔光、摄影级成衣等。\n"
    "  - 仅当用户**明确**要「渲染成真实照片/写实成衣/摄影效果」时，才在 instruction 里写 photorealistic、studio lighting 等。\n"
    "  - 若属于「保持画风只改内容」，将 `preserve_original_style` 设为 `true`（见工具参数说明）。\n\n"

    "## 回复风格\n"
    "- 用中文回复；编辑/复杂指令的英文 prompt 效果更好时可中英并用。\n"
    "- 完成后可简要列举用户**还可以**做的 2～3 件事（非强制顺序）。\n"
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "tool_text_to_image",
            "description": (
                "纯文本生成图片：写实服装、棚拍、街拍、面料特写、灵感拼贴、配色板等非线稿需求优先用本工具。"
                "用户未提供任何底图、只想「生成一张…照片/效果图」时使用。prompt 建议英文。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "英文画面描述，例如 'white oversized hoodie on hanger, studio soft light, fashion e-commerce'",
                    },
                    "style_hint": {
                        "type": "string",
                        "description": "可选：photorealistic / studio / streetwear / editorial / flat_lay / detail 等简短风格词",
                    },
                    "aspect": {
                        "type": "string",
                        "enum": ["square", "portrait", "landscape"],
                        "description": "图片比例：square(1:1), portrait(9:16竖版), landscape(16:9横版)，默认square",
                    },
                },
                "required": ["prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tool_draw_sketch",
            "description": "仅当用户明确要线稿、草图、黑白稿、款式图结构时使用；若要直接要彩色成品照片请用 tool_text_to_image。",
            "parameters": {
                "type": "object",
                "properties": {
                    "detailed_prompt": {
                        "type": "string",
                        "description": "详细的英文提示词，包含 'fashion sketch, black and white, clean lines' 等关键词。",
                    }
                },
                "required": ["detailed_prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tool_edit_image",
            "description": (
                "基于一张已有图片做编辑。若用户只要改色/小改/保持插画或线稿风格，不要当成「整图重渲染成照片」。"
                "base_image_path 必须从【会话图片资源表】中选路径；可编辑任意历史图，不限于「当前一张」。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "base_image_path": {
                        "type": "string",
                        "description": "基础图绝对路径（来自资源表）。若留空则使用会话默认服装图。",
                    },
                    "instruction": {
                        "type": "string",
                        "description": (
                            "编辑说明，英文为佳。改色类请简短，例如只改颜色并写明 keep same sketch/illustration style。"
                            "勿在用户未要求时堆砌 silk、studio lighting、photorealistic。"
                        ),
                    },
                    "preserve_original_style": {
                        "type": "boolean",
                        "description": (
                            "true：保持原图画风（线稿/平涂/插画等），只做指令中的最小改动。"
                            "false：允许改成写实摄影级成衣。用户未提写实/照片/渲染/棚拍时应为 true。"
                        ),
                    },
                },
                "required": ["instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tool_transfer_pattern",
            "description": (
                "将参考图（花纹、Logo、印花）应用到指定服装图上。"
                "路径均从【会话图片资源表】选取；服装图、图案图可任意组合，不必是「最新一张」。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_dress_path": {
                        "type": "string",
                        "description": "目标服装图绝对路径（可留空则使用会话默认服装图）。",
                    },
                    "pattern_ref_path": {
                        "type": "string",
                        "description": "图案/Logo 参考图绝对路径（可留空则使用用户上传图）。",
                    },
                    "instruction": {
                        "type": "string",
                        "description": "如何融合图案，英文为佳，例如 Apply pattern naturally to fabric folds.",
                    },
                },
                "required": ["instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tool_generate_model",
            "description": "生成男/女模特展示图；可与当前服装无关，试穿时再与资源表中的服装图配对。",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_prompt": {
                        "type": "string",
                        "description": "描述模特外观的英文提示词，例如 'female fashion model, full body, studio lighting'"
                    }
                },
                "required": ["model_prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tool_try_on",
            "description": (
                "将一张服装图与一张模特图合成试穿效果。**前置条件**：会话中必须已有可用服装图与模特图；"
                "若状态快照显示缺模特，必须先调用 tool_generate_model，再调用本工具。"
                "路径从【会话图片资源表】选择；可对任意历史服装与任意模特组合。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "dress_path": {
                        "type": "string",
                        "description": "服装图绝对路径（可留空则用会话默认服装图）",
                    },
                    "model_path": {
                        "type": "string",
                        "description": "模特图绝对路径（可留空则用会话默认模特图）",
                    },
                    "instruction": {
                        "type": "string",
                        "description": "试穿与光影风格，例如 realistic fitting, studio fashion photo",
                    },
                },
                "required": ["instruction"],
            },
        },
    }
]


# ─── Session ───

class Session:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.chat_history: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        self.current_image_path: Optional[str] = None
        self.current_model_path: Optional[str] = None
        self.current_tryon_path: Optional[str] = None
        self.uploaded_assets: list[dict] = []
        self.generated_images: list[dict] = []
        self.favorites: list[dict] = []
        self.stats = {"tool_calls": 0, "images_generated": 0, "errors": 0, "start_time": datetime.now().isoformat()}
        self.last_active = datetime.now()
        self.last_user_text: str = ""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.run_folder = os.path.join(OUTPUTS_DIR, f"{session_id}_{timestamp}")
        os.makedirs(self.run_folder, exist_ok=True)

    def touch(self):
        self.last_active = datetime.now()

    def is_expired(self) -> bool:
        return datetime.now() - self.last_active > timedelta(hours=SESSION_TTL_HOURS)

    def save_image(self, url: str, prefix: str = "image") -> Optional[str]:
        for attempt in range(MAX_RETRIES + 1):
            try:
                unique_name = f"{prefix}_{uuid.uuid4().hex[:8]}.png"
                file_path = os.path.join(self.run_folder, unique_name)
                urllib.request.urlretrieve(url, file_path)
                return os.path.abspath(file_path)
            except Exception as e:
                print(f"[ERROR] Download attempt {attempt+1} failed: {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(1)
        return None

    def get_image_url(self, abs_path: str) -> str:
        rel = os.path.relpath(abs_path, OUTPUTS_DIR)
        return f"/api/images/{rel.replace(os.sep, '/')}"

    def trim_history(self):
        if len(self.chat_history) <= MAX_HISTORY:
            return
        system = self.chat_history[0]
        trimmed = self.chat_history[-(MAX_HISTORY - 1):]
        self.chat_history = [system] + trimmed
        print(f"[INFO] Session {self.session_id[:8]}: trimmed history to {len(self.chat_history)} messages")

    def reset(self):
        self.chat_history = [{"role": "system", "content": SYSTEM_PROMPT}]
        self.current_image_path = None
        self.current_model_path = None
        self.current_tryon_path = None
        self.uploaded_assets = []
        self.generated_images = []
        self.favorites = []
        self.stats = {"tool_calls": 0, "images_generated": 0, "errors": 0, "start_time": datetime.now().isoformat()}
        self.last_active = datetime.now()
        self.last_user_text = ""
        print(f"[INFO] Session {self.session_id[:8]}: reset")

    @property
    def uploaded_file_path(self) -> Optional[str]:
        """兼容单图逻辑：多图时取本批次中最后一张（如图案迁移默认参考）。"""
        if not self.uploaded_assets:
            return None
        p = self.uploaded_assets[-1].get("path")
        return p if self._file_ok(p) else None

    def record_image(self, url: str, img_type: str, file_path: str):
        entry = {
            "url": url,
            "type": img_type,
            "path": file_path,
            "time": datetime.now().isoformat(),
            "id": uuid.uuid4().hex[:12],
        }
        self.generated_images.append(entry)
        self.stats["images_generated"] += 1
        return entry

    def add_favorite(self, image_id: str) -> bool:
        for img in self.generated_images:
            if img.get("id") == image_id:
                if img not in self.favorites:
                    self.favorites.append(img)
                return True
        return False

    def remove_favorite(self, image_id: str) -> bool:
        before = len(self.favorites)
        self.favorites = [f for f in self.favorites if f.get("id") != image_id]
        return len(self.favorites) < before

    def get_state_summary(self) -> dict:
        return {
            "has_design": self.current_image_path is not None,
            "has_model": self.current_model_path is not None,
            "has_tryon": self.current_tryon_path is not None,
            "has_upload": len(self.uploaded_assets) > 0,
            "upload_count": len(self.uploaded_assets),
            "image_count": len(self.generated_images),
            "favorites_count": len(self.favorites),
            "history_length": len(self.chat_history),
            "stats": self.stats,
        }

    def _file_ok(self, p: Optional[str]) -> bool:
        return bool(p and os.path.isfile(p))

    def build_workflow_context_block(self) -> str:
        """供 LLM 做工具路由；随用户消息与工具后同步消息附带。"""
        has_design = self._file_ok(self.current_image_path)
        has_model = self._file_ok(self.current_model_path)
        n_upload = len([a for a in self.uploaded_assets if self._file_ok(a.get("path"))])
        has_upload = n_upload > 0
        has_tryon = self._file_ok(self.current_tryon_path)

        lines = [
            "\n\n【会话状态快照】（供决策，勿逐字读给用户）",
            f"- 默认主服装图（编辑/图案目标/试穿·服装侧）: {'已就绪' if has_design else '**缺失** — 需文生图/草图/上传后再编辑或试穿'}",
            f"- 默认模特图（试穿·人物侧）: {'已就绪' if has_model else '**缺失** — 用户要试穿须先 tool_generate_model'}",
            f"- 用户本消息上传参考图: {n_upload} 张（资源表 **用户上传·第N张** 按上传顺序编号；@图N/第二张等均对应该顺序）" if has_upload else "- 用户本消息上传参考图: 无",
            f"- 最近一次试穿合成: {'有' if has_tryon else '无'}",
        ]
        if self.generated_images:
            last = self.generated_images[-1]
            lp = last.get("path")
            if self._file_ok(lp):
                lines.append(f"- 时间上最新产出: type={last.get('type')} 路径={lp}")
        lines.extend([
            "\n【工作流要点】",
            "- 试穿: 必须服装+模特齐备；缺模特则**先** generate_model。",
            "- 编辑: 须先有主服装图；无图则 text_to_image / draw_sketch 或请上传。",
            "- 图案: target=服装图，pattern=上传或表中图案类路径。",
            "- 改色/小改: edit_image + preserve_original_style=true，instruction 简短。",
        ])
        return "\n".join(lines)

    def build_post_tool_sync_message(self) -> str:
        """工具执行后插入一轮「用户」消息，刷新状态与路径表供下一跳 LLM 使用。"""
        return (
            "[系统同步] 工具已执行，状态与资源表已更新。请据此继续选择工具或回复用户（勿向用户复述本段）。\n"
            + self.build_workflow_context_block().lstrip()
            + self.build_assets_context_block()
        )

    def build_assets_context_block(self) -> str:
        lines = [
            "\n\n【会话图片资源表】复制完整路径到工具参数。",
        ]
        seen: set[str] = set()

        cd = self.current_image_path
        if self._file_ok(cd):
            seen.add(cd)
            lines.append(f"- **首选·默认服装底图** [session_default_design]: {cd}")
        cm = self.current_model_path
        if self._file_ok(cm):
            seen.add(cm)
            lines.append(f"- **首选·默认试穿模特** [session_default_model]: {cm}")
        for i, a in enumerate(self.uploaded_assets):
            up = a.get("path")
            if not self._file_ok(up) or up in seen:
                continue
            seen.add(up)
            disp = (a.get("name") or f"image_{i + 1}")[:80]
            aid = a.get("id") or ""
            lines.append(
                f"- **用户上传·第{i + 1}张** 「{disp}」 [id:{aid}] [user_upload_{i + 1}]: {up}"
            )
        ct = self.current_tryon_path
        if self._file_ok(ct):
            seen.add(ct)
            lines.append(f"- **最近一次试穿结果** [try_on_latest]: {ct}")

        lines.append("- —— 历史条目（新→旧，取最近 16 条）——")
        tail = self.generated_images[-16:] if len(self.generated_images) > 16 else self.generated_images
        for entry in reversed(tail):
            p = entry.get("path")
            if not p or p in seen:
                continue
            if not self._file_ok(p):
                continue
            seen.add(p)
            t = entry.get("type", "?")
            lines.append(f"- [{t}] 路径: {p}")

        if len(lines) <= 3:
            lines.append("- （当前还没有可用图片路径：可用文生图/草图，或请用户上传。）")
        return "\n".join(lines)


def get_session(session_id: str) -> Session:
    cleanup_expired_sessions()
    if session_id not in sessions:
        sessions[session_id] = Session(session_id)
    session = sessions[session_id]
    session.touch()
    return session


def cleanup_expired_sessions():
    expired = [sid for sid, s in sessions.items() if s.is_expired()]
    for sid in expired:
        del sessions[sid]
        print(f"[INFO] Expired session removed: {sid[:8]}")


# ─── Rate limiter ───

def check_rate_limit(session_id: str) -> bool:
    now = time.time()
    window = rate_limiter[session_id]
    rate_limiter[session_id] = [t for t in window if now - t < 60]
    if len(rate_limiter[session_id]) >= RATE_LIMIT_PER_MINUTE:
        return False
    rate_limiter[session_id].append(now)
    return True


def _parse_tool_arguments(raw: Optional[str]) -> Tuple[Optional[dict], Optional[str]]:
    if raw is None or not str(raw).strip():
        return {}, None
    try:
        return json.loads(raw), None
    except json.JSONDecodeError as e:
        return None, f"工具参数 JSON 无效: {e}"


def _append_tool_round_sync(session: Session) -> None:
    """工具批次执行完后刷新工作流上下文，避免后续 LLM 轮次仍按旧状态决策。"""
    session.chat_history.append({"role": "user", "content": session.build_post_tool_sync_message()})


# ─── Retry helper ───

def _call_with_retry(fn, *args, retries=MAX_RETRIES, **kwargs):
    for attempt in range(retries + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            if attempt < retries:
                wait = 2 ** attempt
                print(f"[WARN] Retry {attempt+1}/{retries} after {wait}s: {e}")
                time.sleep(wait)
            else:
                raise


# ─── Tool implementations ───

def tool_text_to_image(session: Session, prompt: str, style_hint: str = "", aspect: str = "square") -> dict:
    hint = (style_hint or "").strip()
    text = prompt.strip()
    if hint:
        text = f"{text}, {hint}"
    size = IMAGE_SIZES.get(aspect, IMAGE_SIZES["square"])
    neg = NEGATIVE_PROMPTS["text_to_image"]
    print(f"[TOOL] text_to_image [{size}]: {text[:80]}...")
    try:
        rsp = _call_with_retry(
            ImageGeneration.call,
            model=SKETCH_MODEL,
            messages=[{"role": "user", "content": [{"text": text}]}],
            n=1, size=size, negative_prompt=neg,
        )
        if rsp.status_code == HTTPStatus.OK:
            img_url = rsp.output.choices[0].message.content[0]["image"]
            path = session.save_image(img_url, "t2i")
            if path:
                session.current_image_path = path
                url = session.get_image_url(path)
                entry = session.record_image(url, "text_to_image", path)
                session.stats["tool_calls"] += 1
                return {"status": "success", "file_path": path, "url": url, "id": entry["id"]}
        msg = getattr(rsp, "message", "API调用失败")
        print(f"[ERROR] text_to_image failed: {msg}")
        session.stats["errors"] += 1
        return {"status": "error", "message": msg}
    except Exception as e:
        print(f"[ERROR] text_to_image exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


def tool_draw_sketch(session: Session, detailed_prompt: str) -> dict:
    neg = NEGATIVE_PROMPTS["draw_sketch"]
    print(f"[TOOL] draw_sketch: {detailed_prompt[:80]}...")
    try:
        rsp = _call_with_retry(
            ImageGeneration.call,
            model=SKETCH_MODEL,
            messages=[{"role": "user", "content": [{"text": detailed_prompt}]}],
            n=1, size="1024*1024", negative_prompt=neg,
        )
        if rsp.status_code == HTTPStatus.OK:
            img_url = rsp.output.choices[0].message.content[0]['image']
            path = session.save_image(img_url, "sketch")
            if path:
                session.current_image_path = path
                url = session.get_image_url(path)
                entry = session.record_image(url, "draw_sketch", path)
                session.stats["tool_calls"] += 1
                return {"status": "success", "file_path": path, "url": url, "id": entry["id"]}
        msg = getattr(rsp, 'message', 'API调用失败')
        print(f"[ERROR] draw_sketch failed: {msg}")
        session.stats["errors"] += 1
        return {"status": "error", "message": msg}
    except Exception as e:
        print(f"[ERROR] draw_sketch exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


def _wants_photoreal_intent(text: str) -> bool:
    """用户或指令中是否明确要求写实/摄影级效果（避免「照片」一词误伤普通描述）。"""
    if not text:
        return False
    if re.search(r"(不要|别|勿|无需).{0,8}(写实|照片级|渲染成真实|photorealistic)", text, re.I):
        return False
    t = text.lower()
    keys = (
        "写实", "照片级", "真实照片", "摄影", "渲染成", "渲染为", "渲染成真实",
        "photorealistic", "realistic photo", "photo shoot", "studio lighting",
        "棚拍", "电商大片", "lookbook", "e-commerce", "成衣效果图", "高清成片", "时尚摄影",
        "photography style",
    )
    return any(k.lower() in t for k in keys)


def _instruction_suggests_full_render(ins: str) -> bool:
    """instruction 是否像「整图重渲染」而非局部编辑（含 LLM 惯用的面料/棚拍扩写）。"""
    if _wants_photoreal_intent(ins):
        return True
    low = (ins or "").lower()
    fabric_studio = (
        "silk", "chiffon", "satin", "velvet", "cashmere", "studio soft",
        "soft light", "editorial fashion",
    )
    return any(h in low for h in fabric_studio)


def _edit_should_preserve_style(session: Session, instruction: str, explicit: Optional[bool]) -> bool:
    """
    决定是否锁定画风：避免 LLM 把「改成蓝色」扩写成丝绸棚拍写实图。
    explicit: 工具参数 preserve_original_style；None 表示由服务端推断。
    """
    if explicit is not None:
        return explicit

    u = (session.last_user_text or "").strip()
    ins = (instruction or "").strip()

    if _wants_photoreal_intent(u):
        return False

    # 用户已明确谈材质/面料/质感 → 不锁死画风，允许按描述重绘质感
    if re.search(r"(真丝|丝绒|缎面|皮革|质感|面料|材质|牛仔|棉麻|针织)", u):
        return False

    # 典型「只改色」短句，但 instruction 被扩写成面料/棚拍/写实 → 强制保原画风
    simple_color_user = bool(
        u
        and len(u) <= 56
        and (
            re.search(r"(改成|换成|改为|改|换).{0,10}(色|颜色)", u)
            or (re.match(r"^(帮我)?(改成|换成|改为)", u) and len(u) <= 40)
        )
    )
    if simple_color_user and ins and not _wants_photoreal_intent(u):
        if _instruction_suggests_full_render(ins):
            return True

    # 典型的仅改色 / 简短局部修改（中文）
    if u and len(u) <= 64:
        if re.search(r"(改成|换成|改为|改|换).{0,8}(色|颜色)", u):
            return True
        if re.search(r"^(帮我)?(改成|换成|改为)", u) and len(u) <= 36:
            return True

    # 英文简短改色
    if u and len(u) <= 80:
        ul = u.lower()
        if re.search(r"\b(change|turn|make)\b.+\b(blue|red|green|black|white|yellow|pink|purple|orange|gray|colour|color)\b", ul):
            if not _wants_photoreal_intent(u):
                return True

    return False


def tool_edit_image(
    session: Session,
    base_image_path: str,
    instruction: str,
    preserve_original_style: Optional[bool] = None,
) -> dict:
    real_path = base_image_path
    if (not real_path or not os.path.exists(real_path)) and session.current_image_path:
        real_path = session.current_image_path
    if not real_path or not os.path.exists(real_path):
        return {"status": "error", "message": "找不到基础图片，请先生成或上传一张图片"}

    preserve = _edit_should_preserve_style(session, instruction, preserve_original_style)
    final_instruction = instruction.strip()
    if preserve:
        final_instruction = f"{final_instruction}\n\n{EDIT_STYLE_LOCK_SUFFIX}"
        print(f"[TOOL] edit_image (preserve style): {instruction[:80]}...")
    else:
        print(f"[TOOL] edit_image: {instruction[:80]}...")

    try:
        messages = [{
            "role": "user",
            "content": [
                {"image": f"file://{os.path.abspath(real_path)}"},
                {"text": final_instruction}
            ]
        }]
        rsp = _call_with_retry(MultiModalConversation.call, model=EDIT_MODEL, messages=messages, n=1)
        if rsp.status_code == HTTPStatus.OK:
            content = rsp.output.choices[0].message.content
            for item in content:
                if 'image' in item:
                    path = session.save_image(item['image'], "edit")
                    if path:
                        session.current_image_path = path
                        url = session.get_image_url(path)
                        entry = session.record_image(url, "edit_image", path)
                        session.stats["tool_calls"] += 1
                        return {"status": "success", "file_path": path, "url": url, "id": entry["id"]}
        session.stats["errors"] += 1
        return {"status": "error", "message": "图片编辑API调用失败"}
    except Exception as e:
        print(f"[ERROR] edit_image exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


def tool_transfer_pattern(session: Session, target_dress_path: str, pattern_ref_path: str, instruction: str) -> dict:
    instruction = (instruction or "").strip() or (
        "Apply the pattern from the reference image onto the garment naturally, respect fabric folds and lighting."
    )
    real_dress = target_dress_path
    if (not real_dress or not os.path.exists(real_dress)) and session.current_image_path:
        real_dress = session.current_image_path
    if not real_dress or not os.path.exists(real_dress):
        return {
            "status": "error",
            "message": "找不到目标服装图片",
            "workflow_hint": "先文生图/草图生成服装，或指定资源表中的服装设计路径作为 target_dress_path",
        }
    real_pattern = pattern_ref_path
    if (not real_pattern or not os.path.exists(real_pattern)) and session.uploaded_file_path:
        real_pattern = session.uploaded_file_path
    if not real_pattern or not os.path.exists(real_pattern):
        return {
            "status": "error",
            "message": "找不到参考图案文件，请先上传图案/Logo 图片",
            "workflow_hint": "请用户在对话中上传参考图，或使用资源表中已有图案类图片路径作为 pattern_ref_path",
        }

    print(f"[TOOL] transfer_pattern: {instruction[:80]}...")
    try:
        messages = [{
            "role": "user",
            "content": [
                {"image": f"file://{os.path.abspath(real_dress)}"},
                {"image": f"file://{os.path.abspath(real_pattern)}"},
                {"text": instruction}
            ]
        }]
        rsp = _call_with_retry(MultiModalConversation.call, model=EDIT_MODEL, messages=messages, n=1)
        if rsp.status_code == HTTPStatus.OK:
            content = rsp.output.choices[0].message.content
            for item in content:
                if 'image' in item:
                    path = session.save_image(item['image'], "pattern")
                    if path:
                        session.current_image_path = path
                        url = session.get_image_url(path)
                        entry = session.record_image(url, "transfer_pattern", path)
                        session.stats["tool_calls"] += 1
                        return {"status": "success", "file_path": path, "url": url, "id": entry["id"]}
        session.stats["errors"] += 1
        return {"status": "error", "message": "图案迁移API调用失败"}
    except Exception as e:
        print(f"[ERROR] transfer_pattern exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


def tool_generate_model(session: Session, model_prompt: str) -> dict:
    neg = NEGATIVE_PROMPTS["generate_model"]
    print(f"[TOOL] generate_model: {model_prompt[:80]}...")
    try:
        rsp = _call_with_retry(
            ImageGeneration.call,
            model=SKETCH_MODEL,
            messages=[{"role": "user", "content": [{"text": model_prompt}]}],
            n=1, size="720*1280", negative_prompt=neg,
        )
        if rsp.status_code == HTTPStatus.OK:
            img_url = rsp.output.choices[0].message.content[0]['image']
            path = session.save_image(img_url, "model")
            if path:
                session.current_model_path = path
                url = session.get_image_url(path)
                entry = session.record_image(url, "generate_model", path)
                session.stats["tool_calls"] += 1
                return {"status": "success", "file_path": path, "url": url, "id": entry["id"]}
        msg = getattr(rsp, 'message', 'API调用失败')
        print(f"[ERROR] generate_model failed: {msg}")
        session.stats["errors"] += 1
        return {"status": "error", "message": msg}
    except Exception as e:
        print(f"[ERROR] generate_model exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


def tool_try_on(session: Session, dress_path: str, model_path: str, instruction: str) -> dict:
    instruction = (instruction or "").strip() or "realistic fitting, studio fashion photography, natural drape"
    if not dress_path or not os.path.exists(dress_path):
        dress_path = session.current_image_path
    if not model_path or not os.path.exists(model_path):
        model_path = session.current_model_path
    if not dress_path or not os.path.exists(dress_path):
        return {
            "status": "error",
            "message": "找不到服装图片，请先生成服装设计",
            "workflow_hint": "先使用 tool_text_to_image / tool_draw_sketch 或请用户上传服装图",
        }
    if not model_path or not os.path.exists(model_path):
        return {
            "status": "error",
            "message": "找不到模特图片，无法试穿",
            "workflow_hint": "先调用 tool_generate_model 生成展示模特，再调用 tool_try_on",
        }

    print(f"[TOOL] try_on: {instruction[:80]}...")
    try:
        messages = [{
            "role": "user",
            "content": [
                {"image": f"file://{os.path.abspath(model_path)}"},
                {"image": f"file://{os.path.abspath(dress_path)}"},
                {"text": instruction}
            ]
        }]
        rsp = _call_with_retry(MultiModalConversation.call, model=EDIT_MODEL, messages=messages, n=1)
        if rsp.status_code == HTTPStatus.OK:
            content = rsp.output.choices[0].message.content
            for item in content:
                if 'image' in item:
                    path = session.save_image(item['image'], "tryon")
                    if path:
                        session.current_tryon_path = path
                        url = session.get_image_url(path)
                        entry = session.record_image(url, "try_on", path)
                        session.stats["tool_calls"] += 1
                        return {"status": "success", "file_path": path, "url": url, "id": entry["id"]}
        session.stats["errors"] += 1
        return {"status": "error", "message": "虚拟试穿API调用失败"}
    except Exception as e:
        print(f"[ERROR] try_on exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


# ─── Tool dispatch ───

TOOL_EXECUTORS = {
    "tool_text_to_image": lambda s, a: tool_text_to_image(
        s, a["prompt"], a.get("style_hint") or "", a.get("aspect") or "square"
    ),
    "tool_draw_sketch": lambda s, a: tool_draw_sketch(s, a["detailed_prompt"]),
    "tool_edit_image": lambda s, a: tool_edit_image(
        s,
        a.get("base_image_path") or "",
        a["instruction"],
        a.get("preserve_original_style"),
    ),
    "tool_transfer_pattern": lambda s, a: tool_transfer_pattern(
        s, a.get("target_dress_path", ""), a.get("pattern_ref_path", ""), a.get("instruction", "")
    ),
    "tool_generate_model": lambda s, a: tool_generate_model(s, a["model_prompt"]),
    "tool_try_on": lambda s, a: tool_try_on(
        s, a.get("dress_path", ""), a.get("model_path", ""),
        a.get("instruction", "realistic fitting, fashion photography")
    ),
}

TOOL_NAMES_CN = {
    "tool_text_to_image": "文生图",
    "tool_draw_sketch": "绘制草图",
    "tool_edit_image": "编辑图片",
    "tool_transfer_pattern": "图案迁移",
    "tool_generate_model": "生成模特",
    "tool_try_on": "虚拟试穿",
}


# ─── Models ───

class ChatRequest(BaseModel):
    session_id: str
    message: str

class ResetRequest(BaseModel):
    session_id: str

class EnhancePromptRequest(BaseModel):
    prompt: str
    style: str = ""

class FavoriteRequest(BaseModel):
    session_id: str
    image_id: str

class AnalyzeRequest(BaseModel):
    session_id: str
    image_path: str = ""
    question: str = "请详细分析这张时尚设计图片的风格、面料、剪裁和配色特点。"


# ─── Helpers ───

def _msg_to_dict(assistant_msg) -> dict:
    if assistant_msg.tool_calls:
        return {
            "role": "assistant",
            "content": assistant_msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    }
                }
                for tc in assistant_msg.tool_calls
            ]
        }
    return {
        "role": "assistant",
        "content": assistant_msg.content or "",
    }


def _can_run_parallel(tool_calls) -> bool:
    """Check if all tool calls are independent (no image dependencies between them)."""
    names = [tc.function.name for tc in tool_calls]
    gen_tools = {"tool_text_to_image", "tool_draw_sketch", "tool_generate_model"}
    return all(n in gen_tools for n in names)


async def _execute_tool_calls_parallel(session, tool_calls):
    """Execute independent tool calls concurrently."""
    async def run_one(tc):
        func_name = tc.function.name
        args, perr = _parse_tool_arguments(getattr(tc.function, "arguments", None))
        if args is None:
            return tc, {"status": "error", "message": perr or "参数解析失败"}
        executor = TOOL_EXECUTORS.get(func_name)
        if executor:
            return tc, await asyncio.to_thread(executor, session, args)
        return tc, {"status": "error", "message": f"未知工具: {func_name}"}

    tasks = [run_one(tc) for tc in tool_calls]
    return await asyncio.gather(*tasks)


# ─── Chat streaming ───

async def stream_chat(session: Session, message: str) -> AsyncGenerator[str, None]:
    session.last_user_text = (message or "").strip()

    yield json.dumps({"type": "status", "content": "正在思考..."}, ensure_ascii=False) + "\n"

    if not API_KEY:
        yield json.dumps(
            {"type": "error", "content": "服务端未配置 DASHSCOPE_API_KEY，无法调用模型"},
            ensure_ascii=False,
        ) + "\n"
        yield json.dumps({"type": "done"}, ensure_ascii=False) + "\n"
        return

    ctx = session.build_workflow_context_block() + session.build_assets_context_block()
    session.chat_history.append({"role": "user", "content": message + ctx})
    session.trim_history()

    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=LLM_MODEL,
            messages=session.chat_history,
            tools=TOOLS,
        )

        assistant_msg = response.choices[0].message
        session.chat_history.append(_msg_to_dict(assistant_msg))

        images: list[dict] = []

        if assistant_msg.tool_calls:
            parallel = _can_run_parallel(assistant_msg.tool_calls)

            if parallel and len(assistant_msg.tool_calls) > 1:
                names_cn = [TOOL_NAMES_CN.get(tc.function.name, tc.function.name) for tc in assistant_msg.tool_calls]
                yield json.dumps({"type": "status", "content": f"并行执行: {', '.join(names_cn)}..."}, ensure_ascii=False) + "\n"

                results = await _execute_tool_calls_parallel(session, assistant_msg.tool_calls)
                for tc, result in results:
                    result_json = json.dumps(result, ensure_ascii=False)
                    session.chat_history.append({
                        "role": "tool", "tool_call_id": tc.id, "content": result_json
                    })
                    if result.get("status") == "success" and result.get("url"):
                        info = {"url": result["url"], "type": tc.function.name.replace("tool_", "")}
                        images.append(info)
                        yield json.dumps({"type": "image", **info}, ensure_ascii=False) + "\n"
                    elif result.get("status") == "error":
                        et = result.get("message", "工具执行失败")
                        if result.get("workflow_hint"):
                            et = f"{et}（建议：{result['workflow_hint']}）"
                        yield json.dumps({"type": "error", "content": et}, ensure_ascii=False) + "\n"
                _append_tool_round_sync(session)
                session.trim_history()
            else:
                for tool_call in assistant_msg.tool_calls:
                    func_name = tool_call.function.name
                    args, perr = _parse_tool_arguments(getattr(tool_call.function, "arguments", None))
                    cn_name = TOOL_NAMES_CN.get(func_name, func_name)
                    yield json.dumps({"type": "status", "content": f"正在{cn_name}..."}, ensure_ascii=False) + "\n"

                    if args is None:
                        result = {"status": "error", "message": perr or "参数解析失败"}
                    else:
                        executor = TOOL_EXECUTORS.get(func_name)
                        if executor:
                            result = await asyncio.to_thread(executor, session, args)
                        else:
                            result = {"status": "error", "message": f"未知工具: {func_name}"}

                    result_json = json.dumps(result, ensure_ascii=False)
                    session.chat_history.append({
                        "role": "tool", "tool_call_id": tool_call.id, "content": result_json
                    })

                    if result.get("status") == "success" and result.get("url"):
                        info = {"url": result["url"], "type": func_name.replace("tool_", "")}
                        images.append(info)
                        yield json.dumps({"type": "image", **info}, ensure_ascii=False) + "\n"
                    elif result.get("status") == "error":
                        et = result.get("message", "工具执行失败")
                        if result.get("workflow_hint"):
                            et = f"{et}（建议：{result['workflow_hint']}）"
                        yield json.dumps({"type": "error", "content": et}, ensure_ascii=False) + "\n"
                _append_tool_round_sync(session)
                session.trim_history()

            for _round in range(MAX_TOOL_ROUNDS):
                yield json.dumps({"type": "status", "content": "正在生成回复..."}, ensure_ascii=False) + "\n"

                follow_up = await asyncio.to_thread(
                    client.chat.completions.create,
                    model=LLM_MODEL,
                    messages=session.chat_history,
                    tools=TOOLS,
                )
                follow_msg = follow_up.choices[0].message
                session.chat_history.append(_msg_to_dict(follow_msg))

                if not follow_msg.tool_calls:
                    final_text = follow_msg.content or ""
                    yield json.dumps({"type": "message", "content": final_text, "images": images}, ensure_ascii=False) + "\n"
                    break

                for tool_call in follow_msg.tool_calls:
                    func_name = tool_call.function.name
                    args, perr = _parse_tool_arguments(getattr(tool_call.function, "arguments", None))
                    cn_name = TOOL_NAMES_CN.get(func_name, func_name)
                    yield json.dumps({"type": "status", "content": f"正在{cn_name}..."}, ensure_ascii=False) + "\n"

                    if args is None:
                        result = {"status": "error", "message": perr or "参数解析失败"}
                    else:
                        executor = TOOL_EXECUTORS.get(func_name)
                        if executor:
                            result = await asyncio.to_thread(executor, session, args)
                        else:
                            result = {"status": "error", "message": f"未知工具: {func_name}"}

                    result_json = json.dumps(result, ensure_ascii=False)
                    session.chat_history.append({
                        "role": "tool", "tool_call_id": tool_call.id, "content": result_json
                    })

                    if result.get("status") == "success" and result.get("url"):
                        info = {"url": result["url"], "type": func_name.replace("tool_", "")}
                        images.append(info)
                        yield json.dumps({"type": "image", **info}, ensure_ascii=False) + "\n"
                    elif result.get("status") == "error":
                        err_text = result.get("message", "工具执行失败")
                        if result.get("workflow_hint"):
                            err_text = f"{err_text}（建议：{result['workflow_hint']}）"
                        yield json.dumps({"type": "error", "content": err_text}, ensure_ascii=False) + "\n"
                _append_tool_round_sync(session)
                session.trim_history()
            else:
                yield json.dumps({"type": "message", "content": "操作已完成。", "images": images}, ensure_ascii=False) + "\n"
        else:
            text = assistant_msg.content or ""
            yield json.dumps({"type": "message", "content": text, "images": []}, ensure_ascii=False) + "\n"

    except Exception as e:
        print(f"[ERROR] stream_chat exception: {traceback.format_exc()}")
        session.stats["errors"] += 1
        yield json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False) + "\n"

    yield json.dumps({"type": "done"}, ensure_ascii=False) + "\n"


# ─── API Endpoints ───

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "sessions": len(sessions),
        "time": datetime.now().isoformat(),
        "api_key_configured": bool(API_KEY),
        "models": {"sketch": SKETCH_MODEL, "edit": EDIT_MODEL, "llm": LLM_MODEL, "vision": VISION_MODEL},
    }


async def _safe_stream_chat(session: Session, message: str):
    try:
        async for chunk in stream_chat(session, message):
            yield chunk
    except Exception as e:
        print(f"[ERROR] stream_chat exception: {traceback.format_exc()}")
        yield json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False) + "\n"
        yield json.dumps({"type": "done"}, ensure_ascii=False) + "\n"


@app.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        session = get_session(req.session_id)
        if not check_rate_limit(req.session_id):
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
        return StreamingResponse(
            _safe_stream_chat(session, req.message),
            media_type="application/x-ndjson",
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] chat endpoint: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/reset")
async def reset_session(req: ResetRequest):
    session = get_session(req.session_id)
    session.reset()
    return {"status": "ok"}


@app.get("/api/session/{session_id}/images")
async def get_session_images(session_id: str):
    session = get_session(session_id)
    return {"images": session.generated_images}


@app.get("/api/session/{session_id}/state")
async def get_session_state(session_id: str):
    session = get_session(session_id)
    return session.get_state_summary()


@app.post("/api/upload")
async def upload_file(request: Request):
    """支持单文件 `file` 或多文件 `files`（可重复字段）；本批次会替换会话中的用户上传列表。"""
    try:
        form = await request.form()
    except Exception as e:
        print(f"[ERROR] upload parse form: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=400, detail=f"无法解析上传表单: {e}") from e

    session_id: Optional[str] = None
    files_list: list = []
    for key, val in form.multi_items():
        kl = (key or "").lower()
        if kl == "session_id" and isinstance(val, str):
            session_id = val
        elif kl in ("file", "files") and isinstance(val, StarletteUploadFile):
            files_list.append(val)

    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    if not files_list:
        keys = [k for k, _ in form.multi_items()]
        print(f"[WARN] upload: no file parts, form keys={keys!r}")
        raise HTTPException(
            status_code=400,
            detail="未收到图片文件。请用字段名 file 或 files 上传；多图可多次使用 files。",
        )

    session = get_session(str(session_id))
    if len(files_list) > MAX_UPLOAD_BATCH:
        raise HTTPException(status_code=400, detail=f"最多同时上传 {MAX_UPLOAD_BATCH} 张图片")

    session.uploaded_assets = []
    results: list[dict] = []

    for uf in files_list:
        raw_name = getattr(uf, "filename", None) or "upload.png"
        ext = os.path.splitext(raw_name)[1] or ".png"
        if ext.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"):
            ext = ".png"
        unique_name = f"upload_{uuid.uuid4().hex[:8]}{ext}"
        file_path = os.path.join(session.run_folder, unique_name)
        content = await uf.read()
        if len(content) > 25 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="单张图片不能超过 25MB")
        with open(file_path, "wb") as f:
            f.write(content)
        abs_path = os.path.abspath(file_path)
        disp = os.path.basename(raw_name)[:120]
        aid = uuid.uuid4().hex[:8]
        session.uploaded_assets.append({"path": abs_path, "name": disp, "id": aid})
        url = session.get_image_url(abs_path)
        results.append(
            {
                "url": url,
                "path": abs_path,
                "filename": unique_name,
                "name": disp,
                "id": aid,
                "index": len(results) + 1,
            }
        )
        print(f"[INFO] File uploaded: {unique_name} for session {str(session_id)[:8]} (#{len(results)})")

    first = results[0]
    return {
        "assets": results,
        "count": len(results),
        "url": first["url"],
        "path": first["path"],
        "filename": first["filename"],
    }


@app.get("/api/images/{path:path}")
async def serve_image(path: str):
    file_path = os.path.join(OUTPUTS_DIR, path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(file_path, media_type="image/png")


@app.post("/api/edit_with_mask")
async def edit_with_mask(
    instruction: str = Form(...),
    base_image: UploadFile = File(...),
    mask_image: UploadFile = File(...),
    session_id: str | None = Form(None),
):
    try:
        if session_id:
            session = get_session(session_id)
        else:
            session = Session(session_id=str(uuid.uuid4()))

        base_ext = os.path.splitext(base_image.filename or "base.png")[1] or ".png"
        mask_ext = os.path.splitext(mask_image.filename or "mask.png")[1] or ".png"
        base_name = f"edit_base_{uuid.uuid4().hex[:8]}{base_ext}"
        mask_name = f"edit_mask_{uuid.uuid4().hex[:8]}{mask_ext}"
        base_path = os.path.join(session.run_folder, base_name)
        mask_path = os.path.join(session.run_folder, mask_name)

        base_bytes = await base_image.read()
        mask_bytes = await mask_image.read()
        with open(base_path, "wb") as f:
            f.write(base_bytes)
        with open(mask_path, "wb") as f:
            f.write(mask_bytes)

        abs_base = os.path.abspath(base_path)
        abs_mask = os.path.abspath(mask_path)

        print(f"[API] edit_with_mask: base={abs_base}, mask={abs_mask}, instruction={instruction[:80]}...")

        messages = [
            {
                "role": "user",
                "content": [
                    {"image": f"file://{abs_base}"},
                    {"image": f"file://{abs_mask}"},
                    {
                        "text": (
                            "Only modify the regions that are white in the second image (mask). "
                            "Keep all black / unmasked areas as close to the original as possible. "
                            + instruction
                        )
                    },
                ],
            }
        ]

        rsp = _call_with_retry(MultiModalConversation.call, model=EDIT_MODEL, messages=messages, n=1)
        if rsp.status_code != HTTPStatus.OK:
            msg = getattr(rsp, "message", "图片编辑API调用失败")
            print(f"[ERROR] edit_with_mask failed: {msg}")
            raise HTTPException(status_code=500, detail=msg)

        content = rsp.output.choices[0].message.content
        for item in content:
            if "image" in item:
                result_path = session.save_image(item["image"], "region_edit")
                if result_path:
                    try:
                        base_img = Image.open(abs_base).convert("RGBA")
                        edited_img = Image.open(result_path).convert("RGBA")
                        mask_img = Image.open(abs_mask).convert("L")

                        if mask_img.size != base_img.size:
                            mask_img = mask_img.resize(base_img.size, Image.BILINEAR)

                        mask_bin = mask_img.point(lambda v: 255 if v > 128 else 0)
                        composited = Image.composite(edited_img, base_img, mask_bin)
                        composited.save(result_path)
                    except Exception as e:
                        print(f"[WARN] edit_with_mask compositing failed: {e}")

                    url = session.get_image_url(result_path)
                    session.current_image_path = result_path
                    session.record_image(url, "edit_with_mask", result_path)
                    return {"url": url, "path": result_path}

        raise HTTPException(status_code=500, detail="未从模型返回图片结果")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] edit_with_mask exception: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── New: Prompt Enhancement ───

@app.post("/api/enhance-prompt")
async def enhance_prompt(req: EnhancePromptRequest):
    """Use LLM to expand a rough user prompt into a professional fashion prompt."""
    try:
        style_ctx = f" 风格方向: {req.style}" if req.style else ""
        messages = [
            {
                "role": "system",
                "content": (
                    "你是一位专业时尚摄影和设计提示词专家。将用户的简短中文描述扩展为一段专业的英文图像生成提示词。"
                    "要求：1. 加入面料/材质描述 2. 加入光线/拍摄风格 3. 加入场景/背景 4. 加入质量关键词 5. 保持简洁，不超过80词"
                ),
            },
            {"role": "user", "content": f"请将以下描述扩展为专业英文提示词：「{req.prompt}」{style_ctx}"},
        ]
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=LLM_MODEL,
            messages=messages,
        )
        enhanced = response.choices[0].message.content or req.prompt
        return {"original": req.prompt, "enhanced": enhanced.strip()}
    except Exception as e:
        print(f"[ERROR] enhance_prompt: {e}")
        return {"original": req.prompt, "enhanced": req.prompt, "error": str(e)}


# ─── New: Image Analysis ───

@app.post("/api/analyze-image")
async def analyze_image(req: AnalyzeRequest):
    """Use vision model to analyze a fashion image and return structured insights."""
    try:
        session = get_session(req.session_id)
        img_path = req.image_path
        if not img_path or not os.path.exists(img_path):
            img_path = session.current_image_path
        if not img_path or not os.path.exists(img_path):
            raise HTTPException(status_code=400, detail="没有可分析的图片")

        messages = [{
            "role": "user",
            "content": [
                {"image": f"file://{os.path.abspath(img_path)}"},
                {"text": (
                    f"{req.question}\n\n"
                    "请以JSON格式返回分析结果，包含以下字段：\n"
                    "- style: 风格描述\n"
                    "- colors: 主要配色列表\n"
                    "- fabric: 推测面料\n"
                    "- silhouette: 剪裁/廓形\n"
                    "- occasion: 适合场合\n"
                    "- summary: 一句话总结\n"
                    "- suggestions: 改进建议列表"
                )},
            ]
        }]

        rsp = await asyncio.to_thread(
            _call_with_retry,
            MultiModalConversation.call,
            model=VISION_MODEL,
            messages=messages,
        )
        if rsp.status_code == HTTPStatus.OK:
            content = rsp.output.choices[0].message.content
            text = ""
            for item in content:
                if isinstance(item, dict) and "text" in item:
                    text = item["text"]
                    break
                elif isinstance(item, str):
                    text = item
                    break

            try:
                cleaned = text.strip()
                if cleaned.startswith("```"):
                    cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
                    cleaned = cleaned.rsplit("```", 1)[0]
                analysis = json.loads(cleaned)
            except (json.JSONDecodeError, IndexError):
                analysis = {"summary": text, "raw": True}

            return {"status": "ok", "analysis": analysis, "image_path": img_path}

        msg = getattr(rsp, "message", "分析失败")
        raise HTTPException(status_code=500, detail=msg)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] analyze_image: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── New: Favorites ───

@app.post("/api/session/favorite")
async def add_favorite(req: FavoriteRequest):
    session = get_session(req.session_id)
    if session.add_favorite(req.image_id):
        return {"status": "ok", "favorites_count": len(session.favorites)}
    raise HTTPException(status_code=404, detail="图片未找到")


@app.delete("/api/session/favorite")
async def remove_favorite(req: FavoriteRequest):
    session = get_session(req.session_id)
    if session.remove_favorite(req.image_id):
        return {"status": "ok", "favorites_count": len(session.favorites)}
    raise HTTPException(status_code=404, detail="收藏未找到")


@app.get("/api/session/{session_id}/favorites")
async def get_favorites(session_id: str):
    session = get_session(session_id)
    return {"favorites": session.favorites}


# ─── New: Session statistics ───

@app.get("/api/session/{session_id}/stats")
async def get_session_stats(session_id: str):
    session = get_session(session_id)
    duration = (datetime.now() - datetime.fromisoformat(session.stats["start_time"])).total_seconds()
    return {
        **session.stats,
        "duration_seconds": round(duration),
        "session_id": session_id[:8],
        "images": [
            {"id": img.get("id"), "type": img.get("type"), "time": img.get("time"), "url": img.get("url")}
            for img in session.generated_images
        ],
    }


# ─── New: Export session as design board ───

@app.get("/api/session/{session_id}/export")
async def export_session(session_id: str):
    """Export all session images and metadata as a JSON manifest."""
    session = get_session(session_id)
    return {
        "session_id": session_id,
        "exported_at": datetime.now().isoformat(),
        "stats": session.stats,
        "images": session.generated_images,
        "favorites": session.favorites,
        "state": session.get_state_summary(),
    }


if __name__ == "__main__":
    import uvicorn
    print(f"[INFO] Starting AI Fashion Design Backend...")
    print(f"[INFO] Outputs dir: {OUTPUTS_DIR}")
    print(f"[INFO] Models: sketch={SKETCH_MODEL}, edit={EDIT_MODEL}, llm={LLM_MODEL}, vision={VISION_MODEL}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
