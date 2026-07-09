# AI驱动的时尚穿搭/服装设计系统 — 系统性调研报告

> **调研日期：** 2026年6月19日  
> **方法：** 多角度并行搜索 → 23源筛选 → 95条claim提取 → 3-vote对抗验证 → 18条确认/7条剔除  
> **覆盖范围：** 2023–2026年，ACM MM / SIGIR / CVPR / ICCV / ECCV / AAAI / WWW / ICLR / TOMM / CHI 等

---

## 目录

1. [技术路线分类全景](#1-技术路线分类全景)
2. [重点论文结构化卡片](#2-重点论文结构化卡片)
3. [Yunshan Ma 研究谱系](#3-yunshan-ma-研究谱系)
4. [多智能体架构在时尚生成中的应用](#4-多智能体架构在时尚生成中的应用)
5. [技术路线演进时间线](#5-技术路线演进时间线)
6. [多智能体视频生成用于数字时尚：研究空白与创新切入点](#6-多智能体视频生成用于数字时尚研究空白与创新切入点)
7. [开源资源汇总](#7-开源资源汇总)
8. [参考文献](#8-参考文献)

---

## 1. 技术路线分类全景

### 1.1 检索式/推荐系统类（Outfit Recommendation & Compatibility）

传统范式：基于数据库中已有商品进行搭配推荐和兼容性评分。

| 论文 | 会议/时间 | 核心方法 | 开源 |
|------|----------|---------|------|
| **TOG** (Ding, Ma et al.) | IP&M 2023 | 类别组合模板 + 用户协调偏好学习，统一个性化与兼容性建模 | — |
| **KERN** (Ma et al.) | ICMR 2020 | 知识图谱增强的时尚趋势预测 | — |
| **多模态捆绑构建** (Ma et al.) | WSDM 2024 | 多模态特征 + 细粒度用户反馈进行商品捆绑 | — |

**与GenWardrobe/FashSketch对比：** 检索式方法受限于数据库中已有商品，无法创造新设计。GenWardrobe和DiFashion的核心motivation正是突破这一限制。

### 1.2 生成式穿搭类（Generative Outfit — GAN/Diffusion）

**核心范式转变：** 从"检索搭配已有商品" → "生成新商品图像并搭配"。

| 论文 | 会议/时间 | 技术栈 | 开源 |
|------|----------|--------|------|
| **DiFashion** (Xu, Wang, Feng, Ma, Zhang, He) | SIGIR 2024 | Stable Diffusion v2 + 三类条件（Category Prompt / Mutual Encoder / History Encoder）+ 三条件CFG | [✓](https://github.com/YiyanXu/DiFashion) |
| **GenWardrobe** (Jin, Wen, Yu, Ma*, Zheng, Fan, Ngo) | ACM MM 2025 (Demo) | Gemini查询理解 → Llama-Index RAG (60万条知识库) → SD 3.5服装生成 → GPT-Image-1 VTO合成 | [✓](https://github.com/ShanFengShanFeng/GenWardrobe) |
| **DualFashion** (Yu, Wu, Sun, Ma) | SIGIR 2026 | 双扩散Transformer，联合建模图像+文本模态，属性级描述增强可解释性 | 待发布 |
| **FashionDPO** (Yu, Ma, Wu, Wang, Li, Meng) | SIGIR 2025 | DPO微调：三专家反馈模块（MiniCPM质量 + VBPR兼容性 + CLIP个性化）替代手工奖励函数 | [✓](https://github.com/Mingzhe-Yu/FashionDPO) |

**DiFashion → GenWardrobe → DualFashion 演进脉络：**
- DiFashion (2024) 定义了"生成式服装推荐 (GOR)"任务，用扩散模型从零生成服装图像
- FashionDPO (2025) 引入偏好对齐，用DPO替代监督学习提升生成质量
- GenWardrobe (2025) 将GOR扩展到完整衣橱构建，加入RAG知识检索和VTO
- DualFashion (2026) 进一步扩展到双模态（图像+文本联合生成），增强可解释性

### 1.3 虚拟试穿类（Virtual Try-On — VTON）

**分类体系** (Islam et al., IEEE Access 2024)：
- **Image-based VTON：** 单张人物照片 + 单件服装 → 穿着效果图
- **Multi-pose VTON：** 同一人物多姿态下的试穿
- **Video VTON：** 视频序列中保持时序一致性的试穿

#### Image-based VTON

| 论文 | 会议/时间 | 核心创新 | 开源 |
|------|----------|---------|------|
| **StableVITON** (Kim et al.) | CVPR 2024 | 潜在扩散模型中学习语义对应；零交叉注意力块；ATV损失增强注意力图 | [✓](https://github.com/rlawjdghek/StableVITON) |
| **ITA-MDT** (Hong et al.) | CVPR 2025 | 掩码扩散Transformer (MDT)替代U-Net；ITAFA图像-时间步自适应特征聚合器；显著区域提取器(SRE) | [✓](https://github.com/jiwoohong93/ita-mdt_code) |
| **Smart Fitting Room / GMVT** (Yu, Ma et al.) | ICMR 2024 | 搭配感知VTO：统一服装推荐与虚拟试穿；用户提供部分遮挡图像，系统补全并试穿 | — |
| **OmniVTON** | ICCV 2025 | 首个免训练通用VTO框架，支持多人试穿，DDIM反演+服装先验生成 | — |
| **Voost** (SIGGRAPH Asia 2025) | 统一DiT实现双向试穿/脱衣，注意力温度缩放 + 自校正采样 | — |

#### Video VTON

| 论文 | 会议/时间 | 核心创新 | 关键指标 |
|------|----------|---------|---------|
| **Fashion-VDM** (Google & UW) | SIGGRAPH Asia 2024 | 首个端到端扩散视频VTO，64帧@512px，split-CFG + 渐进时序训练 | Video VTON奠基工作 |
| **DPIDM** (Li et al.) | CVPR 2025 | 动态姿态交互扩散模型，骨骼姿态适配器 + 层级注意力捕捉长程姿态动态 | VFID改善60.5% |
| **CatV2TON** | arXiv 2025.01 | 单DiT统一图像和视频试穿，时序拼接 + 自适应片段归一化 | 统一架构 |
| **VITON-DiT** | arXiv 2024.05 | 首个DiT视频试穿，在非配对人体舞蹈视频上训练 | 非配对训练 |
| **ChronoTailor** | arXiv 2025.06 | 区域感知空间引导 + 注意力驱动时序特征融合 | StyleDress数据集 |
| **MagicTryOn** | arXiv 2025.05 | DiT替代U-Net，联合建模时空一致性，服装token+语义+纹理+轮廓线条件 | 粗到细服装保留 |
| **PEMF-VTO** | IEEE TCE 2026 | 点增强Transformer：点增强空间注意力 + 点增强时序注意力 | 免掩码范式 |
| **DreamVVT** | arXiv 2025.08 | 两阶段DiT + LoRA：关键帧VLM生成 → 骨骼+运动描述驱动长视频 | 长视频生成 |

**六大开放挑战** (Islam et al. 2024)：
1. 服装纹理保留
2. 服装到人物的应用精度
3. 面部身份保留
4. 女性主导的数据集偏差
5. 服装多样性有限
6. 不现实的干净背景数据集偏差

### 1.4 LLM/多模态驱动类（Multimodal Fashion Agent / RAG）

| 论文 | 会议/时间 | 技术路线 | 开源 |
|------|----------|---------|------|
| **GPT-FAR / FashionReGen** (Ding, Ma et al.) | WWW 2024 (Demo) | GPT-4V走秀理解 → 集体组织分析 → 多模态报告生成；覆盖2019-2023六大品牌走秀数据 | [✓](https://github.com/CompFashion/FashionReGen) |
| **VogFashion** | Software Impacts 2026 | Qwen LLM核心 + 四场景（文生图/风格延伸/线稿转时装/图像融合）+ 元认知人机协同调控 + 知识图谱增强提示 | 开放获取 |
| **FashSketch** (Nguyen-Truc et al.) | ACM MM 2025 (Demo) | 图层式画板界面，文本转线稿生成，基于草图的视觉检索，LLM上下文感知线稿推荐 | 未找到 |

**GenWardrobe中的RAG实践：** Gemini查询理解 → Llama-Index从60万条时尚知识条目中检索（涵盖风格规则、场合着装规范、搭配原则等）→ 检索到的知识作为Stable Diffusion 3.5生成的条件信号。

### 1.5 多智能体系统类（Multi-Agent Fashion Design）

详见[第4节](#4-多智能体架构在时尚生成中的应用)。

### 1.6 偏好对齐/微调类（DPO / RLHF for Fashion）

| 论文 | 会议/时间 | 方法 | 开源 |
|------|----------|------|------|
| **FashionDPO** (Yu, Ma et al.) | SIGIR 2025 | 首个将DPO应用于时尚生成，三专家反馈（MiniCPM质量 + VBPR兼容性 + CLIP个性化），无需单独训练奖励模型 | [✓](https://github.com/Mingzhe-Yu/FashionDPO) |
| **StyleTailor** | AAAI 2026 | 三级负反馈闭环（单品级/套装级/试穿级），反例聚合为负向提示词引导迭代精炼，消除奖励模型训练需求 | arXiv:2508.06555 |

**两种对齐范式的对比：**
- **FashionDPO：** 偏好数据来自多专家模型独立评分，基于评分构造正负偏好对，一次性DPO微调
- **StyleTailor：** 偏好信号来自闭环迭代中的负反馈，在线收集 → 即时用于下一轮生成引导，更接近online RL

---

## 2. 重点论文结构化卡片

### 2.1 DiFashion (SIGIR 2024) ★ 生成式服装推荐奠基工作

```
输入: 用户历史购买记录 + 目标类别
  │
  ├─ Category Prompt ──→ 类别对齐（如"上装+下装+鞋"）
  ├─ Mutual Encoder ───→ 跨品类兼容性（自注意力建模商品间关系）
  └─ History Encoder ──→ 用户偏好（从历史购买中提取风格特征）
  │
  ▼
Stable Diffusion v2 (三条件Classifier-Free Guidance)
  │
  ▼
输出: 多件协调的新服装图像（非数据库检索，生成式创造）

关键模型: Stable Diffusion v2, 三条件CFG, 自注意力Mutual Encoder
开源: github.com/YiyanXu/DiFashion
对比GenWardrobe: DiFashion定义任务范式，GenWardrobe扩展到完整衣橱+加入RAG和VTO
```

### 2.2 GenWardrobe (ACM MM 2025 Demo) ★ 参考起点

```
输入: 用户全身照 + 旅行计划（目的地/季节/场合/天数）
  │
  ├─ Gemini 2.0 Flash ──→ 查询理解（提取目的地气候、场合着装要求等）
  ├─ Llama-Index RAG ───→ 时尚知识检索（60万条目知识库：风格规则/搭配原则）
  ├─ Stable Diffusion 3.5 → 逐件服装生成（上装/下装/外套/鞋履等）
  └─ GPT-Image-1 ──────→ 虚拟试穿合成（将生成的服装穿到用户照片上）
  │
  ▼
输出: 完整旅行衣橱（多套协调穿搭 + 试穿效果图）

5种场景: 通用旅行/正式场合/休闲户外/日常通勤/多任务混合
双盲专家评估: 6位时尚专家，5场景，均值偏好分+1.146 (介于"better"和"much better"之间)
开源: github.com/ShanFengShanFeng/GenWardrobe
```

### 2.3 FashSketch (ACM MM 2025 Demo) ★ 参考起点

```
输入: 文本描述 / 粗略草图（设计师输入）
  │
  ├─ 文本转线稿生成 ──→ 从自然语言描述生成时装设计线稿
  ├─ 基于草图的检索 ──→ CLIP类视觉嵌入在数据库中检索相似设计
  ├─ LLM上下文推荐 ──→ 作为"共创伙伴"提供上下文感知设计建议
  └─ 图层式画板界面 ──→ 支持可组合的设计构思/定制/迭代工作流
  │
  ▼
输出: 精炼的时装设计线稿（"视觉DNA"）

对比GenWardrobe: FashSketch面向设计上游（构思/草图创作），GenWardrobe面向设计下游（穿搭/衣橱构建）；两者互补
```

### 2.4 FashionDPO (SIGIR 2025) ★ 偏好对齐

```
输入: 预训练服装生成模型 + 用户偏好数据
  │
  ├─ 质量专家 (MiniCPM MLLM) ────→ 评分生成的视觉质量
  ├─ 兼容性专家 (VBPR+ResNet-50) → 评分单品间搭配协调度
  └─ 个性化专家 (CLIP) ──────────→ 评分与用户风格的匹配度
  │
  ▼
三专家评分 → 构造正负偏好对 → DPO微调生成模型
  │
  ▼
输出: 对齐用户偏好的高质量、高兼容性、高个性化服装搭配

开源: github.com/Mingzhe-Yu/FashionDPO
对比GenWardrobe: FashionDPO专注于偏好对齐方法，GenWardrobe专注于端到端系统集成
```

### 2.5 StyleTailor (AAAI 2026) ★ 最完整的多智能体时尚流水线

```
输入: 用户查询 + 风格偏好
  │
  ├─ Designer Agent
  │   ├─ Style Interpreter (子Agent) ──→ 理解用户风格需求
  │   └─ Shopping Advisor (子Agent) ──→ 检索/生成候选服装
  │
  ├─ Consultant Agent ──→ 逼真虚拟试穿合成
  │
  └─ 三级负反馈闭环 ←── 核心创新
      ├─ Item-level: 单品搜索精炼
      ├─ Outfit-level: 全局一致性
      └─ Try-on-level: 试穿质量
      │
      反例聚合为负向提示词 → 下一轮生成引导
  │
  ▼
输出: 设计+推荐+VTO+评估统一的完整流水线

对比GenWardrobe: StyleTailor通过闭环反馈实现了迭代精炼，GenWardrobe是单向流水线
局限: 仍限于2D静态图像生成
```

### 2.6 ChatFashion (Advanced Engineering Informatics 2025)

```
输入: 多方利益相关者（设计师/制版师）+ 多个工业大模型
  │
  ▼
Transformer核心 ←── 群聊协调
  │
  ├─ 人类设计师 ──→ 设计意图
  ├─ 人类制版师 ──→ 工艺约束
  ├─ 生成模型 ────→ 设计方案生成
  └─ LLM ─────────→ 知识推理
  │
  ▼
协作学习机制: "模型互相学习"，捕捉群聊动态
  │
  ▼
输出: 覆盖设计/造型/制版全生命周期的协作设计方案

对比StyleTailor: ChatFashion面向设计上游（设计过程协作），StyleTailor面向设计下游（穿搭推荐+VTO）
对比GenWardrobe: ChatFashion关注人机多方协作，GenWardrobe是全自动流水线
```

### 2.7 GPT-FAR / FashionReGen (WWW 2024 Demo)

```
输入: T台走秀图像（2019-2023, 六大品牌春夏系列）
  │
  ▼
阶段1: Catwalk Understanding
  GPT-4V → 服装标注（类别: 裙装/夹克/大衣等）
         → 属性关键词生成（风格/廓形/领型/长度/印花/细节/装饰/面料）
  │
  ▼
阶段2: Collective Organization & Analysis
  基于指标的批量趋势统计分析
  │
  ▼
阶段3: Report Generation
  多模态 + 上下文学习 → 结构化时装报告
  │
  ▼
输出: 专业的时装趋势分析报告

开源: github.com/CompFashion/FashionReGen
对比GenWardrobe: GPT-FAR是分析型（趋势理解），GenWardrobe是生成型（衣橱创造）
```

### 2.8 VogFashion (Software Impacts 2026)

```
输入: 设计师需求（文本/线稿/参考图/多图融合）
  │
  ├─ Qwen LLM ─────────→ 核心语言理解与生成
  ├─ 知识图谱增强提示 ─→ 时尚域知识注入
  └─ 元认知调控 ──────→ 人机协作控制机制
  │
  ▼
四场景支持:
  1. 文生图 (Text-to-Image)
  2. 风格延伸 (Style Extension)
  3. 线稿转时装 (Line Drawing → Fashion Image)
  4. 图像融合 (Image Fusion)
  │
  ▼
输出: 单个设计场景的AI辅助产出

对比GenWardrobe: VogFashion是面向生产环境的单场景工具集，GenWardrobe是面向研究的多模块端到端系统
```

### 2.9 Knowledge-Augmented Agentic System for Costume Pattern Design (ADIC 2025)

```
输入: 传统服饰图案设计需求
  │
  ▼
五步闭环 (P-R-G-R-R):
  1. Perception ──→ 图案感知前景分割
  2. Retrieval ───→ 知识检索
  3. Generation ──→ 图案级修复(Motif-level Inpainting)
  4. Reflection ──→ 对称布局编辑(Symmetry-based Layout Editing)
  5. Revision ────→ 风格引导色彩调整(Style-guided Color Adjustment)
  │
  ▼
LLM驱动闭环迭代 ──→ 反馈回步骤1
  │
  ▼
输出: 精炼的传统服饰图案设计

对比StyleTailor: 同属闭环agentic范式，但ADIC聚焦图案级操作而StyleTailor聚焦套装级组装
```

---

## 3. Yunshan Ma 研究谱系

### 3.1 研究者简介

**Yunshan Ma (马云山)** — 新加坡管理大学 (SMU) 计算与信息系统学院，终身轨助理教授。博士毕业于新加坡国立大学 (NUS)，导师 Tat-Seng Chua。研究方向：计算时尚、多模态事件预测、推荐系统。

### 3.2 技术演进四阶段

| 阶段 | 时间 | 核心主题 | 代表论文 |
|------|------|---------|---------|
| **Phase 1: 知识提取与趋势预测** | 2019–2020 | 社交媒体时尚知识挖掘；知识图谱时尚趋势预测 | KERN (ICMR 2020), "Who, Where, and What to Wear" (MM 2019) |
| **Phase 2: 兼容性与推荐** | 2021–2023 | 序列化推荐；图模型；个性化套装生成 | TOG (IP&M 2023), 序列化推荐 (TMM 2021, ICMR 2021) |
| **Phase 3: 生成式+LLM融合** | 2024 | 基于扩散的套装生成；LLM驱动的报告；搭配感知VTO | DiFashion (SIGIR 2024), FashionReGen (WWW 2024), Smart Fitting Room (ICMR 2024) |
| **Phase 4: 高级生成式+偏好优化** | 2025–2026 | DPO微调；双模态扩散；生成式衣橱；离散捆绑构建 | FashionDPO (SIGIR 2025), DualFashion (SIGIR 2026), GenWardrobe (MM 2025), DDBC (ICLR 2026) |

**关键趋势：** 从分析（预测、提取）→ 生成（扩散模型、DPO），且越来越多地集成多模态LLM。2025–2026年的论文全部被CORE A*/A会议收录。

### 3.3 完整出版物清单 (2023–2026)

| # | 论文 | 会议/期刊 | 年份 | 合作者 | 开源 |
|---|------|----------|------|--------|------|
| 1 | TOG: Template-guided Outfit Generation | IP&M Vol.60(5) | 2023 | Yujuan Ding, P.Y. Mok, Yi Bin | — |
| 2 | Multi-modal Bundle Construction | WSDM | 2024 | Zhidan Liu, Shuaiqiang Wang et al. | — |
| 3 | GPT-FAR / FashionReGen | WWW (Demo) | 2024 | Yujuan Ding, Wenqi Fan et al. | ✓ |
| 4 | Smart Fitting Room (GMVT) | ICMR | 2024 | Mingzhe Yu, Lei Wu et al. | — |
| 5 | DiFashion | SIGIR | 2024 | Yiyan Xu, Wenjie Wang et al. | ✓ |
| 6 | GenWardrobe | ACM MM (Demo) | 2025 | Peng Jin, Yilin Wen, Mingzhe Yu et al. | ✓ |
| 7 | FashionDPO | SIGIR | 2025 | Mingzhe Yu, Lei Wu et al. | ✓ |
| 8 | DualFashion | SIGIR | 2026 | Mingzhe Yu, Lei Wu, Qianru Sun | 待发布 |
| 9 | DDBC (Discrete Diffusion for Bundle Construction) | ICLR | 2026 | Teng Tu, Ai Li et al. | — |

### 3.4 核心合作者网络

```
                Tat-Seng Chua (NUS, 博导)
                     │
         ┌───────────┼───────────┐
         │           │           │
    Yunshan Ma ─────┼── Yujuan Ding (港理工/港科大)
    (SMU, 核心节点)  │     长期合作: KERN, TOG, FashionReGen
         │           │
         ├── Mingzhe Yu (山大/SMU)
         │     主力合作: DiFashion→FashionDPO→DualFashion→GenWardrobe
         │
         ├── Wenjie Wang (NUS)
         │     DiFashion, 推荐系统
         │
         ├── Lei Meng (山大)
         │     Smart Fitting Room, FashionDPO
         │
         └── Xiangnan He, Fuli Feng (USTC)
               DiFashion
```

### 3.5 Yunshan Ma研究中的空白

- **多智能体时尚生成：** 未发表相关论文。最接近的是FashionDPO的多专家反馈（非自主协作）和GenWardrobe的流水线化多模块集成。
- **视频时尚生成：** 未涉及。最近仅有一篇微视频推荐论文 (ICMR 2026)，属于推荐而非生成。
- **3D服装生成/神经渲染：** 未涉及。

---

## 4. 多智能体架构在时尚生成中的应用

### 4.1 现有系统分类

#### A. 流水线式多模块集成（准Agent系统）

这些系统将多个AI模块串行/并行连接，但模块间遵循固定流程，无自主决策或协商：

- **GenWardrobe:** Gemini → RAG → SD 3.5 → GPT-Image-1。四个模块独立运行，无闭环反馈
- **FashSketch:** CLIP+FAISS检索 → LLM提示精炼 → ControlNet生成。视觉检索和文本生成交替
- **GPT-FAR:** GPT-4V → 组织分析 → 报告生成。三阶段固定流水线

#### B. 闭环反馈式Agent系统

这些系统引入了反馈循环，使输出质量通过迭代精炼：

- **StyleTailor (AAAI 2026):** Designer Agent + Consultant Agent + 三级负反馈闭环。这是目前最接近真正的多Agent系统的工作
- **ADIC Agentic System (2025):** 感知→检索→生成→反思→修正五步闭环，LLM驱动迭代

#### C. 多方协作式Agent系统

这些系统协调多个具有不同角色的自主实体：

- **ChatFashion (AEI 2025):** Transformer核心协调人类设计师/制版师与多个工业大模型之间的群聊式协作
- **AiFashion (ICaMaL 2024):** 客服Agent/裁缝Agent/制造Agent三体架构

### 4.2 技术分工模式对比

| 系统 | 分工维度 | 协调机制 | 闭环反馈 | 人类参与 |
|------|---------|---------|---------|---------|
| GenWardrobe | 功能模块（理解→检索→生成→试穿） | 固定流水线 | ✗ | ✗ |
| StyleTailor | 角色分工（设计师→顾问→评价） | Agent间消息传递 | ✓ 三级 | ✗ |
| ChatFashion | 利益相关者（人+AI多方） | Transformer群聊 | ✓ 协作学习 | ✓ 深度参与 |
| ADIC Agentic | 工序（感知→检索→生成→反思→修正） | LLM驱动闭环 | ✓ 五步 | ✗ |
| AiFashion | 业务角色（客服/裁缝/制造） | 多模态大模型 | 有限 | ✓ |

### 4.3 关键发现

**目前没有任何已发表的工作实现了≥3个异构Agent围绕时尚图像生成的真正协作。** 现有系统的上限：

- **Agent数量最多2个**（StyleTailor: Designer + Consultant），且两者遵循固定流水线传递，无辩论或协商
- **最复杂的Agent交互**是ChatFashion的群聊（人+AI多方），但聚焦上游设计讨论而非下游图像生成
- **最完整的闭环**是ADIC Agentic的五步P-R-G-R-R，但是单Agent而非多Agent系统
- GenWardrobe、FashSketch、GPT-FAR等本质上是多模块流水线，不满足Agent的定义（无自主决策、无工具选择、无闭环反馈）

**跨领域可借鉴的多Agent范式：**
- **AutoGen / CrewAI / MetaGPT：** 通用多Agent框架，提供角色定义+消息传递+任务分配基础设施
- **GenMAC：** 设计→生成→重设计的迭代多Agent框架，四个MLLM Agent（verification/suggestion/correction/output）分工
- **多Agent辩论（Du et al., 2023）：** LLM间辩论提升推理质量的范式，可直接映射到时尚设计的"风格辩论"场景
- 这些框架的Agent角色设计与StyleTailor的三级反馈闭环在结构上高度相似——但都尚未被应用到时尚图像生成领域

---

## 5. 技术路线演进时间线

```
2019–2022                    2023–2024                          2025–2026
检索式时代                   生成式突破                         多智能体融合
══════════                  ══════════                         ════════════
                                                                
知识图谱+协同过滤           扩散模型生成服装图像               多Agent闭环迭代
                                                               
  KERN ──────────────→ TOG ──→ DiFashion ──→ FashionDPO ──→ StyleTailor
  (ICMR 2020)    (IP&M 2023)  (SIGIR 2024)  (SIGIR 2025)  (AAAI 2026)
  趋势预测       套装生成      生成式推荐     DPO对齐        多Agent闭环

  GPT-FAR ─────────────────────→ GenWardrobe ──→ DualFashion
  (WWW 2024)                    (MM 2025)       (SIGIR 2026)
  LLM趋势分析                   全生成衣橱      双模态扩散

  StableVITON ──→ ITA-MDT ──→ Fashion-VDM ──→ DPIDM ──→ CatV2TON
  (CVPR 2024)    (CVPR 2025)  (SIGA 2024)    (CVPR 2025) (2025)
  语义对应VTO    MDT DiT VTO  视频VTO奠基    时序一致性   统一架构

  ChatFashion ─────────────────→ AiFashion ──→ ???
  (AEI 2025)                    (ICaMaL 2024)
  人机多方协作                  业务Agent分工

  FashSketch ──→ VogFashion
  (MM 2025)      (SW Impacts 2026)
  设计草图Agent  生产化四场景

技术范式演进:
  ┌──────────────┬──────────────────┬─────────────────────┬──────────────────┐
  │ 检索式推荐    │ 生成式(Diffusion) │ LLM/多模态驱动       │ 多Agent协作       │
  │              │                  │                     │                  │
  │ 从DB中搭配    │ 从零创造服装图像   │ LLM理解+RAG+生成    │ 角色分工+闭环反馈  │
  │ 兼容性评分    │ 三条件扩散        │ 知识增强提示         │ 三级负反馈        │
  │ 协同过滤      │ 偏好对齐DPO      │ 多模态分析           │ 人机群聊协作      │
  └──────────────┴──────────────────┴─────────────────────┴──────────────────┘
  2023前主流     2024突破           2024-2025快速发展      2025-2026前沿
```

---

## 6. 多智能体生图生成用于数字时尚：研究空白与创新切入点

### 6.1 多智能体图像生成在时尚领域的现状诊断

#### 6.1.1 已有工作 vs. 真正缺失的能力

当前时尚领域已出现多Agent系统的雏形，但距离真正的"多智能体协作生图"仍有本质差距：

| 维度 | 已有最佳水平 | 仍然缺失 |
|------|------------|---------|
| **Agent数量** | 2个（StyleTailor: Designer + Consultant） | 3+个异构Agent，各有不同模型骨干和工具 |
| **Agent间交互** | 固定流水线传递（GenWardrobe）；单向负反馈（StyleTailor） | Agent间辩论、协商、投票、互相修正 |
| **角色专业化** | 功能模块分工（生成/试穿/评价） | 审美维度分工（色彩/廓形/面料/风格的独立专家Agent） |
| **工具使用** | 硬编码模型选择 | Agent自主决策调用哪个扩散模型/ControlNet/编辑操作 |
| **偏好对齐** | 单层DPO（FashionDPO）；三级评分（StyleTailor） | 多Agent互评+人类反馈的多层次闭环 |
| **记忆与个性化** | 单次会话无状态 | 跨会话的用户风格记忆、偏好演化追踪 |
| **人机协作深度** | ChatFashion的群聊模式（仅设计上游） | Agent主动解释生成理由、接受人类修正并传播到其他Agent |
| **多品类协调** | DiFashion的类别条件扩散（固定品类组合） | 多个Agent分别负责不同品类，协商整体协调性 |

#### 6.1.2 当前研究全景缺口

经过对2023–2026年顶会的系统性搜索，确认以下**两个方向各自发展但存在结构性空白**：

```
  ┌──────────────────────────────┐     ┌──────────────────────────────┐
  │ ✅ 多Agent时尚设计（已有）     │     │ ❌ 真正多Agent协作生图（空白） │
  │                              │     │                              │
  │ StyleTailor (2026)           │     │ • 异构Agent辩论式设计         │
  │   └─ 2 Agent + 反馈闭环      │     │ • 多审美维度专家并行评判       │
  │                              │     │ • Agent自主工具选择与调用      │
  │ ChatFashion (2025)           │     │ • 跨品类Agent协商搭配一致性    │
  │   └─ 人机群聊协作            │     │ • Agent间设计知识传递与学习    │
  │                              │     │ • 多层次人机共创（解释+修正+   │
  │ ADIC Agentic (2025)          │     │   传播）                      │
  │   └─ 单Agent五步闭环         │     │                              │
  │                              │     │                              │
  │ GenWardrobe (2025)           │     │ 通用多Agent框架（可借鉴）：     │
  │   └─ 流水线多模块（非Agent）  │     │ • AutoGen / CrewAI / MetaGPT  │
  │                              │     │ • GenMAC的生成-批评迭代       │
  └──────────────────────────────┘     └──────────────────────────────┘
                    ↑                             ↑
              已发表工作                    此处为核心研究空白
                                   "多智能体协作生图用于数字时尚"
```

**关键判断：** 现有系统要么是多模块流水线（GenWardrobe、GPT-FAR），要么是极简Agent分工（StyleTailor的2-Agent），要么是单Agent闭环（ADIC）。没有任何工作实现了≥3个异构Agent围绕时尚图像生成的真正协作——包括辩论、协商、分工、互相批评。

### 6.2 具体创新切入点（全部聚焦图像生成）

#### 切入点1：异构多Agent协同服装设计系统 ★★★★★ (最推荐)

**核心思路：** 构建3+个异构Agent（不同LLM骨干 + 不同工具权限 + 不同审美专长），围绕同一服装设计任务进行"提案→辩论→融合→生成→互评→迭代"的闭环协作。

**Agent角色设计：**

```
🎨 Creative Director Agent (强LLM, 如Gemini/GPT-4)
  ├─ 解析用户需求 → 提取设计约束（场合/风格/体型/预算/季节）
  ├─ 制定设计策略 → 分解为子任务分派给专业Agent
  └─ 综合各Agent输出 → 形成最终设计决策

👔 Garment Specialist Agent (Diffusion + ControlNet工具权限)
  ├─ 接收品类任务（上装/下装/外套/连衣裙等）
  ├─ 自主选择生成策略（文生图/图生图/ControlNet条件生图）
  └─ 输出候选服装图像 + 设计理由说明

🎨 Color & Pattern Agent (调色板API + 图案生成工具权限)
  ├─ 独立评判配色方案（色相/饱和度/明度协调性）
  ├─ 提出图案/印花建议（条纹/格纹/花卉/几何/纯色）
  └─ 与其他Agent辩论配色合理性

📐 Silhouette & Proportion Agent (VLM + 时尚规则知识库)
  ├─ 评估廓形协调性（如A字裙+修身西装 vs. 宽松裙+宽松上衣）
  ├─ 检查比例规则（如高腰/低腰对不同身高的适配）
  └─ 输出廓形修正建议

🔍 Critic Agent (VLM, 可复用FashionDPO的三专家思路)
  ├─ 质量维度：图像清晰度/服装细节/生成伪影
  ├─ 兼容性维度：多件服装间的风格/颜色/廓形协调度
  └─ 个性化维度：与用户历史偏好的匹配程度
  │
  ▼
辩论记录 → Creative Director综合裁决 → 触发专业Agent重新生成
  │
  ▼
输出: 经多Agent辩论验证的协调服装搭配 + 可解释的设计理由
```

**与StyleTailor的关键区别：**
- StyleTailor：2 Agent线性传递 + 单向负反馈
- 本方案：5 Agent网状协作 + 双向辩论 + 可解释输出

**为什么现在可行：**
- 各Agent的技术基础均已成熟：服装生成（DiFashion/DualFashion/Stable Diffusion 3.5）、色彩评估（可量化为规则+CLIP评分）、廓形判断（VLM + 时尚知识库）
- 多Agent框架（AutoGen/CrewAI）已提供Agent间消息传递的基础设施
- FashionDPO验证了三专家并行评分的可行性，可直接扩展为多Agent并行评判
- GenWardrobe验证了RAG时尚知识库在同领域的有效性

**预期贡献：**
1. 首个≥3异构Agent的时尚生图系统
2. Agent间辩论机制用于设计决策（区别于单向feedback）
3. 可解释的生成过程（每个Agent输出设计理由）
4. 天然的消融实验设计（逐一移除Agent测量影响）

---

#### 切入点2：多Agent套装协调生成——跨品类协商一致性 ★★★★

**核心思路：** 不同Agent负责不同服装品类（上衣Agent/下装Agent/外套Agent/鞋履Agent/配饰Agent），在生成过程中互相传递"搭配约束信号"，确保整体协调。

**技术机制：**
```
上衣Agent (SD 3.5 + 上衣ControlNet)
  │  生成候选上衣 → 提取特征嵌入
  │  ── 传递: 颜色向量 + 风格标签 + 廓形编码 ──→ 下装Agent
  │                                             │
  │  接收: 下装特征 ←────────────────────────── 受上衣条件约束
  │        鞋履特征 ←────────────────────────── 生成下装
  │                                             │
  ▼                                             ▼
       所有Agent共享一个"搭配记忆" (Shared Compatibility Memory)
       存储已生成品类的特征嵌入，新Agent读取并约束自己的生成
```

**与DiFashion的关键区别：**
- DiFashion：单扩散模型同时生成多品类，隐式学习兼容性
- 本方案：多Agent显式协商，每个Agent自主但受他者约束，兼容性可解释

**技术挑战与解法：**
- **挑战：** 品类间颜色/风格约束的数学表示
- **解法：** CLIP嵌入 + 可微分兼容性评分（参考DiFashion的Mutual Encoder）
- **挑战：** Agent生成顺序对结果的影响
- **解法：** 迭代式并行生成（每轮所有Agent生成候选 → 互评 → 选择最协调的组合 → 不满意则重生成）

---

#### 切入点3：多Agent闭环偏好精炼——从FashionDPO到Agentic DPO ★★★★

**核心思路：** 将FashionDPO的"三专家静态评分 → 一次性DPO微调"扩展为"多Agent动态互评 → 在线迭代精炼"。

**技术路线：**
```
FashionDPO (2025):  多专家模型评分 → 构造偏好对 → DPO微调 → 一次性完成
                         ↓ 扩展
Agentic DPO (新):   多个Critic Agent实时评判 → 在线构造负反馈
                         ↓
                   Designer Agent接收反馈 → 即时重生成
                         ↓
                   新的Critic评判 → ... → 闭环直至收敛
                         ↓
                   所有交互记录 → 周期性DPO微调模型
```

**与StyleTailor的关键区别：**
- StyleTailor：三级负反馈只判断"好不好"，不区分"哪方面不好"
- 本方案：多Critic Agent各司审美维度，提供可操作的改进方向

**关键创新：** 将RLHF/DPO的"离线偏好学习"与Agent的"在线闭环迭代"统一为一个框架。

---

#### 切入点4：人机共创多Agent——设计师在回路中 ★★★★

**核心思路：** 将ChatFashion的群聊范式从"多人+多AI"扩展到"单人设计师 + 多AI Agent"，设计师可以随时介入任何Agent的决策。

**交互模式：**
```
设计师 ── 自然语言指令 ──→ Creative Director Agent
                              │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
          Garment Agent  Color Agent   Silhouette Agent
               │              │              │
               └──────────────┼──────────────┘
                              │
              设计师 ←── 可视化提案 + 设计理由 + 备选方案
               │
               ├─ "这个颜色太暗了" → Color Agent 重新提案
               ├─ "保留廓形但换面料" → Silhouette Agent 仅修改面料
               └─ "整体不错，微调袖长" → Garment Agent 局部修复(inpainting)
```

**与VogFashion的"元认知调控"的关键区别：**
- VogFashion：设计师控制AI输出程度的单一维度调控
- 本方案：设计师可针对具体审美维度（色彩/廓形/面料/图案）定向干预，且修正会自动传播到其他Agent

---

#### 切入点5：可解释的时尚Agent——生成过程透明化 ★★★

**核心思路：** 让每个Agent不仅输出图像，还输出"设计理由"（自然语言解释），最终用户看到的不只是搭配结果，还有完整的"设计思维链"。

**输出示例：**
```
🎨 Color Agent:  "建议以驼色为主色调，搭配象牙白内搭——
                  因为用户肤色偏暖调，且场合是商务会议，
                  高对比度配色（如黑+白）会过于严肃。"
                  [引用: Pantone 16-1331 TCX + 11-0601 TCX]

📐 Silhouette Agent: "建议九分烟管裤而非阔腿裤——
                      因为用户身高158cm，阔腿裤会切割视觉比例。
                      高腰设计可延长腿部线条。"
                      [引用: 小个子穿搭比例规则 #47]

👔 Garment Agent: [生成的服装图像]
                   "驼色羊毛混纺单排扣西装 + 象牙白真丝衬衫 +
                    深棕九分烟管裤 + 尖头裸色低跟鞋"
```

**技术基础：** DualFashion (SIGIR 2026) 已经开始同时生成图像和文本描述，本方向可在此基础上增加多Agent辩论的思维链。

---

### 6.3 推荐技术选型参考（聚焦图像生成）

| 组件 | 推荐方案 | 替代方案 | 理由 |
|------|---------|---------|------|
| 多Agent协调 | LLM (Gemini/GPT-4) + 结构化消息协议 | AutoGen / CrewAI框架 | GenWardrobe同款LLM，灵活可控 |
| 服装图像生成 | Stable Diffusion 3.5 + ControlNet + IP-Adapter | DiT-based (DualFashion) | GenWardrobe验证，生态最成熟 |
| 虚拟试穿 | GPT-Image-1 (API) | StableVITON / ITA-MDT (自部署) | GenWardrobe同方案；API调用简单 |
| 视觉评判Agent | GPT-4V / Gemini Vision | MiniCPM (轻量) | 需要视觉理解+自然语言反馈 |
| 时尚知识检索 | Llama-Index RAG (60万条目) | 自建知识图谱 + 向量检索 | GenWardrobe已验证，可直接复用 |
| 兼容性评分 | VBPR + ResNet-50 (FashionDPO方案) | CLIP零样本评分 | FashionDPO验证有效 |
| 偏好对齐 | 在线负反馈（StyleTailor方案）+ 周期性DPO | RLHF | 无需训练奖励模型 |
| 评价指标 | 双盲人类评估 + FID/KID + 兼容性准确率 | 仅自动指标 | 时尚主观性强，需人类评估 |

### 6.4 与GenWardrobe和FashSketch的技术路线对比

| 维度 | GenWardrobe (2025) | FashSketch (2025) | 本方案（多Agent生图） |
|------|-------------------|-------------------|---------------------|
| **Agent数量** | 0（流水线模块） | 0（流水线模块） | 3–5个异构Agent |
| **协调机制** | 固定顺序传递 | 固定顺序传递 | 辩论+协商+投票 |
| **闭环反馈** | ✗ 单向 | ✗ 单向 | ✓ 多Agent互评闭环 |
| **可解释性** | ✗ 黑盒输出 | △ LLM建议有文字 | ✓ 每个Agent输出设计理由 |
| **人机协作** | ✗ 全自动 | ✓ 图层式交互 | ✓ 多层次定向干预 |
| **偏好学习** | ✗ | ✗ | ✓ 在线负反馈+周期性DPO |
| **任务范围** | 旅行穿搭衣橱 | 设计草图创作 | 通用穿搭生图（可扩展） |

### 6.5 风险与注意事项

1. **Agent协调开销：** 多Agent辩论增加推理成本。建议设最大辩论轮次（参考StyleTailor的收敛条件），对简单场景走快速通道（如用户满意度高时跳过后续辩论轮次）。
2. **评价困难：** 多Agent系统的贡献归因困难。必须设计严格的消融实验（逐一移除Agent + 测量人类偏好变化），否则无法证明多Agent优于单Agent。
3. **Agent同质化风险：** 如果多个Agent都使用同一LLM骨干，它们的"辩论"可能只是同一模型的自我对话。需要从三个维度确保异质性：(a)不同的系统提示词（审美立场差异），(b)不同的工具/知识库访问权限，(c)可选的不同LLM骨干（如Gemini vs. GPT-4）。
4. **用户疲劳：** 过多Agent对用户展示过多中间输出可能导致疲劳。需要设计"默认自动模式 + 可选展开细节"的渐进式信息披露UI。
5. **生成多样性下降：** Agent互评可能导致过度保守（为追求"安全"而牺牲创意）。需要显式设计"创意激励"机制——当所有Critic Agent评分过高时，触发更大的生成随机性。

---

### 附：更远期的视频方向机会（简要）

如果未来从静态图像扩展到视频域，以下三个方向值得关注：
- **多Agent视频VTON导演系统：** 将本节的Agent分工从单帧扩展到多帧，增加Temporal Critic Agent评估帧间一致性
- **偏好对齐驱动的视频穿搭编辑：** StyleTailor三级负反馈的时序扩展
- **参考框架：** StoryAgent/MovieAgent的导演-场记-摄影-剪辑多Agent范式可直接适配

但这些属于远期方向。当前阶段，以上5个图像生成切入点与GenWardrobe/FashSketch的技术基础更连续，工程可行性更高。

---

## 7. 开源资源汇总

| 项目 | 链接 | 许可 | 领域 |
|------|------|------|------|
| **DiFashion** | github.com/YiyanXu/DiFashion | — | 生成式服装推荐 |
| **GenWardrobe** | github.com/ShanFengShanFeng/GenWardrobe | — | 生成式衣橱 |
| **FashionDPO** | github.com/Mingzhe-Yu/FashionDPO | — | DPO时尚对齐 |
| **FashionReGen** | github.com/CompFashion/FashionReGen | — | LLM时尚报告 |
| **StableVITON** | github.com/rlawjdghek/StableVITON | CC BY-NC-SA 4.0 | 语义对应VTO |
| **ITA-MDT** | github.com/jiwoohong93/ita-mdt_code | CC BY-NC-SA 4.0 | MDT DiT VTO |
| **Cool-GenAI-Fashion-Papers** | github.com/wendashi/Cool-GenAI-Fashion-Papers | — | 论文收集(470+) |

---

## 8. 参考文献

1. Islam et al. "Deep Learning in Virtual Try-On: A Comprehensive Survey." *IEEE Access*, Vol. 12, pp. 29475–29502, 2024. [🔗](https://bura.brunel.ac.uk/handle/2438/28857)
2. Ding, Ma et al. "GPT-FAR: Fashion Analyzing and Reporting." *WWW '24 Companion*, 2024. DOI: [10.1145/3589335.3651232](https://dl.acm.org/doi/10.1145/3589335.3651232) | [arXiv:2403.06660](https://arxiv.org/abs/2403.06660)
3. Yu, Ma et al. "StyleTailor: A Collaborative Agent Framework for Personalized Fashion Design, Recommendation, and Virtual Try-On." *AAAI 2026*. DOI: [10.1609/aaai.v40i35.40202](https://ojs.aaai.org/index.php/AAAI/article/view/40202) | arXiv:2508.06555
4. Harish et al. "ChatFashion: A Group-Chat Based Collaborative Framework for Garment Design." *Advanced Engineering Informatics*, Vol. 65, 2025. DOI: [10.1016/j.aei.2025.103366](https://www.sciencedirect.com/science/article/abs/pii/S1474034625002599)
5. "VogFashion: Qwen-Powered AI Fashion Design System." *Software Impacts*, Vol. 34, 2026. DOI: [10.1016/j.simpa.2026.102661](https://www.sciencedirect.com/science/article/pii/S2352711026001548)
6. Jin, Wen, Yu, Ma* et al. "GenWardrobe: A Fully Generative Wardrobe System for Travel Fashion." *ACM MM 2025*, pp. 13540–13542. DOI: [10.1145/3746027.3754483](https://acmdl.org/doi/10.1145/3746027.3754483)
7. Shang, Yao, Zhou. "Knowledge-Augmented Agentic Systems for Traditional Costume Pattern Design." *ADIC 2025*, pp. 106–114. [🔗](https://www.designsociety.org/publication/48738/)
8. Yu, Ma et al. "FashionDPO: Fine-tuning Fashion Outfit Generation Model Using Direct Preference Optimization." *SIGIR 2025*. [arXiv:2504.12900](https://arxiv.org/abs/2504.12900)
9. Xu, Wang, Feng, Ma et al. "DiFashion: Towards Personalized Outfit Generation and Recommendation." *SIGIR 2024*, pp. 1350–1359. DOI: [10.1145/3626772.3657719](https://dl.acm.org/doi/10.1145/3626772.3657719)
10. Nguyen-Truc et al. "FashSketch: Advancing Fashion Design Through an Intelligent Sketchpad Studio." *ACM MM 2025*, pp. 13534–13536. DOI: [10.1145/3746027.3754481](https://dl.acm.org/doi/10.1145/3746027.3754481)
11. Yu, Wu, Sun, Ma. "DualFashion: Dual-Diffusional Generative Fashion Recommendation." *SIGIR 2026*. [arXiv:2605.17357](https://arxiv.org/abs/2605.17357)
12. Hong et al. "ITA-MDT: Image-Timestep-Adaptive Masked Diffusion Transformer for Virtual Try-On." *CVPR 2025*, pp. 28284–28294. [arXiv:2503.20418](https://arxiv.org/abs/2503.20418)
13. Kim et al. "StableVITON: Learning Semantic Correspondence with Latent Diffusion Model for Virtual Try-On." *CVPR 2024*, pp. 8176–8185. [arXiv:2312.01725](https://arxiv.org/abs/2312.01725)
14. Li et al. "Pursuing Temporal-Consistent Video Virtual Try-On via Dynamic Pose Interaction." *CVPR 2025*, pp. 22648–22657. (DPIDM)
15. "Fashion-VDM: Video Diffusion Model for Virtual Try-On." *SIGGRAPH Asia 2024*. [arXiv:2411.00225](https://arxiv.org/abs/2411.00225)
16. Shi, Wong, Zou. "Generative AI in Fashion: Overview." *ACM TIST*, 2025. DOI: [10.1145/3718098](https://dl.acm.org/doi/full/10.1145/3718098) — **470+论文综述，2025年必读**
17. CatV2TON. [arXiv:2501.11325](https://arxiv.org/abs/2501.11325)
18. ChronoTailor. [arXiv:2506.05858](https://arxiv.org/abs/2506.05858)
19. DreamVVT. [arXiv:2508.02807](https://arxiv.org/abs/2508.02807)
20. StoryAgent. [arXiv:2411.04925](https://arxiv.org/abs/2411.04925)
21. MovieAgent. [arXiv:2503.07314](https://arxiv.org/abs/2503.07314)
22. GenMAC. [arXiv:2412.04440](https://arxiv.org/abs/2412.04440)

---

> **报告生成方法：** 本报告基于 deep-research workflow 完成 — 5角度并行搜索 → 23源筛选 → 95条claim提取 → 3-vote对抗验证 → 18条确认/7条剔除 → 合成。所有高置信度发现均经过至少2/3投票验证通过。附加4个专项Agent补充了研究者谱系、视频VTON、FashSketch和VTON架构细节。

> **局限性说明：** (1) GenWardrobe和FashSketch均为3页Demo论文，方法深度有限；(2) Islam et al. (2024) VTO综述已2年，视频VTO架构可能已有新进展；(3) StyleTailor (2026.03) 是最新论文，尚无独立复现或批评性跟进；(4) "生成式vs检索式"的二分在实践中有夸大——多数"生成式"系统仍包含检索组件；(5) 未覆盖3D服装生成/神经渲染工作；(6) 中文时尚AI研究（京东、阿里达摩院等）可能未被英文检索充分覆盖。
