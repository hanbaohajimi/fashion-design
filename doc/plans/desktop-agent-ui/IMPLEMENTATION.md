# 桌面工作台实施与验收记录

开始日期：2026-10-27。开始提交：68131c2，实施前工作区干净。本文记录实施验收时的状态，后续Git保存和推送以提交历史为准。执行依据为用户批准的P0–P5计划与desktop-agent-ui技能，沿用既有暖白、深绿主题与组件。

## 阶段记录

| 阶段 | 实现 | 本轮证据/状态 |
| --- | --- | --- |
| P0 | 生产相对导入清单，作品/技术包/项目库隔离原型，生产入口fixture采集 | 原型1440/900/390已通过键盘和结构检查；6视口入口审计已运行 |
| P1 | WorkspaceShell上下文、共享目录、WorkspaceSplit 4.15.0、容器宽度停靠、抽屉/手机、hairline/字号 | Escape取消、键盘调整与刷新偏好通过；多视口无全局横向溢出 |
| P2 | AssistantComposer、IME守卫、唯一滚动控制、本机草稿与冲突副本、明确丢弃 | 草稿repository/hook测试及浏览器恢复通过；真实Windows IME另列未验证 |
| P3 | canceled契约与迁移、数据库取消隔离、AbortSignal、正文检查点、SSE游标/去重、项目任务中心 | 真实PostgreSQL/Redis/HTTP受控模型集成通过；无付费供应商调用 |
| P4 | 十二工作室功能与核心入口沿既有作品布局推广，任务入口统一，开始任务移交工作台 | 最新生产构建313项浏览器回归全部通过，页面和行为覆盖见COVERAGE.md |
| P5 | StreamingReply空闲停表与memo、滚动写入合并、压力fixture、裁切、文档收口 | 69项视觉比较通过，74张基线已逐项审核；真实Windows设备验收仍单列 |

本轮不是新建原生桌面壳，也没有替换tldraw、业务修订、计费或存储结构。WorkspaceShell统一账号/项目/编辑器上下文，ArchiveNavigation及既有页头继续负责视觉外框，保留各页面的文档流/视口语义。

## 关键行为变化

- 选中作品与引用到助手保持独立。聊天只显示结果摘要和入口；新结果不自动打开查看器或改变当前焦点。
- 中文组合输入及500ms内伴生Enter不发送；后续正常Enter可发送。发送锁避免重复提交，回复期间可编辑下一条草稿。
- 回复停止与图片任务取消保持独立。数据库取消终态、intentEpoch及租约检查阻止迟到提案/生成动作；供应商不支持停止时仅承诺停止系统后续处理。
- SSE恢复只GET并携带after，按attempt/eventId去重，旧attempt与旧事件不回退终态。同attempt重复accepted不清空正文。快照和历史不重播渐显。
- 明确失败后的重试创建新请求；请求结果未知保留该次请求身份。生成/保存/发布/导出仍分别确认。
- 草稿按账号、项目、编辑器、对象隔离。冲突副本刷新后仍可读取；明确丢弃不会被延迟写入或卸载恢复；发送前捕获控制器与本地修订收据，旧会话回执及同文的新修订不会被旧请求清除。
- File、Blob URL、签名URL从草稿值及基线中排除。退出账号清理该账号本机草稿。
- 分栏拖动取消恢复开始状态并释放库手势；取消不保存偏好。双击恢复384px、折叠重开及键盘调整均保留。
- TaskFeedback首帧使用真实状态，300ms只延迟装饰。任务中心去重领域任务，上传单列本机活动，只读成员没有写操作能力。

## 验证与环境

机器记录：output/desktop-agent-ui/machine.json。Windows 11家庭版中文版，build 26200，AMD Ryzen 7 7735H，16逻辑处理器，约15GB内存，Node 24.14.0，pnpm 11.9.0。浏览器Chromium 145.0.7632.6。视觉比较使用固定Linux Chromium容器与Noto CJK字体，不能与Windows直接截图混为同一基线。

### 已运行

- 隔离完整检查 `pnpm verify:desktop-ui`：通过。该命令依次部署增量迁移并运行pnpm check，覆盖依赖审计、lint、typecheck、数据库校验、测试、数据库集成及全部构建。最终环境记录在isolated-check-environment.json，最终日志在isolated-check-current.log；首轮记录保留为isolated-check.log及isolated-check-previous-environment.json。
- 最终完整检查：Web 93文件/462测试通过；API 91文件/734测试通过，2项供应商/代理条件测试跳过；Worker 18文件/117测试通过，1项真实供应商测试跳过；数据库3测试通过。包含草稿收据、历史空流状态稳定性、导航注册表与本轮全部源码。
- 单独的assistant-streams与project-tasks真实基础设施集成：合计9通过。另启用真实Next生产代理后assistant-streams 6/6通过，无跳过（assistant-real-proxy-final.log）；实际经过生产Next→受控Nest，delta在数据库最终提交前到达。覆盖跨实例取消、忽略AbortSignal的迟到模型、部分正文保留、权限、同时间戳分页与去重。
- 新增草稿repository/hook、IME、SSE游标与数值排序、真实状态单元测试。新增会话切换及同文新修订两项收据回归后，前端完整93文件/461测试通过（submission-unit-serial.log），lint/typecheck通过，最新生产构建通过（production-current-build.log）。
- 浏览器专项：助手草稿刷新/合成IME、分栏Escape与偏好、工作室表单恢复、任务能力与停止/焦点，4通过。
- 多状态裁切与键盘焦点：DPR 1/1.25/2下default、hover、expanded、motion-end均cut=0，3通过；回执hidden=0。
- 6视口、19项入口逐页检查：1920×1080、1440×900、1366×768、1024×768、768×768、390×844。含十二项工作室功能、登录、确认和公共分享；字号与默认态裁切门禁通过。
- 压力fixture：500条历史、100个节点、1000条面料。保留既有面料虚拟化，当次只渲染15张卡片；最终复测浏览器内捕获input事件到两次requestAnimationFrame的p95为56ms，React更新p95为89ms，记录在performance/stress.json。自动化协议往返p95为123ms，单独保留，不计为浏览器处理耗时。固定fixture开发运行时目标≤200ms；不当作真实用户INP或供应商首字延迟。
- 隔离原型1440/900/390：3通过，覆盖作品、技术包、项目库及抽屉/手机切换，原型输入保持。
- 生产分栏性能专项：12与200节点各3次10秒拖动，1项录制通过（sidebar-performance-final.log）；6轮帧间隔p95为16.7–16.8ms，PerformanceObserver未记录长任务。原始frames/CDP指标见output/playwright/optimization/sidebar-performance.json；没有修改前的同场景对照数据。
- Next生产构建完整浏览器回归：313/313通过（e2e-final-current.log，10.8分钟）。此轮在最终历史空流状态缓存修复前；修复后使用最终完整检查生成的生产构建，68/68相关浏览器场景通过（post-performance-browser.log，2.9分钟）。开发专用旧原型16/16通过（development-final-current.log）；同轮压力失败及后续修复结果分别保留。未将生产中隐藏的旧原型选择器开放为业务入口。
- 固定Linux Chromium普通视觉比较：69/69通过（visual-final-current.log，4.8分钟），覆盖74张已审核基线。新增桌面滚动槽位影响的5张只在逐项查看前后图后提升；没有批量接受差异。

### 遇到并处理的失败

- 初轮完整浏览器回归233通过、86失败、1跳过。失败包含真实焦点/草稿问题、旧分栏像素ARIA断言、旧菜单层级和中点文案断言、缺少新任务接口fixture，以及开发中HMR导致的临时重载。逐项修复后重新回归，不能把初轮结果称为通过。
- 初次共享本机数据库的pnpm check，outbox集成受历史待处理事件影响，4项失败；没有删除既有记录。独立schema与临时Redis下相同完整检查通过。后续检查沿隔离方式执行。
- 最初两个宽度的fixture Before仅作有限参考，其中工作台有首屏骨架采集，不用作完整视觉Before。没有伪造全系统修改前性能数据。
- 中间一次328项开发运行时全量：306通过、21失败、1项按需录制跳过。已按真实问题和过时断言分别修正：选择器的手机退场需等待native modal释放、失败重试保留原记录、新结果显式打开、草稿受理立即确认清理、历史前进后退预提交保护。失败回执保留，不以17项定向通过冒充完整回归。
- 最初压力测量把Playwright通信往返算入界面延迟，曾得到280ms及223ms；改为浏览器捕获input事件起算，保留自动化往返作为独立数据。另将未变的消息轮询结果保持原引用，输入不再重建已加载的500条消息。没有修改200ms门槛。
- 首次74张基线比较67通过、2处目录滚动位置差异；改为字体及布局稳定后定位，2处定向比较通过。逐项审核表在VISUAL-REVIEW.md，最终完整比较另记录。
- 生产构建专项发现tldraw的pointer-events规则在CSS合并后覆盖节点根容器，开发模式未暴露。节点HTMLContainer显式设置pointerEvents，生产中的逐节点执行、评估、对话及系列流程6项重新通过。中止存在该问题的生产全量，保留其日志，不把中止运行算作通过。
- 工作室目录改为仅在字体/容器布局变化时将当前功能居中，避免初始化滚动位置导致随机视觉差异；不在用户手动滚动时持续纠正。
- 删除彩条后，图片世界坐标仍计入旧4px边界；改为hairline outline不占内容盒，避免DPR边界取整破坏极端横纵比。完整图片/连线用例重新回归。
- 弹窗取消曾冒泡到助手容器，明确丢弃曾被本机恢复写回；均增加行为修复和回归覆盖。
- 最新源码压力复测曾测得input p95=265ms，React更新p95=190ms（development-final-current.log及stress-post-receipt-failure.json），超过200ms。定位为历史会话在无流式事件时每次render创建空drafts对象，使500条消息的memo失效。使用共享不可变空集合后，原门槛下复测input p95=56ms、React更新p95=89ms（performance-history-memo.log），并增加无事件历史重渲染回归。未抬高门槛或删除失败记录。
- 文档流页面单独预留根滚动条曾造成1024px目录宽度与画布不同；改为≥768px页面统一预留根滚动槽位，手机不预留。无横向溢出的断言比较scrollWidth≤innerWidth，不误要求有滚动槽位时仍等于视口宽度。
- 并行执行生产构建、视觉编译与单元测试时，商品展示12张选择上限用例超出既有5秒时限；保留submission-static-final.log中的失败，停止编译负载后不改超时重跑完整前端，461/461通过。

## 证据目录

| 目录/文件 | 内容 |
| --- | --- |
| output/desktop-agent-ui/production-imports.json | 路由、相对导入与生产CSS清单 |
| output/desktop-agent-ui/before/ | 有限修改前fixture参考，不能代替完整基线 |
| output/desktop-agent-ui/after/ | 六视口页面截图、几何、字号、裁切回执 |
| output/desktop-agent-ui/states/ | 各DPR默认、hover、展开、动效终态与焦点截图 |
| output/desktop-agent-ui/performance/stress.json | 输入样本、p95、React Profiler提交数据 |
| output/desktop-agent-ui/visual-review/ | 视觉候选复核拼图及清单 |
| output/desktop-agent-ui/visual-candidates/ | 固定容器生成的待复核候选，不直接覆盖仓库快照 |
| output/desktop-agent-ui/*test*.log、e2e-final.log | 本轮浏览器和专项日志 |
| output/desktop-agent-ui/isolated-check-current.log | 最终完整隔离检查与构建日志 |

完整检查还实际运行了技术包HTTP→outbox→BullMQ→私有PDF导出、Redis/Sharp/MinIO图片变换、缩略图队列补偿及worker stalled恢复；这些受控链路不代表真实供应商验证。

输出均为忽略生成物。规范与覆盖见[DESIGN.md](../../../apps/web/DESIGN.md)、[COVERAGE.md](COVERAGE.md)。接口与迁移见[项目任务与助手取消](../../architecture/project-tasks.md)，恢复边界见[本机草稿](../../architecture/local-workspace-drafts.md)。

## 未验证与人工验收

以下没有记为通过，也不能由合成事件或fixture截图替代。步骤见[人工验收单](MANUAL-ACCEPTANCE.md)：

1. Windows真实中文输入法候选选词、伴生Enter、真实物理滚轮与系统键盘连续操作。
2. Windows系统100%/125%/150%缩放，以及真实浏览器200%缩放和手机软键盘。已做DPR 1/1.25/2与等效窄视口测试，它们不等价于系统缩放或真机键盘。
3. 真实配置供应商的停止效果、费用和图像/视频输出；默认未调用付费模型。受控模型只证明平台取消与迟到结果隔离。
4. 页面状态已由自动化用例组合覆盖，未对每页每种状态逐一人工穷举。新旧截图和测试时间边界须保留。
5. 没有进行真实跨设备草稿同步，也不属于本轮范围。本机浏览器数据被主动清理、存储损坏或硬件故障后的恢复不作保证。
6. 未取得68131c2的全系统完整截图与性能基线。保留有限Before参考，以及本轮缓存修复前265ms/修复后56ms的同fixture记录；不把局部对照扩大为全系统前后结论。

## 发布与回滚

先执行增量迁移并发布能识别canceled的后端/读取端，再开放停止入口。关闭UI时保留取消状态读取与既有记录；不回写已应用迁移，不删除作品或历史任务。草稿没有新增服务端表，既有文件/修订结构保持。完整发布步骤见接口文档；本轮没有发布或远端部署。

## 最终结果

本轮代码实施与可自动化验证已交付：最终隔离pnpm check通过，生产完整浏览器313项通过，最终性能修复后相关生产场景68项通过，固定环境视觉69项通过，开发专用原型16项通过，压力fixture与生产分栏录制通过。完整接口、迁移、草稿恢复、页面覆盖和取消竞态证据已分别归档。

实施验收结束时，临时Web服务与隔离Redis已关闭，既有基础设施未停止；next-env.d.ts恢复开始时的生成引用，未保留临时构建目录改动。之后按用户要求重新启动本地系统，并执行Git保存和推送；没有远端部署。真实设备/供应商和完整修改前基线的限制见上文；尚不标记全系统人工验收完成。
