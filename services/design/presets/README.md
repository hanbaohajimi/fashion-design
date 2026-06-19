# 试衣台预设资源说明

这里存放试衣台使用的所有系统预设资源。建造者只需放入图片 + 编辑对应 `manifest.json` 即可生效，**无需改代码**。

## 目录结构

```
presets/
├── clothes/        系统预设衣物
├── models/         模特图（必须至少 1 张默认模特）
├── backgrounds/    背景示例图
├── actions/        动作姿势图
└── beauty/         发型与颜色
```

## 通用字段

每个目录下的 `manifest.json` 是一个数组，每项格式：

```json
{
  "id": "唯一字符串ID",
  "name": "用户看到的中文名",
  "thumbnail": "图片文件名（同目录下）",
  "prompt": "传给生图模型的英文/中文描述",
  "tags": ["可选标签"]
}
```

## 各目录的特殊字段

### clothes/manifest.json

`category` **必填**，使用衣橱 8 大分类之一：

- `top` 上装
- `bottom` 下装
- `suit` 套装
- `shoes` 鞋子
- `bag` 包包
- `jewelry` 首饰
- `accessory` 配饰
- `uncategorized` 未分类

示例：

```json
[
  {
    "id": "preset_top_white_tshirt",
    "name": "纯白 T 恤",
    "thumbnail": "white_tshirt.png",
    "prompt": "plain white cotton t-shirt with crew neck",
    "category": "top",
    "tags": ["基础款", "百搭"]
  }
]
```

### models/manifest.json

`gender` **必填**，`"male"` 或 `"female"`：

```json
[
  {
    "id": "model_female_default",
    "name": "亚洲女模 · 默认",
    "thumbnail": "default_female.png",
    "prompt": "asian female fashion model, neutral pose, studio lighting",
    "gender": "female"
  }
]
```

**注意**：至少需要保留 1 张默认模特，否则生图会失败。

### backgrounds/manifest.json

```json
[
  {
    "id": "bg_studio_white",
    "name": "纯白棚拍",
    "thumbnail": "studio_white.png",
    "prompt": "seamless white studio backdrop, soft diffused lighting"
  }
]
```

### actions/manifest.json

```json
[
  {
    "id": "act_standing_neutral",
    "name": "站立",
    "thumbnail": "standing.png",
    "prompt": "standing straight, hands relaxed at sides"
  }
]
```

### beauty/manifest.json

需要 `gender` 和 `type`（`"hairstyle"` 或 `"color"`）：

```json
[
  {
    "id": "hair_female_long_wave",
    "name": "长卷发",
    "thumbnail": "female_long_wave.png",
    "prompt": "long wavy hair with natural texture",
    "gender": "female",
    "type": "hairstyle"
  },
  {
    "id": "color_brown",
    "name": "棕色",
    "thumbnail": "color_brown.png",
    "prompt": "natural brown hair color",
    "gender": "female",
    "type": "color"
  }
]
```

## 添加新资源步骤

1. 把图片放到对应目录（建议 PNG，长边 512px 左右）
2. 编辑该目录的 `manifest.json`，添加一项
3. 重启服务即可（无需重启前端，刷新页面即可）

## 命名建议

- 图片文件名使用小写英文 + 下划线，避免空格和中文
- `id` 字段使用 `{category}_{name}` 形式，全局唯一
- `prompt` 使用英文描述，更适配生图模型
