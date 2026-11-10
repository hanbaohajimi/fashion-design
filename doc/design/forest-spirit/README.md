# 森林精灵资产与接入资料

历史状态：2026-11-08 起，正式白板入口已改为[织芽毛绒助手](../assistant-seed/integration.md)，不再挂载此处的 Live2D 角色。下文保留此前的设计、交接和制作阶段记录，其中“继续生产”等描述不代表当前实施任务；原交接包保持原样归档。

先读 [本次资产审计](asset-audit.md) 和 [最新外观修正](visual-amendment.json)，再读 [原交接入口](handoff-v1/CODEX_START_HERE.md)。

`handoff-v1/` 是桌面交接包的原样归档，55 个文件与桌面源逐个 SHA-256 一致。不要直接修改归档来覆盖后来确认的需求；新需求记录在外部修正文件。

当前最新外观要求是棕色绣眼内的小浅色 **十字形（+）装饰**，不是 v1 候选的星形。用户已确认 v2 的新帽型与服装轮廓，并授权继续拆层准备；其余脸型、眉毛、浅金头发、短靴、工具袋和所有表情无睫毛要求保留。[已确认透明母图](production/master/forest-spirit-approved-v2.png) 已归档；它仍是平面图，尚无实际拆层、PSD 或该角色的真实 Cubism 导出。按 [v2 拆层准备说明](production/README.md) 继续生产，不需再次询问同一外观确认。

可复现检查入口为 `scripts/manual/forest-spirit/audit-assets.py`；最新本地检查结果写入仓库忽略的 `output/forest-spirit-audit/`。检查器通过仅表示参考包与引用规则正确，不能当作模型制作或网页播放验收。

[前端接入说明](frontend-integration.md) 记录默认开关、现有对话桥接和启用条件；本地分层验收报告在 `output/forest-spirit-validation/report.md`。正式角色缺少分层和模型，测试结果分为模拟交互与官方样例真实运行时验证，不混作正式人物验收。
