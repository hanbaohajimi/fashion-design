# 公开首页摄影素材来源

生成日期：2026-11-14。

四张素材均通过 OpenAI 内置 `image_gen.imagegen` 生成，背景为不透明；模型由内置工具选择。每张只生成一次并选用该结果。未调用项目模型、外部图片 API 或生成 CLI。

设计依据为获选的 `apps/web/.impeccable/mocks/public-fashion-02.png`。用户随后确认“以构图和氛围为准，直接实现（推荐）”。四个 `apps/web/.impeccable/build/crops/<id>.png` 仅作为已检查的视觉参考传入 `referenced_image_paths`；生成文件不包含从设计稿裁出的任何像素。人物和服装均为 AI 生成的设计示例。

原生文件保留在 Codex `generated_images`，未被覆盖。下面列出本机原生来源，便于追溯；项目使用本目录中的最终 PNG。

| 文件 | 原生尺寸 | 保存尺寸 | 后处理 |
| --- | --- | --- | --- |
| `hero-photo.png` | 2003 × 785 | 2560 × 1003 | 已有 ffmpeg，Lanczos 等比放大到宽度 2560；无裁切。约 1.278 倍插值。 |
| `material-photo.png` | 1770 × 889 | 1770 × 889 | 原生尺寸复制，无裁切或缩放。 |
| `sketch-photo.png` | 1573 × 1000 | 1573 × 1000 | 原生尺寸复制，无裁切或缩放。 |
| `collection-photo.png` | 1916 × 821 | 2390 × 1024 | 已有 ffmpeg，Lanczos 等比放大到高度 1024；无裁切。约 1.247 倍插值，保留完整衣摆和鞋。 |

内置工具未输出提示词请求的原生高分辨率。Hero 和 Collection 的保存尺寸包含常规插值放大；此操作不创造新的摄影细节。素材均超过原 spec 对应的最低像素尺寸。

Hero 保留约 2.55:1 全景构图、左侧亮墙留白、下方鼠尾草绿布料、右侧象牙白外套模特，以及远右侧人台与衣架。Collection 在参考基础上向下续出三套完整服装；实际输出约 2.334:1，保留原生成构图而未强制裁成参考的 2.391:1。三个身体中心约在宽度 25%、51%、77%，各套服装独立且均落在自己的三分之一区域；单套聚焦可按实际身体中心定位。

已用 `view_image` 检查所有最终文件：未发现文字、界面残留、遮挡矩形、边框、合并人物或明显肢体错误。材质图具有可见真实织纹；过程图左侧为纸上铅笔稿、右侧为鼠尾草绿垂褶人台。

每张 PNG 均用 `impeccable embed-prompt <file> --prompt-file <prompt>` 写入了完整生成提示词的 PNG tEXt 元数据。下方同步保存提交给工具的提示词正文。

## hero-photo

- 参考：`apps/web/.impeccable/build/crops/hero-photo.png`。
- 原生文件：`C:/Users/朱奕玮/.codex/generated_images/01a1d886-3f20-7ee0-a045-f0d74a9222f9/exec-eace59ca-534d-49b1-9994-4bffadc12c7d.png`。
- 最终文件：`apps/web/assets/plates/hero-photo.png`。
- 最终 PNG SHA-256：`2b801c0a79ac56a2ea271c9e135cfc2b4df604a8e0cfebbb3142b3de5a2daca9`。

```text
Use case: photorealistic-natural
Asset type: production panoramic fashion photograph for the approved cinematic fashion landing design.
Primary request: Generate a new clean original photograph that faithfully recreates the approved reference composition and styling. The provided image is a visual reference only, never shipping pixels. Preserve its scale, silhouette, perspective, palette, lighting, materials and tactile detail.
Input image: hero-photo.png is the approved crop reference. Pale rectangular masks, small leftover lettering, label remnants and green interface marks in this reference are removal annotations, not parts of the photograph. Reconstruct the natural wall and fabric behind them; do not reproduce the masks or any lettering.
Scene/backdrop: a warm ivory fashion atelier, with a tall black-framed window at the far left, a few soft olive leaves along the upper-left edge, and natural window/foliage shadows across the bright plaster wall. Calm bright wall occupies the left half. Sage woven fabric rolls in broad flowing folds across the lower-left foreground. A neutral dress form stands near the far-right quarter and a discreet wooden garment rail with ivory and sage garments occupies the far-right edge.
Subject: one adult East Asian female editorial model, face centered around 66% of frame width, body in the center-right around 64%. Dark hair in a loose textured updo, natural skin texture, chin slightly lifted, composed direct editorial gaze and the same relaxed three-quarter pose as the reference. She wears an ivory sculptural oversized wrap coat, large folded lapels and curved shoulder volume, a self-fabric waist belt and a muted sage underlayer; near hand rests in the coat pocket. Keep the coat's woven texture and soft architectural folds.
Composition/framing: panoramic 2.55:1 image, edge to edge, ideally 3072 by 1205 pixels or the largest available native resolution at this ratio. Match the reference's upper-thigh crop and head position near the top edge. Preserve ample low-detail wall for copy at left, the fabric below it, the model near two thirds and the supporting dress form/rail at right. Do not center the model or add competing props. No framing margins or border.
Lighting/mood: natural warm side light from the left, soft deep shadows, quiet cinematic fashion editorial, realistic photographic depth and texture. The lightest wall is warm ivory rather than white; subdued sage, olive and taupe shadows match the reference.
Constraints: clean photograph only. No text, labels, captions, watermarks, logos, buttons, interface chrome, masks, flat rectangular overlays, drawn lines, page background, border, rounded corners or drop shadows. No extra people or props. No illustration, CGI, painterly rendering or artificial beauty smoothing. Opaque image.
```

## material-photo

- 参考：`apps/web/.impeccable/build/crops/material-photo.png`。
- 原生文件：`C:/Users/朱奕玮/.codex/generated_images/01a1d886-3f20-7ee0-a045-f0d74a9222f9/exec-350b76b8-76c8-45c7-b29f-1042925acf27.png`。
- 最终文件：`apps/web/assets/plates/material-photo.png`。
- 最终 PNG SHA-256：`57c3fd25c80904af39e29633c7b0076056fff5232eeb81535c38eea18aca2da8`。

```text
Use case: photorealistic-natural
Asset type: production textile macro photograph for the approved cinematic fashion landing design.
Primary request: Generate a new original tactile macro photograph of sage woven linen folds matching the provided approved crop. The reference is composition and texture guidance only, never shipping pixels. Preserve its flowing mounds, diagonal folds, scale, perspective and muted sage/olive palette.
Input image: material-photo.png is the approved crop reference.
Subject/material: coarse natural sage linen with individually credible crossing warp and weft, small fiber irregularities, soft diagonal creases and one prominent rolling fold through the middle, with further folds receding behind it. Fabric fills the complete frame.
Composition/framing: close macro photograph, approximately 2.01:1 landscape aspect, ideally 2048 by 1019 pixels or largest native resolution at this ratio. Match the reference's fold arrangement and shallow photographic depth. No surrounding table, room, tools or props.
Lighting/mood: warm soft window light rakes the weave from upper left; muted olive shadows and dusty sage highlights, natural material richness, neither glossy nor oversharpened.
Constraints: opaque edge-to-edge photograph. No text, logo, watermark, labels, UI, borders, rounded corners, margins, drop shadows, illustration, procedural-looking weave, plastic texture or synthetic sparkles.
```

## sketch-photo

- 参考：`apps/web/.impeccable/build/crops/sketch-photo.png`。
- 原生文件：`C:/Users/朱奕玮/.codex/generated_images/01a1d886-3f20-7ee0-a045-f0d74a9222f9/exec-58544fc2-a015-4c74-89b7-f5893cc4dd5e.png`。
- 最终文件：`apps/web/assets/plates/sketch-photo.png`。
- 最终 PNG SHA-256：`f1405c29dd1694ed07ec8d61f7a56e12fe9fdd5a5013032ca68214c220c6e87c`。

```text
Use case: photorealistic-natural
Asset type: production fashion process photograph for the approved cinematic fashion landing design.
Primary request: Generate a new original photograph faithfully matching the approved crop: an actual delicate graphite fashion sketch on warm ivory paper on the left, beside a dress form draped in sage cloth on the right. The supplied reference is visual guidance only, never shipping pixels. Preserve its composition, perspective, calm palette, natural light and material detail.
Input image: sketch-photo.png is the approved crop reference.
Scene/subjects: left 42% contains a thin pencil drawing of a long, belted wrap garment with relaxed wide sleeves on a lightly indicated female fashion figure; graphite lines are precise, subtle and visibly on paper. Right 58% contains an ivory linen dressmaker's torso on a stand with a warm wooden neck cap; softly gathered sage fabric forms an asymmetric one-shoulder draped gown with long fluid folds and a small shoulder fastening, following the reference. The cloth continues beyond the lower frame.
Composition/framing: approximately 1.573:1 landscape, ideally 1887 by 1200 pixels or the largest native resolution at this ratio. Sketch fully legible at left and dress form closer and larger at right; the dress form neck cap is near the top of frame. Warm ivory paper and studio background blend gently without a hard panel division. No unrelated props or table.
Lighting/mood: soft warm natural studio light, natural linen and pencil texture, quiet design atelier documentary photograph, restrained contrast.
Constraints: opaque image, clean edge to edge. No words, sketch annotations, numbers, labels, logos, watermark, interface chrome, borders, rounded corners, drop shadows or artificial page margins. The pencil illustration exists only as the actual drawing on paper at left; the overall plate must be a realistic photograph, not a digital illustration.
```

## collection-photo

- 参考：`apps/web/.impeccable/build/crops/collection-photo.png`。
- 原生文件：`C:/Users/朱奕玮/.codex/generated_images/01a1d886-3f20-7ee0-a045-f0d74a9222f9/exec-8b653ebc-b609-4f5d-96ef-a1fbde4b3811.png`。
- 最终文件：`apps/web/assets/plates/collection-photo.png`。
- 最终 PNG SHA-256：`127af02ec885a9583519cd1e464b5312d53ee6b2ba13c14668283d82a222e3ab`。

```text
Use case: photorealistic-natural
Asset type: production three-look fashion collection photograph for the approved cinematic fashion landing design.
Primary request: Generate a new original editorial photograph continuing the approved cropped collection reference to show three complete coordinated looks. Preserve the garments, styling, cast mood, sage–ivory–charcoal palette, warm studio light and equal-width ordering of the reference. The reference guides appearance only, never shipping pixels.
Input image: collection-photo.png is the approved crop reference. Extend its cropped garments naturally downward so all three outfits are complete.
Scene/backdrop: one calm warm taupe/ivory studio setting and floor, soft natural side light, no props, no visible graphic borders or contact-sheet gutters.
Subjects: exactly three separate adult East Asian female editorial models with natural skin detail and loosely tied dark hair. Model 1 at one sixth of frame width wears the ivory sculptural oversized wrap coat with exaggerated folded lapels, curved sleeves and self belt; relaxed three-quarter frontal pose and one hand in a pocket, complete mid-calf coat hem. Model 2 at half frame width wears the sage draped long dress with gathered waist, generous fluid sleeves and long flowing skirt; quiet three-quarter side pose similar to the reference. Model 3 at five sixths of frame width wears charcoal oversized tailoring, a sculptural double-breasted jacket and complete flowing tailored trousers over a dark high neckline; hands rest naturally in pockets, three-quarter pose similar to the reference. Maintain clear distinct silhouettes and visible separation.
Composition/framing: approximately 2.39:1 landscape, ideally 3072 by 1285 pixels or largest available native resolution at this ratio. The three figures occupy equal-width thirds with their centers at 16.7%, 50% and 83.3%. Frame head to shoes or complete near-full length, with all garment hems and trouser legs visible, a little breathing room above heads and below hems, and similar scale for all three. Preserve their approved left-to-right order. Root may use the full sequence or focus on each third, so keep each complete outfit centered within its own third. Do not overlap or merge people or garments.
Lighting/mood: sophisticated restrained fashion editorial photograph with natural warm side light, tactile ivory and sage woven material, matte charcoal fabric, soft studio shadows and subtle depth.
Constraints: opaque, edge-to-edge photographic image. Exactly three adult models. Anatomically credible independent limbs and hands; fingers may rest naturally inside pockets. No text, labels, logo, watermarks, UI, borders, visible panel dividers, rounded corners, margins, drop shadows, collaged cutout edges, duplicated anatomy, merged bodies, illustration or CGI.
```


