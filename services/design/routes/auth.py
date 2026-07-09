import re

from fastapi import APIRouter, HTTPException

import db
from runtime import (
    LoginRequest,
    RegisterRequest,
    _auth_context,
    _hash_password,
    _issue_auth_session,
    _require_user,
    _utc_now,
    _verify_password,
)

router = APIRouter()


@router.post("/api/auth/register")
async def register(req: RegisterRequest):
    email = req.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="邮箱格式不正确")
    if (
        len(req.password) < 8
        or not re.search(r"[A-Za-z]", req.password)
        or not re.search(r"\d", req.password)
    ):
        raise HTTPException(status_code=400, detail="密码至少8位，且必须包含字母和数字")
    existing = db.get_user_by_email(email)
    if existing:
        raise HTTPException(status_code=409, detail="该邮箱已注册")
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="昵称不能为空")
    db.upsert_user(email, name, _hash_password(req.password))
    token, expires_at = _issue_auth_session(email)
    return {
        "auth_token": token,
        "expires_at": expires_at,
        "email": email,
        "name": name,
    }


@router.post("/api/auth/login")
async def login(req: LoginRequest):
    email = req.email.lower().strip()
    user = db.get_user_by_email(email)
    if not user or not _verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    token, expires_at = _issue_auth_session(email)
    return {
        "auth_token": token,
        "expires_at": expires_at,
        "email": email,
        "name": user["name"],
    }


@router.post("/api/auth/logout")
async def logout():
    context = _auth_context.get()
    if context is None:
        raise HTTPException(status_code=401, detail="未登录")
    db.revoke_auth_session(context[1], _utc_now().isoformat())
    return {"status": "ok"}


@router.post("/api/auth/logout-all")
async def logout_all():
    user = _require_user(None)
    db.revoke_all_auth_sessions(user["email"], _utc_now().isoformat())
    return {"status": "ok"}


@router.get("/api/auth/session")
async def get_auth_session():
    user = _require_user(None)
    return {
        "email": user["email"],
        "name": user["name"],
        "expires_at": user["auth_expires_at"],
    }
