# 多选元素生成功能验证指南

## 验证步骤

### 准备工作
1. 启动开发服务器：`npm run dev`
2. 打开浏览器，登录系统
3. 进入画布页面

### 测试场景1：选择多个fabric元素
1. 在画布中添加3个不同的 fabric 元素
2. 全选这3个 fabric 元素（按住 Shift 点击或框选）
3. 输入提示词："设计一件连衣裙"
4. 点击生成按钮
5. **预期结果**：生成的图片应该参考了其中一个 fabric 的视觉特征

### 测试场景2：选择fabric + style混合
1. 在画布中添加2个 fabric 元素 + 1个 style 元素
2. 全选这3个元素
3. 输入提示词："设计一件外套"
4. 点击生成按钮
5. **预期结果**：
   - 生成的图片应该参考了 style 元素的视觉特征（因为 style 权重0.72高于fabric的0.7）
   - 生成结果应该融合了所有元素的语义信息

### 测试场景3：只选择一个元素（对照组）
1. 只选择1个 fabric 元素
2. 输入提示词："设计一件衬衫"
3. 点击生成按钮
4. **预期结果**：功能应该和之前一样正常工作

## 如何验证选择了正确的参考图片

### 方法1：查看Network请求
1. 打开浏览器开发者工具（F12）
2. 切换到 Network 标签
3. 执行生成操作
4. 找到创建生成任务的 POST 请求（通常是 `/api/generation` 或类似路径）
5. 查看请求的 Payload/Body
6. 检查 `shapeIds` 字段：应该包含所有选中元素的ID
7. 在后端日志中，可以查看最终选择的 `referenceImageUrl`

### 方法2：对比生成结果
1. 记住选中的多个元素的视觉特征（颜色、纹理、风格）
2. 查看生成的图片
3. 判断生成结果是否融合了这些视觉特征
4. 特别关注：应该能看到权重最高的那个元素的特征最明显

### 方法3：查看后端日志
1. 在后端添加日志输出（如果需要）：
```typescript
console.log('Selected reference:', {
  url: selected.url,
  weight: selected.weight,
  priority: selected.priority,
  total: allReferences.length
});
```
2. 查看控制台输出，确认选择了正确的参考图片

## 预期行为总结

| 场景 | 选中元素 | 预期使用的参考 |
|------|----------|----------------|
| 多个相同类型 | 3个fabric（权重都是0.7） | 第一个fabric |
| 混合类型 | 2个fabric(0.7) + 1个style(0.72) | style（权重最高） |
| 自定义权重 | fabric(weight=0.9) + style(0.72) | fabric（自定义权重最高） |
| 单个元素 | 1个fabric | 该fabric |

## 问题排查

### 如果生成结果没有反映任何参考图片
1. 检查元素的 `fileAsset` 是否已上传完成
2. 检查 S3 签名 URL 是否正确生成
3. 检查 AI provider 是否正确接收了 `referenceImageUrl`

### 如果选择了错误的参考图片
1. 检查元素的 `role` 字段是否正确（fabric_ref, style_ref, silhouette_ref）
2. 检查元素的 `weight` 字段值
3. 查看 `CompiledGenInput` 中的 references 数组

### 如果只选中了一个元素却没有使用
1. 检查 `ContextCompilerService` 的 `compile` 方法是否正确处理了 `shapeIds`
2. 检查数据库中 `boardElements` 表中该元素的状态

## 成功标准

✅ 多选元素时，生成任务创建成功
✅ 生成结果融合了所有选中元素的语义信息
✅ 视觉参考使用了权重最高的元素
✅ 单选元素时行为保持不变
✅ 没有出现任何错误或异常
