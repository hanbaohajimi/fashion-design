# 003 — 操作反馈、重命名与焦点恢复

- 状态：已实施；优先级：P1。最新证据见 [实施记录](IMPLEMENTATION.md)。
- 技能：ask-sonner、emil-design-eng、apple-design。
- 基线：`5dbd7a6` 加本轮已检查的工作区改动；只修改本任务涉及的行为，保留正在接入的品牌动效。
- 工作目录：`G:/new-fashion-design`。

## 现状与文件

`apps/web/src/modules/projects/ProjectCard.tsx` 的 submitRename 没有在途请求锁；关闭编辑会卸载输入和原来的菜单入口，没有显式恢复焦点。`ProjectLibrary.tsx` 的 runRename 在父级显示错误后再次抛出，卡片又显示同一错误；页级 notice 用 alert 同时承载成功和失败。

`apps/web/src/app/layout.tsx` 已有唯一 light 主题 Toaster；`apps/web/src/components/ui.tsx` 已有 Notice、Button 和原生 Dialog。复用这些能力。现有项目复制 flight 去重应保留，不重复实现。

## 行为规格

| 操作状态 | 呈现位置 | 行为 |
| --- | --- | --- |
| 字段校验失败 | 输入旁 | 描述具体限制，关联 aria-describedby，聚焦第一个错误 |
| 重命名请求失败 | 正在编辑的卡片 | 保留新名称与编辑态，显示一次错误，可重试 |
| 复制、归档、恢复成功 | 根 Toaster | 只在服务端确认后显示一次成功；不抢焦点 |
| Dialog 内的提交错误 | Dialog 内 | 保持可读、可操作，不能只靠 body 上的 Toast |
| 长生成任务 | 原有 TaskFeedback/结果区 | 保留持久状态和单项重试，不将生命周期替换成 Toast |

原生 showModal 会进入 top layer，普通 body 元素的 z-index 无法替代 Dialog 内反馈。依据：[MDN showModal](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal)。

## 实施步骤

1. 在 `apps/web/src/components/` 新建小型操作消息工具，接口只包含稳定 id、结果类型、标题、可选说明与动作。使用 Sonner 自带类型，不引入消息仓库或新状态库。id 采用 `operation:entityId`；并发不同实体不相互覆盖，同一操作更新同一条消息。
2. 成功消息默认 4000ms；提供关闭按钮和中文关闭标签。失败若需要用户修正或重试，必须有持久的页内/字段内入口，不能只依赖自动消失的 Toast。offset/mobileOffset 按任务 002 的安全区规则配置。保留库原有堆叠动画、light 主题和现有品牌事件反馈，不再额外播放第二次庆祝动画。
3. 重命名使用同步 ref 锁拦截同一事件循环中的连续提交，再通过 pending state 驱动共享 Button 的忙碌状态。键盘 Enter 与点击保存走同一入口；finally 释放锁。pending 时禁用该编辑区的保存/取消并阻止其 Escape 退出，不锁住整个项目库。
4. 名称 trim 后按现有 API 的字符串长度语义校验 3–80。当前前端 Array.from 按码点计数，服务端 z.string().min/max 按 UTF-16 长度计数；本任务对齐现有服务端，补中文、代理对 emoji 边界用例，不暗改 API 契约。
5. 重命名由卡片拥有失败呈现；父级失败继续向调用方抛出，但移除同一操作的父级 notice。成功退出编辑后，在 React 更新完成且菜单重新挂载后聚焦该项目的菜单 summary。通过稳定项目 id 和受控 trigger ref 实现，不能对已经断开的旧 DOM ref 调用 focus。
6. 取消/未变化名称同样恢复焦点。归档移除当前卡片时，焦点移到相邻可操作卡片；列表为空时回到列表标题或明确的空态动作。禁止隐式落到 body。
7. 若保留页内全局 notice，将状态改为带 tone 的结构，复用现有 Notice：失败 alert，普通结果 status。不要成功 Toast 和成功 notice 双重播报。归档/恢复失败按其操作入口归属展示，不能吞掉失败或提示成功。
8. 不增加不存在的撤销语义；只有后端已有明确恢复操作时才能提供相应动作。保持权限、乐观更新回滚及当前复制去重机制。

## 验收

- 连续两次 Enter、Enter 加点击、双击保存：同一在途名称更新只有一次请求。
- 3 秒延迟期间按钮反馈明确；失败保留输入；重试可成功；成功、取消和 Escape 均有确定焦点返回点。
- 同时重命名两个不同项目互不阻塞；服务端 403/409/网络错误不会造成假成功。
- 字符串长度覆盖 2/3/80/81、全空白、中文和 emoji；错误规则与服务端相同。
- 复制/归档/恢复每次只有一个主要消息源；读屏成功使用非打断式状态语义。
- Dialog 打开时错误可见且可访问；手机 Toast 不挡底部关键动作。

测试放在对应组件旁；在现有 `tests/e2e/frontend-experience.spec.ts` 中补真实键盘和焦点路径，不只断言 Toast 文案。

```powershell
pnpm --filter @fashion/web test
pnpm exec playwright test tests/e2e/frontend-experience.spec.ts
pnpm --filter @fashion/web typecheck
pnpm --filter @fashion/web lint
```

交付：失败/成功截图、请求计数断言、键盘路径结果及修改文件清单，见实施记录。本文保留原始实施规格。
