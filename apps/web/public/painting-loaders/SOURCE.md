# 绘画等待素材

来源：https://github.com/Aleksksa/painting-loaders

选用场景：abstraction-dusk、impressionism-willow、impressionism-irises。
提供的本地源码使用 p5 2.3.3、p5.brush 2.2.2。
应用仅使用预渲染媒体，运行时不加载这两个绘画库。

从本地源码重新制作：

    node scripts/render-painting-loaders.mjs <source-directory>

视频规格：480×480、24fps、10 秒、固定原作种子、无音轨。
WebP 封面来自提供的原作静帧；WebM/MP4 逐帧录制原引擎的增量绘画过程。

复用条件：审查时源码根目录未提供明确 LICENSE；确认条件前，生产环境保持关闭。
`NEXT_PUBLIC_PAINTING_LOADERS=false` 可关闭全部画作与媒体请求。
开发环境默认启用；生产环境默认关闭，确认复用条件后才显式设置 `true` 并重新构建。
该开关仅控制装饰媒体，不影响任务状态、错误与恢复操作。
