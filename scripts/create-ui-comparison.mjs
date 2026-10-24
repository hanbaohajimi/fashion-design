import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// 将已捕获的真实页面并排展示；不处理、重绘或补造作品素材。
const directory = resolve(import.meta.dirname, "../output/neutral-refactor");
const files = readdirSync(resolve(directory, "before"))
  .filter(
    (file) =>
      file.endsWith(".png") && existsSync(resolve(directory, "after", file)),
  )
  .sort();
const options = files
  .map((file) => `<option value="${file}">${file.replace(".png", "")}</option>`)
  .join("");
writeFileSync(
  resolve(directory, "comparison.html"),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Atelier 重构前后对照</title><style>body{margin:0;background:#f5f5f5;color:#181818;font:14px/1.6 system-ui}header{padding:16px 24px;background:white;border-bottom:1px solid #18181829;display:flex;align-items:center;gap:16px;flex-wrap:wrap}h1{font-size:20px;margin:0}select,button{font:inherit;min-height:36px}main{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px}section{min-width:0}h2{font-size:14px;margin:0 0 8px}.pane{height:calc(100vh - 180px);overflow:auto;background:white;border:1px solid #18181829}img{display:block;width:100%}.actual img{width:auto}.gray img{filter:grayscale(1)}@media(max-width:800px){main{grid-template-columns:1fr}.pane{height:70vh}}</style><header><h1>Atelier 界面重构前后对照</h1><select aria-label="选择页面">${options}</select><label><input id="gray" type="checkbox">去色检查</label><label><input id="actual" type="checkbox">实际像素</label><span>同一组 API fixtures · 本地渲染</span></header><main><section><h2>重构前 · <a id="beforeLink" target="_blank">打开原图</a></h2><div class="pane"><img id="before" alt="重构前截图"></div></section><section><h2>重构后 · <a id="afterLink" target="_blank">打开原图</a></h2><div class="pane"><img id="after" alt="重构后截图"></div></section></main><script>const picker=document.querySelector('select');function render(){for(const side of ['before','after']){const url=side+'/'+picker.value;document.getElementById(side).src=url;document.getElementById(side+'Link').href=url}document.title='Atelier · '+picker.value}picker.addEventListener('change',render);for(const id of ['gray','actual'])document.getElementById(id).addEventListener('change',e=>document.body.classList.toggle(id,e.target.checked));picker.value='studio-tasks-1280.png';render();</script></html>`,
);
console.log(
  `已建立 ${files.length} 组对照：${resolve(directory, "comparison.html")}`,
);
