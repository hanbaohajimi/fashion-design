"""
趋势分析占位服务：在未配置 ai_fashion 时提供 /api/health 与简易首页，
供统一平台 iframe 与健康检查通过（完整仪表盘 / 爬取 / LLM 需接入 ai_fashion）。
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI(title="Trend Analysis Stub", version="0.1.0")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "trend-analysis-stub",
        "hint": "配置 AI_FASHION_BACKEND 指向 ai_fashion 项目目录后可切换为完整趋势中心",
    }


@app.get("/api/trends/hot")
def trends_hot():
    return {"items": [], "keywords": []}


@app.get("/api/trends/timeline")
def trends_timeline():
    return {"points": []}


@app.get("/", response_class=HTMLResponse)
def index():
    return HTMLResponse(
        """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>趋势分析 · 占位模式</title>
  <style>
    :root { --gold:#b08d57; --bg:#1a1a1c; --card:#252528; --muted:#9a9a9e; --text:#ece8e1; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: system-ui, "Segoe UI", sans-serif; background:var(--bg); color:var(--text);
      min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .card { max-width:520px; background:var(--card); border:1px solid rgba(176,141,87,.25); border-radius:16px;
      padding:28px 32px; box-shadow:0 12px 40px rgba(0,0,0,.35); }
    h1 { font-size:1.15rem; font-weight:600; margin:0 0 12px; letter-spacing:.02em; }
    p { margin:0 0 14px; font-size:0.9rem; line-height:1.65; color:var(--muted); }
    p strong { color: var(--text); }
    .hint { font-size:0.82rem; color:var(--gold); opacity:0.9; margin-top: 10px; }
    code, pre { font-family: ui-monospace, Consolas, monospace; }
    pre { font-size:0.76rem; background:#111; padding:12px 14px; border-radius:10px;
      color:#c8c4bc; margin:10px 0 0; overflow-x:auto; line-height:1.5; white-space:pre-wrap; word-break:break-all; }
    .lbl { font-size:0.72rem; color:var(--muted); margin-top:14px; margin-bottom:4px; }
    .tag { display:inline-block; font-size:0.7rem; padding:4px 10px; border-radius:999px;
      background:rgba(176,141,87,.15); color:var(--gold); margin-bottom:16px; }
  </style>
</head>
<body>
  <div class="card">
    <span class="tag">占位模式</span>
    <h1>趋势分析中心（精简占位）</h1>
    <p>当前运行在 <strong>占位服务</strong>：说明本机 <strong>8002</strong> 上的趋势进程<strong>没有成功加载</strong>完整 ai_fashion（或仍在跑<strong>旧进程</strong>）。</p>
    <p><strong>请先关掉旧的 8002</strong>（任务管理器结束 python，或 <code style="display:inline;background:#111;padding:2px 6px;border-radius:4px">taskkill /PID … /F</code>），再在<strong>含 start.py 的项目根</strong>执行 <strong>python start.py</strong>。</p>
    <p>若已将源码放在项目根下 <code style="display:inline;background:#111;padding:2px 6px;border-radius:4px">ai_fashion\\ai_fashion\\</code> 且其中有 <strong>api.py</strong>，新版启动器会<strong>自动识别</strong>，一般<strong>不必</strong>再设环境变量。</p>
    <p class="hint">若仍为本页：看运行 <code style="display:inline;background:#111;padding:2px 6px;border-radius:4px">python run.py</code> 的终端里是否有红色报错（缺依赖、导入失败等），并在 <code style="display:inline;background:#111;padding:2px 6px;border-radius:4px">ai_fashion\\ai_fashion</code> 目录按原项目说明安装依赖。</p>
    <div class="lbl">可选：手动指定路径（PowerShell，路径改成你的真实目录）</div>
    <pre>$env:AI_FASHION_BACKEND = "你的项目根\\ai_fashion\\ai_fashion"
cd "你的项目根\\backend\\services\\trend-analysis"
python run.py</pre>
    <p style="margin-top:16px;font-size:0.82rem;">确认未设置 <strong>FASHION_TREND_USE_STUB=1</strong>（否则会强制占位）。无 ai_fashion 时可保留本页仅做联调。</p>
  </div>
</body>
</html>"""
    )
