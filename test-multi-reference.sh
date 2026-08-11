#!/bin/bash
# 多选元素生成功能端到端测试脚本

echo "==================================="
echo "多选元素生成功能验证脚本"
echo "==================================="
echo ""

# 1. 启动开发服务器
echo "步骤 1: 启动开发服务器"
echo "请在另一个终端运行: npm run dev"
echo ""
read -p "服务器已启动? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    exit 1
fi

# 2. 打开浏览器
echo ""
echo "步骤 2: 测试场景"
echo "-----------------------------------"
echo ""

echo "场景 1: 选择多个 fabric 元素"
echo "  1) 在画布中添加 3 个不同的 fabric 元素"
echo "  2) 框选或按住 Shift 点击选中所有 3 个元素"
echo "  3) 输入提示词: '设计一件连衣裙'"
echo "  4) 点击生成按钮"
echo "  5) 打开浏览器开发者工具 > Network 标签"
echo "  6) 查看生成请求的 payload，检查 shapeIds 是否包含所有 3 个元素"
echo ""
read -p "场景 1 完成? (y/n) " -n 1 -r
echo ""

echo ""
echo "场景 2: 选择混合类型元素 (fabric + style)"
echo "  1) 在画布中添加 2 个 fabric + 1 个 style 元素"
echo "  2) 选中所有 3 个元素"
echo "  3) 输入提示词: '设计一件外套'"
echo "  4) 点击生成按钮"
echo "  5) 查看生成结果，应该融合了 style 的视觉特征（因为权重更高）"
echo ""
read -p "场景 2 完成? (y/n) " -n 1 -r
echo ""

echo ""
echo "场景 3: 单个元素（对照组）"
echo "  1) 只选择 1 个 fabric 元素"
echo "  2) 输入提示词: '设计一件衬衫'"
echo "  3) 点击生成按钮"
echo "  4) 确认功能正常，没有任何错误"
echo ""
read -p "场景 3 完成? (y/n) " -n 1 -r
echo ""

echo ""
echo "==================================="
echo "✅ 所有测试场景已完成"
echo "==================================="
echo ""
echo "如果所有场景都正常工作，说明修复成功！"
echo ""
echo "预期结果总结:"
echo "  - 多选元素时，所有元素都参与语义编译"
echo "  - 视觉参考使用权重最高的元素"
echo "  - 单选时行为保持不变"
echo "  - 没有任何错误或异常"
