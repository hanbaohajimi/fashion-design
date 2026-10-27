# 文档目录

从本页按用途查找资料。历史方案保留原有事实和完成状态；文件日期、当时的截图或“已完成”描述，不代表当前版本已重新验收。

## 现行入口

| 资料 | 用途 |
| --- | --- |
| [项目 README](../README.md) | 本地启动、功能入口、升级和常用命令 |
| [Agent 架构](architecture/AGENT_ARCHITECTURE.md) | 当前设计协作框架、领域边界与实现依据 |
| [助手流式消息](architecture/assistant-streaming.md) | SSE协议、Redis恢复、发布开关与真实链路验证 |
| [前端设计规范](../apps/web/DESIGN.md) | 当前界面的视觉与交互规范，结合运行源码阅读 |
| [选择控件与命令菜单规范](impeccable/选择控件与命令菜单规范.md) | Select/Dropdown 的语义、数量阈值、手机弹层与登记例外 |
| [前端产品说明](../apps/web/PRODUCT.md) | 用户、任务、产品约束与资料来源 |
| [脚本目录](../scripts/README.md) | 日常工具、文档生成与手工验证入口 |

## 按用途查找

- [服装秀子功能迁移与实施](plans/fashion-show-migration/README.md)：2026-10-26，含来源基线、分阶段验收及模型可用性边界。

| 目录 | 内容与时间边界 |
| --- | --- |
| [architecture/](architecture/) | Agent 架构，以及[交互开发线与白板功能迁移](architecture/interaction-lines-and-migration.md)记录；后者核查日期为 2026-10-23 |
| [product/](product/) | MVP Word 方案和 2026-08-02 面料库/趋势方案，作为产品演进参考 |
| [demos/](demos/) | 三份演示视频拍摄流程书，保留可交付的原始 Word 文件 |
| [plans/](plans/README.md) | 2026-10-25 Web 审查、七项优化计划及[实施记录](plans/IMPLEMENTATION.md)；实施状态以各文件注明的基线为准 |
| [history/](history/) | 各轮视觉、流程和稳定性实施记录，以及[本次目录整理记录](history/仓库目录整理-2026-10-25.md) |
| [impeccable/](impeccable/) | 设计契约、方向比较、已归档基线和验收记录；[森织品牌验收](impeccable/森织品牌接入验收.md)为 2026-10-25 的检查结果 |
| [visual-reviews/](visual-reviews/2026-10-24/README.md) | 2026-10-24 的截图、对照页与检查输出，保留历史证据 |
| [reference/material-mounting/](reference/material-mounting/) | 装裱视觉研究：说明、参考图片、HTML 预览及预览生成代码；不作为现行 UI 规范 |

### 产品方案与演示文件

- [AI 服装设计平台 MVP 方案](product/AI服装设计平台MVP方案.docx)
- [面料库与趋势分析阶段方案](product/AI服装设计平台_面料库与趋势分析方案.md)
- [演示 01：从一张面料图片入手](demos/演示视频01_从一张面料图片入手_拍摄流程书.docx)
- [演示 02：从一张草绘图入手](demos/演示视频02_从一张草绘图入手_拍摄流程书.docx)
- [演示 03：从多参考图入手](demos/演示视频03_从多参考图入手_拍摄流程书.docx)

## 文件放置规则

正式文档按用途放入上述目录，图片与离线预览跟随对应资料。实施记录保留日期和验证边界；新增通用规范应从本页链接，不在仓库根目录继续堆放总结。

可复用生成工具放在 `scripts/documents/`。本地 PDF、渲染页、临时截图和工具输出放在忽略的 `output/`，不与正式资料混放。本次移动前的 Git 状态、文件哈希、原稿及本地成果均保留于 `output/archive/repository-2026-10-25/`；详见整理记录。
