import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { values } = parseArgs({ options: { sdk: { type: "string", default: "output/live2d-proof-20261105/sdk/CubismSdkForWeb-5-r.5" }, port: { type: "string", default: "4189" }, runtime: { type: "string", default: "output/forest-spirit-runtime" } } });
const roots = {
  runtime: path.resolve(repo, values.runtime),
  sample: path.resolve(repo, values.sdk, "Samples/Resources/Haru"),
  sprout: path.join(repo, "output/live2d-proof-20261105/model"),
};
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>官方 Haru 隔离技术诊断 · 非森林精灵</title>
<style>body{font:16px system-ui;background:#f3f1e8;color:#253f35;padding:24px}canvas{width:360px;height:480px;background:#fff;border:1px solid #bfc8b8}p{max-width:850px}button{margin:6px;padding:10px}strong{color:#8b371d}pre{white-space:pre-wrap}</style>
<h1>官方 Haru 隔离技术诊断</h1><p><strong>不是森林精灵，不是用户角色交付。</strong>使用 SDK 原始 Haru 模型、原始动作和物理文件；动作映射只测试四个播放器通道，不代表悬停、拖动、放下动作已经制作。此页不加载正式角色审核清单，不接入聊天或产品。</p>
<canvas id="model" width="360" height="480"></canvas><p id="status">加载真实 Core / Framework / moc3 中…</p>
<button id="hover">通道 hover_greet：原版 haru_g_m15</button><button id="drag">通道 drag_hold：原版 haru_g_m26</button><button id="down">通道 put_down：原版 haru_g_m06</button>
<script src="/runtime/live2dcubismcore.min.js"></script><script type="module">
import {createCubismRenderer,sdkVersion} from '/runtime/forest-spirit-runtime.js';
const canvas=document.querySelector('#model'), errors=[];
window.addEventListener('error',e=>errors.push(e.message));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
canvas.addEventListener('forest-spirit-error',e=>errors.push(e.detail));
const asset={model3Url:'/sample/Haru.model3.json',motions:{idle:'/sample/motions/haru_g_idle.motion3.json',hover_greet:'/sample/motions/haru_g_m15.motion3.json',drag_hold:'/sample/motions/haru_g_m26.motion3.json',put_down:'/sample/motions/haru_g_m06.motion3.json'}};
const renderer=createCubismRenderer(canvas);
function snapshot(){const model=renderer.user?.getModel();return {label:'Official Haru sample ONLY - not approved forest spirit',sdkVersion,ready:renderer.ready,disposed:renderer.disposed,paused:renderer.paused,reduced:renderer.reduced,current:renderer.current,raf:renderer.raf,lastFrame:renderer.lastFrame,textureCount:renderer.textures.length,drawableCount:model?.getDrawableCount(),parameters:model?Object.fromEntries(Array.from({length:model.getParameterCount()},(_,i)=>[model.getParameterId(i).getString(),model.getParameterValueByIndex(i)])):null,glError:renderer.gl?.getError(),errors:[...errors]};}
window.tech={renderer,asset,createCubismRenderer,snapshot,ready:false};
try{renderer.resize(360,480,devicePixelRatio);await renderer.load(asset,new AbortController().signal);renderer.resume();await renderer.play('idle');window.tech.ready=true;document.querySelector('#status').textContent='真实模型/纹理/动作/物理已载入。仅技术验证，不是正式角色验收。';}catch(error){errors.push(String(error));document.querySelector('#status').textContent=String(error);}
for(const [id,motion] of [['hover','hover_greet'],['drag','drag_hold'],['down','put_down']])document.querySelector('#'+id).onclick=()=>renderer.play(motion,{interrupt:true});
</script></html>`;
const types = { ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".vert": "text/plain", ".frag": "text/plain" };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" }); response.end(html); return; }
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    const root = roots[parts.shift()];
    if (!root) { response.writeHead(404); response.end(); return; }
    const filename = path.resolve(root, ...parts);
    if (!filename.startsWith(root + path.sep)) throw new Error("Invalid path");
    const bytes = await readFile(filename);
    response.writeHead(200, { "Content-Type": types[path.extname(filename)] ?? "application/octet-stream", "Cache-Control": "no-store" }); response.end(bytes);
  } catch { response.writeHead(404); response.end("Missing diagnostic resource"); }
});
server.listen(Number(values.port), "127.0.0.1", () => console.log(`Local-only diagnostic: http://127.0.0.1:${values.port} (official Haru sample, NOT forest spirit)`));
