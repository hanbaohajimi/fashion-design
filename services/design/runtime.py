import os
import re
import json
import uuid
import secrets
import hashlib
import asyncio
import time
import urllib.request
import traceback
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from typing import Optional, AsyncGenerator, Tuple
from collections import defaultdict

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Header
from starlette.datastructures import UploadFile as StarletteUploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
from pwdlib import PasswordHash

import sqlite3 as _sqlite3

import db
from ai_clients import (
    TEXT_MODEL,
    IMAGE_MODEL,
    IMAGE_EDIT_MODEL,
    TRYON_MODEL,
    chat_with_tools,
    generate_image,
    simple_chat,
    vision_analyze,
)
from agents import ToolContext, ToolRegistry
from agents.tools import (
    DrawSketchTool,
    EditImageTool,
    GenerateImageTool,
    GenerateModelTool,
    TransferPatternTool,
    VirtualTryOnTool,
)
from agents.trace import JsonlToolTraceStore

OUTPUTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)
TRACE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "tool_traces")
os.makedirs(TRACE_DIR, exist_ok=True)

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
        self.current_asset_id: Optional[str] = None
        self.current_model_asset_id: Optional[str] = None
        self.current_tryon_asset_id: Optional[str] = None
        self.uploaded_assets: list[dict] = []
        self.project_assets: list[dict] = []
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
        self.project_id: Optional[str] = None
        self.design_id: Optional[str] = None
        self._hydrated_design_id: Optional[str] = None

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

    def save_image_bytes(self, data: bytes, prefix: str = "image") -> Optional[str]:
        try:
            unique_name = f"{prefix}_{uuid.uuid4().hex[:8]}.png"
            file_path = os.path.join(self.run_folder, unique_name)
            with open(file_path, "wb") as f:
                f.write(data)
            return os.path.abspath(file_path)
        except Exception as e:
            print(f"[ERROR] save_image_bytes failed: {e}")
            return None

    def get_image_url(self, abs_path: str) -> str:
        rel = os.path.relpath(abs_path, OUTPUTS_DIR)
        return f"/api/design/images/{rel.replace(os.sep, '/')}"

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
        self.current_asset_id = None
        self.current_model_asset_id = None
        self.current_tryon_asset_id = None
        self.uploaded_assets = []
        self.project_assets = []
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
        parent_asset_id = self.current_asset_id if img_type in {"edit_image", "transfer_pattern", "try_on"} else None
        entry = {
            "url": url,
            "type": img_type,
            "path": file_path,
            "time": datetime.now().isoformat(),
            "id": uuid.uuid4().hex[:12],
        }
        self.generated_images.append(entry)
        entry["parent_asset_id"] = parent_asset_id
        self.stats["images_generated"] += 1
        if img_type == "generate_model":
            self.current_model_asset_id = entry["id"]
        elif img_type == "try_on":
            self.current_tryon_asset_id = entry["id"]
        else:
            self.current_asset_id = entry["id"]
        # Auto-save to library if user is authenticated
        if self.user_email:
            item_id = entry["id"]
            user_email = self.user_email
            project_id = self.project_id
            session_id = self.session_id
            prompt = self.last_user_text
            try:
                db.create_generation_asset(
                    item_id,
                    user_email,
                    url,
                    design_id=self.design_id,
                    project_id=project_id,
                    session_id=session_id,
                    parent_asset_id=parent_asset_id,
                    file_path=file_path,
                    kind=img_type,
                    prompt=prompt,
                    model_name=IMAGE_MODEL,
                    tool_name=img_type,
                )
            except Exception as exc:
                print(f"[WARN] generation asset persist failed: {exc}")
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(_auto_save_to_library(
                        item_id, user_email, url, session_id, prompt, project_id, img_type
                    ))
            except Exception:
                pass
        return entry

    def apply_personalization_context(self, personalization_ctx: str) -> None:
        combined = SYSTEM_PROMPT + ("\n\n" + personalization_ctx if personalization_ctx else "")
        if self.chat_history and self.chat_history[0].get("role") == "system":
            self.chat_history[0] = {"role": "system", "content": combined}
        else:
            self.chat_history.insert(0, {"role": "system", "content": combined})

    def sync_project_assets(self, user_email: str, project_id: Optional[str]) -> None:
        """Refresh enabled visual project references without mixing them into per-message uploads."""
        self.project_assets = []
        if not project_id:
            return
        try:
            rows = db.list_project_assets(project_id, user_email, enabled_only=True)
        except Exception:
            return
        for row in rows:
            path = row["file_path"]
            if path and os.path.isfile(path) and row["image_url"]:
                self.project_assets.append({
                    "id": row["id"],
                    "path": path,
                    "name": row["name"],
                    "kind": row["kind"],
                })

    def hydrate(self, user_email: str, design_id: Optional[str], project_id: Optional[str]) -> None:
        """Rebuild durable Agent context after navigation, TTL expiry, or restart."""
        self.user_email = user_email
        self.design_id = design_id
        self.project_id = project_id
        if not design_id or self._hydrated_design_id == design_id:
            return

        rows = db.list_messages(design_id)
        durable_history: list[dict] = [self.chat_history[0]]
        for row in rows[-(MAX_HISTORY - 1):]:
            role = str(row["role"] or "")
            if role not in {"user", "assistant"}:
                continue
            content = str(row["content"] or "")
            try:
                images = json.loads(row["images"] or "[]")
            except Exception:
                images = []
            if role == "assistant" and images:
                image_refs = ", ".join(
                    str(item.get("url")) for item in images if isinstance(item, dict) and item.get("url")
                )
                if image_refs:
                    content = f"{content}\n[本轮生成资产: {image_refs}]"
            durable_history.append({"role": role, "content": content})
        self.chat_history = durable_history

        assets = db.list_generation_assets(user_email, design_id=design_id, limit=100)
        self.generated_images = []
        self.uploaded_assets = []
        for row in assets:
            entry = {
                "id": row["id"],
                "url": row["image_url"],
                "type": row["kind"],
                "path": row["file_path"],
                "time": row["created_at"],
                "parent_asset_id": row["parent_asset_id"],
            }
            if row["kind"] == "upload":
                self.uploaded_assets.append({
                    "id": row["id"],
                    "path": row["file_path"],
                    "name": _json_safe_metadata(row["metadata"]).get("name") or "历史上传",
                })
                continue
            self.generated_images.append(entry)
            if row["kind"] == "generate_model":
                self.current_model_path = row["file_path"]
                self.current_model_asset_id = row["id"]
            elif row["kind"] == "try_on":
                self.current_tryon_path = row["file_path"]
                self.current_tryon_asset_id = row["id"]
            else:
                self.current_image_path = row["file_path"]
                self.current_asset_id = row["id"]
        self._hydrated_design_id = design_id

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
        n_project = len([a for a in self.project_assets if self._file_ok(a.get("path"))])
        has_upload = n_upload > 0
        has_tryon = self._file_ok(self.current_tryon_path)

        lines = [
            "\n\n【会话状态快照】（供决策，勿逐字读给用户）",
            f"- 默认主服装图（编辑/图案目标/试穿·服装侧）: {'已就绪' if has_design else '**缺失** — 需文生图/草图/上传后再编辑或试穿'}",
            f"- 默认模特图（试穿·人物侧）: {'已就绪' if has_model else '**缺失** — 用户要试穿须先 tool_generate_model'}",
            f"- 用户本消息上传参考图: {n_upload} 张（资源表 **用户上传·第N张** 按上传顺序编号；@图N/第二张等均对应该顺序）" if has_upload else "- 用户本消息上传参考图: 无",
            f"- 项目启用视觉参考: {n_project} 张（按需从资源表引用，不替代用户本轮明确上传）",
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
        for i, a in enumerate(self.project_assets):
            path = a.get("path")
            if not self._file_ok(path) or path in seen:
                continue
            seen.add(path)
            name = (a.get("name") or f"project_reference_{i + 1}")[:80]
            lines.append(
                f"- **项目参考·第{i + 1}张** 「{name}」 [id:{a.get('id') or ''}] [project_reference_{i + 1}]: {path}"
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


def _json_safe_metadata(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def get_session(
    session_id: str,
    personalization_ctx: str = "",
    *,
    user_email: Optional[str] = None,
    design_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Session:
    cleanup_expired_sessions()
    if session_id not in sessions:
        sessions[session_id] = Session(session_id, personalization_ctx)
    session = sessions[session_id]
    session.apply_personalization_context(personalization_ctx)
    if user_email:
        session.hydrate(user_email, design_id, project_id)
        session.sync_project_assets(user_email, project_id)
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
    neg = NEGATIVE_PROMPTS["text_to_image"]
    full_prompt = f"{text}\n\nAvoid: {neg}"
    print(f"[TOOL] text_to_image [{aspect}]: {text[:80]}...")
    try:
        img_bytes = _call_with_retry(generate_image, full_prompt, aspect=aspect)
        path = session.save_image_bytes(img_bytes, "t2i")
        if path:
            session.current_image_path = path
            url = session.get_image_url(path)
            entry = session.record_image(url, "text_to_image", path)
            session.stats["tool_calls"] += 1
            return {"status": "success", "file_path": path, "url": url, "id": entry["id"], "parent_asset_id": entry.get("parent_asset_id")}
        session.stats["errors"] += 1
        return {"status": "error", "message": "图片保存失败"}
    except Exception as e:
        print(f"[ERROR] text_to_image exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


def tool_draw_sketch(session: Session, detailed_prompt: str) -> dict:
    neg = NEGATIVE_PROMPTS["draw_sketch"]
    full_prompt = f"{detailed_prompt}\n\nAvoid: {neg}"
    print(f"[TOOL] draw_sketch: {detailed_prompt[:80]}...")
    try:
        img_bytes = _call_with_retry(generate_image, full_prompt, aspect="square")
        path = session.save_image_bytes(img_bytes, "sketch")
        if path:
            session.current_image_path = path
            url = session.get_image_url(path)
            entry = session.record_image(url, "draw_sketch", path)
            session.stats["tool_calls"] += 1
            return {"status": "success", "file_path": path, "url": url, "id": entry["id"], "parent_asset_id": entry.get("parent_asset_id")}
        session.stats["errors"] += 1
        return {"status": "error", "message": "图片保存失败"}
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
        img_bytes = _call_with_retry(generate_image, final_instruction, reference_paths=[real_path])
        path = session.save_image_bytes(img_bytes, "edit")
        if path:
            session.current_image_path = path
            url = session.get_image_url(path)
            entry = session.record_image(url, "edit_image", path)
            session.stats["tool_calls"] += 1
            return {"status": "success", "file_path": path, "url": url, "id": entry["id"], "parent_asset_id": entry.get("parent_asset_id")}
        session.stats["errors"] += 1
        return {"status": "error", "message": "图片编辑保存失败"}
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
        img_bytes = _call_with_retry(
            generate_image, instruction,
            reference_paths=[real_dress, real_pattern],
        )
        path = session.save_image_bytes(img_bytes, "pattern")
        if path:
            session.current_image_path = path
            url = session.get_image_url(path)
            entry = session.record_image(url, "transfer_pattern", path)
            session.stats["tool_calls"] += 1
            return {"status": "success", "file_path": path, "url": url, "id": entry["id"], "parent_asset_id": entry.get("parent_asset_id")}
        session.stats["errors"] += 1
        return {"status": "error", "message": "图案迁移保存失败"}
    except Exception as e:
        print(f"[ERROR] transfer_pattern exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


def tool_generate_model(session: Session, model_prompt: str) -> dict:
    neg = NEGATIVE_PROMPTS["generate_model"]
    full_prompt = f"{model_prompt}\n\nAvoid: {neg}"
    print(f"[TOOL] generate_model: {model_prompt[:80]}...")
    try:
        img_bytes = _call_with_retry(generate_image, full_prompt, aspect="portrait")
        path = session.save_image_bytes(img_bytes, "model")
        if path:
            session.current_model_path = path
            url = session.get_image_url(path)
            entry = session.record_image(url, "generate_model", path)
            session.stats["tool_calls"] += 1
            return {"status": "success", "file_path": path, "url": url, "id": entry["id"], "parent_asset_id": entry.get("parent_asset_id")}
        session.stats["errors"] += 1
        return {"status": "error", "message": "模特生成保存失败"}
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
        img_bytes = _call_with_retry(
            generate_image, instruction,
            reference_paths=[model_path, dress_path],
        )
        path = session.save_image_bytes(img_bytes, "tryon")
        if path:
            session.current_tryon_path = path
            url = session.get_image_url(path)
            entry = session.record_image(url, "try_on", path)
            session.stats["tool_calls"] += 1
            return {"status": "success", "file_path": path, "url": url, "id": entry["id"], "parent_asset_id": entry.get("parent_asset_id")}
        session.stats["errors"] += 1
        return {"status": "error", "message": "虚拟试穿保存失败"}
    except Exception as e:
        print(f"[ERROR] try_on exception: {e}")
        session.stats["errors"] += 1
        return {"status": "error", "message": str(e)}


# ─── Tool dispatch ───

_LEGACY_TOOL_RUNNERS = {
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

_OPENAI_TOOL_DEFS = {
    tool["function"]["name"]: tool["function"]
    for tool in TOOLS
    if isinstance(tool, dict) and tool.get("type") == "function" and tool.get("function")
}


def _tool_description(name: str, fallback: str) -> str:
    return str(_OPENAI_TOOL_DEFS.get(name, {}).get("description") or fallback)


def _tool_schema(name: str) -> dict:
    return dict(_OPENAI_TOOL_DEFS.get(name, {}).get("parameters") or {"type": "object", "properties": {}})


TOOL_REGISTRY = ToolRegistry(
    tools=[
        GenerateImageTool(
            name="tool_text_to_image",
            description=_tool_description("tool_text_to_image", "Generate a fashion image from text."),
            input_schema=_tool_schema("tool_text_to_image"),
            runner=_LEGACY_TOOL_RUNNERS["tool_text_to_image"],
            model_name=IMAGE_MODEL,
            parallel_safe=True,
        ),
        DrawSketchTool(
            name="tool_draw_sketch",
            description=_tool_description("tool_draw_sketch", "Generate a black and white fashion sketch."),
            input_schema=_tool_schema("tool_draw_sketch"),
            runner=_LEGACY_TOOL_RUNNERS["tool_draw_sketch"],
            model_name=IMAGE_MODEL,
            parallel_safe=True,
        ),
        EditImageTool(
            name="tool_edit_image",
            description=_tool_description("tool_edit_image", "Edit an existing image."),
            input_schema=_tool_schema("tool_edit_image"),
            runner=_LEGACY_TOOL_RUNNERS["tool_edit_image"],
            model_name=IMAGE_EDIT_MODEL,
        ),
        TransferPatternTool(
            name="tool_transfer_pattern",
            description=_tool_description("tool_transfer_pattern", "Transfer a pattern to a garment image."),
            input_schema=_tool_schema("tool_transfer_pattern"),
            runner=_LEGACY_TOOL_RUNNERS["tool_transfer_pattern"],
            model_name=IMAGE_EDIT_MODEL,
        ),
        GenerateModelTool(
            name="tool_generate_model",
            description=_tool_description("tool_generate_model", "Generate a fashion model image."),
            input_schema=_tool_schema("tool_generate_model"),
            runner=_LEGACY_TOOL_RUNNERS["tool_generate_model"],
            model_name=IMAGE_MODEL,
            parallel_safe=True,
        ),
        VirtualTryOnTool(
            name="tool_try_on",
            description=_tool_description("tool_try_on", "Combine a garment image with a model image."),
            input_schema=_tool_schema("tool_try_on"),
            runner=_LEGACY_TOOL_RUNNERS["tool_try_on"],
            model_name=TRYON_MODEL,
        ),
    ],
    trace_store=JsonlToolTraceStore(os.path.join(TRACE_DIR, "tool_calls.jsonl")),
)

TOOLS = TOOL_REGISTRY.openai_tools()

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
    project_id: Optional[str] = None
    design_id: Optional[str] = None
    trend_id: Optional[str] = None
    trend_enabled: bool = False
    capability_id: Optional[str] = None  # 前端明确指定的能力，后端优先按此路由工具

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

def _normalize_tool_call(tc) -> dict:
    """统一 tool_call 为 dict 形式(chat_with_tools 直接返回 dict;此函数对 dict 无副作用)。"""
    if isinstance(tc, dict):
        return tc
    return {
        "id": tc.id,
        "type": "function",
        "function": {
            "name": tc.function.name,
            "arguments": tc.function.arguments,
        },
    }


def _can_run_parallel(tool_calls) -> bool:
    """Check if all tool calls are independent (no image dependencies between them)."""
    names = [tc["function"]["name"] for tc in tool_calls]
    return all(TOOL_REGISTRY.is_parallel_safe(n) for n in names)


def _make_tool_context(session: Session, tool_call: dict) -> ToolContext:
    return ToolContext(
        session=session,
        session_id=session.session_id,
        tool_call_id=tool_call.get("id") or uuid.uuid4().hex,
        model_name=IMAGE_MODEL,
        trace_dir=TRACE_DIR,
    )


async def _execute_tool_calls_parallel(session, tool_calls):
    """Execute independent tool calls concurrently."""
    async def run_one(tc):
        func_name = tc["function"]["name"]
        args, perr = _parse_tool_arguments(tc["function"].get("arguments"))
        if args is None:
            return tc, {"status": "error", "message": perr or "参数解析失败"}
        return tc, await TOOL_REGISTRY.run(func_name, args, _make_tool_context(session, tc))

    tasks = [run_one(tc) for tc in tool_calls]
    return await asyncio.gather(*tasks)


# ─── Chat streaming ───

async def stream_chat(session: Session, message: str, capability_id: Optional[str] = None) -> AsyncGenerator[str, None]:
    session.last_user_text = (message or "").strip()

    yield json.dumps({"type": "status", "content": "正在思考..."}, ensure_ascii=False) + "\n"

    # ── capability_id 约束注入 ──────────────────────────────────────────────
    # 当前端传入合法的 capability_id 时，在上下文中明确告知 LLM 应优先调用哪个工具。
    # 这是方案 A（最小侵入）：不过滤工具列表，只追加强约束提示，让 LLM 确定性地选择工具。
    VALID_CAPABILITY_IDS = {
        "text_to_image", "draw_sketch", "edit_image",
        "transfer_pattern", "generate_model", "try_on",
    }
    CAPABILITY_TOOL_NAMES = {
        "text_to_image":   "tool_text_to_image",
        "draw_sketch":     "tool_draw_sketch",
        "edit_image":      "tool_edit_image",
        "transfer_pattern":"tool_transfer_pattern",
        "generate_model":  "tool_generate_model",
        "try_on":          "tool_try_on",
    }
    capability_hint = ""
    effective_tools = TOOLS  # 默认：完整工具列表
    if capability_id:
        if capability_id in VALID_CAPABILITY_IDS:
            tool_name = CAPABILITY_TOOL_NAMES[capability_id]
            capability_hint = (
                f"\n\n[SYSTEM CONSTRAINT] 本次任务已由前端明确指定能力：{capability_id}。"
                f"请优先调用工具 {tool_name}，不要调用其他核心生成工具，除非用户的文本明确要求不同的操作。"
            )
            # ── 工具硬约束：只暴露对应核心工具 ─────────────────────────────
            # 六个核心生成工具名称
            CORE_GENERATION_TOOLS = {
                "tool_text_to_image", "tool_draw_sketch", "tool_edit_image",
                "tool_transfer_pattern", "tool_generate_model", "tool_try_on",
            }
            # 过滤 TOOLS：保留指定核心工具 + 所有非核心辅助工具
            effective_tools = [
                t for t in TOOLS
                if t.get("function", {}).get("name") not in CORE_GENERATION_TOOLS
                or t.get("function", {}).get("name") == tool_name
            ]
        else:
            import logging
            logging.getLogger(__name__).warning(
                "[stream_chat] 收到非法 capability_id=%r，忽略并使用 LLM 意图判断", capability_id
            )

    ctx = session.build_workflow_context_block() + session.build_assets_context_block()
    session.chat_history.append({"role": "user", "content": message + ctx + capability_hint})
    session.trim_history()

    try:
        assistant_msg = await asyncio.to_thread(
            chat_with_tools, session.chat_history, effective_tools,
        )
        session.chat_history.append(assistant_msg)

        images: list[dict] = []

        if assistant_msg.get("tool_calls"):
            tool_calls = assistant_msg["tool_calls"]
            parallel = _can_run_parallel(tool_calls)

            if parallel and len(tool_calls) > 1:
                names_cn = [TOOL_NAMES_CN.get(tc["function"]["name"], tc["function"]["name"]) for tc in tool_calls]
                yield json.dumps({"type": "status", "content": f"并行执行: {', '.join(names_cn)}..."}, ensure_ascii=False) + "\n"

                results = await _execute_tool_calls_parallel(session, tool_calls)
                for tc, result in results:
                    result_json = json.dumps(result, ensure_ascii=False)
                    session.chat_history.append({
                        "role": "tool", "tool_call_id": tc["id"],
                        "name": tc["function"]["name"], "content": result_json
                    })
                    if result.get("status") == "success" and result.get("url"):
                        info = {
                            "url": result["url"],
                            "type": tc["function"]["name"].replace("tool_", ""),
                            "asset_id": result.get("id"),
                            "parent_asset_id": result.get("parent_asset_id"),
                            "trace_id": result.get("trace_id"),
                            "model_name": result.get("model_name"),
                            "tool_name": result.get("tool_name"),
                        }
                        images.append(info)
                        yield json.dumps({**info, "type": "image", "original_url": info["url"], "image_type": info["type"]}, ensure_ascii=False) + "\n"
                    elif result.get("status") == "error":
                        et = result.get("message", "工具执行失败")
                        if result.get("workflow_hint"):
                            et = f"{et}（建议：{result['workflow_hint']}）"
                        yield json.dumps({"type": "error", "content": et}, ensure_ascii=False) + "\n"
                _append_tool_round_sync(session)
                session.trim_history()
            else:
                for tool_call in tool_calls:
                    func_name = tool_call["function"]["name"]
                    args, perr = _parse_tool_arguments(tool_call["function"].get("arguments"))
                    cn_name = TOOL_NAMES_CN.get(func_name, func_name)
                    yield json.dumps({"type": "status", "content": f"正在{cn_name}..."}, ensure_ascii=False) + "\n"

                    if args is None:
                        result = {"status": "error", "message": perr or "参数解析失败"}
                    else:
                        result = await TOOL_REGISTRY.run(
                            func_name, args, _make_tool_context(session, tool_call)
                        )

                    result_json = json.dumps(result, ensure_ascii=False)
                    session.chat_history.append({
                        "role": "tool", "tool_call_id": tool_call["id"],
                        "name": func_name, "content": result_json
                    })

                    if result.get("status") == "success" and result.get("url"):
                        info = {
                            "url": result["url"],
                            "type": func_name.replace("tool_", ""),
                            "asset_id": result.get("id"),
                            "parent_asset_id": result.get("parent_asset_id"),
                            "trace_id": result.get("trace_id"),
                            "model_name": result.get("model_name"),
                            "tool_name": result.get("tool_name"),
                        }
                        images.append(info)
                        yield json.dumps({**info, "type": "image", "original_url": info["url"], "image_type": info["type"]}, ensure_ascii=False) + "\n"
                    elif result.get("status") == "error":
                        et = result.get("message", "工具执行失败")
                        if result.get("workflow_hint"):
                            et = f"{et}（建议：{result['workflow_hint']}）"
                        yield json.dumps({"type": "error", "content": et}, ensure_ascii=False) + "\n"
                _append_tool_round_sync(session)
                session.trim_history()

            for _round in range(MAX_TOOL_ROUNDS):
                yield json.dumps({"type": "status", "content": "正在生成回复..."}, ensure_ascii=False) + "\n"

                follow_msg = await asyncio.to_thread(
                    chat_with_tools, session.chat_history, TOOLS,
                )
                session.chat_history.append(follow_msg)

                if not follow_msg.get("tool_calls"):
                    final_text = follow_msg.get("content") or ""
                    yield json.dumps({"type": "message", "content": final_text, "images": images}, ensure_ascii=False) + "\n"
                    break

                for tool_call in follow_msg["tool_calls"]:
                    func_name = tool_call["function"]["name"]
                    args, perr = _parse_tool_arguments(tool_call["function"].get("arguments"))
                    cn_name = TOOL_NAMES_CN.get(func_name, func_name)
                    yield json.dumps({"type": "status", "content": f"正在{cn_name}..."}, ensure_ascii=False) + "\n"

                    if args is None:
                        result = {"status": "error", "message": perr or "参数解析失败"}
                    else:
                        result = await TOOL_REGISTRY.run(
                            func_name, args, _make_tool_context(session, tool_call)
                        )

                    result_json = json.dumps(result, ensure_ascii=False)
                    session.chat_history.append({
                        "role": "tool", "tool_call_id": tool_call["id"],
                        "name": func_name, "content": result_json
                    })

                    if result.get("status") == "success" and result.get("url"):
                        info = {
                            "url": result["url"],
                            "type": func_name.replace("tool_", ""),
                            "asset_id": result.get("id"),
                            "parent_asset_id": result.get("parent_asset_id"),
                            "trace_id": result.get("trace_id"),
                            "model_name": result.get("model_name"),
                            "tool_name": result.get("tool_name"),
                        }
                        images.append(info)
                        yield json.dumps({**info, "type": "image", "original_url": info["url"], "image_type": info["type"]}, ensure_ascii=False) + "\n"
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
            text = assistant_msg.get("content") or ""
            yield json.dumps({"type": "message", "content": text, "images": []}, ensure_ascii=False) + "\n"

    except Exception as e:
        print(f"[ERROR] stream_chat exception: {traceback.format_exc()}")
        session.stats["errors"] += 1
        yield json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False) + "\n"

    yield json.dumps({"type": "done"}, ensure_ascii=False) + "\n"


# ─── API Endpoints ───



async def _safe_stream_chat(session: Session, message: str, capability_id: Optional[str] = None):
    try:
        async for chunk in stream_chat(session, message, capability_id=capability_id):
            yield chunk
    except Exception as e:
        print(f"[ERROR] stream_chat exception: {traceback.format_exc()}")
        yield json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False) + "\n"
        yield json.dumps({"type": "done"}, ensure_ascii=False) + "\n"
















# ─── New: Prompt Enhancement ───



# ─── New: Image Analysis ───



# ─── New: Favorites ───







# ─── New: Session statistics ───



# ─── New: Export session as design board ───





# ═══════════════════════════════════════════════════
# Auth helpers
# ═══════════════════════════════════════════════════

_password_hash = PasswordHash.recommended()
_auth_context: ContextVar[Optional[tuple[_sqlite3.Row, str]]] = ContextVar(
    "auth_context",
    default=None,
)
AUTH_IDLE_TIMEOUT_MINUTES = max(
    1,
    int(os.environ.get("AUTH_IDLE_TIMEOUT_MINUTES", "60")),
)
AUTH_ABSOLUTE_TIMEOUT_HOURS = max(
    1,
    int(os.environ.get("AUTH_ABSOLUTE_TIMEOUT_HOURS", "168")),
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_password(password: str) -> str:
    return _password_hash.hash(password)


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        return _password_hash.verify(password, stored_hash)
    except Exception:
        return False


def _hash_auth_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _issue_auth_session(email: str) -> tuple[str, str]:
    now = _utc_now()
    expires_at = now + timedelta(hours=AUTH_ABSOLUTE_TIMEOUT_HOURS)
    token = secrets.token_urlsafe(32)
    db.delete_expired_auth_sessions(now.isoformat())
    db.create_auth_session(
        session_id=uuid.uuid4().hex,
        user_email=email,
        token_hash=_hash_auth_token(token),
        created_at=now.isoformat(),
        expires_at=expires_at.isoformat(),
    )
    return token, expires_at.isoformat()


def _authenticate_token(token: str) -> Optional[_sqlite3.Row]:
    now = _utc_now()
    idle_cutoff = now - timedelta(minutes=AUTH_IDLE_TIMEOUT_MINUTES)
    return db.get_user_by_session(
        _hash_auth_token(token),
        now.isoformat(),
        idle_cutoff.isoformat(),
    )


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _require_user(auth_token: Optional[str] = None) -> _sqlite3.Row:
    context = _auth_context.get()
    if context is not None and auth_token is None:
        return context[0]
    user = _authenticate_token(auth_token) if auth_token else None
    if not user:
        raise HTTPException(status_code=401, detail="Token 无效或已过期")
    return user


def _ensure_owned_session(
    user_email: str,
    session_id: str,
    *,
    project_id: Optional[str] = None,
    design_id: Optional[str] = None,
    create_if_missing: bool = True,
) -> Optional[str]:
    """Return the design id bound to this session after checking ownership."""
    existing = db.get_chat_session(session_id)
    if existing:
        if existing["user_email"] != user_email:
            raise HTTPException(status_code=404, detail="会话不存在")
        return existing["design_id"] or design_id

    target_design_id = design_id or session_id
    design = db.get_design(target_design_id, user_email)
    if design:
        db.create_chat_session(
            session_id,
            user_email,
            design["project_id"],
            design_id=target_design_id,
        )
        return target_design_id

    if create_if_missing:
        db.create_chat_session(session_id, user_email, project_id, design_id=design_id)
        return design_id

    raise HTTPException(status_code=404, detail="会话不存在")


_PUBLIC_API_PATHS = {
    "/api/health",
    "/api/auth/register",
    "/api/auth/login",
}
_PUBLIC_API_PREFIXES = (
    "/api/images/",
    "/api/tryon/preset-images/",
    "/api/tryon/presets/",
)


async def authenticate_api_requests(request: Request, call_next):
    path = request.url.path
    if (
        request.method == "OPTIONS"
        or not path.startswith("/api/")
        or path in _PUBLIC_API_PATHS
        or path.startswith(_PUBLIC_API_PREFIXES)
    ):
        return await call_next(request)

    raw_token = _extract_bearer_token(request.headers.get("Authorization"))
    user = _authenticate_token(raw_token) if raw_token else None
    if not user:
        return JSONResponse(
            status_code=401,
            content={"detail": "Token 无效、已过期或会话已注销"},
        )

    context_token = _auth_context.set((user, _hash_auth_token(raw_token)))
    try:
        return await call_next(request)
    finally:
        _auth_context.reset(context_token)


# ═══════════════════════════════════════════════════
# Auth endpoints
# ═══════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    email: str
    name: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str












# ═══════════════════════════════════════════════════
# Personalization helpers
# ═══════════════════════════════════════════════════

def _build_personalization_context(
    personal_profile: dict,
    project: Optional[dict] = None,
) -> str:
    contexts: list[str] = []

    if personal_profile.get("meta", {}).get("onboarding_completed"):
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
        contexts.append("\n".join(lines))

    if project:
        b = project.get("brief", {})
        dl = project.get("design_language", {})
        dyn = project.get("dynamic", {})
        sigs = [
            s["pattern"] for s in (dyn.get("design_signatures") or [])
            if s.get("confidence", 0) >= 0.65
        ][:5]
        lines = [f"=== 当前项目设计档案：{project.get('name','')} ==="]
        if project.get("description"):
            lines.append(f"项目简介：{str(project['description'])[:2000]}")
        if project.get("instructions"):
            lines.append(f"项目强制规则：{str(project['instructions'])[:3000]}")
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
        # Project-level trend anchors
        trend_ctx = _build_project_trend_context(project)
        if trend_ctx:
            lines.append(trend_ctx)
        try:
            knowledge_rows = db.list_project_assets(project.get("id", ""), project.get("user_email", ""), enabled_only=True)
        except Exception:
            knowledge_rows = []
        if knowledge_rows:
            lines.append("项目知识资料：")
            for row in knowledge_rows[:12]:
                text = str(row["extracted_text"] or "").strip()
                if text:
                    lines.append(f"- {row['name']}：{text[:1800]}")
                elif row["image_url"]:
                    lines.append(f"- 视觉参考「{row['name']}」：{row['image_url']}")
        lines += [
            "",
            "原则：以上是该项目已建立的设计语言，在生成时保持风格一致性。",
            "若设计师本次指令探索新方向，忠实执行，不要强行向历史风格靠拢。",
            "回复使用专业时装设计术语，不需要解释基础概念。",
            "=== 档案结束 ===",
        ]
        contexts.append("\n".join(lines))

    return "\n\n".join(contexts)


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
        local_path = image_url
        if local_path.startswith("/api/design/images/"):
            rel = local_path.removeprefix("/api/design/images/")
            local_path = os.path.join(OUTPUTS_DIR, rel.replace("/", os.sep))
        if not os.path.exists(local_path):
            db.update_library_item_tags(item_id, {}, "failed")
            return

        raw = await asyncio.to_thread(
            vision_analyze, local_path, _AUTO_TAG_SYSTEM + "\n\n" + tag_prompt,
        )
        raw = (raw or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            raw = raw.rsplit("```", 1)[0]
        tags = json.loads(raw)
        db.update_library_item_tags(item_id, tags, "completed")
        # Detect trend alignment after tagging
        asyncio.create_task(_detect_trend_alignment(item_id, tags))
    except Exception as e:
        print(f"[WARN] auto_tag_image failed for {item_id}: {e}")
        db.update_library_item_tags(item_id, {}, "failed")


async def _auto_save_to_library(
    item_id: str,
    user_email: str,
    image_url: str,
    session_id: str,
    prompt: str,
    project_id: Optional[str],
    img_type: str,
) -> None:
    """Fire-and-forget: save image to library then trigger auto-tagging."""
    try:
        db.create_library_item(item_id, user_email, image_url, session_id, prompt, project_id, img_type)
        asyncio.create_task(_auto_tag_image(item_id, image_url, prompt))
        # Check if smart collections should be generated
        total = db.count_library_items(user_email)
        if total == 30:
            asyncio.create_task(_generate_smart_collections(user_email))
        # Trigger library-based profile analysis at thresholds
        if total in (20, 50, 100):
            asyncio.create_task(_analyze_library_for_profile(user_email))
            if project_id:
                asyncio.create_task(_analyze_library_for_profile(user_email, project_id))
    except Exception as e:
        print(f"[WARN] _auto_save_to_library failed: {e}")


async def _async_update_signals(
    email: str,
    project_id: Optional[str],
    user_message: str,
) -> None:
    """Fire-and-forget signal extraction — never raises."""
    try:
        signals = _extract_personal_signals(user_message)
        if any(signals.values()):
            profile = db.get_personal_profile(email)
            profile = _apply_personal_signals(profile, signals)
            db.save_personal_profile(email, profile)
        if project_id:
            project_signals = _extract_designer_signals(user_message)
            if not any(project_signals.values()):
                return
            workspace = db.get_designer_workspace(email)
            workspace = _apply_designer_signals(workspace, project_id, project_signals)
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
        raw = await asyncio.to_thread(
            simple_chat,
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        raw = (raw or "").strip()
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
    static: dict

class PersonalStaticPatchRequest(BaseModel):
    static: dict

class ProfileConfirmRequest(BaseModel):
    accepted_items: list  # list of accepted diff items

class DesignerProjectCreateRequest(BaseModel):
    name: str
    brief: dict = {}
    design_language: dict = {}

class DesignerProjectPatchRequest(BaseModel):
    name: Optional[str] = None
    brief: Optional[dict] = None
    design_language: Optional[dict] = None
    status: Optional[str] = None
    status: Optional[str] = None

class DesignerProjectAnalyzeRequest(BaseModel):
    pass

class DesignerProjectConfirmRequest(BaseModel):
    accepted_items: list

class PersonalAnalyzeRequest(BaseModel):
    pass

class CreateSessionRequest(BaseModel):
    project_id: Optional[str] = None
    trend_id: Optional[str] = None
    trend_enabled: bool = False












# ═══════════════════════════════════════════════════
# Designer Workspace endpoints
# ═══════════════════════════════════════════════════













# ═══════════════════════════════════════════════════
# Conversation session creation
# ═══════════════════════════════════════════════════



# ═══════════════════════════════════════════════════
# Library — request models
# ═══════════════════════════════════════════════════

class LibraryPatchRequest(BaseModel):
    is_favorite: Optional[bool] = None
    user_tags: Optional[list] = None
    notes: Optional[str] = None
    save_context: Optional[str] = None

class CollectionCreateRequest(BaseModel):
    name: str
    project_id: Optional[str] = None

class CollectionPatchRequest(BaseModel):
    name: Optional[str] = None
    cover_item_id: Optional[str] = None
    sort_order: Optional[int] = None

class CollectionItemsRequest(BaseModel):
    item_ids: list

class SuggestOutfitRequest(BaseModel):
    occasion: Optional[str] = None
    weather: Optional[dict] = None

class LibraryAnalyzeRequest(BaseModel):
    pass

class RetryTagsRequest(BaseModel):
    pass


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

















# ═══════════════════════════════════════════════════
# Collections
# ═══════════════════════════════════════════════════













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


async def _analyze_library_for_profile(email: str, project_id: Optional[str] = None) -> None:
    """Fire-and-forget: analyze library tags and write back to profile."""
    try:
        stats = db.get_library_stats(email, project_id)
        if stats["total_count"] < 5:
            return

        top_tags = (
            stats["top_styles"][:10]
            + stats["top_colors"][:5]
            + stats["top_occasions"][:5]
            + stats["top_silhouettes"][:3]
        )
        tag_summary = ", ".join(f"{t['name']}({t['count']})" for t in top_tags)

        if not project_id:
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
        else:
            workspace = db.get_designer_workspace(email)
            project = next(
                (proj for proj in workspace.get("projects", []) if proj.get("id") == project_id),
                None,
            )
            if not project:
                return
            user_prompt = f"项目「{project['name']}」库分析。加权标签：{tag_summary}\n请提取设计规律。"
            result = await _run_llm_summary(_LIBRARY_DESIGNER_SYSTEM, user_prompt)
            if not result:
                return
            project["pending_review"] = {
                "type": "designer",
                "result": result,
                "generated_at": datetime.now().isoformat(),
                "source": "library",
            }
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
                                         smart_rule=f"project:{proj['id']}", project_id=proj["id"])
                    rows3, _ = db.list_library_items(email, project_id=proj["id"], limit=200)
                    if rows3:
                        db.add_items_to_collection(col_id3, [r["id"] for r in rows3])
                break
    except Exception as e:
        print(f"[WARN] _generate_smart_collections failed: {e}")


# ═══════════════════════════════════════════════════
# Trends — data sync from trend system
# ═══════════════════════════════════════════════════

TREND_API_BASE = os.environ.get("TREND_API_URL", "http://127.0.0.1:8002")

# Map trend system season_bucket_id (e.g. "2025_SS") to display label
def _season_label(bucket_id: str) -> str:
    if not bucket_id:
        return ""
    parts = bucket_id.split("_")
    if len(parts) == 2:
        year, code = parts
        mapping = {"SS": "春夏", "FW": "秋冬", "RESORT": "度假", "CRUISE": "早春", "PREFALL": "早秋"}
        return f"{year}{mapping.get(code, code)}"
    return bucket_id


def _trend_item_to_db(item: dict, report: dict) -> dict:
    """Convert a TrendItem from FashionTrendReport to db.upsert_trend args."""
    import hashlib
    trend_id = hashlib.sha256(f"{report.get('report_id','')}:{item.get('name','')}".encode()).hexdigest()[:16]
    season = _season_label(report.get("season_bucket_id", ""))
    colors = item.get("related_colors", [])
    color_palette = [{"name": c, "hex": ""} for c in colors[:6]]
    fabrics = item.get("related_fabrics", [])
    silhouettes = item.get("related_silhouettes", [])
    keywords = item.get("related_items", []) + item.get("related_patterns", [])
    style_keywords = item.get("style_keywords", []) if "style_keywords" in item else []  # type: ignore[index]
    design_language = {
        "silhouettes": silhouettes[:5],
        "fabrics": fabrics[:5],
        "details": keywords[:5],
        "style_prompt": item.get("description", ""),
    }
    images = item.get("selected_images", [])
    return dict(
        trend_id=trend_id,
        name=item.get("name", ""),
        name_zh=item.get("name", ""),
        season=season,
        cover_image=images[0] if images else "",
        image_gallery=images[:6],
        keywords=style_keywords[:8],
        description=item.get("description", ""),
        color_palette=color_palette,
        design_language=design_language,
        style_tags=style_keywords[:6],
        occasion_tags=[],
        source_report_id=report.get("report_id", ""),
    )


async def _sync_trends_from_report() -> int:
    """Fetch latest report from trend system and upsert key_trends into DB. Returns count synced."""
    try:
        import urllib.request as _req
        with _req.urlopen(f"{TREND_API_BASE}/api/reports/latest", timeout=5) as resp:
            report = json.loads(resp.read())
        items = report.get("key_trends", [])
        count = 0
        for item in items:
            if not item.get("name"):
                continue
            args = _trend_item_to_db(item, report)
            db.upsert_trend(**args)
            count += 1
        print(f"[INFO] Trend sync: upserted {count} trends from report {report.get('report_id','')}")
        return count
    except Exception as e:
        print(f"[WARN] Trend sync failed: {e}")
        return 0


# Background sync task — run on startup + hourly
_last_trend_sync: float = 0.0

async def _trend_sync_loop() -> None:
    global _last_trend_sync
    await asyncio.sleep(2)  # let server fully start first
    while True:
        await _sync_trends_from_report()
        _last_trend_sync = asyncio.get_event_loop().time()
        await asyncio.sleep(3600)  # sync every hour


async def _start_trend_sync():
    asyncio.create_task(_trend_sync_loop())


# ═══════════════════════════════════════════════════
# Trends — request models
# ═══════════════════════════════════════════════════

class TrendFavoriteRequest(BaseModel):
    pass

class TrendSyncRequest(BaseModel):
    pass

class ProjectTrendAddRequest(BaseModel):
    trend_id: str
    alignment_note: Optional[str] = None

class ProjectTrendRemoveRequest(BaseModel):
    pass


def _row_to_trend(row) -> dict:
    d = dict(row)
    for field in ("image_gallery", "keywords", "color_palette", "design_language", "style_tags", "occasion_tags"):
        try:
            d[field] = json.loads(d.get(field) or ("[]" if field != "design_language" else "{}"))
        except Exception:
            d[field] = [] if field != "design_language" else {}
    return d


def _compute_match_score(trend: dict, user_keywords: list) -> float:
    if not user_keywords:
        return 0.0
    trend_kws = trend.get("style_tags", []) + trend.get("occasion_tags", []) + trend.get("keywords", [])
    if not trend_kws:
        return 0.0
    score = 0
    for uk in user_keywords:
        for tk in trend_kws:
            if tk and uk and (tk in uk or uk in tk):
                score += 1
    return min(score / (len(trend_kws) * 2), 1.0)


# ═══════════════════════════════════════════════════
# Trends — API endpoints
# ═══════════════════════════════════════════════════













# ═══════════════════════════════════════════════════
# Trends — designer project anchors
# ═══════════════════════════════════════════════════





# ═══════════════════════════════════════════════════
# Trends — trend context in personalization
# ═══════════════════════════════════════════════════

def _build_trend_context(trend_id: Optional[str], trend_enabled: bool) -> str:
    if not trend_enabled:
        return ""
    if not trend_id:
        latest_season = db.get_latest_trend_season()
        rows = db.list_trends(season=latest_season)[:3] if latest_season else db.list_trends()[:3]
        if not rows:
            return ""
        lines = [f"=== 当前趋势脉冲参考{f' · {latest_season}' if latest_season else ''} ==="]
        for row in rows:
            current = _row_to_trend(row)
            design_language = current.get("design_language", {})
            signals = (
                design_language.get("style_prompt")
                or "、".join(current.get("keywords", [])[:5])
                or current.get("description", "")
            )
            if signals:
                lines.append(f"- {current['name']}：{signals}")
        if len(lines) == 1:
            return ""
        lines += [
            "",
            "原则：综合以上最新趋势信号，但优先满足用户的具体需求与个人风格档案。",
            "不需要在回复中逐条复述趋势名称，将其自然融入色彩、廓形、面料或细节。",
            "=== 趋势脉冲参考结束 ===",
        ]
        return "\n".join(lines)
    row = db.get_trend(trend_id)
    if not row:
        return ""
    trend = _row_to_trend(row)
    dl = trend.get("design_language", {})
    color_names = [c["name"] for c in trend.get("color_palette", [])[:4] if c.get("name")]
    lines = [f"=== 当前趋势参考：{trend['name']} ==="]
    if trend.get("description"):
        lines.append(f"趋势概述：{trend['description']}")
    if dl.get("style_prompt"):
        lines.append(f"设计语感：{dl['style_prompt']}")
    if dl.get("silhouettes"):
        lines.append(f"代表廓形：{'、'.join(dl['silhouettes'][:4])}")
    if dl.get("fabrics"):
        lines.append(f"代表面料：{'、'.join(dl['fabrics'][:4])}")
    if dl.get("details"):
        lines.append(f"设计细节：{'、'.join(dl['details'][:4])}")
    if color_names:
        lines.append(f"色彩方向：{'、'.join(color_names)}")
    lines += [
        "",
        "原则：在满足用户具体需求的前提下，让设计隐性地呼应以上趋势方向。",
        "注意：趋势方向是参考灵感，不应覆盖用户的个人风格档案偏好。",
        "当趋势与档案存在明显方向冲突时，以档案为主，趋势作为局部细节参考。",
        "不需要在回复中点名提及趋势名称，自然融入即可。",
        "=== 趋势参考结束 ===",
    ]
    return "\n".join(lines)


def _build_project_trend_context(designer_project: dict) -> str:
    """Build trend context from project-level trend_anchors."""
    anchors = designer_project.get("brief", {}).get("trend_anchors", [])
    if not anchors:
        return ""
    lines = []
    for anchor in anchors[:3]:
        row = db.get_trend(anchor["trend_id"])
        if not row:
            continue
        trend = _row_to_trend(row)
        dl = trend.get("design_language", {})
        desc = dl.get("style_prompt") or ", ".join(trend.get("keywords", [])[:4])
        note = f"（{anchor['alignment_note']}）" if anchor.get("alignment_note") else ""
        lines.append(f"- {trend['name']}{note}：{desc}")
    if not lines:
        return ""
    return "\n参考趋势方向：\n" + "\n".join(lines)


# ═══════════════════════════════════════════════════
# Trends — detect trend alignment for library items
# ═══════════════════════════════════════════════════

async def _detect_trend_alignment(item_id: str, auto_tags: dict) -> None:
    """Fire-and-forget: compute trend alignment scores for a library item."""
    try:
        rows = db.list_trends()
        if not rows:
            return
        item_kws = (
            (auto_tags.get("style_keywords") or [])
            + (auto_tags.get("occasions") or [])
            + ([auto_tags["silhouette"]] if auto_tags.get("silhouette") else [])
            + (auto_tags.get("garment_types") or [])
        )
        if not item_kws:
            return
        alignments = []
        for row in rows:
            trend = _row_to_trend(row)
            trend_kws = trend.get("style_tags", []) + trend.get("occasion_tags", []) + trend.get("keywords", [])
            overlap = sum(1 for ik in item_kws for tk in trend_kws if tk and ik and (tk in ik or ik in tk))
            score = overlap / max(len(trend_kws), 1)
            if score >= 0.25:
                alignments.append({"trend_id": trend["id"], "trend_name": trend["name"], "score": round(score, 3)})
        alignments.sort(key=lambda x: -x["score"])
        db.update_library_item_trend_alignments(item_id, alignments[:3])
    except Exception as e:
        print(f"[WARN] _detect_trend_alignment failed: {e}")


# ═══════════════════════════════════════════════════════════
# Wardrobe API
# ═══════════════════════════════════════════════════════════

WARDROBE_DIR = os.path.join(OUTPUTS_DIR, "wardrobe")
os.makedirs(WARDROBE_DIR, exist_ok=True)

WARDROBE_CATEGORIES = ["top", "bottom", "suit", "shoes", "bag", "jewelry", "accessory", "uncategorized"]

_WARDROBE_TAG_SYSTEM = (
    "你是时尚图像分析师。任务：判断衣物属于哪个具体类别。\n\n"
    "**前置判断（最重要！必须先做这一步）**：\n"
    "如果图中是穿着衣服的**完整真人/模特**(可见上半身或全身的人脸/躯干/四肢)，"
    "说明这张图是「人物展示图」而非单品图，**不适合作为衣橱单品归类**。\n"
    "此时直接输出（且仅输出）：\n"
    '{"category":"uncategorized","confidence":0.05,"name":"含人物的展示图",'
    '"sub_category":"","colors":[],"fabric":"","style_tags":[],"season":"all-season",'
    '"description":"图中是穿着衣物的人物模特，建议保存到作品集而非衣橱单品库"}\n'
    "**例外**：图中只有局部身体且仅展示单件首饰/配饰（如只露出手腕戴手表、只露出脖子戴项链），"
    "继续按下面流程判断；图中只有衣物平铺/挂拍/线稿/插画/特写（无真人穿着）也继续。\n\n"
    "**类别定义（仅在通过前置判断后才使用）**：\n"
    "- top: 上装(T恤/衬衫/卫衣/毛衣/外套/西装上衣/风衣/大衣/吊带/背心)\n"
    "- bottom: 下装(裤子/裙子/短裤/牛仔裤/西裤/半身裙)\n"
    "- suit: 套装/连体(连衣裙/连体裤/西装套装) — 注意：只有「单件衣物本身就是连体的」才用此类\n"
    "- shoes: 鞋子(高跟/球鞋/靴子/凉鞋/拖鞋)\n"
    "- bag: 包(手提包/双肩包/腰包/钱包/手拿包)\n"
    "- jewelry: 首饰(项链/耳环/戒指/手链/胸针)\n"
    "- accessory: 其它配饰(帽子/围巾/腰带/手套/袜子/眼镜)\n"
    "- uncategorized: 仅在图片无法识别为任何衣物时使用\n\n"
    "**判断步骤（仅单品图）**：\n"
    "1. 识别图中主体是身体哪部分穿戴（上半身=top，下半身=bottom，整体=suit，脚=shoes，等等）\n"
    "2. 若图中是连衣裙、连体裤，选 suit 而不是 top 或 bottom\n"
    "3. 若同时出现多件，以**画面主体**为准\n"
    "4. confidence 范围 0.0-1.0，表示对 category 判断的把握（0.9=几乎确定；0.5=模棱两可）\n\n"
    "**输出格式（必须是严格合法的 JSON，不要包 markdown 代码块，不要任何前后文字）**：\n"
    '{"category":"top","confidence":0.92,"sub_category":"T恤","name":"白色印花T恤",'
    '"colors":["白","黑"],"fabric":"棉","style_tags":["休闲","街头"],'
    '"season":"summer","description":"宽松版型白色短袖,胸前黑色字母印花"}\n\n'
    "season 必须是 spring/summer/fall/winter/all-season 之一。"
)


def _wardrobe_user_dir(user_email: str) -> str:
    h = hashlib.md5(user_email.encode()).hexdigest()[:10]
    d = os.path.join(WARDROBE_DIR, h)
    os.makedirs(d, exist_ok=True)
    return d


def _save_wardrobe_image(user_email: str, item_id: str, data: bytes, ext: str = "png") -> tuple[str, str]:
    d = _wardrobe_user_dir(user_email)
    fname = f"{item_id}.{ext}"
    fpath = os.path.join(d, fname)
    with open(fpath, "wb") as f:
        f.write(data)
    thumb_name = f"{item_id}_thumb.jpg"
    thumb_path = os.path.join(d, thumb_name)
    try:
        im = Image.open(fpath)
        im.thumbnail((300, 300))
        im.save(thumb_path, "JPEG", quality=85)
    except Exception:
        thumb_path = fpath
    rel = os.path.relpath(fpath, OUTPUTS_DIR).replace(os.sep, "/")
    thumb_rel = os.path.relpath(thumb_path, OUTPUTS_DIR).replace(os.sep, "/")
    return f"/api/design/images/{rel}", f"/api/design/images/{thumb_rel}"


async def _wardrobe_auto_tag(item_id: str, image_url: str) -> None:
    local_path = image_url
    if local_path.startswith("/api/design/images/"):
        rel = local_path.removeprefix("/api/design/images/")
        local_path = os.path.join(OUTPUTS_DIR, rel.replace("/", os.sep))
    if not os.path.exists(local_path):
        db.update_wardrobe_item_ai(item_id, {"error": "image_not_found"}, "failed")
        return

    last_raw = ""
    last_err = ""
    for attempt in range(2):  # 1 initial + 1 retry
        try:
            prompt = _WARDROBE_TAG_SYSTEM + "\n\n请分析这张衣物图片。"
            if attempt > 0 and last_raw:
                prompt += (
                    f"\n\n上次你的输出无法解析为合法 JSON 或 category 不在白名单内。"
                    f"上次原始输出：\n```\n{last_raw[:500]}\n```\n"
                    f"错误：{last_err}\n"
                    f"请严格按上面定义的 JSON 格式重新输出，只输出 JSON，不要 markdown 代码块，不要任何解释文字。"
                )
            raw = await asyncio.to_thread(vision_analyze, local_path, prompt)
            last_raw = (raw or "").strip()

            cleaned = last_raw
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
                cleaned = cleaned.rsplit("```", 1)[0].strip()
            if not cleaned.startswith("{"):
                m = re.search(r"\{.*\}", cleaned, re.S)
                if m:
                    cleaned = m.group(0)

            tags = json.loads(cleaned)

            cat = tags.get("category")
            if cat not in WARDROBE_CATEGORIES:
                last_err = f"category '{cat}' not in whitelist"
                continue

            try:
                tags["confidence"] = max(0.0, min(1.0, float(tags.get("confidence", 0.5))))
            except (TypeError, ValueError):
                tags["confidence"] = 0.5

            db.update_wardrobe_item_ai(item_id, tags, "completed")
            return
        except json.JSONDecodeError as e:
            last_err = f"JSON parse error: {e}"
            print(f"[WARN] wardrobe_auto_tag attempt {attempt+1} JSON failed for {item_id}: {e}")
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            print(f"[WARN] wardrobe_auto_tag attempt {attempt+1} failed for {item_id}: {e}")

    db.update_wardrobe_item_ai(
        item_id,
        {"error": last_err, "raw_output": last_raw[:1000]},
        "failed",
    )
    print(f"[WARN] wardrobe_auto_tag exhausted retries for {item_id}: {last_err}")


def _require_wardrobe_user(authorization: Optional[str]) -> str:
    return _require_user()["email"]


def _wardrobe_row_to_dict(row) -> dict:
    d = dict(row)
    for k in ("colors", "style_tags", "ai_analysis"):
        if k in d and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except Exception:
                pass
    d["favorite"] = bool(d.get("favorite"))
    # 把 ai_analysis.confidence 提升到顶层供前端直接读
    if isinstance(d.get("ai_analysis"), dict):
        c = d["ai_analysis"].get("confidence")
        if c is not None:
            try:
                d["confidence"] = max(0.0, min(1.0, float(c)))
            except (TypeError, ValueError):
                pass
    return d




class WardrobeFromTrendRequest(BaseModel):
    image_url: str
    name: str = ""
    source_ref: Optional[str] = None




class WardrobeFromDesignRequest(BaseModel):
    image_url: str
    session_id: Optional[str] = None
    name: str = ""
    image_type: Optional[str] = None   # "generate_model" / "try_on" / "text_to_image" / ...


# 人物类图片(非单品),禁止入衣橱
_PERSON_IMAGE_TYPES = {"generate_model", "try_on"}








class WardrobePatchRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    colors: Optional[list] = None
    style_tags: Optional[list] = None
    season: Optional[str] = None
    fabric: Optional[str] = None
    notes: Optional[str] = None
    favorite: Optional[bool] = None






class WardrobeBatchDeleteRequest(BaseModel):
    item_ids: list[str]








# ── Outfits ──

class OutfitCreateRequest(BaseModel):
    name: str
    item_ids: list[str]
    description: Optional[str] = None
    occasion: Optional[str] = None
    season: Optional[str] = None
    style: Optional[str] = None








class OutfitPatchRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    occasion: Optional[str] = None
    season: Optional[str] = None
    style: Optional[str] = None






class OutfitAddItemRequest(BaseModel):
    wardrobe_item_id: str
    layer_order: int = 0






# ═══════════════════════════════════════════════════════════
# Try-On Station API
# ═══════════════════════════════════════════════════════════

PRESETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presets")
TRYON_DIR = os.path.join(OUTPUTS_DIR, "tryon")
_TRYON_CATEGORIES = ("clothes", "models", "backgrounds", "actions", "beauty")
TRYON_MAX_INPUT_LONG_EDGE = 1024  # downscale wardrobe/preset images before DashScope call


def _ensure_presets_layout() -> None:
    """Create preset directories + empty manifests at startup (idempotent)."""
    os.makedirs(PRESETS_DIR, exist_ok=True)
    os.makedirs(TRYON_DIR, exist_ok=True)
    for cat in _TRYON_CATEGORIES:
        cat_dir = os.path.join(PRESETS_DIR, cat)
        os.makedirs(cat_dir, exist_ok=True)
        manifest = os.path.join(cat_dir, "manifest.json")
        if not os.path.exists(manifest):
            with open(manifest, "w", encoding="utf-8") as f:
                f.write("[]\n")


_ensure_presets_layout()

# Static serving of preset thumbnails: /api/tryon/preset-images/clothes/foo.png


# ── Manifest cache (mtime-aware) ──
_manifest_cache: dict[str, tuple[float, list[dict]]] = {}


def _load_preset_manifest(category: str) -> list[dict]:
    """Cached manifest loader. Re-reads only when mtime changes."""
    if category not in _TRYON_CATEGORIES:
        raise HTTPException(404, f"Unknown preset category: {category}")
    path = os.path.join(PRESETS_DIR, category, "manifest.json")
    if not os.path.exists(path):
        return []
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return []
    cached = _manifest_cache.get(category)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            data = []
    except Exception as e:
        print(f"[WARN] failed to load preset manifest {category}: {e}")
        _manifest_cache[category] = (mtime, [])
        return []
    out = []
    for entry in data:
        if not isinstance(entry, dict) or not entry.get("id") or not entry.get("thumbnail"):
            continue
        item = dict(entry)
        item["image_url"] = f"/api/tryon/preset-images/{category}/{entry['thumbnail']}"
        item["category_group"] = category
        out.append(item)
    _manifest_cache[category] = (mtime, out)
    return out


def _validate_presets_at_startup() -> None:
    """Print warnings for missing files / duplicate IDs so builders catch problems early."""
    for cat in _TRYON_CATEGORIES:
        items = _load_preset_manifest(cat)
        seen_ids: set[str] = set()
        missing = 0
        for it in items:
            if it["id"] in seen_ids:
                print(f"[WARN] preset {cat}: duplicate id {it['id']!r}")
            seen_ids.add(it["id"])
            fp = os.path.join(PRESETS_DIR, cat, it["thumbnail"])
            if not os.path.exists(fp):
                missing += 1
                print(f"[WARN] preset {cat}: file not found {it['thumbnail']!r} for id {it['id']!r}")
        if items:
            print(f"[INFO] preset {cat}: loaded {len(items)} item(s), {missing} missing file(s)")


_TRYON_USER_LOCKS: dict[str, asyncio.Lock] = {}


def _get_user_tryon_lock(email: str) -> asyncio.Lock:
    lk = _TRYON_USER_LOCKS.get(email)
    if lk is None:
        lk = asyncio.Lock()
        _TRYON_USER_LOCKS[email] = lk
    return lk


_validate_presets_at_startup()


def _resolve_preset_file(category: str, preset_id: str) -> tuple[dict, str]:
    """Return (manifest entry, absolute file path) or raise HTTPException."""
    items = _load_preset_manifest(category)
    entry = next((it for it in items if it["id"] == preset_id), None)
    if not entry:
        raise HTTPException(404, f"Preset not found: {category}/{preset_id}")
    path = os.path.join(PRESETS_DIR, category, entry["thumbnail"])
    if not os.path.exists(path):
        raise HTTPException(404, f"Preset image missing on disk: {category}/{entry['thumbnail']}")
    return entry, path


def _resolve_wardrobe_file(item_id: str, user_email: str) -> str:
    """Return absolute file path for a wardrobe item or raise."""
    row = db.get_wardrobe_item(item_id, user_email)
    if not row:
        raise HTTPException(404, f"Wardrobe item not found: {item_id}")
    image_url = row["image_url"]
    rel = image_url.removeprefix("/api/design/images/")
    abs_path = os.path.join(OUTPUTS_DIR, rel.replace("/", os.sep))
    if not os.path.exists(abs_path):
        raise HTTPException(404, f"Wardrobe image missing on disk: {image_url}")
    return abs_path


def _tryon_user_dir(user_email: str) -> str:
    h = hashlib.md5(user_email.encode()).hexdigest()[:10]
    d = os.path.join(TRYON_DIR, h)
    os.makedirs(d, exist_ok=True)
    return d


# Cache: src abs path → (mtime, shrunk abs path). Once a file is shrunk, reuse it.
_TRYON_INPUT_CACHE_DIR = os.path.join(TRYON_DIR, "_inputs")
os.makedirs(_TRYON_INPUT_CACHE_DIR, exist_ok=True)
_input_shrink_cache: dict[str, tuple[float, str]] = {}


def _shrink_for_tryon(src_path: str) -> str:
    """Resize src image (in place cache) so long edge ≤ TRYON_MAX_INPUT_LONG_EDGE.

    DashScope multimodal accepts large images but they slow round-trip noticeably.
    Returns absolute path to the shrunk file (may equal src_path if already small).
    """
    try:
        mtime = os.path.getmtime(src_path)
    except OSError:
        return src_path
    cached = _input_shrink_cache.get(src_path)
    if cached and cached[0] == mtime and os.path.exists(cached[1]):
        return cached[1]
    try:
        with Image.open(src_path) as im:
            w, h = im.size
            long_edge = max(w, h)
            if long_edge <= TRYON_MAX_INPUT_LONG_EDGE:
                _input_shrink_cache[src_path] = (mtime, src_path)
                return src_path
            scale = TRYON_MAX_INPUT_LONG_EDGE / float(long_edge)
            new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
            key = hashlib.md5(f"{src_path}:{mtime}".encode()).hexdigest()[:16]
            out_path = os.path.join(_TRYON_INPUT_CACHE_DIR, f"{key}.jpg")
            shrunk = im.convert("RGB") if im.mode not in ("RGB", "L") else im
            shrunk = shrunk.resize(new_size, Image.LANCZOS)
            shrunk.save(out_path, "JPEG", quality=88, optimize=True)
        _input_shrink_cache[src_path] = (mtime, out_path)
        return out_path
    except Exception as e:
        print(f"[WARN] _shrink_for_tryon failed for {src_path}: {e}")
        return src_path


def _save_tryon_image_from_url(user_email: str, image_url: str) -> str:
    """Download a remote output URL into outputs/tryon/{hash}/ and return /api/design/images/... path."""
    d = _tryon_user_dir(user_email)
    fname = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.png"
    fpath = os.path.join(d, fname)
    urllib.request.urlretrieve(image_url, fpath)
    rel = os.path.relpath(fpath, OUTPUTS_DIR).replace(os.sep, "/")
    return f"/api/design/images/{rel}"


def _save_tryon_image_bytes(user_email: str, data: bytes) -> str:
    d = _tryon_user_dir(user_email)
    fname = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}.png"
    fpath = os.path.join(d, fname)
    with open(fpath, "wb") as f:
        f.write(data)
    rel = os.path.relpath(fpath, OUTPUTS_DIR).replace(os.sep, "/")
    return f"/api/design/images/{rel}"




class TryOnClothes(BaseModel):
    kind: str  # 'wardrobe' | 'preset'
    id: str


class TryOnPresetSel(BaseModel):
    id: str
    prompt: Optional[str] = None
    name: Optional[str] = None


class TryOnBeauty(BaseModel):
    hairstyle: Optional[TryOnPresetSel] = None
    color: Optional[TryOnPresetSel] = None


class TryOnGenerateRequest(BaseModel):
    clothes: list[TryOnClothes] = []
    model: Optional[TryOnPresetSel] = None
    background: Optional[TryOnPresetSel] = None
    action: Optional[TryOnPresetSel] = None
    beauty: Optional[TryOnBeauty] = None
    extra_prompt: str = ""


def _build_tryon_prompt(
    primary_clothes: list[dict],
    extra_clothes: list[dict],
    background: Optional[dict],
    action: Optional[dict],
    beauty_hair: Optional[dict],
    beauty_color: Optional[dict],
    extra_prompt: str,
) -> str:
    """
    按衣物类别构建英文试穿 prompt，避免同类型冲突堆叠。
    类别优先级与穿着逻辑：
      suit / uncategorized  → 作为整体主套装
      top                   → 上装（衬衫/毛衣/外套等）
      bottom                → 下装（裤/裙）
      shoes                 → 鞋子
      bag                   → 包
      jewelry / accessory   → 首饰/配饰（可多件）
    规则：若已有 suit，忽略 top/bottom；若有多件 top 只取第一件。
    """
    # ── 按类别分组，处理冲突 ──
    cats: dict[str, list[dict]] = {
        "suit": [], "top": [], "bottom": [],
        "shoes": [], "bag": [], "accessory": [], "jewelry": [],
        "uncategorized": [],
    }
    for item in primary_clothes:
        cat = item.get("category") or "uncategorized"
        cats.setdefault(cat, []).append(item)

    has_suit = bool(cats["suit"] or cats["uncategorized"])

    parts: list[str] = []

    # Suit / full-outfit
    for item in cats["suit"] + cats["uncategorized"]:
        name = item.get("name") or item.get("prompt") or "outfit"
        parts.append(f"wearing {name} (shown in reference image)")

    # Top — 有 suit 时忽略 top
    if not has_suit:
        for item in cats["top"][:1]:
            name = item.get("name") or item.get("prompt") or "top"
            parts.append(f"paired with {name} on top (shown in reference image)")

    # Bottom — 有 suit 时忽略
    if not has_suit:
        for item in cats["bottom"][:1]:
            name = item.get("name") or item.get("prompt") or "bottom"
            parts.append(f"wearing {name} on the bottom (shown in reference image)")

    # Shoes
    for item in cats["shoes"][:1]:
        name = item.get("name") or item.get("prompt") or "shoes"
        parts.append(f"wearing {name} (shown in reference image)")

    # Bag
    for item in cats["bag"][:1]:
        name = item.get("name") or item.get("prompt") or "bag"
        parts.append(f"carrying {name} (shown in reference image)")

    # Accessories / jewelry
    for item in (cats["jewelry"] + cats["accessory"])[:3]:
        name = item.get("name") or item.get("prompt") or "accessory"
        parts.append(f"accessorized with {name}")

    # Extra (text-only, beyond image limit)
    for item in extra_clothes:
        name = item.get("name") or item.get("prompt") or ""
        if name:
            parts.append(f"also wearing {name}")

    outfit_desc = ", ".join(parts) if parts else "the provided outfit"

    lines = [
        f"Fashion editorial photo: a model {outfit_desc}.",
        "Keep the model's facial features, skin tone, and body proportions exactly as in the reference photo.",
        "Clothes fit naturally, fabric drapes realistically, no distortion.",
    ]

    if background and background.get("prompt"):
        lines.append(f"Background: {background['prompt']}.")
    if action and action.get("prompt"):
        lines.append(f"Pose: {action['prompt']}.")
    if beauty_hair and beauty_hair.get("prompt"):
        lines.append(f"Hairstyle: {beauty_hair['prompt']}.")
    if beauty_color and beauty_color.get("prompt"):
        lines.append(f"Hair color: {beauty_color['prompt']}.")
    if extra_prompt and extra_prompt.strip():
        lines.append(extra_prompt.strip())

    return " ".join(lines)


def _pick_default_model() -> tuple[dict, str]:
    items = _load_preset_manifest("models")
    if not items:
        raise HTTPException(400, "系统尚未配置默认模特，请联系建造者添加 presets/models/")
    entry = items[0]
    path = os.path.join(PRESETS_DIR, "models", entry["thumbnail"])
    if not os.path.exists(path):
        raise HTTPException(500, f"默认模特图片缺失: {entry['thumbnail']}")
    return entry, path




async def _tryon_generate_impl(email: str, req: TryOnGenerateRequest) -> dict:
    # Resolve model
    if req.model and req.model.id:
        model_entry, model_path = _resolve_preset_file("models", req.model.id)
    else:
        model_entry, model_path = _pick_default_model()

    # Resolve clothes: first 2 → image inputs, rest → text descriptions
    primary_clothes: list[dict] = []  # has 'name','prompt' + 'file_path'
    extra_clothes: list[dict] = []
    for idx, c in enumerate(req.clothes):
        if c.kind == "wardrobe":
            row = db.get_wardrobe_item(c.id, email)
            if not row:
                raise HTTPException(404, f"衣橱衣物不存在: {c.id}")
            entry = {
                "name": row["name"] or "衣物",
                "prompt": row["name"] or "",
                "id": c.id,
                "category": row.get("category") or "uncategorized",
                "sub_category": row.get("sub_category") or "",
            }
            try:
                entry["file_path"] = _resolve_wardrobe_file(c.id, email)
            except HTTPException:
                continue
        elif c.kind == "preset":
            try:
                p_entry, p_path = _resolve_preset_file("clothes", c.id)
            except HTTPException:
                continue
            entry = {
                "name": p_entry.get("name") or c.id,
                "prompt": p_entry.get("prompt") or p_entry.get("name") or "",
                "id": c.id,
                "category": p_entry.get("category") or "uncategorized",
                "sub_category": p_entry.get("sub_category") or "",
                "file_path": p_path,
            }
        else:
            continue
        if idx < 8:                    # GPT Image 2 支持多图; 合理上限 8 件衣物
            primary_clothes.append(entry)
        else:
            extra_clothes.append(entry)

    if not primary_clothes:
        raise HTTPException(400, "没有可用的衣物图片，请重新选择")

    # Resolve background/action/beauty prompts (no images — pure text)
    bg_entry = None
    if req.background and req.background.id:
        bg_entry, _ = _resolve_preset_file("backgrounds", req.background.id)
    act_entry = None
    if req.action and req.action.id:
        act_entry, _ = _resolve_preset_file("actions", req.action.id)
    hair_entry = None
    color_entry = None
    if req.beauty:
        if req.beauty.hairstyle and req.beauty.hairstyle.id:
            hair_entry, _ = _resolve_preset_file("beauty", req.beauty.hairstyle.id)
        if req.beauty.color and req.beauty.color.id:
            color_entry, _ = _resolve_preset_file("beauty", req.beauty.color.id)

    prompt = _build_tryon_prompt(
        primary_clothes, extra_clothes,
        bg_entry, act_entry, hair_entry, color_entry,
        req.extra_prompt,
    )

    # Pre-shrink images in parallel — eliminates seconds of upload latency for large photos.
    paths_to_shrink = [model_path] + [c["file_path"] for c in primary_clothes]
    shrunk = await asyncio.gather(*(asyncio.to_thread(_shrink_for_tryon, p) for p in paths_to_shrink))
    model_path_send, *cloth_paths_send = shrunk

    refs = [model_path_send] + cloth_paths_send

    t0 = time.time()
    try:
        img_bytes = await asyncio.to_thread(
            _call_with_retry, generate_image, prompt,
            reference_paths=refs,
        )
    except Exception as e:
        print(f"[ERROR] tryon generate exception: {e}")
        raise HTTPException(500, f"生图失败: {e}")

    try:
        local_url = await asyncio.to_thread(_save_tryon_image_bytes, email, img_bytes)
    except Exception as e:
        raise HTTPException(500, f"保存生成图失败: {e}")

    elapsed = round(time.time() - t0, 1)
    print(f"[INFO] tryon generate ok user={email[:10]} elapsed={elapsed}s clothes={len(req.clothes)}")
    return {
        "image_url": local_url,
        "prompt": prompt,
        "model_used": model_entry.get("id"),
        "primary_clothes": [c["id"] for c in primary_clothes],
        "extra_clothes": [c["id"] for c in extra_clothes],
        "elapsed_seconds": elapsed,
    }


def _ingest_preset_clothes_to_wardrobe(email: str, preset_ids: list[str]) -> list[str]:
    """Copy each system preset cloth into the user's wardrobe; return new wardrobe item IDs."""
    new_ids: list[str] = []
    for pid in preset_ids:
        try:
            entry, src_path = _resolve_preset_file("clothes", pid)
        except HTTPException as e:
            print(f"[WARN] save-outfit ingest skip {pid}: {e.detail}")
            continue
        try:
            with open(src_path, "rb") as f:
                data = f.read()
        except Exception as e:
            print(f"[WARN] save-outfit ingest read failed {pid}: {e}")
            continue
        item_id = uuid.uuid4().hex[:12]
        ext = os.path.splitext(src_path)[1].lstrip(".") or "png"
        image_url, thumb_url = _save_wardrobe_image(email, item_id, data, ext)
        db.create_wardrobe_item(
            item_id, email, image_url,
            source_type="preset",
            source_ref=pid,
            source_image_url=None,
            name=entry.get("name") or "",
            category=entry.get("category") or "uncategorized",
        )
        if thumb_url:
            db.patch_wardrobe_item(item_id, email, thumbnail_url=thumb_url)
        asyncio.create_task(_wardrobe_auto_tag(item_id, image_url))
        new_ids.append(item_id)
    return new_ids


class SaveTryOnOutfitRequest(BaseModel):
    name: str
    generated_image_url: str
    wardrobe_item_ids: list[str] = []
    preset_clothing_ids: list[str] = []
    description: Optional[str] = None
    occasion: Optional[str] = None
    season: Optional[str] = None
    style: Optional[str] = None




if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("DESIGN_STUDIO_PORT", "8001"))
    print(f"[INFO] Starting AI Fashion Design Backend...")
    print(f"[INFO] Outputs dir: {OUTPUTS_DIR}")
    print(f"[INFO] Models: image={IMAGE_MODEL}, llm={TEXT_MODEL}")
    print(f"[INFO] Listening on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)

# Export private helper names for route modules that intentionally import the runtime surface.
__all__ = [name for name in globals() if not name.startswith('__')]
