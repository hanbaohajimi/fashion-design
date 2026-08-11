# 多选元素生成图片参考修复

## 问题描述

当用户在画布中选择多个元素（比如3个fabric + 1个style）进行生成新图片时，系统只参考了其中一张图片进行生成，其他选中的图片被忽略了。

## 问题根因

在 `apps/api/src/modules/generation/generation.service.ts` 中，当处理 t2i（文生图）任务时，代码只使用了每种类型参考图片数组的第一个元素：

```typescript
// 修复前的代码
const styleReference = compiledPrompt.styleReferences?.[0];  // 只用第一个
const silhouetteReference = compiledPrompt.silhouetteReferences?.[0]?.edgeImageUrl;
const fabricReference = compiledPrompt.fabricReferences?.[0];  // 只用第一个
```

当用户选择了多个同类型的图片元素时（比如3个fabric元素），只有第一个会被用作视觉参考。

## 技术限制

由于 GPT Image 2 API 只支持单个 `referenceImageUrl` 参数，我们无法同时使用多个图片作为视觉参考。但是：

1. ✅ **编译器已经正确工作**：`ContextCompilerService` 会收集所有选中元素的图片，并将它们的语义信息（标签、属性）编译到 prompt 中
2. ✅ **语义信息已经使用**：所有选中图片的 fabricTerms、patternTerms、detailTerms 都会加入到 prompt 中
3. ❌ **视觉参考只能选一个**：API 限制，只能传递一个图片 URL 作为视觉参考

## 解决方案

实现了一个**智能选择策略**，从所有参考图片中选择最合适的一个作为视觉参考：

### 选择规则

1. **优先比较权重**：选择权重（weight）最高的图片
2. **权重相同时比较类型优先级**：style > fabric > silhouette

### 默认权重
- Style: 0.72
- Fabric: 0.70
- Silhouette: 0.55

### 代码实现

```typescript
// 收集所有参考图片及其权重
const allReferences = [];

// Style references (最高优先级)
for (const ref of compiledPrompt.styleReferences ?? []) {
  allReferences.push({
    url: ref.imageUrl,
    weight: "weight" in ref ? ref.weight : STYLE_REFERENCE_STRENGTH,
    priority: 3,
  });
}

// Fabric references (中优先级)
for (const ref of compiledPrompt.fabricReferences ?? []) {
  allReferences.push({
    url: ref.imageUrl,
    weight: "weight" in ref ? ref.weight : FABRIC_REFERENCE_STRENGTH,
    priority: 2,
  });
}

// Silhouette references (低优先级)
for (const ref of compiledPrompt.silhouetteReferences ?? []) {
  allReferences.push({
    url: ref.edgeImageUrl,
    weight: SILHOUETTE_REFERENCE_STRENGTH,
    priority: 1,
  });
}

// 选择权重最高的参考图片
if (allReferences.length > 0) {
  const selected = allReferences.reduce((best, current) => {
    // 优先比较权重
    if (current.weight > best.weight) return current;
    if (current.weight < best.weight) return best;
    // 权重相同时，比较类型优先级
    if (current.priority > best.priority) return current;
    return best;
  });

  providerRequest.referenceImageUrl = selected.url;
  providerRequest.strength = selected.weight;
}
```

## 测试场景

### 场景1：3个fabric + 1个style
- 输入：3个fabric（权重0.7）+ 1个style（权重0.72）
- 结果：选择 style（权重最高：0.72）

### 场景2：不同权重的style
- 输入：style1（权重0.5）+ style2（权重0.8）+ 1个fabric（权重0.7）
- 结果：选择 style2（权重最高：0.8）

### 场景3：只有同权重的fabric
- 输入：2个fabric（权重都是0.7）
- 结果：选择第一个fabric（权重相同，保持原有顺序）

### 场景4：所有类型都有
- 输入：1个style + 1个fabric + 1个silhouette
- 结果：选择 style（权重最高：0.72）

## 影响范围

- ✅ **向后兼容**：对于只选择一个元素的情况，行为不变
- ✅ **多选改进**：多选时会选择权重最高的图片，而不是固定选第一个
- ✅ **语义完整**：所有选中元素的语义信息仍然会编译到 prompt 中
- ⚠️ **视觉参考限制**：仍然只能使用一个图片作为视觉参考（API限制）

## 未来优化方向

1. **多图合成**：可以在服务端将多个参考图片合成为一张，传递给 AI
2. **权重调整UI**：允许用户在画布中调整每个元素的权重
3. **参考图选择提示**：在UI中明确告诉用户哪张图被选为主视觉参考
4. **多轮生成**：对于多个重要参考，可以分别生成然后让用户选择

## 验证方法

1. 在画布中选择多个图片元素（比如3个fabric）
2. 输入提示词并生成图片
3. 查看生成结果是否参考了权重最高的图片
4. 检查 Network 请求，确认 `referenceImageUrl` 指向正确的图片

## 修改文件

- `apps/api/src/modules/generation/generation.service.ts`：实现智能参考图片选择逻辑
