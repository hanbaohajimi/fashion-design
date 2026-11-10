# 项目生成文件浏览与来源恢复验收

日期：2026-11-10。范围为项目已有产物的集中浏览、搜索、预览、下载及来源定位。入口位于无限白板的项目菜单“生成文件”，沿用暖白、深绿和已有对话/画布实例。未运行模型生成，不据此判断生成质量或与 Lovart 全面等效。

## 实现与交互

- 按全部、图片、视频、音频、文档筛选，服务端搜索名称、操作或文件编号；每页30项，手动继续读取和刷新，不增加轮询。关闭取消列表读取及下载准备，账号/项目切换隔离查询与预览。
- 生成图片、编辑结果、归档产物、服装秀媒体及成功/过期导出记录集中展示；结果移出当前画布后仍可访问。同一资产的多份画布摆放只列一次，不按文件字节合并不同产物记录。
- 图片以 contain 展示完整内容；视频、音频使用浏览器播放器，不自动播放，返回列表卸载播放器。预览失败可重试；列表在预览期间保持挂载，返回保留滚动和行焦点。
- 当前画布结果可定位；失效节点提示后保留预览。历史生成图片可查看只读设计路径，无决策写入入口；窄屏按来源、操作、输出纵向排列。
- 技术包/展示稿来源链接展开并聚焦实际导出修订，当前编辑草稿仍是当前版；缺失修订明确提示，缺失文档不改开另一份文档。切换功能或返回款式时清除旧修订定位。系列导出链接打开原系列，已删除时显示读取错误、保留重试且禁用导出。
- 缺失来源的导出保留记录，不生成指向无关展示页的链接。过期文件禁用下载，存在有效来源时可回去重新导出；本地一次性到期计时只更新显示。
- 开合面板保留画布中心、聊天实例、草稿、光标与列表阅读位置；打开暂停织芽，关闭恢复并将焦点交回项目菜单。

## 接口与数据边界

共享类型：`packages/shared/src/project-generated-files.ts`。API模块：`apps/api/src/modules/project-generated-files/`。前端：`GeneratedFilesPanel.tsx`、`generated-files-api.ts`，来源修订定位由 `use-linked-document-revision.ts` 提供。

| 接口 | 行为 |
| --- | --- |
| `GET /projects/:projectId/generated-files` | 可选 `kind=all|image|video|audio|document`、`q`、`limit`、`cursor`；默认30、最多60项 |
| `GET /projects/:projectId/generated-files/:domain/:id/download` | `domain=asset|runway|export`，重新检查访问权限、业务记录、过期时间及存储文件后返回短时签名与文件名 |

读取直接投影现有 DesignAsset、RunwayMedia、ExportJob，无新数据库状态副本或任务调度。排除普通上传图片、输入媒体、衣架蒙版、定位/细节指引及材质探针；Studio 与新接口共享已有资产可见性规则。

每个来源读取 `limit+1`，以创建时间及 `domain:id` 倒序合并；游标绑定项目、筛选与搜索条件。删除分页边界行仍可继续，之后插入的更晚记录留给刷新查看。仅对当前页补查现存画布节点及来源文档。

所有读取/下载使用项目 read 权限，响应为 private/no-store。签名最长60秒，且不超过导出文件剩余期限，存储检查后再次计算期限。下载使用原文件及实际 MIME，中文附件名保留；大文件交由浏览器处理，不先整体装入前端内存。界面只提示“已交给浏览器下载”，不承诺已落盘。权限撤销会阻止后续获取签名，已经发出的签名在短时有效期内仍可能可用。

前端验证身份、状态、日期、数字及 URL 等响应字段，来源链接限定当前项目；不完整响应可重读，无效下载响应不启动下载。存储文件缺失时明确失败，产物记录保留。历史外部图片可沿用原有预览，但不属于部署私有存储的原图不由新下载接口代理。

## 检查结果

以下按不同用例计数；重跑同一用例不重复累计。

| 检查 | 结果与范围 |
| --- | --- |
| API 定向单元/真实集成 | 34项：新模块7项单元、5项真实集成、原 StudioService 22项回归；收尾改动后新模块12项再次通过 |
| Web 定向单元 | 28项：DesignPathPanel 4项、技术包/展示19项、文件响应与下载5项；收尾复测后24项通过，路径4项沿用本阶段此前结果 |
| 浏览器功能 | 最终 `generated-files.spec.ts` 20项通过，单worker；涵盖列表、下载、媒体、草稿与账号隔离、有效和失效来源 |
| 独立画面/裁切 | 2项：1440×900和320×568，含默认/悬停/路径展开/稳定四态；面板内部 cut=0、hidden=0 |
| 独立性能 | 1项，100对象、120文件，三段各30秒，详见下表 |
| 静态检查 | Web/API 应用类型检查、目标文件 ESLint、目标 diff 空白检查通过；ESLint 保留已有 Next pages 路径提示，退出码0 |

共62项不同单元/集成检查；不将浏览器、画面和性能项混入该数字。前端与真实后端分别检查，尚未用正式生成任务完成整页端到端验收。

真实集成使用隔离测试账号、项目和记录，经过 PostgreSQL、Nest HTTP 与 MinIO，结束清理测试数据。覆盖同时间跨域分页、搜索/类型、归档、内部产物排除、增删分页边界、跨项目访问拒绝、成员撤销后403、过期410、文件缺失、实际签名字节及中文文件名。音频/PDF的存储测试使用标记字节，只证明传输一致，不证明解码。浏览器另使用仓库内有效小视频和 WAV 检查加载、播放及卸载。

曾遇到浏览器路由模拟 attachment 下载被取消，改用独立本地 HTTP 文件服务后实际落盘通过；未将模拟失败当成应用下载故障。移动路径排版曾受过宽按钮样式及三列布局影响，已缩小样式作用域并在≤560px的嵌入容器改为纵向，相关回归和画面检查通过。

## 性能记录

2026-11-10北京时间12:15，Windows、Chromium 145.0.7632.6，无头、DPR=1、16逻辑线程，原生时钟/rAF、单worker、无trace/录屏/并行检查。API及图片为受控本地夹具；数据在来源缺失提示与响应校验补充之前取得，这些补充未更改滚动或画布渲染路径，未重复宣称新性能测量。

| 场景 | 平均fps | >33.3ms帧 | 输入至下一帧P95 |
| --- | ---: | ---: | ---: |
| 打开文件前平移100对象白板 | 59.90 | 0.167% | 5.9ms |
| 滚动120条文件 | 60.00 | 0% | 0.3ms |
| 关闭文件后平移白板 | 59.94 | 0.111% | 6.2ms |

均达到本阶段≥58fps、长帧<1%的目标。首屏操作至30项显示693ms。输入采样是事件至下一次rAF，并非显示器实际呈现延迟；不代表生产网络、大视频或真实手机性能。原始帧数据：`output/playwright/generated-files/performance.json`。

## 画面与复现

生成物保存在忽略目录 `output/playwright/generated-files/`：

- `final-list-1440.png`、`final-list-320.png`：列表。
- `image-preview-*`、`history-*`、`video-preview-*`、`documents-*`：完整图片、只读路径、媒体与文档。
- `tour-1440.webm`、`tour-320.webm`：实际界面短录屏，使用测试素材。
- `clip-1440.json`、`clip-320.json`：四态裁切结果。扫描器覆盖dialog后代，自身投影不在扫描范围；另验证原生模态边界位于视口内。

320px画面在减弱动态和系统暗色偏好下检查；平台仍为现行暖白主题，不能据此声称已有完整独立深色主题。真实手机与实体触控仍待验证。

定向复测命令（不要扩为全仓检查）：

```powershell
# 仓库根目录
pnpm exec playwright test tests/e2e/generated-files.spec.ts --workers=1

# apps/web
pnpm exec vitest run src/modules/board/workflow/generated-files-api.spec.ts src/modules/studio/TechPackEditor.spec.tsx src/modules/studio/PresentationSets.spec.tsx src/modules/board/generation/DesignPathPanel.spec.tsx

# apps/api；环境文件需使用绝对路径
node --env-file=G:/new-fashion-design/.env G:/new-fashion-design/apps/api/node_modules/vitest/vitest.mjs run src/modules/project-generated-files/project-generated-files.spec.ts src/modules/project-generated-files/project-generated-files.integration.spec.ts src/modules/studio/studio.service.spec.ts
```

性能复测在仓库根目录设置 `GENERATED_FILES_PERF=1` 后单独运行 `tests/e2e/generated-files-performance.spec.ts`；不与录屏或其他检查并行。

## 环境与尚未验证事项

Docker Desktop最初未启动。启动后既有 `new-fashion-design-runway-worker-1` 自动恢复；发现后立即停止，所查近期日志为连接失败，随后确认未运行。本阶段只显式启动数据库与MinIO，没有提交生成任务；不能表述为“正式Worker从未启动”。

未调用付费模型，未执行迁移、部署、CI、提交或推送。保留原有无关改动。签名开始后的网络下载失败由浏览器显示；大文件断点续传、完整PDF渲染、供应商产出质量以及Lovart登录后的内部体验均未据此验收。

官方参考沿用[能力对照](lovart-capability-review.md)中已经记录的公开材料。本次没有新增可复核的远程正文，未使用用户本机网络访问Lovart；历史中仅有访问成功发言而无工具正文的部分不能作为新增证据。整体产品目标继续进行，下一项优先核查对象历史与实际创作往返的连续性。
