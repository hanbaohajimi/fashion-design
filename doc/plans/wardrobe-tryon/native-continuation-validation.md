# 原生候选继续编辑的来源核验

日期：2026-11-04。这里只记录验证机制，不代表羽绒侧图已通过最终验收。

同一真实模型输出可以分别得到“旧局部蒙版试验失败”和“新全图意图可继续处理”的结论。新审核另存 `whole-candidate-review.json`，精确绑定图片 SHA 和允许目标；旧拒绝记录保留。新 native attempt 必须显式指定该审核及 `--allow-probe-parent`，并用 `nextStageScope` 绑定源、蒙版、attempt、correction 操作和允许目标子集。输出仍须重新全图审核，不能继承入架批准。

本次仅修改手工 runner 与其校验/测试，不增加产品 API，也不开放算法派生图直接作为 native 入口。入口继续要求真实成功的单张模型任务。递归遇到算法派生祖先时，验证真实 `existing/isolated` ready preparation、无任务的 DesignStep、source/raw/mask 三源四 SHA、raw 成功任务与实际参考/蒙版，以及冻结正面类别和方向；真实父资产仍是 raw，再沿算法 source 追溯。循环、目录越界、超过 64 层及错源均拒绝。

实际只读核查通过的链：Sunburst raw `907639…ebfe4` → 派生 `08bd45…57323` → 派生 `c9dd8b…df70` → 派生 `a2fb44…2fa4` → 真实原始侧图 → 已确认正面。首层使用独立全图审核，三个派生层分别使用自己的正式 processing 审核。数据库、私有存储实际字节均参与核验；未伪造任务或资产。

验证结果：

- `node --test scripts/manual/wardrobe-provider-journal.spec.mjs`：99/99 通过，包括合法派生祖先、错源/错 SHA/错任务/错准备/错正面拒绝、新审核目标子集、历史真实 v1 枚举接受及伪造缩写拒绝，以及登记/确认后再次读取原生血缘。
- `pnpm exec tsc --project output/wardrobe-provider/resume-audit/runner-tsconfig.json`：严格检查通过；配置继承仓库 API 严格设置并显式包含 runner。
- `pnpm exec eslint` 对 runner、journal、journal 测试、CLI wrapper：通过。
- `git diff --check`：通过。
- `audit-native-source`：真实数据库/私有存储递归通过，供应商请求、数据库写、存储写均为 0；日志保存在忽略的 `output/wardrobe-provider/resume-audit/native-source-live-audit.log`。

本次单次 native 供应商试验另在 `output/wardrobe-provider/attempts/puffer-sleeve-native-guide-v1/` 保留原始输出、真实任务、实际 wire 和后续独立审核。作者示意只提供一条缺失袖缝的位置意图；整体质感、合理分格和原款保真是结果标准，不能把人为像素坐标当成用户的设计要求。后续去背景仍需结构全图通过后另行决定，不自动触发。

2026-11-04 保存结果：该唯一 native 请求成功，实际 PNG SHA `7db93c896da09eeec543c638307e72daf761bb208ca347e01d3b62fd61f0331f` 的结构、材质和白/灰/深三底审核通过，无需额外去背景。实际桌面/手机挂具校准通过后，以原 PNG 和侧挂点 `(0.54,0.09)` 保存为版本 4，当前修订 `f2616249-cb24-4806-913a-d1119b2af653`；正面 `(0.5,0.21)` 与肩宽比例 `0.62` 保持。真实保存准备 `fee82790-efc4-4407-b075-20df69967062` 与此前预览登记 `e9254a68-a5f7-4b99-a1ec-11dee048a853` 均保留。

严格终态核查 `output/wardrobe-provider/final-state-audit.json` 已通过：29 个当前修订、58 张正侧图片及对应 canonical/保存回执一致；读取 113 个真实私有祖先资产，核验 72 个成功祖先任务。隔离项目累计任务 118 个成功、2 个失败，无在途任务或 worker，等待/活动/延迟队列均为 0。保留的实际调用累计 161 次图像 HTTP、118 次内容审核 HTTP；技术失败为图像 403 和 502 各一次，75 条历史视觉拒绝记录单独保留，不等于 75 次技术请求失败。无供应商最终账单，实际费用未知，不能把配置零值理解成免费。

该终态核查证明真实保存与来源一致；保存后的三组桌面/手机混排及正常动效录屏由 UI 验收记录单独给出，不能由素材或数据库通过自动推断。

保存后发现并修复了旧 runner 的证据合并问题：原 `confirm-side` 将 existing 登记覆盖进 `side-preparation.json`，把原 task/source 字段替换成登记后的空任务和输出自身。数据库、真实任务、图片及单品修订未受影响。新流程分别保留 `native-input-preparation.json` 与 `registered-side-preparation.json`，确认复用实际登记且不再覆盖原生输入。

本次已保存的 7db9 不重新确认或改写旧文件；仅在核对真实数据库任务、before/after compiled 输入、源/蒙版/作者参考绑定、四份实际私有图片 SHA 后新增独立输入证据，明确标记 `reconstructed-from-recorded-task-and-binding`、本次重建时间与全部来源文件 SHA，不冒充当时采集。重新运行保存后只读 native 血缘核查通过，日志 `output/wardrobe-provider/resume-audit/native-saved-source-live-audit.log`；29 件/58 图终态核查再次通过，版本仍为 4，所有历史拒绝原样保留，额外供应商请求为 0。
