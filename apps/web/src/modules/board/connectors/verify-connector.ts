/**
 * 连接器功能验证脚本
 *
 * 在浏览器控制台运行此脚本来验证连接器的核心功能
 *
 * 使用方法：
 * 1. 打开浏览器开发者工具
 * 2. 进入画布页面
 * 3. 在控制台粘贴并运行此脚本
 */

export function verifyConnectorImplementation() {
  console.log("🔍 开始验证连接器实现...\n");

  const results = {
    passed: [] as string[],
    failed: [] as string[],
  };

  // 检查1: AnchorOverlay 组件是否渲染
  const anchorOverlay = document.querySelector('.anchorOverlay');
  if (anchorOverlay) {
    results.passed.push("✅ AnchorOverlay 组件已渲染");
  } else {
    results.failed.push("❌ AnchorOverlay 组件未找到");
  }

  // 检查2: SVG 容器是否存在
  const anchorSvg = anchorOverlay?.querySelector('svg');
  if (anchorSvg) {
    results.passed.push("✅ 锚点 SVG 容器存在");

    // 检查3: SVG transform 是否应用
    const transform = anchorSvg.style.transform;
    if (transform && transform.includes('translate') && transform.includes('scale')) {
      results.passed.push("✅ SVG camera transform 已正确应用");
      console.log(`   Transform: ${transform}`);
    } else {
      results.failed.push("❌ SVG camera transform 缺失或不正确");
    }

    // 检查4: transformOrigin 是否设置
    const transformOrigin = anchorSvg.style.transformOrigin;
    if (transformOrigin === "0 0" || transformOrigin === "0px 0px") {
      results.passed.push("✅ SVG transformOrigin 正确设置为 '0 0'");
    } else {
      results.failed.push(`❌ SVG transformOrigin 不正确: ${transformOrigin}`);
    }
  } else {
    results.failed.push("❌ 锚点 SVG 容器未找到");
  }

  // 检查5: 连接器工具按钮是否存在
  const connectorButton = document.querySelector('button[aria-label="连接器工具"]');
  if (connectorButton) {
    results.passed.push("✅ 连接器工具按钮存在");
  } else {
    results.failed.push("❌ 连接器工具按钮未找到");
  }

  // 检查6: CSS 样式是否正确加载
  const styleSheets = Array.from(document.styleSheets);
  let anchorPointStyleFound = false;
  let pointerEventsFound = false;

  try {
    for (const sheet of styleSheets) {
      if (!sheet.cssRules) continue;
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText?.includes('anchorPoint')) {
          anchorPointStyleFound = true;
          const style = rule.style;
          if (style.pointerEvents === 'all') {
            pointerEventsFound = true;
          }
        }
      }
    }
  } catch {
    console.warn("⚠️ 无法检查 CSS 规则（可能是 CORS 限制）");
  }

  if (anchorPointStyleFound) {
    results.passed.push("✅ .anchorPoint CSS 样式已加载");
  } else {
    results.failed.push("❌ .anchorPoint CSS 样式未找到");
  }

  if (pointerEventsFound) {
    results.passed.push("✅ .anchorPoint pointer-events: all 已设置");
  } else {
    results.failed.push("❌ .anchorPoint pointer-events 未正确设置");
  }

  // 检查7: ConnectorShape 类型是否注册
  const canvas = document.querySelector('.tl-canvas');
  if (canvas) {
    results.passed.push("✅ Tldraw 画布已加载");
  } else {
    results.failed.push("❌ Tldraw 画布未找到");
  }

  // 输出结果
  console.log("\n📊 验证结果:");
  console.log("\n通过的检查:");
  results.passed.forEach(item => console.log(item));

  if (results.failed.length > 0) {
    console.log("\n❌ 失败的检查:");
    results.failed.forEach(item => console.log(item));
  }

  const total = results.passed.length + results.failed.length;
  const passRate = ((results.passed.length / total) * 100).toFixed(1);

  console.log(`\n总计: ${results.passed.length}/${total} 通过 (${passRate}%)`);

  if (results.failed.length === 0) {
    console.log("\n✅ 所有核心功能验证通过！");
    return true;
  } else {
    console.log("\n⚠️ 部分检查未通过，请检查上述失败项");
    return false;
  }
}

// 自动执行验证
if (typeof window !== 'undefined') {
  // 等待 DOM 加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => verifyConnectorImplementation(), 1000);
    });
  } else {
    setTimeout(() => verifyConnectorImplementation(), 1000);
  }
}
