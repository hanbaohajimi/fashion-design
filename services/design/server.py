import os
import re
import json
import uuid
import hashlib
import asyncio
import time
import urllib.request
import traceback
from datetime import datetime, timedelta
from http import HTTPStatus
from typing import Optional, AsyncGenerator, Tuple
from collections import defaultdict

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Header
from starlette.datastructures import UploadFile as StarletteUploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from PIL import Image

from dashscope.aigc.image_generation import ImageGeneration
from dashscope import MultiModalConversation
import dashscope
from openai import OpenAI

import sqlite3 as _sqlite3

import db

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
    def __init__(self, session_id: str, personalization_ctx: str = ""):
        self.session_id = session_id
        combined_system = SYSTEM_PROMPT + ("\n\n" + personalization_ctx if personalization_ctx else "")
        self.chat_history: list[dict] = [{"role": "system", "content": combined_system}]
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
        # Set by chat endpoint when user is authenticated
        self.user_email: Optional[str] = None
        self.mode: str = "personal"
        self.designer_project_id: Optional[str] = None

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
        # Auto-save to library if user is authenticated
        if self.user_email:
            item_id = entry["id"]
            user_email = self.user_email
            mode = self.mode
            project_id = self.designer_project_id
            session_id = self.session_id
            prompt = self.last_user_text
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(_auto_save_to_library(
                        item_id, user_email, url, session_id, prompt, mode, project_id, img_type
                    ))
            except Exception:
                pass
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


def get_session(session_id: str, personalization_ctx: str = "") -> Session:
    cleanup_expired_sessions()
    if session_id not in sessions:
        sessions[session_id] = Session(session_id, personalization_ctx)
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
    mode: str = "personal"
    designer_project_id: Optional[str] = None
    auth_token: Optional[str] = None

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
        # Resolve personalization context if auth_token provided
        personalization_ctx = ""
        user_email: Optional[str] = None
        if req.auth_token:
            user_row = db.get_user_by_token(req.auth_token)
            if user_row:
                user_email = user_row["email"]
                personal_profile = db.get_personal_profile(user_email)
                designer_project = None
                if req.mode == "designer" and req.designer_project_id:
                    ws = db.get_designer_workspace(user_email)
                    designer_project = next(
                        (p for p in ws.get("projects", []) if p["id"] == req.designer_project_id), None
                    )
                personalization_ctx = _build_personalization_context(
                    req.mode, personal_profile, designer_project
                )

        session = get_session(req.session_id, personalization_ctx)
        if user_email:
            session.user_email = user_email
            session.mode = req.mode
            session.designer_project_id = req.designer_project_id
        if not check_rate_limit(req.session_id):
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

        async def _stream_and_side_effects():
            async for chunk in _safe_stream_chat(session, req.message):
                yield chunk
            # After stream completes: signal extraction + history analysis (fire-and-forget)
            if user_email:
                asyncio.create_task(_async_update_signals(
                    user_email, req.mode, req.designer_project_id, req.message
                ))
                total = db.count_user_sessions(user_email, req.mode, req.designer_project_id if req.mode == "designer" else None)
                if req.mode == "personal":
                    asyncio.create_task(_maybe_analyze_personal(user_email, total))
                elif req.mode == "designer" and req.designer_project_id:
                    asyncio.create_task(_maybe_analyze_designer(user_email, req.designer_project_id, total))

        return StreamingResponse(_stream_and_side_effects(), media_type="application/x-ndjson")
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


# ═══════════════════════════════════════════════════
# Auth helpers
# ═══════════════════════════════════════════════════

def _hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def _require_user(auth_token: Optional[str]) -> _sqlite3.Row:
    if not auth_token:
        raise HTTPException(status_code=401, detail="未登录")
    user = db.get_user_by_token(auth_token)
    if not user:
        raise HTTPException(status_code=401, detail="Token 无效或已过期")
    return user


# ═══════════════════════════════════════════════════
# Auth endpoints (mirror localStorage flow on server)
# ═══════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    email: str
    name: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class LogoutRequest(BaseModel):
    auth_token: str


@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    email = req.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="邮箱格式不正确")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少6位")
    existing = db.get_user_by_email(email)
    if existing:
        raise HTTPException(status_code=409, detail="该邮箱已注册")
    db.upsert_user(email, req.name, _hash_password(req.password))
    token = uuid.uuid4().hex
    db.set_auth_token(email, token)
    return {"auth_token": token, "email": email, "name": req.name}


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    email = req.email.lower().strip()
    user = db.get_user_by_email(email)
    if not user or user["password_hash"] != _hash_password(req.password):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    token = uuid.uuid4().hex
    db.set_auth_token(email, token)
    return {"auth_token": token, "email": email, "name": user["name"]}


@app.post("/api/auth/logout")
async def logout(req: LogoutRequest):
    db.revoke_token(req.auth_token)
    return {"status": "ok"}


# ═══════════════════════════════════════════════════
# Personalization helpers
# ═══════════════════════════════════════════════════

def _build_personalization_context(
    mode: str,
    personal_profile: dict,
    designer_project: Optional[dict] = None,
) -> str:
    if mode == "personal":
        if not personal_profile.get("meta", {}).get("onboarding_completed"):
            return ""
        s = personal_profile.get("static", {})
        d = personal_profile.get("dynamic", {})
        keywords = list(s.get("style_keywords") or [])
        for k in (d.get("inferred_keywords") or []):
            if k.get("confidence", 0) >= 0.6:
                keywords.append(k["tag"])
        avoids = list(s.get("avoid_elements") or []) + list(d.get("disliked_elements") or [])
        colors = list(s.get("color_palette") or []) + list(d.get("color_tendency") or [])
        occasions = s.get("occasions") or []
        body_shape = s.get("body_shape", "")
        concerns = s.get("concerns") or []

        lines = ["=== 用户个人风格档案 ==="]
        if body_shape:
            concern_str = f"，设计重点：{'、'.join(concerns)}" if concerns else ""
            lines.append(f"体型：{body_shape}{concern_str}")
        if keywords:
            lines.append(f"偏好风格：{'、'.join(dict.fromkeys(keywords))}")
        if colors:
            lines.append(f"偏好色系：{'、'.join(dict.fromkeys(colors))}")
        if occasions:
            lines.append(f"主要场合：{'、'.join(occasions)}")
        if avoids:
            lines.append(f"请回避：{'、'.join(dict.fromkeys(avoids))}")
        lines += [
            "",
            "原则：在理解用户本次指令的基础上自动参考以上偏好优化设计。",
            "本次指令与档案冲突时，以本次指令为准，可轻微提示替代方案。",
            "不要在回复中提及【根据你的档案】等字样。",
            "=== 档案结束 ===",
        ]
        return "\n".join(lines)

    if mode == "designer":
        if not designer_project:
            return ""
        b = designer_project.get("brief", {})
        dl = designer_project.get("design_language", {})
        dyn = designer_project.get("dynamic", {})
        sigs = [
            s["pattern"] for s in (dyn.get("design_signatures") or [])
            if s.get("confidence", 0) >= 0.65
        ][:5]
        lines = [f"=== 当前项目设计档案：{designer_project.get('name','')} ==="]
        if b.get("season"):
            lines.append(f"系列：{b['season']}")
        if b.get("target_audience"):
            lines.append(f"目标客群：{b['target_audience']}")
        if b.get("style_anchors"):
            lines.append(f"风格锚点：{'、'.join(b['style_anchors'][:5])}")
        if b.get("mood_keywords"):
            lines.append(f"情绪关键词：{'、'.join(b['mood_keywords'][:5])}")
        if b.get("reference_designers"):
            lines.append(f"参考方向：{'、'.join(b['reference_designers'][:5])}")
        if dl.get("silhouettes"):
            lines.append(f"惯用廓形：{'、'.join(dl['silhouettes'][:5])}")
        if dl.get("fabric_preferences"):
            lines.append(f"面料偏好：{'、'.join(dl['fabric_preferences'][:5])}")
        if dl.get("structural_details"):
            lines.append(f"结构细节偏好：{'、'.join(dl['structural_details'][:5])}")
        if sigs:
            lines.append(f"本项目设计规律：{'；'.join(sigs)}")
        if b.get("avoid_directions"):
            lines.append(f"本项目回避方向：{'、'.join(b['avoid_directions'][:5])}")
        lines += [
            "",
            "原则：以上是该项目已建立的设计语言，在生成时保持风格一致性。",
            "若设计师本次指令探索新方向，忠实执行，不要强行向历史风格靠拢。",
            "回复使用专业时装设计术语，不需要解释基础概念。",
            "=== 档案结束 ===",
        ]
        return "\n".join(lines)

    return ""


# ═══════════════════════════════════════════════════
# Signal extraction helpers (async, non-blocking)
# ═══════════════════════════════════════════════════

_PERSONAL_NEGATIVE_PATTERNS = [
    re.compile(r"太(亮|花|紧|宽|短|长|正式|休闲|甜|成熟)了"),
    re.compile(r"不(要|喜欢|太).{0,10}(色|款|风格|印花|图案)"),
    re.compile(r"去掉|换掉|取消"),
]
_PERSONAL_POSITIVE_PATTERNS = [
    re.compile(r"就这|保留|很好|喜欢|完美|对了|收藏"),
    re.compile(r"再来.{0,4}(类似|同款|这种)"),
]
_DIRECTION_MAP = {
    "宽松": "oversized", "修身": "修身", "简洁": "极简",
    "深色": "深色系", "浅色": "浅色系", "高级": "高级感",
    "极简": "极简", "复古": "复古", "街头": "街头",
}
_DESIGNER_SILHOUETTE = ["落肩", "宽袖", "茧型", "不对称", "解构", "开衩", "A型", "H型", "X型", "垂坠"]
_DESIGNER_FABRIC = ["亚麻", "双宫丝", "压缩", "做旧", "垂感", "挺括", "真丝", "羊毛", "牛仔", "皮革"]
_DESIGNER_CRAFT = ["手工褶皱", "毛边", "拼接", "包边", "刺绣", "解构拼接", "宽袖克夫"]
_DESIGNER_NEGATIVE = [
    re.compile(r"不要(.{0,8})感"),
    re.compile(r"去掉(.{0,8})"),
    re.compile(r"太(.{0,6})了"),
]


def _extract_personal_signals(text: str) -> dict:
    neg = []
    pos = []
    directions = []
    for pat in _PERSONAL_NEGATIVE_PATTERNS:
        for m in pat.finditer(text):
            neg.append(m.group(0))
    for pat in _PERSONAL_POSITIVE_PATTERNS:
        for m in pat.finditer(text):
            pos.append(m.group(0))
    for kw, mapped in _DIRECTION_MAP.items():
        if kw in text:
            directions.append(mapped)
    return {"positive_signals": pos, "negative_signals": neg, "direction_keywords": directions}


def _extract_designer_signals(text: str) -> dict:
    tech = []
    rejected = []
    for kw in _DESIGNER_SILHOUETTE + _DESIGNER_FABRIC + _DESIGNER_CRAFT:
        if kw in text:
            tech.append(kw)
    for pat in _DESIGNER_NEGATIVE:
        for m in pat.finditer(text):
            rejected.append(m.group(1).strip() if m.lastindex else m.group(0))
    return {"technical_elements": list(set(tech)), "rejected_elements": list(set(rejected))}


def _apply_personal_signals(profile: dict, signals: dict) -> dict:
    dynamic = profile.setdefault("dynamic", {
        "inferred_keywords": [], "disliked_elements": [],
        "color_tendency": [], "sessions_analyzed": 0,
    })
    existing = {k["tag"]: k for k in dynamic.get("inferred_keywords", [])}
    for kw in signals.get("direction_keywords", []):
        if kw in existing:
            existing[kw]["count"] = existing[kw].get("count", 1) + 1
            existing[kw]["confidence"] = min(0.9, existing[kw].get("confidence", 0.5) + 0.05)
        else:
            existing[kw] = {"tag": kw, "confidence": 0.5, "count": 1}
    dynamic["inferred_keywords"] = list(existing.values())
    disliked = set(dynamic.get("disliked_elements", []))
    for neg in signals.get("negative_signals", []):
        disliked.add(neg)
    dynamic["disliked_elements"] = list(disliked)
    return profile


def _apply_designer_signals(workspace: dict, project_id: str, signals: dict) -> dict:
    projects = workspace.get("projects", [])
    for proj in projects:
        if proj.get("id") == project_id:
            dyn = proj.setdefault("dynamic", {
                "design_signatures": [], "recurring_elements": [], "sessions_analyzed": 0,
            })
            existing = set(dyn.get("recurring_elements", []))
            for el in signals.get("technical_elements", []):
                existing.add(el)
            dyn["recurring_elements"] = list(existing)
            break
    return workspace


_AUTO_TAG_SYSTEM = (
    "你是时尚图像分析师。分析这张服装设计图，严格按以下JSON返回，不输出任何其他内容：\n"
    '{"garment_types":["上衣"],"colors":["米白"],"silhouette":"H型","occasions":["通勤"],'
    '"style_keywords":["极简"],"season":"秋冬"}\n'
    "garment_types选项：上衣/衬衫/T恤/毛衣/外套/风衣/大衣/连衣裙/半裙/裤子/阔腿裤/短裤/套装/其他\n"
    "silhouette选项：A型/H型/X型/茧型/直筒/修身/不对称/其他\n"
    "season选项：春夏/秋冬/全季"
)


async def _auto_tag_image(item_id: str, image_url: str, prompt: str) -> None:
    """Async fire-and-forget: call vision LLM to tag the image, then update DB."""
    try:
        tag_prompt = f"生成该图的描述：{prompt}\n请分析图片内容并返回风格标签。" if prompt else "请分析图片内容并返回风格标签。"
        # Build absolute URL for the image if needed
        abs_url = image_url
        if abs_url.startswith("/api/images/"):
            # Use local file path instead for vision model
            rel = abs_url.removeprefix("/api/images/")
            abs_url = os.path.join(OUTPUTS_DIR, rel.replace("/", os.sep))
            # Convert to file:// or use base64
            if os.path.exists(abs_url):
                import base64
                with open(abs_url, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                ext = os.path.splitext(abs_url)[1].lower().lstrip(".")
                mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
                abs_url = f"data:{mime};base64,{b64}"
            else:
                db.update_library_item_tags(item_id, {}, "failed")
                return

        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=VISION_MODEL,
            messages=[
                {"role": "system", "content": _AUTO_TAG_SYSTEM},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": abs_url}},
                    {"type": "text", "text": tag_prompt},
                ]},
            ],
        )
        raw = (response.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            raw = raw.rsplit("```", 1)[0]
        tags = json.loads(raw)
        db.update_library_item_tags(item_id, tags, "completed")
    except Exception as e:
        print(f"[WARN] auto_tag_image failed for {item_id}: {e}")
        db.update_library_item_tags(item_id, {}, "failed")


async def _auto_save_to_library(
    item_id: str,
    user_email: str,
    image_url: str,
    session_id: str,
    prompt: str,
    mode: str,
    project_id: Optional[str],
    img_type: str,
) -> None:
    """Fire-and-forget: save image to library then trigger auto-tagging."""
    try:
        db.create_library_item(item_id, user_email, image_url, session_id, prompt, mode, project_id, img_type)
        asyncio.create_task(_auto_tag_image(item_id, image_url, prompt))
        # Check if smart collections should be generated
        total = db.count_library_items(user_email)
        if total == 30:
            asyncio.create_task(_generate_smart_collections(user_email))
        # Trigger library-based profile analysis at thresholds
        if total in (20, 50, 100):
            asyncio.create_task(_analyze_library_for_profile(user_email, mode))
    except Exception as e:
        print(f"[WARN] _auto_save_to_library failed: {e}")


async def _async_update_signals(
    email: str,
    mode: str,
    project_id: Optional[str],
    user_message: str,
) -> None:
    """Fire-and-forget signal extraction — never raises."""
    try:
        if mode == "personal":
            signals = _extract_personal_signals(user_message)
            if not any(signals.values()):
                return
            profile = db.get_personal_profile(email)
            profile = _apply_personal_signals(profile, signals)
            db.save_personal_profile(email, profile)
        elif mode == "designer" and project_id:
            signals = _extract_designer_signals(user_message)
            if not any(signals.values()):
                return
            workspace = db.get_designer_workspace(email)
            workspace = _apply_designer_signals(workspace, project_id, signals)
            db.save_designer_workspace(email, workspace)
    except Exception:
        pass  # never block the chat stream


# ═══════════════════════════════════════════════════
# AI history summary
# ═══════════════════════════════════════════════════

_PERSONAL_SUMMARY_SYSTEM = (
    "你是时尚顾问助手，分析以下用户的穿搭设计历史，提取个人风格偏好。"
    "严格按以下JSON返回，不输出任何其他内容：\n"
    '{"top_style_keywords":[{"tag":"关键词","confidence":0.85,"evidence":"简短依据（10字内）"}],'
    '"new_disliked_elements":["元素1"],'
    '"color_tendency":["色系1"],'
    '"dominant_occasions":["场合1"],'
    '"summary_note":"一句话概括（15字内）"}\n'
    "要求：keywords 最多8条，confidence 范围 0.5~0.95，只提取有明确证据的偏好。"
)

_DESIGNER_SUMMARY_SYSTEM = (
    "你是专业时尚编辑，分析以下设计师在某项目中的创作历史，提取设计语言规律。"
    "严格按以下JSON返回，不输出任何其他内容：\n"
    '{"design_signatures":[{"pattern":"设计规律描述","confidence":0.85,"evidence":"具体依据（15字内）"}],'
    '"recurring_elements":["反复出现的设计元素"],'
    '"emerging_direction":"本项目正在形成的风格走向（20字内）",'
    '"potential_conflicts":null}\n'
    "注意：design_signatures 描述创作手法和结构规律，最多6条，只提取有3次以上重复依据的规律。"
)


async def _run_llm_summary(system_prompt: str, user_prompt: str) -> Optional[dict]:
    try:
        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw = (response.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            raw = raw.rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception as e:
        print(f"[WARN] LLM summary failed: {e}")
        return None


async def _maybe_analyze_personal(email: str, total_sessions: int) -> None:
    profile = db.get_personal_profile(email)
    analyzed = profile.get("dynamic", {}).get("sessions_analyzed", 0)
    should = (analyzed == 0 and total_sessions >= 10) or (total_sessions - analyzed >= 20)
    if not should:
        return
    user_prompt = (
        f"历史对话条数：{total_sessions}\n"
        f"已有推断标签：{json.dumps(profile.get('dynamic',{}).get('inferred_keywords',[]), ensure_ascii=False)}\n"
        f"已有厌恶元素：{json.dumps(profile.get('dynamic',{}).get('disliked_elements',[]), ensure_ascii=False)}\n"
        "请基于以上信息进行风格总结。"
    )
    result = await _run_llm_summary(_PERSONAL_SUMMARY_SYSTEM, user_prompt)
    if not result:
        return
    profile.setdefault("dynamic", {})
    profile["dynamic"].setdefault("inferred_keywords", [])
    existing_tags = {k["tag"] for k in profile["dynamic"]["inferred_keywords"]}
    for kw in result.get("top_style_keywords", []):
        if kw.get("tag") and kw["tag"] not in existing_tags:
            profile["dynamic"]["inferred_keywords"].append(kw)
    disliked = set(profile["dynamic"].get("disliked_elements", []))
    disliked.update(result.get("new_disliked_elements", []))
    profile["dynamic"]["disliked_elements"] = list(disliked)
    color = set(profile["dynamic"].get("color_tendency", []))
    color.update(result.get("color_tendency", []))
    profile["dynamic"]["color_tendency"] = list(color)
    profile["dynamic"]["sessions_analyzed"] = total_sessions
    profile["dynamic"]["last_analyzed_at"] = datetime.now().isoformat()
    # store pending review
    profile["pending_review"] = {
        "type": "personal",
        "result": result,
        "generated_at": datetime.now().isoformat(),
    }
    db.save_personal_profile(email, profile)


async def _maybe_analyze_designer(email: str, project_id: str, project_sessions: int) -> None:
    workspace = db.get_designer_workspace(email)
    project = next((p for p in workspace.get("projects", []) if p.get("id") == project_id), None)
    if not project:
        return
    analyzed = project.get("dynamic", {}).get("sessions_analyzed", 0)
    should = (analyzed == 0 and project_sessions >= 8) or (project_sessions - analyzed >= 15)
    if not should:
        return
    user_prompt = (
        f"项目名称：{project.get('name','')}\n"
        f"项目背景：{json.dumps(project.get('brief',{}), ensure_ascii=False)}\n"
        f"已有设计元素：{json.dumps(project.get('dynamic',{}).get('recurring_elements',[]), ensure_ascii=False)}\n"
        f"项目对话条数：{project_sessions}\n"
        "请基于以上信息进行设计规律总结。"
    )
    result = await _run_llm_summary(_DESIGNER_SUMMARY_SYSTEM, user_prompt)
    if not result:
        return
    for proj in workspace.get("projects", []):
        if proj.get("id") == project_id:
            proj.setdefault("dynamic", {})
            proj["dynamic"]["design_signatures"] = result.get("design_signatures", [])
            el = set(proj["dynamic"].get("recurring_elements", []))
            el.update(result.get("recurring_elements", []))
            proj["dynamic"]["recurring_elements"] = list(el)
            proj["dynamic"]["sessions_analyzed"] = project_sessions
            proj["dynamic"]["last_analyzed_at"] = datetime.now().isoformat()
            proj["pending_review"] = {
                "type": "designer",
                "result": result,
                "generated_at": datetime.now().isoformat(),
            }
            break
    db.save_designer_workspace(email, workspace)


# ═══════════════════════════════════════════════════
# Personal Profile endpoints
# ═══════════════════════════════════════════════════

class PersonalOnboardingRequest(BaseModel):
    auth_token: str
    static: dict

class PersonalStaticPatchRequest(BaseModel):
    auth_token: str
    static: dict

class ProfileConfirmRequest(BaseModel):
    auth_token: str
    accepted_items: list  # list of accepted diff items

class DesignerProjectCreateRequest(BaseModel):
    auth_token: str
    name: str
    brief: dict = {}
    design_language: dict = {}

class DesignerProjectPatchRequest(BaseModel):
    auth_token: str
    name: Optional[str] = None
    brief: Optional[dict] = None
    design_language: Optional[dict] = None
    status: Optional[str] = None

class DesignerProjectAnalyzeRequest(BaseModel):
    auth_token: str

class DesignerProjectConfirmRequest(BaseModel):
    auth_token: str
    accepted_items: list

class PersonalAnalyzeRequest(BaseModel):
    auth_token: str

class CreateSessionRequest(BaseModel):
    auth_token: str
    mode: str = "personal"
    designer_project_id: Optional[str] = None


@app.get("/api/profile/personal")
async def get_personal_profile_endpoint(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    profile = db.get_personal_profile(user["email"])
    return {"profile": profile}


@app.post("/api/profile/personal/onboarding")
async def personal_onboarding(req: PersonalOnboardingRequest):
    user = _require_user(req.auth_token)
    profile = db.get_personal_profile(user["email"])
    profile["static"] = req.static
    profile.setdefault("dynamic", {
        "inferred_keywords": [], "disliked_elements": [],
        "color_tendency": [], "sessions_analyzed": 0,
    })
    profile["meta"] = {"onboarding_completed": True, "updated_at": datetime.now().isoformat()}
    db.save_personal_profile(user["email"], profile)
    return {"status": "ok", "profile": profile}


@app.patch("/api/profile/personal/static")
async def patch_personal_static(req: PersonalStaticPatchRequest):
    user = _require_user(req.auth_token)
    profile = db.get_personal_profile(user["email"])
    profile.setdefault("static", {}).update(req.static)
    profile.setdefault("meta", {})["updated_at"] = datetime.now().isoformat()
    db.save_personal_profile(user["email"], profile)
    return {"status": "ok", "profile": profile}


@app.post("/api/profile/personal/analyze")
async def trigger_personal_analyze(req: PersonalAnalyzeRequest):
    user = _require_user(req.auth_token)
    total = db.count_user_sessions(user["email"], "personal")
    await _maybe_analyze_personal(user["email"], max(total, 1))
    profile = db.get_personal_profile(user["email"])
    return {"status": "ok", "profile": profile}


@app.post("/api/profile/personal/confirm")
async def confirm_personal_review(req: ProfileConfirmRequest):
    user = _require_user(req.auth_token)
    profile = db.get_personal_profile(user["email"])
    pending = profile.pop("pending_review", None)
    if not pending:
        return {"status": "ok", "profile": profile}
    # merge accepted items
    result = pending.get("result", {})
    accepted_tags = {item.get("tag") for item in req.accepted_items if item.get("tag")}
    existing_tags = {k["tag"] for k in profile.get("dynamic", {}).get("inferred_keywords", [])}
    for kw in result.get("top_style_keywords", []):
        if kw.get("tag") in accepted_tags and kw["tag"] not in existing_tags:
            profile.setdefault("dynamic", {}).setdefault("inferred_keywords", []).append(kw)
    db.save_personal_profile(user["email"], profile)
    return {"status": "ok", "profile": profile}


# ═══════════════════════════════════════════════════
# Designer Workspace endpoints
# ═══════════════════════════════════════════════════

@app.get("/api/profile/designer/projects")
async def get_designer_projects(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    workspace = db.get_designer_workspace(user["email"])
    return {"workspace": workspace}


@app.post("/api/profile/designer/projects")
async def create_designer_project(req: DesignerProjectCreateRequest):
    user = _require_user(req.auth_token)
    workspace = db.get_designer_workspace(user["email"])
    project = {
        "id": uuid.uuid4().hex,
        "name": req.name,
        "status": "active",
        "created_at": datetime.now().isoformat(),
        "brief": req.brief,
        "design_language": req.design_language,
        "dynamic": {
            "design_signatures": [],
            "recurring_elements": [],
            "sessions_analyzed": 0,
        },
    }
    workspace.setdefault("projects", []).append(project)
    workspace["active_project_id"] = project["id"]
    workspace["meta"] = {"onboarding_completed": True, "updated_at": datetime.now().isoformat()}
    db.save_designer_workspace(user["email"], workspace)
    return {"status": "ok", "project": project, "workspace": workspace}


@app.patch("/api/profile/designer/projects/{project_id}")
async def patch_designer_project(project_id: str, req: DesignerProjectPatchRequest):
    user = _require_user(req.auth_token)
    workspace = db.get_designer_workspace(user["email"])
    for proj in workspace.get("projects", []):
        if proj["id"] == project_id:
            if req.name is not None:
                proj["name"] = req.name
            if req.brief is not None:
                proj.setdefault("brief", {}).update(req.brief)
            if req.design_language is not None:
                proj.setdefault("design_language", {}).update(req.design_language)
            if req.status is not None:
                proj["status"] = req.status
            break
    else:
        raise HTTPException(status_code=404, detail="项目未找到")
    workspace.setdefault("meta", {})["updated_at"] = datetime.now().isoformat()
    db.save_designer_workspace(user["email"], workspace)
    return {"status": "ok", "workspace": workspace}


@app.delete("/api/profile/designer/projects/{project_id}")
async def archive_designer_project(project_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    workspace = db.get_designer_workspace(user["email"])
    for proj in workspace.get("projects", []):
        if proj["id"] == project_id:
            proj["status"] = "archived"
            break
    else:
        raise HTTPException(status_code=404, detail="项目未找到")
    db.save_designer_workspace(user["email"], workspace)
    return {"status": "ok"}


@app.post("/api/profile/designer/projects/{project_id}/analyze")
async def trigger_designer_analyze(project_id: str, req: DesignerProjectAnalyzeRequest):
    user = _require_user(req.auth_token)
    cnt = db.count_user_sessions(user["email"], "designer", project_id)
    await _maybe_analyze_designer(user["email"], project_id, max(cnt, 1))
    workspace = db.get_designer_workspace(user["email"])
    return {"status": "ok", "workspace": workspace}


@app.post("/api/profile/designer/projects/{project_id}/confirm")
async def confirm_designer_review(project_id: str, req: DesignerProjectConfirmRequest):
    user = _require_user(req.auth_token)
    workspace = db.get_designer_workspace(user["email"])
    for proj in workspace.get("projects", []):
        if proj.get("id") == project_id:
            proj.pop("pending_review", None)
            accepted_patterns = {item.get("pattern") for item in req.accepted_items if item.get("pattern")}
            existing = {s["pattern"] for s in proj.get("dynamic", {}).get("design_signatures", [])}
            for item in req.accepted_items:
                if item.get("pattern") and item["pattern"] not in existing:
                    proj.setdefault("dynamic", {}).setdefault("design_signatures", []).append(item)
            break
    db.save_designer_workspace(user["email"], workspace)
    return {"status": "ok", "workspace": workspace}


# ═══════════════════════════════════════════════════
# Session creation with mode
# ═══════════════════════════════════════════════════

@app.post("/api/conversations")
async def create_conversation(req: CreateSessionRequest):
    user = _require_user(req.auth_token)
    session_id = uuid.uuid4().hex
    db.create_chat_session(session_id, user["email"], req.mode, req.designer_project_id)
    # Build personalization context now so it's baked into the session
    personal_profile = db.get_personal_profile(user["email"])
    designer_project = None
    if req.mode == "designer" and req.designer_project_id:
        ws = db.get_designer_workspace(user["email"])
        designer_project = next(
            (p for p in ws.get("projects", []) if p["id"] == req.designer_project_id), None
        )
    ctx = _build_personalization_context(req.mode, personal_profile, designer_project)
    get_session(session_id, ctx)  # pre-create with context
    return {
        "session_id": session_id,
        "mode": req.mode,
        "designer_project_id": req.designer_project_id,
    }


# ═══════════════════════════════════════════════════
# Library — request models
# ═══════════════════════════════════════════════════

class LibraryPatchRequest(BaseModel):
    auth_token: str
    is_favorite: Optional[bool] = None
    user_tags: Optional[list] = None
    notes: Optional[str] = None
    save_context: Optional[str] = None

class CollectionCreateRequest(BaseModel):
    auth_token: str
    name: str
    mode: Optional[str] = None
    designer_project_id: Optional[str] = None

class CollectionPatchRequest(BaseModel):
    auth_token: str
    name: Optional[str] = None
    cover_item_id: Optional[str] = None
    sort_order: Optional[int] = None

class CollectionItemsRequest(BaseModel):
    auth_token: str
    item_ids: list

class SuggestOutfitRequest(BaseModel):
    auth_token: str
    occasion: Optional[str] = None
    weather: Optional[dict] = None

class LibraryAnalyzeRequest(BaseModel):
    auth_token: str

class RetryTagsRequest(BaseModel):
    auth_token: str


def _row_to_item(row) -> dict:
    d = dict(row)
    try:
        d["auto_tags"] = json.loads(d.get("auto_tags") or "{}")
    except Exception:
        d["auto_tags"] = {}
    try:
        d["user_tags"] = json.loads(d.get("user_tags") or "[]")
    except Exception:
        d["user_tags"] = []
    d["is_favorite"] = bool(d.get("is_favorite"))
    return d


# ═══════════════════════════════════════════════════
# Library — image endpoints
# ═══════════════════════════════════════════════════

@app.get("/api/library")
async def list_library(
    authorization: Optional[str] = Header(None),
    mode: Optional[str] = None,
    project_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    is_favorite: Optional[bool] = None,
    tags: Optional[str] = None,
    page: int = 1,
    limit: int = 30,
):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    tag_list = [t.strip() for t in tags.split(",")] if tags else None
    rows, total = db.list_library_items(
        user["email"],
        mode=mode,
        designer_project_id=project_id,
        collection_id=collection_id,
        is_favorite=is_favorite,
        tags=tag_list,
        page=page,
        limit=limit,
    )
    items = [_row_to_item(r) for r in rows]
    return {"items": items, "total": total, "page": page, "has_more": (page * limit) < total}


@app.patch("/api/library/{item_id}")
async def patch_library_item(item_id: str, req: LibraryPatchRequest):
    user = _require_user(req.auth_token)
    kwargs = {}
    if req.is_favorite is not None:
        kwargs["is_favorite"] = req.is_favorite
    if req.user_tags is not None:
        kwargs["user_tags"] = req.user_tags
    if req.notes is not None:
        kwargs["notes"] = req.notes
    if req.save_context is not None:
        kwargs["save_context"] = req.save_context
    row = db.patch_library_item(item_id, user["email"], **kwargs)
    if not row:
        raise HTTPException(status_code=404, detail="图片不存在")
    item = _row_to_item(row)
    # If favorited, trigger library analysis
    if req.is_favorite is True:
        asyncio.create_task(_analyze_library_for_profile(user["email"], "personal"))
    return {"item": item}


@app.delete("/api/library/{item_id}")
async def delete_library_item(item_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    ok = db.soft_delete_library_item(item_id, user["email"])
    if not ok:
        raise HTTPException(status_code=404, detail="图片不存在")
    return {"status": "ok"}


@app.get("/api/library/stats")
async def get_library_stats(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    stats = db.get_library_stats(user["email"])
    return stats


@app.get("/api/library/{item_id}/similar")
async def get_similar_items(item_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    row = db.get_library_item(item_id, user["email"])
    if not row:
        raise HTTPException(status_code=404, detail="图片不存在")
    try:
        target_tags = json.loads(row["auto_tags"] or "{}")
    except Exception:
        target_tags = {}

    target_colors = set(target_tags.get("colors", []))
    target_styles = set(target_tags.get("style_keywords", []))
    target_sil = target_tags.get("silhouette", "")
    target_occ = set(target_tags.get("occasions", []))

    rows, _ = db.list_library_items(user["email"], limit=200)
    scored = []
    for r in rows:
        if r["id"] == item_id:
            continue
        try:
            t = json.loads(r["auto_tags"] or "{}")
        except Exception:
            continue
        score = (
            len(target_colors & set(t.get("colors", []))) * 2
            + len(target_styles & set(t.get("style_keywords", []))) * 3
            + (2 if target_sil and t.get("silhouette") == target_sil else 0)
            + len(target_occ & set(t.get("occasions", [])))
        )
        max_score = max(len(target_colors) * 2 + len(target_styles) * 3 + 2 + len(target_occ), 1)
        norm = score / max_score
        if norm >= 0.3:
            scored.append((_row_to_item(r), norm))
    scored.sort(key=lambda x: -x[1])
    return {"items": [x[0] for x in scored[:12]]}


@app.post("/api/library/analyze")
async def trigger_library_analyze(req: LibraryAnalyzeRequest):
    user = _require_user(req.auth_token)
    await _analyze_library_for_profile(user["email"], "personal")
    await _analyze_library_for_profile(user["email"], "designer")
    return {"status": "ok"}


@app.post("/api/library/retry-tags")
async def retry_failed_tags(req: RetryTagsRequest):
    user = _require_user(req.auth_token)
    rows, _ = db.list_library_items(user["email"], limit=500)
    count = 0
    for row in rows:
        if row["tag_status"] == "failed":
            db.update_library_item_tags(row["id"], {}, "pending")
            asyncio.create_task(_auto_tag_image(row["id"], row["image_url"], row["generation_prompt"] or ""))
            count += 1
    return {"status": "ok", "retrying": count}


@app.post("/api/library/suggest-outfit")
async def suggest_outfit(req: SuggestOutfitRequest):
    user = _require_user(req.auth_token)
    occasion = req.occasion or "通勤"
    weather = req.weather or {}
    temp = weather.get("temp", 20)
    condition = weather.get("condition", "")

    # Get tagged items
    rows, _ = db.list_library_items(user["email"], mode="personal", limit=200)
    tagged = [_row_to_item(r) for r in rows if r["tag_status"] == "completed"]
    if not tagged:
        return {"outfits": [], "message": "库中还没有足够的图片，先生成一些服装图片吧"}

    # Build tag summary
    item_summaries = []
    for item in tagged[:50]:
        t = item["auto_tags"]
        summary = f"ID:{item['id']} 类型:{','.join(t.get('garment_types',[]))} 颜色:{','.join(t.get('colors',[]))} 廓形:{t.get('silhouette','')} 场合:{','.join(t.get('occasions',[]))} 风格:{','.join(t.get('style_keywords',[]))}"
        item_summaries.append(summary)

    system_prompt = (
        "你是专业造型师。根据用户的穿搭库和今日场合，推荐2-3套搭配。"
        '严格按以下JSON返回：{"outfits":[{"description":"搭配说明（30字内）","item_ids":["id1","id2"],"tags":["标签"]}]}'
    )
    user_prompt = (
        f"今日场合：{occasion}\n天气：{condition} {temp}°C\n"
        f"用户穿搭库（共{len(tagged)}件）：\n" + "\n".join(item_summaries)
    )

    result = await _run_llm_summary(system_prompt, user_prompt)
    if not result:
        return {"outfits": [], "message": "AI 暂时无法生成搭配建议"}

    # Resolve item objects
    item_map = {item["id"]: item for item in tagged}
    outfits = []
    for outfit in result.get("outfits", []):
        items = [item_map[iid] for iid in outfit.get("item_ids", []) if iid in item_map]
        outfits.append({
            "description": outfit.get("description", ""),
            "items": items,
            "tags": outfit.get("tags", []),
        })
    return {"outfits": outfits}


# ═══════════════════════════════════════════════════
# Collections
# ═══════════════════════════════════════════════════

@app.get("/api/library/collections")
async def list_collections(authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    rows = db.list_collections(user["email"])
    result = []
    for row in rows:
        col = dict(row)
        col["item_count"] = db.get_collection_item_count(col["id"])
        col["cover_image"] = db.get_collection_cover(col["id"])
        col["is_smart"] = bool(col.get("is_smart"))
        result.append(col)
    return {"collections": result}


@app.post("/api/library/collections")
async def create_collection(req: CollectionCreateRequest):
    user = _require_user(req.auth_token)
    col_id = uuid.uuid4().hex
    db.create_collection(col_id, user["email"], req.name, mode=req.mode, designer_project_id=req.designer_project_id)
    row = db.get_collection(col_id, user["email"])
    col = dict(row)
    col["item_count"] = 0
    col["cover_image"] = None
    col["is_smart"] = False
    return {"collection": col}


@app.patch("/api/library/collections/{col_id}")
async def patch_collection(col_id: str, req: CollectionPatchRequest):
    user = _require_user(req.auth_token)
    kwargs = {}
    if req.name is not None:
        kwargs["name"] = req.name
    if req.cover_item_id is not None:
        kwargs["cover_item_id"] = req.cover_item_id
    if req.sort_order is not None:
        kwargs["sort_order"] = req.sort_order
    row = db.patch_collection(col_id, user["email"], **kwargs)
    if not row:
        raise HTTPException(status_code=404, detail="合集不存在")
    col = dict(row)
    col["item_count"] = db.get_collection_item_count(col_id)
    col["cover_image"] = db.get_collection_cover(col_id)
    col["is_smart"] = bool(col.get("is_smart"))
    return {"collection": col}


@app.delete("/api/library/collections/{col_id}")
async def delete_collection(col_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    ok = db.delete_collection(col_id, user["email"])
    if not ok:
        raise HTTPException(status_code=404, detail="合集不存在")
    return {"status": "ok"}


@app.post("/api/library/collections/{col_id}/items")
async def add_to_collection(col_id: str, req: CollectionItemsRequest):
    user = _require_user(req.auth_token)
    if not db.get_collection(col_id, user["email"]):
        raise HTTPException(status_code=404, detail="合集不存在")
    db.add_items_to_collection(col_id, req.item_ids)
    return {"status": "ok", "item_count": db.get_collection_item_count(col_id)}


@app.delete("/api/library/collections/{col_id}/items/{item_id}")
async def remove_from_collection(col_id: str, item_id: str, authorization: Optional[str] = Header(None)):
    token = (authorization or "").removeprefix("Bearer ").strip() or None
    user = _require_user(token)
    if not db.get_collection(col_id, user["email"]):
        raise HTTPException(status_code=404, detail="合集不存在")
    db.remove_item_from_collection(col_id, item_id)
    return {"status": "ok"}


# ═══════════════════════════════════════════════════
# Library → Personalization
# ═══════════════════════════════════════════════════

_LIBRARY_PERSONAL_SYSTEM = (
    "你是时尚造型顾问。根据用户穿搭库的加权风格统计，分析其风格偏好。"
    "严格按以下JSON返回，不输出任何其他内容：\n"
    '{"top_style_keywords":[{"tag":"关键词","confidence":0.85,"evidence":"来自库分析"}],'
    '"new_disliked_elements":[],"color_tendency":["色系"],'
    '"summary_note":"一句话概括（15字内）"}'
)

_LIBRARY_DESIGNER_SYSTEM = (
    "你是专业时尚编辑。根据设计师库的加权风格统计，分析其设计语言规律。"
    "严格按以下JSON返回，不输出任何其他内容：\n"
    '{"design_signatures":[{"pattern":"设计规律","confidence":0.85,"evidence":"来自库分析"}],'
    '"recurring_elements":["元素"],"emerging_direction":"风格走向（20字内）"}'
)


async def _analyze_library_for_profile(email: str, mode: str) -> None:
    """Fire-and-forget: analyze library tags and write back to profile."""
    try:
        stats = db.get_library_stats(email)
        if stats["total_count"] < 5:
            return

        top_tags = (
            stats["top_styles"][:10]
            + stats["top_colors"][:5]
            + stats["top_occasions"][:5]
            + stats["top_silhouettes"][:3]
        )
        tag_summary = ", ".join(f"{t['name']}({t['count']})" for t in top_tags)

        if mode == "personal":
            user_prompt = f"用户穿搭库共{stats['total_count']}张，收藏{stats['favorite_count']}张。\n加权标签统计：{tag_summary}\n请分析风格偏好。"
            result = await _run_llm_summary(_LIBRARY_PERSONAL_SYSTEM, user_prompt)
            if not result:
                return
            profile = db.get_personal_profile(email)
            profile.setdefault("dynamic", {})
            existing_tags = {k["tag"] for k in profile["dynamic"].get("inferred_keywords", [])}
            for kw in result.get("top_style_keywords", []):
                if kw.get("tag") and kw["tag"] not in existing_tags:
                    kw["evidence"] = kw.get("evidence", "") + "（库分析）"
                    profile["dynamic"].setdefault("inferred_keywords", []).append(kw)
            disliked = set(profile["dynamic"].get("disliked_elements", []))
            disliked.update(result.get("new_disliked_elements", []))
            profile["dynamic"]["disliked_elements"] = list(disliked)
            color = set(profile["dynamic"].get("color_tendency", []))
            color.update(result.get("color_tendency", []))
            profile["dynamic"]["color_tendency"] = list(color)
            profile["pending_review"] = {
                "type": "personal",
                "result": result,
                "generated_at": datetime.now().isoformat(),
                "source": "library",
            }
            db.save_personal_profile(email, profile)
        elif mode == "designer":
            workspace = db.get_designer_workspace(email)
            for proj in workspace.get("projects", []):
                if proj.get("status") != "active":
                    continue
                user_prompt = f"设计师项目「{proj['name']}」库分析。加权标签：{tag_summary}\n请提取设计规律。"
                result = await _run_llm_summary(_LIBRARY_DESIGNER_SYSTEM, user_prompt)
                if not result:
                    continue
                proj["pending_review"] = {
                    "type": "designer",
                    "result": result,
                    "generated_at": datetime.now().isoformat(),
                    "source": "library",
                }
                break
            db.save_designer_workspace(email, workspace)
    except Exception as e:
        print(f"[WARN] _analyze_library_for_profile failed: {e}")


async def _generate_smart_collections(email: str) -> None:
    """Auto-generate smart collections when library hits 30 items."""
    try:
        stats = db.get_library_stats(email)
        existing = db.list_collections(email)
        existing_names = {r["name"] for r in existing}

        # Rule 1: top color
        if stats["top_colors"] and stats["top_colors"][0]["count"] >= 5:
            name = f"你的{stats['top_colors'][0]['name']}系"
            if name not in existing_names:
                col_id = uuid.uuid4().hex
                db.create_collection(col_id, email, name, is_smart=True, smart_rule=f"top_color:{stats['top_colors'][0]['name']}")
                # Populate with matching items
                rows, _ = db.list_library_items(email, limit=200)
                color_val = stats["top_colors"][0]["name"]
                matched = [r["id"] for r in rows if color_val in json.loads(r["auto_tags"] or "{}").get("colors", [])]
                if matched:
                    db.add_items_to_collection(col_id, matched)

        # Rule 2: recent favorites
        name2 = "最近收藏"
        if name2 not in existing_names:
            col_id2 = uuid.uuid4().hex
            db.create_collection(col_id2, email, name2, is_smart=True, smart_rule="is_favorite:recent30")
            rows2, _ = db.list_library_items(email, is_favorite=True, limit=50)
            if rows2:
                db.add_items_to_collection(col_id2, [r["id"] for r in rows2])

        # Rule 3: designer active project collection
        workspace = db.get_designer_workspace(email)
        for proj in workspace.get("projects", []):
            if proj.get("status") == "active":
                name3 = f"{proj['name']} · 全部"
                if name3 not in existing_names:
                    col_id3 = uuid.uuid4().hex
                    db.create_collection(col_id3, email, name3, is_smart=True,
                                         smart_rule=f"project:{proj['id']}", designer_project_id=proj["id"])
                    rows3, _ = db.list_library_items(email, designer_project_id=proj["id"], limit=200)
                    if rows3:
                        db.add_items_to_collection(col_id3, [r["id"] for r in rows3])
                break
    except Exception as e:
        print(f"[WARN] _generate_smart_collections failed: {e}")


if __name__ == "__main__":
    import uvicorn
    print(f"[INFO] Starting AI Fashion Design Backend...")
    print(f"[INFO] Outputs dir: {OUTPUTS_DIR}")
    print(f"[INFO] Models: sketch={SKETCH_MODEL}, edit={EDIT_MODEL}, llm={LLM_MODEL}, vision={VISION_MODEL}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
