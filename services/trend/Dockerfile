# syntax=docker/dockerfile:1
FROM python:3.11-slim

# 安装系统依赖（Playwright 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 \
    libpango-1.0-0 libcairo2 libx11-6 libx11-xcb1 libxcb1 \
    libxext6 libxss1 && \
    rm -rf /var/lib/apt/lists/*

# 工作目录
WORKDIR /app

# 先复制依赖文件（利用 Docker 层缓存）
COPY pyproject.toml ./

# 安装 Python 依赖
RUN pip install --no-cache-dir hatchling && \
    pip install --no-cache-dir -e ".[ocr]" || pip install --no-cache-dir -e . && \
    pip install playwright && \
    playwright install chromium && \
    playwright install-deps chromium

# 复制项目文件
COPY . .

# 创建数据目录
RUN mkdir -p data/images data/raw data/reports output logs storage storage_states

# 环境变量（可被 docker-compose 或 -e 覆盖）
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Shanghai

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python -c "from config import settings; print('ok')" || exit 1

# 默认命令：启动调度器（不立即运行，等第一个周期）
# 若要立即运行改为: python main.py run-once
CMD ["python", "main.py", "schedule"]
