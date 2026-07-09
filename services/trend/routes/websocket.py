from fastapi import APIRouter

from runtime import *

router = APIRouter()


@router.websocket("/ws/pipeline")
async def ws_pipeline(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # 立即推送当前状态
        current = get_storage().get_current_task()
        await websocket.send_json(
            json.loads(
                json.dumps(
                    {
                        "type": "connected",
                        "data": {**(current or {}), "pause_requested": is_pause_requested()},
                    },
                    default=str,
                )
            )
        )

        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                data = json.loads(msg)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # 心跳
                await websocket.send_json({"type": "ping"})
            except Exception:
                break

    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(websocket)

