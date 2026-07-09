from fastapi import APIRouter

from runtime import *

router = APIRouter()


@router.get("/api/tasks")
async def get_tasks(limit: int = Query(30, ge=1, le=200)):
    from report_utils import summarize_tokens

    try:
        runs = get_storage().get_all_task_runs(limit)
        for r in runs:
            try:
                r["llm_token_usage"] = json.loads(r.get("llm_token_usage_json") or "{}")
            except Exception:
                r["llm_token_usage"] = {}
            r["llm_tokens_total_est"] = summarize_tokens(r.get("llm_token_usage"))
        return {"tasks": runs}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/tasks/{run_id}")
async def get_task_detail(run_id: str):
    """单条任务详情（可观测性钻取）。"""
    try:
        t = get_storage().get_task_by_id(run_id)
        if not t:
            raise HTTPException(404, "任务不存在")
        try:
            t["llm_token_usage"] = json.loads(t.get("llm_token_usage_json") or "{}")
        except Exception:
            t["llm_token_usage"] = {}
        from report_utils import summarize_tokens

        t["llm_tokens_total_est"] = summarize_tokens(t.get("llm_token_usage"))
        return t
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/api/tasks/current")
async def get_current_task():
    try:
        _recover_orphan_running_tasks_if_needed()
        task = get_storage().get_current_task()
        return task or {}
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.post("/api/pipeline/trigger")
async def trigger_pipeline(req: TriggerRequest):
    global _pipeline_task

    if req.mode != "full":
        raise HTTPException(400, "仅支持完整工作流分析（mode=full）")

    _recover_orphan_running_tasks_if_needed()

    # 检查是否已有 running 任务
    running = get_storage().get_running_task()
    if running:
        raise HTTPException(409, f"Pipeline already running: {running.get('run_id')}")

    if _pipeline_task and not _pipeline_task.done():
        raise HTTPException(409, "Pipeline task already scheduled")

    _pipeline_task = asyncio.create_task(
        _run_pipeline_background(req.mode)
    )

    return {"status": "triggered", "mode": req.mode}


@router.get("/api/pipeline/state")
async def pipeline_state():
    """返回当前流水线运行/暂停状态。"""
    _recover_orphan_running_tasks_if_needed()
    running = get_storage().get_running_task()
    return {
        "is_running": bool(running),
        "pause_requested": is_pause_requested(),
        "current_task": running or {},
    }


@router.post("/api/pipeline/pause")
async def pause_pipeline():
    """
    请求暂停运行中的流水线。
    注意：暂停会在安全检查点生效（站点边界、文章抓取并发入口、阶段切换点）。
    """
    _recover_orphan_running_tasks_if_needed()
    running = get_storage().get_running_task()
    if not running:
        raise HTTPException(409, "No running pipeline to pause")
    request_pause()
    await ws_manager.broadcast(
        {
            "type": "paused",
            "data": {"run_id": running.get("run_id"), "pause_requested": True},
        }
    )
    return {"status": "pause_requested", "run_id": running.get("run_id")}


@router.post("/api/pipeline/resume")
async def resume_pipeline():
    """恢复被暂停的流水线。"""
    _recover_orphan_running_tasks_if_needed()
    running = get_storage().get_running_task()
    if not running:
        raise HTTPException(409, "No running pipeline to resume")
    request_resume()
    await ws_manager.broadcast(
        {
            "type": "resumed",
            "data": {"run_id": running.get("run_id"), "pause_requested": False},
        }
    )
    return {"status": "resumed", "run_id": running.get("run_id")}


@router.post("/api/pipeline/retry/{run_id}")
async def retry_failed_pipeline(run_id: str):
    """对失败或部分成功的任务按记录的 pipeline_mode 重试（需当前无运行中任务）。"""
    global _pipeline_task

    # 与历史「误标 success」口径对齐后再判断（与 normalize-task-statuses 一致）
    get_storage().normalize_single_task_run_status(run_id)
    task = get_storage().get_task_by_id(run_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    st = task.get("status")
    if st not in ("failed", "partial"):
        raise HTTPException(
            400,
            f"仅 failed / partial 任务可重试，当前状态: {st}",
        )
    mode = (task.get("pipeline_mode") or "").strip() or "full"
    if mode not in ("full", "crawl_only", "analyze_only", "analyze_library"):
        mode = "full"

    running = get_storage().get_running_task()
    if running:
        raise HTTPException(409, f"Pipeline already running: {running.get('run_id')}")
    if _pipeline_task and not _pipeline_task.done():
        raise HTTPException(409, "Pipeline task already scheduled")

    _pipeline_task = asyncio.create_task(_run_pipeline_background(mode))
    return {"status": "triggered", "mode": mode, "retried_run_id": run_id}

