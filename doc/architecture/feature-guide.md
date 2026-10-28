# 功能指引

2026-10-28。实现位于 `apps/web/src/components/feature-guide/`，由根布局中的 `FeatureGuideProvider` 统一管理。本文记录当前实现、本轮针对性验证结果及验证边界。

## 页面与步骤

指引按页面类型分段，只介绍当前存在的入口。款式与交付十二项功能共用 `studio` 指引及偏好，切换项目、功能或查询参数不会新增首次查看记录。

| 页面类型 | 路径 | 步骤内容（目标均存在时） |
| --- | --- | --- |
| `projects` | `/` | 工作区目录、新建项目、搜索、账号菜单重播（4步） |
| `workspace` | `/:projectId` | 作品/流程视图、素材、助手入口、引用、项目任务（5步） |
| `studio` | `/:projectId/studio` | 功能目录、当前资料、保存与提交（3步） |
| `fabrics` | `/fabrics` | 搜索筛选、面料预览、加入项目（3步） |
| `trends` | `/trends` | 搜索筛选、摘要与来源、加入项目（3步） |

登录、认证、分享、原型及其他未匹配路由不启动指引。未登录时不展示。步骤文案集中于 `guide-model.ts`；`studio` 的资料标题可以读取目标的 `data-guide-title`。

助手按目标的 `data-guide-variant` 适配当前能力：`collapsed` 介绍展开“设计助手”，`mobile` 介绍切换“助手”视图，`input` 介绍输入需求与生成前确认，`history` 说明只读历史与顶部“新建对话”，`paused` 说明从“助手设置”恢复。状态改变时更新当前文案。资料页只有 `data-guide-switcher="true"` 时介绍切换资料，只有 `data-guide-revision="true"` 时介绍修订号，不从其他说明文字推断能力。

面料筛选指向“规格筛选”的真实入口，说明分类、成分、供应商和克重条件，并区分搜索框可查的名称、标签、编号。趋势筛选说明可搜索标题、摘要、关键词，或按主题查看；没有加入项目入口时省略对应步骤。

## 展示与生命周期

- 页面用 `data-guide-page` 声明类型，成功加载后设置 `data-guide-ready="true"`。加载中或失败不自动展示，也不写已查看状态。
- 首次展示等待目标布局稳定600ms；页面必须可见，没有其他模态dialog、命令菜单或弹出菜单，没有输入焦点，也没有按住指针。输入、组合输入、窗口改变及指针结束会重新等待。菜单重播允许从当前输入上下文发起，仍等待页面、弹层及布局就绪。
- 每步用 `data-guide` 定位真实元素。没有布局、隐藏、禁用或已移除的目标跳过，步数随当前目标调整；优先使用桌面/手机重复元素中处于视口内的实例。助手收起时介绍可见入口，不自动展开面板；只读页面仅介绍仍存在的可用功能。
- 展示期间页面隐藏或出现其他业务弹层时暂停，条件恢复后继续。账号、路径或查询参数变化结束当前轮次并重新判断，卸载清理监听、观察器和计时器。
- 普通跳过、Escape或完成立即写入本机偏好，当前轮次保留 `closing` 状态并停止步骤与几何更新，等待 `MotionDialog` 的120ms淡出结束，通过 `onAfterClose` 卸载。路由、查询参数或账号切换立即结束；减弱动态时关闭不播放动画。

指引只滚动和介绍现有目标。不会点击目标、切换业务视图、展开助手、改变分栏偏好、提交生成、上传、保存修订、发布或导出，也不绕过权限与人工确认。

## 本机偏好与重播

偏好存入当前浏览器的 `localStorage`，键为 `fashion:feature-guide:v1:<accountId>:<surface>`，只包含查看状态。它按账号、页面类型及版本隔离，不含项目ID，也不上传服务端。

| 状态 | 写入时机 |
| --- | --- |
| `viewed` | 指引第一次打开时，避免刷新或中断后再次自动弹出 |
| `skipped` | 点击跳过或按Escape退出 |
| `completed` | 最后一步点击完成 |

任一有效状态都会阻止同类页面再次自动展示；未知或损坏值忽略。存储不可用或写入失败时，当前Provider保留内存选择，不承诺刷新后的恢复。其他标签页的存储事件可更新尚未展示的判断，不强行关闭正在阅读的指引。

账号菜单的“功能指引”可重播当前页面，不必清除偏好。流程画布“工作室帮助”中的“查看界面指引”先关闭帮助弹窗，再等待条件就绪重播。重播期间仍会更新上述状态。

## 视觉、定位与键盘

`FeatureGuideOverlay` 复用 `MotionDialog` 的 `guide` 变体，以原生 `dialog.showModal()` 管理模态层与背景不可交互。SVG柔和遮罩挖洞，暖白与深绿双层轮廓标出目标；说明卡沿用暖白纸面、深绿动作色、共享圆角和浮层阴影。标题16px、正文14px、步数12px，操作按钮至少44px。

桌面在目标四周比较位置，减少卡片与高亮重叠；<768px先尝试底部，再比较顶部。定位计入visualViewport偏移与安全区，卡片距可见边缘16px，过高时内部滚动；目标必要时立即滚入视口。高亮按滚动祖先的client box及可见视口裁剪，排除祖先边框与滚动条占用，并考虑缩放后的尺寸。

`useGuideGeometry` 用ResizeObserver追踪目标、全部祖先与说明卡尺寸，用MutationObserver追踪兄弟DOM重排、文本及布局属性变化，并监听图片等资源加载与字体加载完成。滚动、窗口及visualViewport变化同样触发测量；事件通过单个rAF合并，空闲不运行持续rAF循环。暂停、关闭与卸载时清理观察器、事件和待执行帧。

进入使用 `--motion-guide-enter`（150ms）透明度动画，因业务弹层暂挂及普通跳过、Escape、完成时使用 `--motion-guide-exit`（120ms）淡出，普通关闭在淡出结束后卸载。离开路由或切换账号立即卸载。步骤正文使用150ms淡入。减弱动态将弹层动画时长归零并关闭正文动画。高对比度下卡片补充系统色边界。

指引提供上一步、下一步/完成与跳过；首步禁用上一步。Tab和Shift+Tab保留在当前dialog，Escape退出，步数与说明采用 `aria-live="polite"`。关闭后通过共享弹层逻辑返回安全焦点；路由已改变或页面隐藏时不强行恢复，避免重新聚焦输入而唤起手机键盘。

## 验证入口与边界

在仓库根目录运行：

```powershell
pnpm --filter @fashion/web test src/components/feature-guide/guide-model.spec.ts src/components/feature-guide/guide-layout.spec.ts src/components/feature-guide/guide-copy.spec.ts
pnpm --filter @fashion/web lint
pnpm --filter @fashion/web typecheck
pnpm test:e2e tests/e2e/feature-guide.spec.ts --project=chromium
pnpm test:e2e tests/e2e/workflow-canvas.spec.ts --project=chromium --grep "功能指引隔离画布快捷键"
```

本轮上述导览单元测试、Web lint与typecheck、43个导览Chromium场景及画布连线快捷键隔离场景已通过。单元测试覆盖路由识别、账号与页面偏好、损坏值、存储失败、卡片/高亮几何边界，以及助手状态文案、资料切换与修订能力、面料筛选入口。

43个导览浏览器场景包含五类页面的320、390、1024、1280、1440px宽度，及跳过重播、键盘、业务弹层等待、加载失败、空数据、助手收起、只读、跨项目偏好、窗口变化与目标移除。新增几何与关闭检查覆盖兄弟内容增高、图片加载、带边框滚动祖先的client box裁剪，以及普通动效下Escape的120ms淡出与焦点恢复。`workflow-canvas.spec.ts` 的“功能指引隔离画布快捷键，退出后保留原有连线选择”验证导览期间画布快捷键隔离及退出后的连线选择。截图生成到忽略目录 `output/feature-guide/`。

这些浏览器用例使用 `seedVisualApp(page, { guides: true })` 和受控API fixture，拒绝并记录业务写请求。其他视觉fixture默认预置五类页面为已完成，保持其回访用户场景。fixture不证明真实数据库、Redis、队列、MinIO、供应商或全部角色场景已经验证；本功能验证不调用付费模型。
