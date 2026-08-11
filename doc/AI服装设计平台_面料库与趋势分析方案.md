# AI服装设计平台 - 面料库与趋势分析新阶段方案

## 📋 方案概述

**版本**: v2.0  
**日期**: 2026-08-02  
**状态**: 设计阶段  
**基于**: 已完成的MVP基础功能（白板、生成闭环、迭代优化）

---

## 🎯 一、战略定位与产品构想

### 1.1 核心构想

在已验证的AI生成闭环基础上，构建两大差异化壁垒：

#### **面料库 - 材质驱动设计**
**构想**: 把设计师抽屉里的面料小样变成结构化、可检索、可回流生成的数字资产。

**魔法时刻**: 
```
拖一块丝绸面料到白板 
→ 说"做件立领衬衫" 
→ 生成的衬衫能看出丝绸的光泽和垂感
```

**为什么这是壁垒**:
- ✅ **专业度**: 真实服装设计从面料开始，而非凭空想象
- ✅ **切换成本**: 用户上传的私有面料库锁定用户
- ✅ **通用工具做不了**: Midjourney/DALL-E不理解"120g府绸"与"180g牛津纺"的区别
- ✅ **数据飞轮**: 用户上传越多，库越有价值，护城河越深

#### **时尚趋势分析 - 可溯源的灵感引擎**
**构想**: AI帮你快速读懂近期趋势，并给出每个平台的原始链接让你自己核实。

**魔法时刻**:
```
打开趋势页 
→ 看到"2026春夏多巴胺配色回潮"的AI摘要 + Vogue原文链接
→ 点"存入白板" → 色卡和关键词自动进入工作台
→ 结合面料生成新设计
```

**为什么这样设计**:
- ✅ **诚实第一**: AI摘要不完美，原文链接是兜底 → 化解信任顾虑
- ✅ **效率提升**: 不用每天刷10个网站，AI帮你提炼关键信息
- ✅ **闭环回流**: 趋势不是死内容，能直接变成白板约束参与生成
- ✅ **合规安全**: 只存摘要+链接，不镜像全文 → 零版权风险

### 1.2 与现有MVP的关系

**已完成基础**:
- ✅ 白板工作台（元素语义化、角色标注）
- ✅ AI生成闭环（圈选→生成→采纳→迭代）
- ✅ 局部重绘与变体
- ✅ 设计资产血缘管理

**新阶段目标**:
- 🎯 让生成不再"凭空想象"，而是**基于真实材质**
- 🎯 让设计不再"灵感枯竭"，而是**有可溯源的方向输入**

---

## 🧵 二、面料库详细设计

### 2.1 产品定位

**一句话**: 结构化的数字面料资产库，让材质成为设计的第一约束。

**核心价值主张**:
1. **预置骨架**: 平台提供50-100种常见面料（棉/丝/毛/化纤/牛仔/针织...）
2. **用户上传**: 设计师拍摄自有面料小样，形成私有库
3. **结构化属性**: 不只是图片，还有成分/克重/垂坠度/弹性等可检索字段
4. **回流生成**: 拖入白板 → 材质信息注入AI prompt → 生成结果可辨识材质

### 2.2 数据模型

**Fabric 表结构**:
```prisma
model Fabric {
  id              String   @id @default(cuid())
  scope           String   // "preset"(预置) | "user"(用户上传)
  ownerId         String?  // 用户上传时必填
  
  // 基本信息
  name            String   // "60支府绸纯棉布"
  category        String   // 大类：cotton/silk/wool/synthetic/blend
  subCategory     String?  // 子类：poplin/satin/chiffon/denim/jersey...
  
  // 媒体文件
  mainFileId      String   // 主图（平铺纹理）
  hangingFileId   String?  // 垂坠图（P1阶段）
  closeupFileId   String?  // 微距图（P1阶段）
  
  // 结构化属性（JSONB）
  attributes      Json     // 见下方详细说明
  
  // AI生成标签（供编译器消费）
  aiTags          Json?    // VLM提取的材质关键词
  
  // 元数据
  source          String?  // "ai_generated" | "photographed" | "user_upload"
  license         String?  // "cc0" | "proprietary"
  status          String   @default("active")
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([scope, category])
  @@index([ownerId])
}
```

**attributes 字段详细结构**:
```json
{
  "composition": {"cotton": 60, "polyester": 40},  // 成分占比
  "weave": "plain",              // plain/twill/satin/knit
  "weight": 180,                 // GSM（克/平方米）
  "drape": "moderate",           // stiff/moderate/fluid
  "stretch": "slight",           // none/slight/high
  "opacity": "opaque",           // opaque/semi/sheer
  "sheen": "matte",              // matte/subtle/glossy
  "texture": "smooth",           // smooth/textured/fuzzy
  "width": 150,                  // 门幅（cm）
  "seasonSuggestion": ["spring", "summer"],
  "useCases": ["shirt", "dress", "outerwear"]
}
```

### 2.3 内容来源策略

#### **路径1: AI生成无缝贴图（冷启动主力）**
- **目的**: 快速铺满骨架，覆盖常见材质
- **方法**: 用文生图模型（Flux/SDXL）批量生成无缝贴图
- **覆盖品类**: 
  - 棉: 府绸/牛津纺/帆布/牛仔
  - 丝: 缎面/雪纺/双绉
  - 毛: 呢料/针织/法兰绒
  - 化纤: 涤纶/尼龙/氨纶混纺
- **优势**: 零版权风险、成本低、可控
- **劣势**: 需人工挑选质量，真实感略逊

**生成Prompt模板**:
```
seamless fabric texture, {fabric_type}, high resolution, 
photorealistic, even lighting, no wrinkles, tileable pattern,
{specific_attributes}

示例:
seamless fabric texture, cotton poplin, high resolution,
photorealistic, matte finish, plain weave, smooth surface
```

#### **路径2: 自拍/授权素材（提升真实感）**
- **目的**: 关键品类用真实照片提升可信度
- **方法**: 
  - 采购面料小样（淘宝/1688批发市场）
  - 标准化拍摄（平铺/自然光/相机固定）
  - 或购买CC0可商用纹理素材库
- **优先级**: 高频使用的10-20种核心面料
- **成本**: 约¥2000-5000（小样+拍摄设备）

#### **路径3: 用户上传（增长引擎）**
- **目的**: 形成私有面料库 = 高切换成本
- **流程**: 见2.4节"用户上传功能"
- **护城河逻辑**: 
  - 用户A上传50块面料 → 迁移成本巨大
  - 面料库越丰富 → 生成质量越高 → 越依赖平台

**⚠️ 明确禁止**: 不爬取无授权网页面料图入库（版权风险）

### 2.4 核心功能设计

#### **功能1: 面料浏览与检索**

**布局**: 
- 瀑布流/网格视图（可切换）
- 左侧筛选栏 + 顶部搜索框

**筛选维度**:
- 品类: 棉/丝/毛/化纤/混纺
- 成分: 纯棉/含弹/混纺
- 克重区间: <100g / 100-200g / >200g
- 季节: 春夏/秋冬
- 垂坠度: 挺括/适中/飘逸
- 色系: 暖色/冷色/中性（P1）

**搜索逻辑**:
```typescript
// 关键词匹配 name + attributes
WHERE name LIKE '%府绸%' 
   OR attributes->>'weave' = 'plain'
   OR attributes->'useCases' ? 'shirt'
```

**收藏夹**（P1）:
- 常用面料星标
- 跨项目快速复用

#### **功能2: 用户上传流程（MVP版）**

**交互流程**:
```
1. 点击"上传面料" 
   → 拖入照片/点选文件 
   → 上传到对象存储（R2/S3）

2. 填写表单:
   [基本信息]
   - 面料名称*: ___________
   - 大类*: [下拉] 棉/丝/毛/化纤/混纺
   - 子类: [下拉/可输入] 府绸/缎面/牛仔...
   
   [成分配比]
   - 棉: ___% 
   - 涤纶: ___%
   - 其他: ___  (可添加多项)
   
   [物理属性] (下拉枚举)
   - 克重: [< 100g / 100-150g / 150-200g / > 200g]
   - 垂坠度: [挺括 / 适中 / 飘逸]
   - 弹性: [无弹 / 微弹 / 高弹]
   - 透明度: [不透 / 半透 / 透明]
   - 光泽: [哑光 / 微光 / 高光]
   - 质感: [光滑 / 纹理 / 绒面]
   
   [使用建议] (多选)
   - 适用季节: □春夏 □秋冬
   - 适用品类: □衬衫 □连衣裙 □外套 □裤装

3. [P1功能] AI自动识别 
   → VLM分析照片 → 预填属性草案 → 人工确认

4. 保存 
   → scope="user"
   → ownerId=当前用户
   → 仅本人可见
```

**表单验证**:
- 必填: 名称、大类、主图
- 成分占比总和 = 100%
- 克重/垂坠度等至少填一项

**隐私设计**:
- 用户上传的面料默认private
- 后续P2可支持"分享到公共库"（需审核）

#### **功能3: 回流生成（关键通路）**

**白板内操作**:
```
1. 白板左侧工具栏 → 点击"面料"图标
   → 弹出面料抽屉（右侧滑入）

2. 面料抽屉内:
   - 快速筛选: 我的面料 / 预置面料
   - 搜索框 + 品类标签
   - 瀑布流展示

3. 拖拽面料卡片到白板画布
   → 生成一个fabric类型元素
   → 自动标注role=["fabric_ref"]
   → 显示面料名称 + 缩略图

4. 圈选面料元素 + 其他约束 
   → 点"生成"按钮
   → 编译器提取面料属性注入prompt
   → 调用生图模型
```

**编译器处理逻辑**:
```typescript
// apps/api/src/modules/generation/compiler/fabric.channel.ts

export class FabricChannel implements CompilerChannel {
  async compile(elements: BoardElement[]): Promise<CompileResult> {
    const fabricElements = elements.filter(e => 
      e.type === "fabric" || e.role?.includes("fabric_ref")
    );
    
    if (fabricElements.length === 0) {
      return {prompt: "", refImages: []};
    }
    
    const fabricPrompts: string[] = [];
    const fabricRefs: RefImage[] = [];
    
    for (const el of fabricElements) {
      const fabric = await this.db.fabric.findUnique({
        where: {id: el.content.fabricId},
        include: {mainFile: true}
      });
      
      if (!fabric) continue;
      
      const attr = fabric.attributes as FabricAttributes;
      
      // 提取材质关键词
      const composition = Object.entries(attr.composition)
        .map(([fiber, pct]) => `${fiber} ${pct}%`)
        .join(", ");
      
      fabricPrompts.push(
        `fabric material: ${composition}`,
        `weave type: ${attr.weave}`,
        `fabric texture: ${attr.texture}`,
        `drape: ${attr.drape}`,
        `sheen: ${attr.sheen}`
      );
      
      // 纹理参考图
      fabricRefs.push({
        url: fabric.mainFile.url,
        role: "fabric_texture",
        weight: el.weight || 0.7  // 材质权重
      });
    }
    
    return {
      prompt: fabricPrompts.join(", "),
      refImages: fabricRefs
    };
  }
}
```

**生成结果验证**:
- **成功标准**: 人眼能看出棉/丝/牛仔/呢料的明显区别
- **降级方案**: 如模型不支持材质精细控制 → 降级为"材质参考"（文案调整）

### 2.5 MVP最薄边界

✅ **MVP必做**:
- 预置骨架50-100种常见面料
- 用户上传 + 手动填写属性表单
- 按品类/成分/克重筛选
- 拖入白板作fabric_ref元素
- 材质关键词注入编译器
- **魔法时刻验收**: 拖面料→生成→材质可辨识

❌ **MVP不做（P1/P2）**:
- AI自动打标（上传时VLM识别属性）
- 三视图+垂坠视频（只要平铺图）
- 面料采购/供应链对接
- 以图搜相似面料
- 分享到公共库
- 面料市场/交易

### 2.6 验收标准

| 标准 | 验收方式 |
|------|---------|
| ✅ 能浏览预置面料库（≥50种） | 打开面料页，数量达标，覆盖5大品类 |
| ✅ 能按品类/成分筛选 | 选择"纯棉" → 只显示100%棉的面料 |
| ✅ 能上传自有面料并填属性 | 上传照片 + 填表 → 保存成功 → 面料列表出现 |
| ✅ 拖面料到白板成为fabric_ref元素 | 拖入后显示面料卡片，role包含fabric_ref |
| ✅ **魔法时刻**: 材质可辨识 | 拖丝绸+说"做件衬衫" → 生成的衬衫有丝绸光泽 <br> 拖牛仔+说"做条裤子" → 生成的裤子是牛仔质感 |
| ✅ 用户A上传的面料，用户B不可见 | 不同账号登录 → 看不到对方的用户面料 |

---

## 📊 三、时尚趋势分析详细设计

### 3.1 产品定位

**一句话**: AI帮你快速读懂近期趋势，并给出每个平台的原始链接让你自己核实。

**核心原则（回应"AI总结不可信"顾虑）**:
- ✅ **AI摘要 + 平台原始链接并排呈现**
- ✅ **摘要显著标注"AI整理，建议结合原文判断"**
- ✅ **用户永远能点链接跳转源头**

**明确不做**:
- ❌ 不镜像/转载平台完整内容（只摘要+缩略图+链接）
- ❌ 不做实时爬取（定期批量即可）
- ❌ 不做个性化推荐（MVP统一内容）

### 3.2 数据模型

**TrendItem 表结构**:
```prisma
model TrendItem {
  id            String   @id @default(cuid())
  
  // 基本信息
  title         String   // "2026春夏多巴胺配色回潮"
  summary       String   @db.Text  // AI生成的2-3句摘要
  
  // 原始来源（可信兜底）
  platform      String   // "vogue" | "wwd" | "pinterest" | "fashionunited"
  sourceUrl     String   // 原文链接
  publishedAt   DateTime // 来源发布时间
  
  // 视觉与分类
  coverFileId   String?  // 代表图（缩略，注明出处）
  category      String   // "women" | "men" | "accessories"
  tags          String[] // ["color", "silhouette", "fabric", "print"]
  
  // 结构化提取（供存入白板用）
  extracted     Json?    // 见下方详细说明
  
  // 元数据
  curatedAt     DateTime @default(now()) // 入库时间
  status        String   @default("published")
  
  @@index([publishedAt])
  @@index([category])
  @@index([platform])
}

model TrendDigest {
  id            String   @id @default(cuid())
  period        String   // "2026-W31"（ISO周）
  theme         String   // "春夏关键词：轻盈、透明、未来感"
  itemIds       String[] // 关联的TrendItem id
  overview      String   @db.Text // AI生成的本周综述
  createdAt     DateTime @default(now())
  
  @@index([period])
}
```

**extracted 字段详细结构**:
```json
{
  "keyColors": ["#FF6B9D", "#FDB462", "#8DD3C7"],  // 提取的主色
  "silhouettes": ["oversized", "A-line", "cocoon"],  // 廓形关键词
  "keywords": ["dopamine dressing", "bold color", "optimism"],  // 趋势关键词
  "fabricMentions": ["silk", "chiffon", "sheer"]  // 提到的面料
}
```

### 3.3 内容生产流程（定期任务）

**执行频率**: 每周一次（cron: `0 2 * * MON`，周一凌晨2点）

**技术实现**:
```typescript
// apps/worker/src/processors/trend.digest.processor.ts

@Processor('trend-digest')
export class TrendDigestProcessor {
  
  @Process('weekly-digest')
  async processTrendDigest(job: Job) {
    const logger = job.log.bind(job);
    
    // 1. 联网搜索近期时尚趋势
    const searchQueries = [
      "fashion trends 2026 spring summer",
      "runway trends 2026",
      "color trends fashion 2026",
      "sustainable fashion trends"
    ];
    
    const allResults = [];
    
    for (const query of searchQueries) {
      const results = await this.webSearchService.search({
        query,
        timeRange: "last_week",
        sources: [
          "vogue.com",
          "wwd.com", 
          "pinterest.com/trends",
          "fashionunited.com"
        ],
        limit: 10
      });
      
      allResults.push(...results);
    }
    
    logger(`Found ${allResults.length} trend articles`);
    
    // 2. 对每条结果调LLM结构化摘要
    for (const result of allResults) {
      try {
        const summary = await this.llmService.generate({
          model: "claude-sonnet-4",
          prompt: `总结以下时尚趋势文章的核心要点（2-3句话，中文）：

标题：${result.title}
摘要：${result.snippet}

输出JSON格式：
{
  "summary": "2-3句中文摘要",
  "keyColors": ["#HEX颜色1", "#HEX颜色2", ...],
  "silhouettes": ["廓形关键词1", "廓形关键词2", ...],
  "keywords": ["趋势关键词1", "趋势关键词2", ...],
  "fabricMentions": ["提到的面料1", "提到的面料2", ...]
}

注意：
- 颜色必须是HEX格式
- 关键词用中文
- 如果没有提到某项，返回空数组`,
          responseFormat: {type: "json_object"}
        });
        
        const parsed = JSON.parse(summary.content);
        
        // 3. 存库
        const coverFile = result.image 
          ? await this.downloadThumbnail(result.image, result.sourceUrl)
          : null;
        
        await this.db.trendItem.create({
          data: {
            title: result.title,
            summary: parsed.summary,
            platform: this.extractPlatform(result.url),
            sourceUrl: result.url,
            publishedAt: result.publishedDate || new Date(),
            extracted: {
              keyColors: parsed.keyColors || [],
              silhouettes: parsed.silhouettes || [],
              keywords: parsed.keywords || [],
              fabricMentions: parsed.fabricMentions || []
            },
            coverFileId: coverFile?.id,
            category: "women", // 或自动分类
            tags: parsed.keywords.slice(0, 5)
          }
        });
        
        logger(`Processed: ${result.title}`);
        
      } catch (error) {
        logger(`Error processing ${result.title}: ${error.message}`);
      }
    }
    
    // 4. [可选] 生成本周综述
    const thisWeek = this.getISOWeek(new Date());
    const items = await this.db.trendItem.findMany({
      where: {
        curatedAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      }
    });
    
    if (items.length > 0) {
      const overview = await this.generateWeeklyOverview(items);
      
      await this.db.trendDigest.create({
        data: {
          period: thisWeek,
          theme: overview.theme,
          itemIds: items.map(i => i.id),
          overview: overview.content
        }
      });
    }
    
    return {processed: allResults.length};
  }
  
  private extractPlatform(url: string): string {
    if (url.includes('vogue.com')) return 'vogue';
    if (url.includes('wwd.com')) return 'wwd';
    if (url.includes('pinterest.com')) return 'pinterest';
    if (url.includes('fashionunited.com')) return 'fashionunited';
    return 'other';
  }
  
  private getISOWeek(date: Date): string {
    const year = date.getFullYear();
    const week = /* ISO week calculation */;
    return `${year}-W${week.toString().padStart(2, '0')}`;
  }
}
```

**关键依赖**:
- `webSearchService`: 使用Brave Search API / Perplexity / 自建搜索
- `llmService`: Claude API 用于结构化摘要
- `downloadThumbnail`: 下载缩略图到对象存储（注明来源水印）

### 3.4 前端交互设计

#### **趋势页（独立页 /trends）**

**布局结构**:
```tsx
// apps/web/app/trends/page.tsx

export default function TrendsPage() {
  return (
    <div className="trends-page">
      {/* 顶部：本周综述 */}
      <WeeklyDigestCard digest={weeklyDigest} />
      
      {/* 筛选栏 */}
      <FilterBar>
        <CategoryFilter /> {/* 女装/男装/配饰 */}
        <TagFilter />      {/* 颜色/廓形/面料/印花 */}
        <PlatformFilter /> {/* Vogue/WWD/Pinterest */}
      </FilterBar>
      
      {/* 趋势卡片流 */}
      <TrendCardGrid items={trendItems} />
    </div>
  );
}
```

**趋势卡片组件**:
```tsx
// apps/web/components/trends/TrendCard.tsx

function TrendCard({item}: {item: TrendItem}) {
  return (
    <article className="trend-card">
      {/* 代表图 */}
      {item.coverFileId && (
        <div className="cover">
          <img src={item.coverFile.url} alt={item.title} />
          <Badge>{item.platform}</Badge>
        </div>
      )}
      
      {/* 标题 */}
      <h3 className="title">{item.title}</h3>
      
      {/* AI摘要层 */}
      <div className="summary-section">
        <WarningBanner>
          ⚠️ AI整理，建议结合原文判断
        </WarningBanner>
        <p className="summary">{item.summary}</p>
        
        {/* 提取的色卡 */}
        {item.extracted.keyColors?.length > 0 && (
          <ColorStrip colors={item.extracted.keyColors} />
        )}
        
        {/* 关键词标签 */}
        {item.extracted.keywords?.length > 0 && (
          <TagList tags={item.extracted.keywords} />
        )}
      </div>
      
      {/* 原始链接层（置顶设计） */}
      <div className="source-section">
        <a 
          href={item.sourceUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="source-link"
        >
          📄 查看原文 - {item.platform}
        </a>
        <time>{formatDate(item.publishedAt)}</time>
      </div>
      
      {/* 回流白板按钮 */}
      <ActionButton 
        onClick={() => handleSaveToBoard(item.id)}
        icon={<PlusIcon />}
      >
        存入白板
      </ActionButton>
    </article>
  );
}
```

**诚实边界设计要点**:
- ⚠️ 警告标识显眼（黄色背景）
- 📄 原文链接置于显著位置（不藏在底部）
- 来源平台清晰标注（Vogue/WWD等）
- 发布日期展示（让用户判断时效性）

#### **存入白板功能**

**API接口**:
```typescript
// apps/api/src/modules/boards/boards.controller.ts

@Post(':id/import-trend')
async importTrendToBoard(
  @Param('id') boardId: string,
  @Body() dto: {trendItemId: string; position?: {x: number; y: number}}
) {
  const trend = await this.db.trendItem.findUnique({
    where: {id: dto.trendItemId},
    include: {coverFile: true}
  });
  
  if (!trend) {
    throw new NotFoundException('Trend item not found');
  }
  
  // 生成一组元素
  const elements: Partial<BoardElement>[] = [];
  
  // 1. 文本便签：AI摘要
  elements.push({
    type: "note",
    content: {
      text: trend.summary,
      trendItemId: trend.id,
      source: trend.sourceUrl
    },
    role: ["note"],
    position: dto.position || {x: 100, y: 100}
  });
  
  // 2. 色卡：提取的颜色
  if (trend.extracted.keyColors?.length > 0) {
    trend.extracted.keyColors.forEach((color, idx) => {
      elements.push({
        type: "swatch",
        content: {
          color,
          trendItemId: trend.id
        },
        role: ["color_ref"],
        position: {
          x: 100 + idx * 80,
          y: 250
        }
      });
    });
  }
  
  // 3. 代表图：缩略图
  if (trend.coverFileId) {
    elements.push({
      type: "image",
      content: {
        fileId: trend.coverFileId,
        trendItemId: trend.id
      },
      role: ["style_ref"],
      position: {x: 100, y: 350}
    });
  }
  
  // 批量创建元素
  const created = await this.boardsService.createElements(
    boardId, 
    elements
  );
  
  return {
    success: true,
    elements: created
  };
}
```

**前端交互**:
```typescript
// 点击"存入白板"后
async function handleSaveToBoard(trendItemId: string) {
  // 1. 如果没有打开的白板，提示选择/创建
  const activeBoardId = useActiveBoardStore(s => s.boardId);
  
  if (!activeBoardId) {
    const choice = await showDialog({
      title: "选择白板",
      options: recentBoards,
      allowCreate: true
    });
    
    if (choice === 'create') {
      const newBoard = await createBoard({name: "新设计"});
      router.push(`/boards/${newBoard.id}`);
      activeBoardId = newBoard.id;
    }
  }
  
  // 2. 调用API导入
  const result = await api.importTrendToBoard(activeBoardId, {
    trendItemId,
    position: {x: 100, y: 100} // 或智能定位
  });
  
  // 3. 提示成功 + 跳转
  toast.success(`已存入白板（${result.elements.length}个元素）`);
  
  if (router.pathname !== `/boards/${activeBoardId}`) {
    router.push(`/boards/${activeBoardId}`);
  }
}
```

### 3.5 MVP最薄边界

✅ **MVP必做**:
- 定期任务（每周）联网搜索 + LLM摘要
- 趋势卡展示（AI摘要 + 原文链接 + 明确标注）
- 按品类/标签筛选
- 一键"存入白板"为方向约束
- 明确的诚实边界设计（警告标识）

❌ **MVP不做（P1/P2）**:
- 实时滚动更新
- 个性化推荐
- 订阅关注特定方向
- 趋势直接驱动系列DNA建议
- 用户评论/点赞
- 趋势对比/演变图谱

### 3.6 验收标准

| 标准 | 验收方式 |
|------|---------|
| ✅ 趋势页能看到≥10条近期趋势卡 | 打开 /trends，卡片数量达标，都是近1个月内容 |
| ✅ 每张卡都有AI摘要 + "查看原文"链接 | 随机抽查5张卡，两项都存在 |
| ✅ AI摘要处显著标注警告 | ⚠️警告文案清晰可见，黄色背景 |
| ✅ 点"查看原文"能跳转到来源平台 | 点击链接 → 新标签页打开Vogue/WWD等原文 |
| ✅ "存入白板"后，白板出现相关元素 | 点击 → 白板出现文本便签+色卡+图片 |
| ✅ 这些元素可参与后续生成 | 圈选趋势色卡+面料 → 生成 → 结果应用了色彩 |

---

## 🔗 四、与现有系统的集成

### 4.1 白板元素类型扩展

**board_elements 表新增type**:
```prisma
model BoardElement {
  id          String   @id @default(cuid())
  boardId     String
  type        String   // 新增: "fabric" | "trend"
  
  content     Json     // 根据type不同:
                      // type="fabric" → {fabricId: "clx..."}
                      // type="note" 且来自趋势 → {text: "...", trendItemId: "clx..."}
                      // type="swatch" 且来自趋势 → {color: "#FFF", trendItemId: "clx..."}
  
  role        String[] // 如 ["fabric_ref"] | ["color_ref"] | ["style_ref"]
  position    Json     // {x, y}
  size        Json?    // {width, height}
  rotation    Float?
  weight      Float?   // 生成时的权重
  
  // ... 其他字段
}
```

**tldraw shape 定义**:
```typescript
// apps/web/lib/tldraw/shapes/FabricShape.tsx

export class FabricShape extends BaseBoxShapeUtil<FabricShape> {
  static override type = 'fabric' as const
  
  getDefaultProps(): FabricShape['props'] {
    return {
      w: 200,
      h: 200,
      fabricId: '',
      fabricName: '',
      fabricCategory: '',
      thumbnailUrl: ''
    }
  }
  
  component(shape: FabricShape) {
    return (
      <HTMLContainer>
        <div className="fabric-card">
          <img src={shape.props.thumbnailUrl} alt={shape.props.fabricName} />
          <div className="info">
            <span className="name">{shape.props.fabricName}</span>
            <span className="category">{shape.props.fabricCategory}</span>
          </div>
          <Badge>面料</Badge>
        </div>
      </HTMLContainer>
    )
  }
  
  indicator(shape: FabricShape) {
    return <rect width={shape.props.w} height={shape.props.h} />
  }
}
```

### 4.2 生成编译器扩展

**已有通道**: ImageChannel, NoteChannel, SwatchChannel  
**新增通道**: FabricChannel (见2.4节), TrendChannel

```typescript
// apps/api/src/modules/generation/compiler/trend.channel.ts

export class TrendChannel implements CompilerChannel {
  async compile(elements: BoardElement[]): Promise<CompileResult> {
    const trendElements = elements.filter(e => 
      e.content.trendItemId != null
    );
    
    if (trendElements.length === 0) {
      return {prompt: "", refImages: []};
    }
    
    const trendPrompts: string[] = [];
    const trendRefs: RefImage[] = [];
    
    // 提取色卡
    const colorElements = trendElements.filter(e => e.type === "swatch");
    if (colorElements.length > 0) {
      const colors = colorElements.map(e => e.content.color).join(", ");
      trendPrompts.push(`color palette: ${colors}`);
    }
    
    // 提取关键词（从原始趋势项）
    const trendIds = [...new Set(trendElements.map(e => e.content.trendItemId))];
    const trends = await this.db.trendItem.findMany({
      where: {id: {in: trendIds}}
    });
    
    for (const trend of trends) {
      if (trend.extracted?.keywords?.length > 0) {
        trendPrompts.push(
          `trend keywords: ${trend.extracted.keywords.join(", ")}`
        );
      }
      if (trend.extracted?.silhouettes?.length > 0) {
        trendPrompts.push(
          `silhouette: ${trend.extracted.silhouettes.join(" or ")}`
        );
      }
    }
    
    // 趋势图片作为风格参考
    const imageElements = trendElements.filter(e => 
      e.type === "image" && e.role?.includes("style_ref")
    );
    
    for (const el of imageElements) {
      const file = await this.db.uploadedFile.findUnique({
        where: {id: el.content.fileId}
      });
      if (file) {
        trendRefs.push({
          url: file.url,
          role: "style_ref",
          weight: el.weight || 0.5
        });
      }
    }
    
    return {
      prompt: trendPrompts.join(", "),
      refImages: trendRefs
    };
  }
}
```

**主编译器整合**:
```typescript
// apps/api/src/modules/generation/compiler/index.ts

export class GenerationCompiler {
  private channels: CompilerChannel[] = [
    new ImageChannel(this.db),
    new NoteChannel(this.db),
    new SwatchChannel(this.db),
    new FabricChannel(this.db),    // 新增
    new TrendChannel(this.db),     // 新增
  ];
  
  async compile(elements: BoardElement[], userIntent?: string) {
    const results = await Promise.all(
      this.channels.map(ch => ch.compile(elements))
    );
    
    const combinedPrompt = [
      userIntent,
      ...results.map(r => r.prompt).filter(Boolean)
    ].join(", ");
    
    const combinedRefs = results.flatMap(r => r.refImages || []);
    
    return {
      prompt: combinedPrompt,
      refImages: combinedRefs
    };
  }
}
```

### 4.3 API路由新增

```typescript
// apps/api/src/modules/fabrics/fabrics.module.ts
@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [FabricsController],
  providers: [FabricsService],
  exports: [FabricsService]
})
export class FabricsModule {}

// apps/api/src/modules/fabrics/fabrics.controller.ts
@Controller('fabrics')
@UseGuards(JwtAuthGuard)
export class FabricsController {
  
  @Get()
  async list(@Query() query: ListFabricsDto, @CurrentUser() user: User) {
    // 筛选逻辑
    return this.fabricsService.list({
      scope: query.scope, // "all" | "preset" | "user"
      category: query.category,
      ownerId: query.scope === 'user' ? user.id : undefined,
      search: query.search,
      pagination: {page: query.page, limit: query.limit}
    });
  }
  
  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.fabricsService.findOneWithPermission(id, user.id);
  }
  
  @Post()
  @UseInterceptors(FileInterceptor('mainImage'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateFabricDto,
    @CurrentUser() user: User
  ) {
    // 上传图片到对象存储
    const uploaded = await this.storageService.upload(file, {
      folder: `fabrics/${user.id}`
    });
    
    return this.fabricsService.create({
      ...dto,
      scope: 'user',
      ownerId: user.id,
      mainFileId: uploaded.id
    });
  }
  
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFabricDto,
    @CurrentUser() user: User
  ) {
    return this.fabricsService.update(id, dto, user.id);
  }
  
  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() user: User) {
    return this.fabricsService.delete(id, user.id);
  }
  
  @Post(':id/favorite')
  async toggleFavorite(@Param('id') id: string, @CurrentUser() user: User) {
    // P1功能
    return this.fabricsService.toggleFavorite(id, user.id);
  }
}
```

```typescript
// apps/api/src/modules/trends/trends.module.ts
@Module({
  imports: [PrismaModule],
  controllers: [TrendsController],
  providers: [TrendsService],
  exports: [TrendsService]
})
export class TrendsModule {}

// apps/api/src/modules/trends/trends.controller.ts
@Controller('trends')
export class TrendsController {
  
  @Get()
  async list(@Query() query: ListTrendsDto) {
    return this.trendsService.list({
      category: query.category,
      platform: query.platform,
      tags: query.tags,
      pagination: {page: query.page, limit: query.limit}
    });
  }
  
  @Get('weekly-digest')
  async getWeeklyDigest(@Query('period') period?: string) {
    // 获取本周或指定周的综述
    return this.trendsService.getDigest(period);
  }
  
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.trendsService.findOne(id);
  }
}
```

```typescript
// apps/api/src/modules/boards/boards.controller.ts
@Controller('boards')
@UseGuards(JwtAuthGuard)
export class BoardsController {
  
  // 已有路由...
  
  // 新增：导入趋势到白板
  @Post(':id/import-trend')
  async importTrend(
    @Param('id') boardId: string,
    @Body() dto: ImportTrendDto,
    @CurrentUser() user: User
  ) {
    // 见3.4节实现
    return this.boardsService.importTrendToBoard(
      boardId, 
      dto.trendItemId, 
      dto.position,
      user.id
    );
  }
}
```

### 4.4 数据库迁移

**Prisma Schema 新增**:
```prisma
// prisma/schema.prisma

model Fabric {
  id              String   @id @default(cuid())
  scope           String   // "preset" | "user"
  ownerId         String?
  
  name            String
  category        String
  subCategory     String?
  
  mainFileId      String
  hangingFileId   String?
  closeupFileId   String?
  
  attributes      Json
  aiTags          Json?
  
  source          String?
  license         String?
  status          String   @default("active")
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  owner           User?    @relation(fields: [ownerId], references: [id])
  mainFile        UploadedFile @relation("FabricMainImage", fields: [mainFileId], references: [id])
  hangingFile     UploadedFile? @relation("FabricHangingImage", fields: [hangingFileId], references: [id])
  closeupFile     UploadedFile? @relation("FabricCloseupImage", fields: [closeupFileId], references: [id])
  
  @@index([scope, category])
  @@index([ownerId])
  @@index([status])
}

model TrendItem {
  id            String   @id @default(cuid())
  
  title         String
  summary       String   @db.Text
  
  platform      String
  sourceUrl     String
  publishedAt   DateTime
  
  coverFileId   String?
  category      String
  tags          String[]
  
  extracted     Json?
  
  curatedAt     DateTime @default(now())
  status        String   @default("published")
  
  coverFile     UploadedFile? @relation(fields: [coverFileId], references: [id])
  
  @@index([publishedAt])
  @@index([category])
  @@index([platform])
  @@index([status])
}

model TrendDigest {
  id            String   @id @default(cuid())
  period        String
  theme         String
  itemIds       String[]
  overview      String   @db.Text
  createdAt     DateTime @default(now())
  
  @@unique([period])
  @@index([period])
}

// BoardElement 表扩展（已有表）
// 只需确保 content 字段是 Json 类型，能存储任意结构
```

**迁移文件**:
```bash
# 生成迁移
pnpm prisma migrate dev --name add_fabric_and_trend_modules

# 生成 Prisma Client
pnpm prisma generate
```

---

## 📅 五、开发任务分解与排期

### 阶段5：面料库后端（8-10天）

#### **任务5.1：数据模型与CRUD接口**（3天）
- [ ] Prisma schema 定义 Fabric 表
- [ ] 生成迁移文件并执行
- [ ] FabricsService 实现 CRUD 方法
- [ ] FabricsController 实现 REST 接口
- [ ] 权限控制：用户只能访问 preset + 自己的面料
- [ ] 单元测试：CRUD + 权限边界

#### **任务5.2：预置面料骨架内容生产**（3天）
- [ ] 用Flux/SDXL生成50种常见面料贴图
- [ ] 人工挑选质量合格的图片
- [ ] 编写属性数据（JSON）
- [ ] 批量导入脚本（Prisma seed）
- [ ] 验收：可浏览50种预置面料

#### **任务5.3：用户上传流程**（2-4天）
- [ ] 文件上传接口（multipart/form-data）
- [ ] 对象存储集成（R2/S3）
- [ ] 属性表单验证（成分占比=100%等）
- [ ] 前端上传表单UI（见2.4节）
- [ ] 验收：能上传面料并填属性

### 阶段6：面料库前端 + 回流生成（6-8天）

#### **任务6.1：面料库页与白板内抽屉**（3天）
- [ ] 面料库独立页 /fabrics
- [ ] 瀑布流/网格布局
- [ ] 筛选组件（品类/成分/克重/季节）
- [ ] 搜索框与关键词匹配
- [ ] 白板内"面料"按钮 → 右侧抽屉滑入
- [ ] 验收：可浏览、筛选、搜索面料

#### **任务6.2：面料元素shape与拖入白板**（2天）
- [ ] tldraw FabricShape 定义
- [ ] 从抽屉拖入白板逻辑
- [ ] 面料卡片显示（缩略图+名称+品类）
- [ ] role自动标注为["fabric_ref"]
- [ ] 验收：拖入后白板出现面料元素

#### **任务6.3：编译器fabric通道与生成**（3天）
- [ ] FabricChannel 实现（见2.4节）
- [ ] 材质关键词提取逻辑
- [ ] 纹理参考图传递给模型
- [ ] generation_inputs 记录 fabric_id
- [ ] 调参测试：材质可辨识度
- [ ] 验收：**魔法时刻**成立（拖丝绸→生成→有光泽）

### 阶段7：趋势模块（5-7天）

#### **任务7.1：趋势数据采集与存储**（2-3天）
- [ ] TrendItem 和 TrendDigest 表迁移
- [ ] 联网搜索集成（Brave API / Perplexity）
- [ ] LLM结构化摘要（Claude API）
- [ ] BullMQ 定期任务配置（每周一次）
- [ ] 缩略图下载与水印标注
- [ ] 手动触发一次任务，入库10+条测试数据
- [ ] 验收：数据库有≥10条趋势记录

#### **任务7.2：趋势页前端**（2天）
- [ ] 趋势页 /trends 路由与布局
- [ ] TrendCard 组件（见3.4节）
- [ ] 诚实边界设计（警告标识+原文链接置顶）
- [ ] 筛选栏（品类/标签/平台）
- [ ] 本周综述卡片（WeeklyDigestCard）
- [ ] 验收：可浏览趋势卡，样式符合设计

#### **任务7.3：存入白板接口**（1-2天）
- [ ] POST /boards/:id/import-trend 接口
- [ ] 元素生成逻辑（文本+色卡+图片）
- [ ] 前端"存入白板"按钮交互
- [ ] 白板选择/创建对话框
- [ ] 验收：点击后白板出现3类元素

### 阶段8：集成测试与优化（3-5天）

#### **任务8.1：E2E流程验收**（2天）
- [ ] 完整流程测试：
  - 浏览预置面料 → 上传自有面料 → 筛选
  - 浏览趋势 → 存入白板
  - 白板内：拖入面料 + 趋势色卡 + 文字意图 → 生成
  - 验收生成结果：材质可辨识 + 色彩应用
- [ ] 边界情况测试：
  - 用户A看不到用户B的面料
  - 原文链接可跳转
  - 生成失败时的降级提示

#### **任务8.2：性能优化**（1-2天）
- [ ] 面料库图片懒加载与CDN加速
- [ ] 趋势页瀑布流虚拟滚动
- [ ] 编译器缓存优化
- [ ] 数据库查询索引优化

#### **任务8.3：文案与引导**（1天）
- [ ] "魔法时刻"引导提示（新手引导）
- [ ] AI标注文案审查（诚实边界）
- [ ] 错误提示文案优化
- [ ] 帮助文档/视频录制

### 总计：22-30个工作日

**关键路径**:
```
阶段5（面料后端）→ 阶段6（面料前端+生成）→ 阶段8（验收）
阶段7（趋势模块）可与阶段6并行开发
```

---

## ⚠️ 六、关键风险与缓解策略

### 6.1 技术风险

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|----------|
| **面料材质在生成结果中不可辨识** | 中 | 高 | • 早期用最强模型（Flux Pro/SDXL Lightning）调参验证<br>• 准备降级话术"材质参考"而非"材质精确还原"<br>• 多轮AB测试找最优prompt结构 |
| **预置面料库AI贴图不够真实** | 中 | 中 | • 混合20-30%自拍素材提升可信度<br>• 运营引导用户上传形成UGC内容<br>• 标注来源："AI生成"vs"实拍" |
| **LLM趋势摘要准确性被质疑** | 中 | 中 | • 强化"可溯源"设计（原文链接置顶）<br>• 人工审校前10批内容<br>• 收集用户反馈迭代prompt |
| **生图模型不支持多参考图** | 低 | 高 | • 提前验证目标模型API能力<br>• 备选方案：ControlNet多控制 |

### 6.2 内容风险

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|----------|
| **趋势来源版权纠纷** | 低 | 高 | • 只存摘要+缩略+链接，不镜像全文<br>• 优先抓取授权/开放来源<br>• 缩略图加来源水印<br>• 法务审查内容策略 |
| **用户上传侵权面料图** | 中 | 中 | • 上传协议明确版权责任<br>• P1考虑图像去重检测 |
| **AI生成面料贴图侵权争议** | 低 | 低 | • 使用开源模型生成<br>• 标注"AI生成"避免误导 |

### 6.3 产品风险

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|----------|
| **用户不理解"面料库"价值** | 中 | 中 | • 新手引导强化"魔法时刻"<br>• 案例展示：相同设计+不同面料<br>• 设计师访谈视频 |
| **趋势模块使用率低** | 中 | 低 | • 首页突出展示本周热门趋势<br>• 邮件/推送周报<br>• 降级：如无人用，P2可下线 |
| **用户期望"触感"但屏幕无法呈现** | 高 | 低 | • 预期管理：文案强调"视觉材质参考"<br>• 属性标注补充：克重/垂坠度等 |

---

## 🎯 七、成功指标（OKR）

### O1: 面料库成为核心差异化能力

**KR1**: 上线后30天内，≥60%活跃用户至少上传1块面料  
**KR2**: 包含面料元素的生成任务占比≥40%  
**KR3**: 用户平均面料库存量≥10块（7日留存用户）  
**KR4**: "魔法时刻"转化率≥70%（拖面料→生成→采纳）

### O2: 趋势模块提供可信灵感来源

**KR1**: 趋势页周访问率≥50%（活跃用户）  
**KR2**: "存入白板"转化率≥20%（浏览趋势→存入）  
**KR3**: 用户对AI摘要的信任度评分≥3.5/5（调研）  
**KR4**: 原文链接点击率≥30%（体现可溯源价值）

### O3: 两模块协同提升生成质量

**KR1**: 包含面料+趋势的生成任务，采纳率比纯文本高≥15%  
**KR2**: 用户主观质量评分（面料+趋势）≥4.0/5  
**KR3**: 迭代轮次减少≥20%（约束更清晰）

---

## 📝 八、Vibe Coding 提示词

以下提示词可直接用于AI辅助编码（Claude/Cursor/GitHub Copilot）：

### 8.1 面料库后端开发

```markdown
【任务】实现面料库后端模块

【上下文】
- 项目：AI服装设计平台，Next.js + NestJS + Prisma + PostgreSQL
- 目标：构建面料数字资产库，支持预置面料+用户上传

【需求】
1. Prisma Schema:
   - Fabric表：id, scope(preset/user), ownerId, name, category, subCategory
   - mainFileId关联UploadedFile
   - attributes字段(Json)存储：composition, weave, weight, drape, stretch等
   - 索引：[scope, category], [ownerId]

2. NestJS Service:
   - list(): 支持筛选scope/category/search，分页
   - findOne(): 带权限检查（preset公开，user仅本人）
   - create(): 用户上传，scope="user", ownerId=当前用户
   - update/delete(): 仅允许修改/删除自己的面料

3. REST API:
   - GET /fabrics?scope=all&category=cotton&page=1
   - POST /fabrics (multipart: mainImage + attributes JSON)
   - PATCH /fabrics/:id
   - DELETE /fabrics/:id

【约束】
- 成分占比总和必须=100%
- 用户只能看到preset + 自己的面料
- 文件上传到R2/S3，返回URL

【期望输出】
- prisma/schema.prisma (Fabric model)
- apps/api/src/modules/fabrics/ (module, service, controller, dto)
- 单元测试覆盖权限边界
```

### 8.2 面料库前端开发

```markdown
【任务】实现面料库前端UI与白板集成

【上下文】
- 项目：Next.js 14 + React + TypeScript + tldraw + TailwindCSS
- 目标：让用户浏览面料库并拖入白板

【需求】
1. 面料库页 /fabrics:
   - 瀑布流布局（react-window虚拟滚动）
   - 左侧筛选栏：品类/成分/克重/季节
   - 顶部搜索框
   - 面料卡片：缩略图 + 名称 + 品类标签

2. 白板内面料抽屉:
   - 左侧工具栏添加"面料"图标按钮
   - 点击后右侧滑入抽屉（300px宽）
   - 抽屉内：快速筛选（我的/预置）+ 搜索 + 瀑布流
   - 支持拖拽到画布

3. tldraw FabricShape:
   - 自定义shape类型"fabric"
   - props: fabricId, fabricName, fabricCategory, thumbnailUrl
   - 渲染：卡片样式，显示缩略图+文本
   - 自动标注role=["fabric_ref"]

【技术要点】
- 使用SWR缓存面料列表
- 拖拽用HTML5 Drag API
- tldraw shape注册到editor.shapeUtils

【设计规范】
- 色系：深色调（#0F131C背景，#1E2636卡片）
- 圆角：16px卡片，999px标签
- 间距：grid gap-4
- 字体：clamp()流式缩放

【期望输出】
- apps/web/app/fabrics/page.tsx
- apps/web/components/fabrics/FabricCard.tsx
- apps/web/components/board/FabricDrawer.tsx
- apps/web/lib/tldraw/shapes/FabricShape.tsx
```

### 8.3 面料回流生成（编译器）

```markdown
【任务】实现面料信息注入生成prompt的编译器通道

【上下文】
- 项目：NestJS后端，已有ImageChannel/NoteChannel/SwatchChannel
- 目标：提取白板上面料元素的材质属性，转化为AI可理解的prompt

【需求】
1. FabricChannel类:
   - 实现CompilerChannel接口
   - compile(elements: BoardElement[]): Promise<CompileResult>

2. 编译逻辑:
   - 过滤type="fabric"或role包含"fabric_ref"的元素
   - 查询Fabric表获取完整属性（attributes字段）
   - 提取关键信息：
     * composition: "cotton 60%, polyester 40%"
     * weave: "plain" | "twill" | "knit"
     * texture: "smooth" | "textured"
     * drape: "stiff" | "moderate" | "fluid"
     * sheen: "matte" | "subtle" | "glossy"
   - 组装prompt片段：
     "fabric material: cotton 60%, polyester 40%, weave type: plain, fabric texture: smooth, drape: moderate, sheen: matte"
   - 纹理参考图：mainFile.url作为refImage，role="fabric_texture", weight=0.7

3. 集成到主编译器:
   - GenerationCompiler.channels数组添加FabricChannel
   - 合并所有通道的prompt和refImages

【约束】
- 处理空情况：无面料元素时返回{prompt: "", refImages: []}
- 记录fabric_id到generation_inputs表（血缘追溯）

【期望输出】
- apps/api/src/modules/generation/compiler/fabric.channel.ts
- 更新 apps/api/src/modules/generation/compiler/index.ts
- 单元测试：多面料/无面料/权限检查
```

### 8.4 趋势模块后端（定期任务）

```markdown
【任务】实现趋势采集与结构化存储的BullMQ定期任务

【上下文】
- 项目：NestJS + BullMQ + Prisma + Claude API
- 目标：每周自动抓取时尚趋势并AI摘要入库

【需求】
1. TrendItem和TrendDigest表（Prisma Schema）:
   - TrendItem: title, summary, platform, sourceUrl, publishedAt, coverFileId, category, tags, extracted(Json)
   - extracted字段：{keyColors: ["#HEX"], silhouettes: [], keywords: [], fabricMentions: []}

2. BullMQ定期任务:
   - 队列名：trend-digest
   - Cron：每周一凌晨2点（0 2 * * MON）
   - Processor：TrendDigestProcessor

3. 任务流程:
   Step 1: 联网搜索
     - 用Brave Search API / Perplexity搜索
     - 查询词：["fashion trends 2026", "runway trends", "color trends fashion"]
     - 来源过滤：vogue.com, wwd.com, pinterest.com/trends, fashionunited.com
     - 时间范围：last_week
   
   Step 2: LLM结构化摘要
     - 调用Claude API (sonnet-4)
     - Prompt模板：
       "总结以下时尚趋势文章的核心要点（2-3句话，中文）：
        标题：{title}
        摘要：{snippet}
        
        输出JSON：{summary, keyColors, silhouettes, keywords, fabricMentions}"
     - 使用responseFormat: {type: "json_object"}
   
   Step 3: 下载缩略图
     - 从搜索结果image字段下载
     - 上传到R2/S3，folder="trends"
     - 添加来源水印（可选）
   
   Step 4: 存库
     - TrendItem.create()
     - 记录platform, sourceUrl, publishedAt
   
   Step 5: 生成周综述（可选）
     - 汇总本周所有item
     - LLM生成overview
     - TrendDigest.create()

【错误处理】
- 单条失败不影响整体：try-catch包裹每条处理
- 记录失败日志到job.log
- 重试策略：3次，指数退避

【期望输出】
- prisma/schema.prisma (TrendItem, TrendDigest)
- apps/worker/src/processors/trend.digest.processor.ts
- apps/worker/src/queues/trend.queue.ts
- 配置cron到BullMQ
```

### 8.5 趋势模块前端（诚实边界设计）

```markdown
【任务】实现趋势页UI，强调可溯源与诚实边界

【上下文】
- 项目：Next.js 14 + React + TypeScript
- 目标：展示AI趋势摘要 + 原文链接，化解信任顾虑

【需求】
1. 趋势页 /trends:
   - 顶部：本周综述卡片（WeeklyDigestCard）
   - 筛选栏：品类（女装/男装/配饰）、标签、平台
   - 主体：趋势卡片流（3列网格，响应式）

2. TrendCard组件（关键设计）:
   结构从上到下：
   - 代表图 + 平台标签
   - 标题（h3）
   - 【AI摘要层】
     * ⚠️ 警告框："AI整理，建议结合原文判断"（黄色背景，显眼）
     * 摘要文本（2-3句）
     * 提取的色卡（ColorStrip）
     * 关键词标签（TagList）
   - 【原始链接层】（置顶设计，不藏底部）
     * 📄 "查看原文 - Vogue" 链接（target="_blank"）
     * 发布日期
   - "存入白板"按钮

3. 诚实边界设计原则:
   - ⚠️ 警告标识必须显眼（黄底黑字，icon）
   - 📄 原文链接置于显著位置（与摘要并列，非次要）
   - 来源平台清晰标注（不能只有"来源"，要明确"Vogue"等）
   - 发布日期展示（让用户判断时效性）
   - 不用"AI推荐""智能分析"等夸大文案，用"AI整理"

4. 存入白板交互:
   - 点击按钮 → 检查是否有活跃白板
   - 无白板 → 弹出选择/创建对话框
   - 调用API → POST /boards/:id/import-trend
   - 成功 → toast提示"已存入白板（3个元素）" + 跳转白板

【样式要求】
- 色系：深色调（#0F131C背景，#1E2636卡片）
- 警告框：#FDB462背景，#161D2B文字
- 圆角：16px卡片，8px警告框
- 原文链接：#38BDF8高亮色，hover下划线

【期望输出】
- apps/web/app/trends/page.tsx
- apps/web/components/trends/TrendCard.tsx
- apps/web/components/trends/WeeklyDigestCard.tsx
- apps/web/components/trends/ColorStrip.tsx
```

### 8.6 白板集成（存入趋势功能）

```markdown
【任务】实现趋势导入白板的后端接口与前端交互

【上下文】
- 已有白板元素系统：BoardElement表，type字段支持扩展
- 目标：点"存入白板" → 白板出现文本便签+色卡+图片

【需求】
1. 后端API:
   - 路由：POST /boards/:id/import-trend
   - Body：{trendItemId: string, position?: {x, y}}
   - 逻辑：
     a. 查询TrendItem（include coverFile）
     b. 生成3类元素：
        * type="note": {text: summary, trendItemId, source: sourceUrl}, role=["note"]
        * type="swatch" × N: {color: keyColors[i], trendItemId}, role=["color_ref"]
        * type="image": {fileId: coverFileId, trendItemId}, role=["style_ref"]
     c. position自动布局：note在(x,y), 色卡横排在(x, y+150), 图片在(x, y+250)
     d. 批量插入BoardElement表
   - 返回：{success: true, elements: [...]}

2. 前端交互:
   - TrendCard内"存入白板"按钮onClick
   - 检查activeBoardId（全局状态）
   - 无活跃白板 → showDialog选择/创建
   - 调用API → await importTrendToBoard(boardId, trendItemId)
   - 成功 → toast + 跳转白板（如不在白板页）
   - 白板自动刷新显示新元素

3. 白板元素显示:
   - note元素：便签样式，显示摘要文本
   - swatch元素：色块，显示HEX颜色
   - image元素：趋势图片缩略图
   - 所有元素带trendItemId标记（metadata）

【约束】
- 权限检查：只能导入到自己有权限的白板
- 幂等性：重复导入同一趋势到同一白板 → 提示"已存在"
- position智能定位：如白板已有内容，避开已有元素区域

【期望输出】
- apps/api/src/modules/boards/boards.controller.ts (新增路由)
- apps/api/src/modules/boards/boards.service.ts (importTrendToBoard方法)
- apps/web/components/trends/TrendCard.tsx (交互逻辑)
- apps/web/hooks/useImportTrend.ts (可选，封装逻辑)
```

### 8.7 编译器趋势通道

```markdown
【任务】实现趋势元素回流生成的编译器通道

【上下文】
- 白板上的趋势元素（色卡/图片/文本）需要转化为生成约束
- 目标：提取趋势关键词、色彩、廓形信息注入prompt

【需求】
1. TrendChannel类:
   - 实现CompilerChannel接口
   - compile(elements: BoardElement[]): Promise<CompileResult>

2. 编译逻辑:
   - 过滤带trendItemId的元素（来自趋势模块）
   - 提取色卡元素：type="swatch" && trendItemId存在
     → 汇总颜色："color palette: #FF6B9D, #FDB462, #8DD3C7"
   - 查询原始TrendItem（去重trendItemId）
     → 提取extracted.keywords："trend keywords: dopamine dressing, bold color"
     → 提取extracted.silhouettes："silhouette: oversized or A-line"
   - 趋势图片作为风格参考：
     type="image" && role包含"style_ref" && trendItemId存在
     → refImage: {url, role: "style_ref", weight: 0.5}

3. Prompt结构:
   ```
   color palette: #FF6B9D, #FDB462,
   trend keywords: dopamine dressing, bold color, optimism,
   silhouette: oversized or cocoon
   ```

【约束】
- 处理空情况：无趋势元素时返回空
- 去重trendItemId：多个元素可能来自同一趋势

【期望输出】
- apps/api/src/modules/generation/compiler/trend.channel.ts
- 更新 GenerationCompiler.channels数组
- 单元测试
```

---

## 📚 九、附录

### 9.1 参考资料

**时尚趋势来源平台**:
- Vogue: https://www.vogue.com/fashion/trends
- WWD: https://wwd.com/fashion-news/trends/
- Pinterest Trends: https://www.pinterest.com/business/trends/
- Fashion United: https://fashionunited.com/trends
- WGSN (付费): https://www.wgsn.com/

**技术文档**:
- Prisma: https://www.prisma.io/docs
- tldraw: https://tldraw.dev/docs
- BullMQ: https://docs.bullmq.io/
- Brave Search API: https://brave.com/search/api/
- Claude API: https://docs.anthropic.com/

### 9.2 面料属性枚举值参考

```typescript
// 面料大类
export enum FabricCategory {
  COTTON = "cotton",           // 棉
  SILK = "silk",              // 丝
  WOOL = "wool",              // 毛
  SYNTHETIC = "synthetic",    // 化纤
  BLEND = "blend"             // 混纺
}

// 织造方式
export enum WeaveType {
  PLAIN = "plain",            // 平纹
  TWILL = "twill",            // 斜纹
  SATIN = "satin",            // 缎纹
  KNIT = "knit",              // 针织
  JACQUARD = "jacquard"       // 提花
}

// 垂坠度
export enum Drape {
  STIFF = "stiff",            // 挺括
  MODERATE = "moderate",      // 适中
  FLUID = "fluid"             // 飘逸
}

// 弹性
export enum Stretch {
  NONE = "none",              // 无弹
  SLIGHT = "slight",          // 微弹
  HIGH = "high"               // 高弹
}

// 透明度
export enum Opacity {
  OPAQUE = "opaque",          // 不透
  SEMI = "semi",              // 半透
  SHEER = "sheer"             // 透明
}

// 光泽
export enum Sheen {
  MATTE = "matte",            // 哑光
  SUBTLE = "subtle",          // 微光
  GLOSSY = "glossy"           // 高光
}

// 质感
export enum Texture {
  SMOOTH = "smooth",          // 光滑
  TEXTURED = "textured",      // 纹理
  FUZZY = "fuzzy"             // 绒面
}

// 适用季节
export enum Season {
  SPRING = "spring",
  SUMMER = "summer",
  AUTUMN = "autumn",
  WINTER = "winter"
}

// 适用品类
export enum UseCase {
  SHIRT = "shirt",            // 衬衫
  DRESS = "dress",            // 连衣裙
  OUTERWEAR = "outerwear",    // 外套
  PANTS = "pants",            // 裤装
  SKIRT = "skirt",            // 裙装
  SUIT = "suit"               // 西装
}
```

### 9.3 数据库迁移SQL参考

```sql
-- Fabric表
CREATE TABLE "Fabric" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scope" TEXT NOT NULL,
  "ownerId" TEXT,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "subCategory" TEXT,
  "mainFileId" TEXT NOT NULL,
  "hangingFileId" TEXT,
  "closeupFileId" TEXT,
  "attributes" JSONB NOT NULL,
  "aiTags" JSONB,
  "source" TEXT,
  "license" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Fabric_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "Fabric_mainFileId_fkey" FOREIGN KEY ("mainFileId") REFERENCES "UploadedFile"("id")
);

CREATE INDEX "Fabric_scope_category_idx" ON "Fabric"("scope", "category");
CREATE INDEX "Fabric_ownerId_idx" ON "Fabric"("ownerId");
CREATE INDEX "Fabric_status_idx" ON "Fabric"("status");

-- TrendItem表
CREATE TABLE "TrendItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "coverFileId" TEXT,
  "category" TEXT NOT NULL,
  "tags" TEXT[],
  "extracted" JSONB,
  "curatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'published',
  CONSTRAINT "TrendItem_coverFileId_fkey" FOREIGN KEY ("coverFileId") REFERENCES "UploadedFile"("id")
);

CREATE INDEX "TrendItem_publishedAt_idx" ON "TrendItem"("publishedAt");
CREATE INDEX "TrendItem_category_idx" ON "TrendItem"("category");
CREATE INDEX "TrendItem_platform_idx" ON "TrendItem"("platform");
CREATE INDEX "TrendItem_status_idx" ON "TrendItem"("status");

-- TrendDigest表
CREATE TABLE "TrendDigest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "period" TEXT NOT NULL,
  "theme" TEXT NOT NULL,
  "itemIds" TEXT[],
  "overview" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "TrendDigest_period_key" ON "TrendDigest"("period");
CREATE INDEX "TrendDigest_period_idx" ON "TrendDigest"("period");
```

---

## ✅ 十、总结

### 核心价值重申

1. **面料库 = 材质驱动设计壁垒**
   - 让AI生成不再"凭空想象"，而是基于真实材质
   - 用户上传形成私有资产库 = 高切换成本
   - 专业度碾压通用工具

2. **趋势分析 = 可溯源的灵感引擎**
   - AI摘要提升效率，原文链接保证可信
   - 回流白板形成闭环，不是死内容
   - 诚实边界设计化解信任顾虑

3. **两者协同 = 完整的设计方法论**
   - 趋势（方向） + 面料（材质） + 用户意图 = 高质量生成
   - 从"画图工具"升级为"设计工作台"

### 最终建议

- **资源倾斜**: 80%精力给面料库，20%给趋势（面料是壁垒，趋势是辅助）
- **验收标准**: 魔法时刻成立 > 功能完整度
- **迭代策略**: MVP快速上线 → 收集反馈 → P1优化（AI打标、三视图）
- **风险管控**: 早期验证材质可辨识度，准备降级方案

---

**方案编写**: Claude Opus 5  
**日期**: 2026-08-02  
**版本**: v2.0 Final

