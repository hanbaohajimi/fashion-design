/**
 * 锚点跳动修复验证脚本
 *
 * 在浏览器控制台运行此脚本来验证所有修复已正确应用
 */

console.log('🔍 验证锚点跳动修复...\n');

const results = [];

// 检查1: SVG transform 使用 translate3d
const svg = document.querySelector('.anchorOverlay svg');
if (svg) {
  const transform = svg.style.transform;
  const usesTranslate3d = transform && transform.includes('translate3d');
  results.push({
    name: 'SVG 使用 translate3d（GPU 加速）',
    passed: usesTranslate3d,
    details: usesTranslate3d
      ? `✓ Transform: ${transform.substring(0, 60)}...`
      : `✗ Transform 应该使用 translate3d: ${transform}`
  });
} else {
  results.push({
    name: 'SVG 容器',
    passed: false,
    details: '✗ 未找到 .anchorOverlay svg（可能尚未进入连接器模式）'
  });
}

// 检查2: CSS transition 不包含位置属性
let transitionCorrect = false;
try {
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && rule.selectorText.includes('anchorPoint')) {
          const transition = rule.style.transition;
          // transition 应该只包含 fill 和 transform，不应该是 "all"
          if (transition && !transition.includes('all')) {
            transitionCorrect = true;
          }
        }
      }
    } catch (e) {
      // CORS 限制
    }
  }
} catch (e) {
  console.warn('无法检查样式表（CORS）');
}

results.push({
  name: 'CSS transition 不使用 "all"',
  passed: transitionCorrect,
  details: transitionCorrect
    ? '✓ transition 只动画视觉效果，不动画位置'
    : '⚠ 无法验证（可能因 CORS 限制）'
});

// 检查3: will-change 属性
let willChangeFound = false;
try {
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && (rule.selectorText.includes('anchorPoint') || rule.selectorText.includes('anchorOverlay'))) {
          if (rule.style.willChange && rule.style.willChange.includes('transform')) {
            willChangeFound = true;
          }
        }
      }
    } catch (e) {
      // CORS
    }
  }
} catch (e) {
  console.warn('无法检查 will-change');
}

results.push({
  name: 'will-change: transform（性能优化）',
  passed: willChangeFound,
  details: willChangeFound
    ? '✓ 已设置 will-change 提示浏览器优化'
    : '⚠ 无法验证（可能因 CORS 限制）'
});

// 检查4: 锚点存在且可点击
const anchors = document.querySelectorAll('.anchorPoint');
const hasAnchors = anchors.length > 0;
results.push({
  name: '锚点渲染',
  passed: hasAnchors,
  details: hasAnchors
    ? `✓ 找到 ${anchors.length} 个锚点`
    : '✗ 未找到锚点（请先激活连接器工具）'
});

if (hasAnchors) {
  const firstAnchor = anchors[0];
  const pointerEvents = window.getComputedStyle(firstAnchor).pointerEvents;
  results.push({
    name: '锚点可点击（pointer-events）',
    passed: pointerEvents === 'all',
    details: pointerEvents === 'all'
      ? '✓ pointer-events: all'
      : `✗ pointer-events: ${pointerEvents}`
  });
}

// 输出结果
console.log('\n📊 验证结果:\n');
results.forEach(r => {
  const icon = r.passed ? '✅' : '❌';
  console.log(`${icon} ${r.name}`);
  console.log(`   ${r.details}`);
});

const passed = results.filter(r => r.passed).length;
const total = results.length;
const passRate = ((passed / total) * 100).toFixed(0);

console.log('\n' + '='.repeat(60));
console.log(`总计: ${passed}/${total} 通过 (${passRate}%)`);

if (passed >= total * 0.8) {
  console.log('\n✅ 核心修复已应用！\n');
  console.log('📝 手动测试步骤：');
  console.log('1. 激活连接器工具（如果尚未激活）');
  console.log('2. 点击画布上任意元素的锚点（蓝色圆点）');
  console.log('3. 观察：锚点应该立即响应，不应该跳动或闪烁');
  console.log('4. 缩放画布（Ctrl + 滚轮）');
  console.log('5. 再次点击锚点，验证在不同缩放级别下都准确响应');
  console.log('\n如果仍有跳动，请提供：');
  console.log('- 具体的跳动表现（方向、距离、频率）');
  console.log('- 当前缩放级别');
  console.log('- 浏览器控制台的错误信息');
} else {
  console.log('\n⚠️ 部分检查未通过');
  console.log('可能原因：');
  console.log('- 画布尚未加载完成');
  console.log('- 未激活连接器工具');
  console.log('- CORS 限制无法检查某些样式');
  console.log('\n建议：等待几秒后重新运行此脚本');
}

console.log('\n详细修复说明请查看：');
console.log('apps/web/src/modules/board/connectors/ANCHOR-JUMP-FIX.md');
