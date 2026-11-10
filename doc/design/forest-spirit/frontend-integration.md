# 现有助手的 Live2D 接入

2026-11-05。本文件只说明已实现的接入代码，正式 v2 模型尚未交付，不能据此宣布角色可播放。

## 已实现

- `apps/web/src/modules/forest-spirit/ForestSpiritAssistant.tsx` 挂在现有 `WorkflowCanvas` 画布区域，调用原 `setSidebarOpen`、`setMobileView` 和焦点请求。完整 `WorkflowAssistantPanel` 保持挂载，会话、消息、草稿仍由原系统管理。
- 悬停一次、1800 ms 冷却、不排队；短按打开原对话并隐藏精灵；400 ms 长按后拖动；6 CSS px 以内为按压容差；提前移出容差取消短按；按账号和项目保存可用移动范围内的归一化位置。
- 对话关闭恢复位置；键盘 Enter/空格打开；触屏不触发 hover；轮廓外穿透。指针捕获丢失、取消、窗口失焦、缩放、组件卸载均清理手势。
- 隐藏、后台、无可用空间暂停；运行时失败只隐藏精灵，原助手入口仍可用。WebGL 模型通过独立官方 SDK 运行时加载，30 fps 上限、DPR 上限 2；CSS transform 只定位拖动层，不承担人物动画。

## 资产未就绪时

`NEXT_PUBLIC_FOREST_SPIRIT_ENABLED=false` 为默认值。资源入口 `apps/web/public/live2d/forest-spirit/asset-manifest.json` 明确记录 `awaiting-production-assets`，没有伪造 model3/moc3 路径，也没有放入替代 PNG。

即使开发者把开关设为 true，资源清单不是 `ready`、人物版本不匹配、全动作视觉未审核、命中轮廓未审核或 SDK/资源加载失败时，也不会出现角色。当前只完成平面母图外观确认，不等于所有模型表情已审核。

## 交付后的启用顺序

1. 按 v2 拆层清单完成真实图层、遮挡补画、闭眼素材及 PSD，确认重组图没有形象漂移。
2. 在 Cubism 保存真实 cmo3/can3，并导出 moc3、model3、纹理、physics3 及四个分别制作的动作。正向视觉与参数审查通过后才能设置模型审核字段。
3. 使用 `scripts/manual/forest-spirit/prepare-runtime.mjs` 从本机官方 SDK 构建运行时。说明和许可文件保留要求见同目录 README；本轮没有部署或作商业授权判断。
4. 将审核过的模型包与运行时放在同源资源路径。依据 `spirit-contract.ts` 提供 ReadySpiritAsset：`model3Url`、`coreUrl`、`runtimeModuleUrl`、四动作 URL，以及与实际渲染比例对齐并逐点确认的 `hitArea.viewBox/polygons`。不要将测试矩形当正式轮廓。
5. 逐项完成角色真实浏览器验收后，在启动或构建时启用 `NEXT_PUBLIC_FOREST_SPIRIT_ENABLED=true`。公开环境变量是 Next 编译配置，改变后需要重启或重新构建。

## 本轮测试边界

定向单元测试覆盖资源门禁、手势状态机、生命周期及包装器。`tests/e2e/forest-spirit-assistant.spec.ts` 在真实浏览器和现有项目页面运行，API 被模拟，正向角色手势使用明确标注 TEST ONLY 的测试渲染器；没有调用收费模型、发送设计请求或创建第二套聊天。

浏览器证据在 `output/forest-spirit-validation/`。这些截图证明现有聊天桥接与恢复行为，**不能证明正式人物的 Live2D 画面、表情、物理、轮廓命中或动画质量**。官方 SDK 技术模型验证另行记录，与正式角色验收分开。

本轮独立运行时还实际播放了官方未修改 Haru：16 项技术检查通过，包括真实模型参数变化、物理、暂停恢复、动态减少动画、动作通道与末帧保持、加载取消、双实例释放和上下文丢失。记录位于 `output/forest-spirit-runtime/technical-evidence/technical-browser.json`。使用 Chromium 的 SwiftShader 软件 WebGL，不是硬件性能基准；Haru 与原版动作仅验证播放器，没有进入产品或成为正式角色交付。

本地复现（PowerShell，两个终端，先停用占用 3000 的其他开发服务）：

```powershell
# 终端一，仅为本地交互测试启用
$env:NEXT_PUBLIC_FOREST_SPIRIT_ENABLED='true'
pnpm --filter @fashion/web dev
# 终端二
$env:FOREST_SPIRIT_E2E_ENABLED='true'
pnpm exec playwright test tests/e2e/forest-spirit-assistant.spec.ts --workers=1
```

默认关闭开关时运行同一测试文件只执行原助手降级测试，其余测试明确跳过，不能计作全部通过。没有运行完整 pnpm check、CI、提交、推送或部署。
