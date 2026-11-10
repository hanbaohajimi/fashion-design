# 森林布偶精灵 · Codex 交付包 v1

这是根据用户最后确认的形象制作的**参考素材与制作规范包**，不是已经建模完成的 Live2D 模型。

Python 检查脚本使用标准库，建议 Python 3.10 或更高版本。TypeScript 文件是接口约定，不是完整播放器。

## 先做什么

1. 解压到当前项目中合适的资料目录，例如 `docs/forest_spirit_handoff/`。不假定本地项目路径。
2. 让 Codex 首先阅读 `CODEX_START_HERE.md`，再依次阅读 `docs/` 和 `specs/`。
3. 双击 `reference_index.html` 可离线查看所有参考裁图。
4. 在本目录运行 `python tools/check_handoff.py` 检查资料完整性。
5. 真正的模型制作完成后，运行 `python tools/check_runtime.py deliverables/live2d/forest_spirit.model3.json` 做基础资源引用检查，再进行官方 SDK 实际加载测试。

## 包内已经有

- 用户最后确认的 1254×1254 PNG 原图，按原文件复制。
- 主角色、面部、帽子与头发、短靴、工具袋、正侧背视图、表情、姿态、纹理等 25 张原像素裁图。
- 用户先前提供的平台 Logo 与工具袋细节截图，只作限定用途的辅助参考。
- 外观锁定、拆层、参数与动作、网页交互、验收、缺失资产和官方来源文档。
- JSON 制作清单、TypeScript 接口约定和 Python 检查脚本。

## 包内没有

没有透明角色成品，没有已经补画的部件层，没有可用的分层 PSD，没有 `.cmo3` / `.can3` 工程，没有 `.moc3`、纹理图集、真实的 `.motion3.json` / `.physics3.json`，也没有 Cubism Core。

**原图裁切不等于拆层。JSON 规格不等于绑定。让 PNG 上下浮动不等于真正 Live2D。**

## 硬约束

角色以最后一张母图为唯一身份基准。全状态无睫毛；保留浅金头发、棕色椭圆绣眼、棕色短靴和工具袋。禁止回退到最初禁止商用的娃娃照片或未经确认的旧方案。

悬停回应一次；左键直接打开现有对话并隐藏精灵；长按拖动位置；无自主游走；无小面板；收起对话恢复位置与会话。

## 文档导航

- `docs/01_visual_lock.md`：造型不变项、视觉优先级、母图局限。
- `docs/02_artwork_and_layers.md`：生产立绘、拆层、补画与 PSD 规范。
- `docs/03_rigging_and_motions.md`：绑定、参数、动作、物理。
- `docs/04_web_integration.md`：现有工作台接入与手势状态机。
- `docs/05_acceptance.md`：分阶段验收与测试。
- `docs/06_missing_assets.md`：完成情况、缺失资产与阻塞。
- `docs/07_official_sources.md`：官方依据和许可边界。

所有时长、尺寸、帧率和参数幅度均是**建议初值**，不是已测结果或用户已经确认的细节。调整时保持已确认交互不变。
