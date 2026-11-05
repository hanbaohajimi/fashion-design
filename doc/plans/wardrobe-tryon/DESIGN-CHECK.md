# 衣架与试衣：设计继承核对

后续按用户要求重做的木质挂具、银色圆杆、真实服装尺度与预览，见 [真实材质返工](REALISM.md)；下文为返工前的设计继承记录，不替代最新视觉证据。

核对日期：2026-10-30。范围为最终衣架工作区及与现有工作台、商品展示、实时试穿的界面衔接。

结论：此次实现是森织现有设计系统内的普通功能扩展。暖白纸面、深绿动作色、字号、共享控件和项目上下文均沿用现行实现；视频指定的衣架空间行为只作为该局部工作区的交互，不提升为全站布局或动效规范。未改写全局 `apps/web/DESIGN.md` 与 `.impeccable/design.json`。

本轮采用 Impeccable documenter 的源码取证方式，读取 `reference/document.md`、`reference/degraded/documenter.md`，核对最终源码和已有截图；未重新运行测试、启动浏览器或调用模型。既有测试和独立审查结论引用 [分层验收记录](ACCEPTANCE.md)，不作为本次重新执行的结果。

## 依据及优先级

1. [现行 DESIGN.md](../../../apps/web/DESIGN.md) 与 `apps/web/src/styles/design-system.css` 共同定义当前产品规范；运行时主题以该样式文件为准。
2. [衣架局部 brief](../../../apps/web/.impeccable/surfaces/wardrobe-workspace.md) 记录已确认的页面方向、视频行为、素材和验证边界。
3. `apps/web/src/modules/studio/wardrobe/` 的最终组件及其复用的共享组件是本次实现证据。
4. [design.json](../../../apps/web/.impeccable/design.json) 提供现有设计元数据与组件示例；其中已有历史描述不能覆盖较新的现行契约及运行时值。
5. 视频观察、功能映射见 [VIDEO-REFERENCE.md](VIDEO-REFERENCE.md)。测试截图证明布局和交互状态，不能证明真实服装或供应商生成质量。

## 继承核对

| 项目 | 最终实现及结论 | 主要源码依据 |
| --- | --- | --- |
| 配色和表面 | 继承 `--surface-0/1/2/3` 的暖白层次及 `--color-ink`、`--color-ink-secondary`、`--color-action`、`--color-focus-ring`。局部未引入新的品牌色或主题；状态同时具有文字和操作反馈。 | `design-system.css`；`wardrobe.module.css`；`WardrobeWorkspace.tsx` |
| 字体与字号 | 沿用共享 Inter／中文系统字体栈。局部正文 14px、辅助信息 12px、标题 16px；手机输入 16px。未引入新字体，也未增加超出现行 12／14／16／24px 的文字层级。 | `design-system.css`；`wardrobe.module.css` |
| 边界与深度 | 普通列表和分隔线复用 `--border-hairline`。挂具、框选与焦点轮廓使用功能性笔画；衣物投影仅帮助辨认作品层次，资料区保持平面排版。 | `wardrobe.module.css`；`GarmentDisplay.tsx`；`RegionSelector.tsx` |
| 导航和页面归属 | 衣架置于当前项目的商品展示内部，沿用项目和款式修订来源；没有新增全局常驻导航列，也没有替换现有品牌和外框。 | `StudioWorkspace.tsx`；`StyleLibrary.tsx`；`WardrobeWorkspace.tsx` |
| 分栏与手机 | 复用 `WorkspaceSplit`，按实际容器至少 966px（640＋320＋6）判断停靠；窄屏沿用抽屉机制。手机使用衣架／搭配／试穿分视图，隐藏视图保留实例，收起返回衣架。此局部条件没有成为新的全站断点。 | `WardrobeWorkspace.tsx`；共享 `WorkspaceSplit` |
| 按钮、表单与反馈 | 复用 `Button`、`Field`、`Input`、`Select`、`SegmentedControl`、`Notice`、`UploadInput`、`ImagePreview` 和现有 `AssetPicker`。主操作、普通操作、危险操作保持原语义，没有另造视觉相同但行为不同的控件体系。 | `WardrobeRack.tsx`；`PrepareGarment.tsx`；`OutfitEditor.tsx`；`WardrobeTryOn.tsx` |
| 模态与可达性 | 聚焦、准备和截图切换确认使用共享 `Dialog`，继承原生模态、Escape 与焦点管理。聚焦／准备／确认壳桌面内边距 24px、手机 16px；聚焦保留上一件、下一件、返回及独立加入操作。 | `WardrobeRack.tsx`；`PrepareGarment.tsx`；`WardrobeTryOn.tsx`；`wardrobe.module.css` |
| 草稿与保存 | 复用本机草稿机制；搭配编辑、正式保存、版本冲突和离开保护维持原语义。本人试穿的临时快照不等同于正式保存搭配。 | `WardrobeWorkspace.tsx`；`OutfitEditor.tsx`；`use-realtime-outfit.ts` |
| 任务与历史 | 悬停、搜索、翻组、聚焦不创建 AI 任务。准备生成、确认入架和模特试穿分别显式执行；展示真实状态、失败和取消，旧版本结果仍可查看，并明确结果所属版本。 | `PrepareGarment.tsx`；`WardrobeTryOn.tsx`；`use-wardrobe-data.ts` |

## 保留在局部的行为和几何

**稳定命中规则。** 衣架按钮的命中区不随展示层移动。当前单品在原挂点附近转正，左右邻近单品按距离衰减让位；这不是把每次悬停都滚到中心的轮播。点击才进入放大聚焦，关闭后返回原浏览位置。键盘聚焦和触摸设备保留可达路径。

**浏览与搭配分离规则。** 点击衣服仍是查看；加入搭配是独立按钮。通常加入按冲突位置默认替换并提供撤销，叠穿通过明确操作确认；同一单品不同修订不重复保留。连体服与上装、下装的替换关系由搭配状态处理，而不是根据图片猜测。

**完整主体规则。** `GarmentDisplay` 以图片实际比例计算展示尺寸，使用 contain 和用户核对的归一化挂点。上衣、外套、连体服默认肩部衣架；裤裙用夹具；包、围巾、腰带用挂钩；鞋、帽和其他配饰用置物托。独立 SVG 挂具只属于展示层，不进入试穿参考图。透明边缘、长衣下摆和鞋底位置由真实图片及挂点决定，不使用统一衣服轮廓裁切。

衣架使用透明单品平面、CSS 透视与独立挂具实现 2.5D。它不提供真实三维体积、未知背面或布料物理，也不把这些未实现能力写成设计承诺。

当前局部动效为展示层 460ms 转正／位移、标签 150ms 显隐，聚焦进入 430ms、退出 240ms；减弱动态路径关闭主要空间变换。没有空闲循环动画。这些时长只记录当前衣架行为，不覆盖共享按钮、模态或会话的既有动效。

`--rack-count`、`--rack-shift`、`--rest-angle`、`--piece-width`、`--piece-ratio`、`--anchor-x`、`--anchor-y` 是有默认值的组件几何参数；内容和容器可以覆盖它们。它们不是新增全局设计 token，不写入 design.json 的主题原语。

**连续试穿规则。** 本人模式复用现有 `RealtimeTryOnPanel`。只有当前穿搭的单品、层次、穿着说明或叠穿确认发生变化才触发完整输入更新；单纯改名不触发更新。临时快照与参考准备串行合并，仅应用最新完整输入；准备期间保留前一画面并禁止截图，失败或不支持时明确停止应用旧效果。手机内部换视图保留会话，切换试衣对象前保护未保存截图。能力未验收时保持关闭，不通过界面暗示已经可用。

## 素材来源与截图范围

生产单品来自当前项目私有资产或用户明确上传；新上传复用签名上传、文件完成、缩略图及项目资产导入链路。上传成功仅登记并选中来源，仍需准备、并排核对轮廓和挂点、确认修订后才加入衣架。原始设计、生成候选、确认单品、临时试穿快照、正式搭配和试穿结果保留各自身份。

本次没有新增产品展示位图。`tests/e2e/wardrobe-fixture.ts` 明确标注的透明 SVG 几何样本用于上衣、外套、裤装、连衣裙、鞋和包的布局／交互检查；它们不是服装生成结果。`GarmentDisplay` 的 SVG 仅绘制挂具。

本轮文档核对实际打开了以下既有截图：

| 文件 | 可支持的结论 |
| --- | --- |
| `output/wardrobe-tryon/browser/rack-hover-desktop.png` | 现有森织外框、衣架主区与搭配侧栏、悬停正面和邻近让位的静态终态、不同挂具。 |
| `output/wardrobe-tryon/browser/focus-mobile.png` | 手机完整单品、聚焦导航、独立加入操作和模态内边距。 |
| `output/wardrobe-tryon/browser/prepare-source.png` | 现有素材选择、直接上传来源、独立准备操作、共享控件和可见焦点轮廓。 |

其他最终截图、录屏和视频对照位于 `output/wardrobe-tryon/browser/`。独立审查 `output/wardrobe-tryon/review/finish-review.md` 已将 F1–F5 评为 resolved；该结论限定于 UI 与工程修复。真实抠图、遮挡补全、多件保真、特殊品类效果以及本人物理摄像头供应商效果仍按 [ACCEPTANCE.md](ACCEPTANCE.md) 标为未验收。

## 既有漂移：仅记录，不改写

| 已有记录 | 与当前规范的关系 | 本次处理 |
| --- | --- | --- |
| design.json 的部分作用域、导航及叙述仍称 11 个工作室功能。 | 现行 DESIGN.md 已明确十二项；sidecar 的旧计数不能成为新增界面的规范来源。 | 保留原文件，记录漂移，不借衣架扩展批量更新全局文档。 |
| design.json 保留“新增 28／18／22px”等历史层级推广记录。 | 现行 DESIGN.md 和运行时文字层级已采用 12／14／16／24px。 | 按现行契约核对；不将历史记录重新规定为衣架字号。 |
| sidecar 示例包含较早的颜色、尺寸 fallback，`generatedAt` 仍为 2026-10-25。 | 共享 CSS 变量存在时实际继承运行时值；脱离应用的预览不能仅凭 fallback 被认定等同于当前界面。生成日期也不代表所有后续内容均未更新。 | 不据此宣称运行时样式错误，也不在本次范围修复 sidecar。 |

本核对未新增全站规则、主题 token 或组件示例；未把既有漂移、几何测试样本或未验收的模型效果固化为设计系统约定。局部 brief 已覆盖本次方向，无需追加改动。
