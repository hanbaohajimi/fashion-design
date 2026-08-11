/**
 * 连接器实现验证脚本
 *
 * 在浏览器控制台运行此脚本以验证所有修复已正确应用
 *
 * 使用方法：
 * 1. 打开 http://localhost:3000
 * 2. 进入任意项目画布
 * 3. 打开浏览器开发者工具（F12）
 * 4. 复制粘贴此脚本到控制台并执行
 */

console.log('🔍 开始验证连接器实现...\n');

const checks = [];

// 检查 1: AnchorOverlay 是否渲染
const overlay = document.querySelector('[class*="anchorOverlay"]');
checks.push({
  name: 'AnchorOverlay 组件渲染',
  passed: !!overlay,
  details: overlay ? '✓ 找到组件' : '✗ 未找到组件'
});

// 检查 2: SVG 容器及 transform
if (overlay) {
  const svg = overlay.querySelector('svg');
  if (svg) {
    const transform = svg.style.transform;
    const hasTranslate = transform && transform.includes('translate');
    const hasScale = transform && transform.includes('scale');
    const transformOrigin = svg.style.transformOrigin;

    checks.push({
      name: 'SVG camera transform',
      passed: hasTranslate && hasScale,
      details: hasTranslate && hasScale
        ? `✓ Transform: ${transform.substring(0, 50)}...`
        : `✗ Transform 不正确: ${transform}`
    });

    checks.push({
      name: 'SVG transformOrigin',
      passed: transformOrigin === '0 0' || transformOrigin === '0px 0px',
      details: transformOrigin === '0 0' || transformOrigin === '0px 0px'
        ? '✓ 设置为 "0 0"'
        : `✗ 值为 "${transformOrigin}"`
    });
  } else {
    checks.push({
      name: 'SVG 容器',
      passed: false,
      details: '✗ SVG 未找到'
    });
  }
}

// 检查 3: 连接器工具按钮
const connectorBtn = document.querySelector('button[aria-label*="连接器"]');
checks.push({
  name: '连接器工具按钮',
  passed: !!connectorBtn,
  details: connectorBtn ? '✓ 按钮存在' : '✗ 按钮未找到'
});

// 检查 4: Tldraw 画布
const canvas = document.querySelector('.tl-canvas');
checks.push({
  name: 'Tldraw 画布',
  passed: !!canvas,
  details: canvas ? '✓ 画布已加载' : '✗ 画布未找到'
});

// 检查 5: CSS 样式
let anchorPointStyleFound = false;
let pointerEventsCorrect = false;

try {
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && rule.selectorText.includes('anchorPoint')) {
          anchorPointStyleFound = true;
          if (rule.style.pointerEvents === 'none') {
            pointerEventsCorrect = true;
          }
        }
      }
    } catch (e) {
      // CORS 限制，跳过
    }
  }
} catch (e) {
  console.warn('无法检查样式表（CORS）');
}

checks.push({
  name: 'CSS .anchorPoint 样式',
  passed: anchorPointStyleFound,
  details: anchorPointStyleFound ? '✓ 样式已加载' : '✗ 样式未找到'
});

checks.push({
  name: 'CSS pointer-events: none',
  passed: pointerEventsCorrect,
  details: pointerEventsCorrect ? '✓ 锚点不会拦截画布事件' : '⚠ 无法验证（可能因 CORS）'
});

// 输出结果
console.log('\n📊 验证结果:\n');
checks.forEach(check => {
  const icon = check.passed ? '✅' : '❌';
  console.log(`${icon} ${check.name}`);
  console.log(`   ${check.details}`);
});

const passed = checks.filter(c => c.passed).length;
const total = checks.length;
const passRate = ((passed / total) * 100).toFixed(0);

console.log('\n' + '='.repeat(50));
console.log(`总计: ${passed}/${total} 通过 (${passRate}%)`);

if (passed === total) {
  console.log('\n✅ 所有检查通过！连接器功能已正确实现。\n');
  console.log('📝 下一步：');
  console.log('1. 点击工具栏的连接器按钮（两个圆点连线图标）');
  console.log('2. 观察画布上元素的锚点（蓝色圆点）');
  console.log('3. 先点击源元素锚点，再点击目标元素锚点');
  console.log('4. 验证连接线创建成功');
  console.log('5. 缩放/平移画布，验证锚点不跳动');
} else {
  console.log('\n⚠️ 部分检查未通过。');
  console.log('可能原因：画布尚未加载完成，请等待几秒后重新运行此脚本。');
}

console.log('\n详细测试步骤请查看:');
console.log('apps/web/src/modules/board/connectors/connector-manual-test.md');
