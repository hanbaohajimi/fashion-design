import asyncio
import json
import os
import traceback
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from starlette.datastructures import UploadFile as StarletteUploadFile

from ai_clients import generate_image, simple_chat, vision_analyze
from runtime import (
    MAX_UPLOAD_BATCH,
    OUTPUTS_DIR,
    AnalyzeRequest,
    EnhancePromptRequest,
    Session,
    _ensure_owned_session,
    _require_user,
    get_session,
)

router = APIRouter()


@router.post("/api/upload")
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

    user = _require_user()
    _ensure_owned_session(user["email"], str(session_id))
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


@router.get("/api/images/{path:path}")
async def serve_image(path: str):
    base_dir = os.path.abspath(OUTPUTS_DIR)
    file_path = os.path.abspath(os.path.join(base_dir, path))
    if os.path.commonpath([base_dir, file_path]) != base_dir:
        raise HTTPException(status_code=404, detail="Image not found")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(file_path, media_type="image/png")


@router.post("/api/edit_with_mask")
async def edit_with_mask(
    instruction: str = Form(...),
    base_image: UploadFile = File(...),
    mask_image: UploadFile = File(...),
    session_id: str | None = Form(None),
):
    try:
        if session_id:
            user = _require_user()
            _ensure_owned_session(user["email"], session_id)
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

        mask_instruction = (
            "Use the second image as a mask. Only modify the regions that are white in the mask. "
            "Keep all black / unmasked areas as close to the original as possible. "
            + instruction
        )

        try:
            img_bytes = await asyncio.to_thread(
                _call_with_retry, generate_image, mask_instruction,
                reference_paths=[abs_base, abs_mask],
            )
        except Exception as e:
            print(f"[ERROR] edit_with_mask failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))

        result_path = session.save_image_bytes(img_bytes, "region_edit")
        if not result_path:
            raise HTTPException(status_code=500, detail="未从模型返回图片结果")

        try:
            base_img = Image.open(abs_base).convert("RGBA")
            edited_img = Image.open(result_path).convert("RGBA")
            mask_img = Image.open(abs_mask).convert("L")

            if mask_img.size != base_img.size:
                mask_img = mask_img.resize(base_img.size, Image.BILINEAR)
            if edited_img.size != base_img.size:
                edited_img = edited_img.resize(base_img.size, Image.BILINEAR)

            mask_bin = mask_img.point(lambda v: 255 if v > 128 else 0)
            composited = Image.composite(edited_img, base_img, mask_bin)
            composited.save(result_path)
        except Exception as e:
            print(f"[WARN] edit_with_mask compositing failed: {e}")

        url = session.get_image_url(result_path)
        session.current_image_path = result_path
        session.record_image(url, "edit_with_mask", result_path)
        return {"url": url, "path": result_path}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] edit_with_mask exception: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/enhance-prompt")
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
        response_text = await asyncio.to_thread(simple_chat, messages)
        enhanced = response_text or req.prompt
        return {"original": req.prompt, "enhanced": enhanced.strip()}
    except Exception as e:
        print(f"[ERROR] enhance_prompt: {e}")
        return {"original": req.prompt, "enhanced": req.prompt, "error": str(e)}


@router.post("/api/analyze-image")
async def analyze_image(req: AnalyzeRequest):
    """Use vision model to analyze a fashion image and return structured insights."""
    try:
        user = _require_user()
        _ensure_owned_session(user["email"], req.session_id, create_if_missing=False)
        session = get_session(req.session_id)
        img_path = req.image_path
        if not img_path or not os.path.exists(img_path):
            img_path = session.current_image_path
        if not img_path or not os.path.exists(img_path):
            raise HTTPException(status_code=400, detail="没有可分析的图片")

        vision_prompt = (
            f"{req.question}\n\n"
            "请以JSON格式返回分析结果，包含以下字段：\n"
            "- style: 风格描述\n"
            "- colors: 主要配色列表\n"
            "- fabric: 推测面料\n"
            "- silhouette: 剪裁/廓形\n"
            "- occasion: 适合场合\n"
            "- summary: 一句话总结\n"
            "- suggestions: 改进建议列表"
        )

        text = await asyncio.to_thread(_call_with_retry, vision_analyze, img_path, vision_prompt)

        try:
            cleaned = text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
                cleaned = cleaned.rsplit("```", 1)[0]
            analysis = json.loads(cleaned)
        except (json.JSONDecodeError, IndexError):
            analysis = {"summary": text, "raw": True}

        return {"status": "ok", "analysis": analysis, "image_path": img_path}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] analyze_image: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
