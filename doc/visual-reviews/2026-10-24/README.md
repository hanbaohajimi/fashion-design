# Atelier 全系统视觉重构验证归档

实施基线为 `993dd9e`。完整范围、设计规范、业务保护及验证限制见 [实施报告](../../全系统视觉与交互重构-2026-10-24.md)。

- [36 组前后对照](comparison.html)：同组 API fixtures 下的实际截图，包含主要入口、11 个工作室模块及资产和导出浮层；下载仓库后用浏览器打开，可切换实际像素和去色视图。
- [颜色预览](design-system/preview.html) 与 [完整对比度矩阵](design-system/contrast-matrix.csv)：从实际 CSS 导出，33 组配对通过；导出 CSS 不参与应用运行。
- [视觉审查记录](visual-review.json)：59 张逐张审查的固定 Linux Chromium 截图及 SHA-256；正式基线位于 `tests/visual/__screenshots__/atelier.spec.ts/`。
- [响应式扫描](responsive-audit.json)：102 组检查；[工作室首屏定位](workspace-targets.json) 记录 1366×768 下全部 11 模块的有效内容起点与主操作数量。
- [输入边界与焦点](input-boundaries.json)：项目、面料和趋势入口的真实计算样式。
- `checks/`：lint、类型、构建、206 项组件测试、128 项全量业务 E2E、相关增补回归及 53 项视觉测试输出。扩展名改为 `.txt` 供版本管理，仅清理行尾空格与文件末尾多余空行。

截图使用测试素材，不代表生产素材质量。683×384 是 200% 缩放的等效可用空间检查；未声称完成真实设备浏览器缩放或软键盘验收。尚未完成真实设计师参与的用户验证及真实数据库、队列、计费、私有存储链路验证。

未归档本地服务日志、重复候选截图和源码压缩包。原始输出仍位于本机 `output/neutral-refactor/`。生成脚本分别是 `scripts/export-design-system.mjs` 和 `scripts/create-ui-comparison.mjs`；图像对照脚本需要已有 before/after 截图，不会补造界面图。

2026-10-25 补充复核：远端 CI 及本机重复运行暴露了实验配置原生 `fieldset` 滚动条占位不稳定的问题。将滚动承载移到独立容器并固定滚动条留白后，逐张检查桌面、手机、只读与请求失败五张候选图，仅更新 1280px 实验页面的一张正式基线。对应新旧哈希及审查原因保存在 `visual-review.json` 的 `followUpReviews` 中；其他日期为 2026-10-24 的对照图保留原始归档。
