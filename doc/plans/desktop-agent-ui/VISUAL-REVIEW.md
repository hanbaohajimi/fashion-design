# 视觉候选逐项复核

2026-10-27：固定Linux Chromium与Noto CJK环境，69个场景生成74张候选。复核拼图sheet-1至sheet-9，另放大检查默认作品工作台和390px技术包。下表每项经复核后才提升为仓库基线；未执行无审查的全量update-snapshots。完整哈希在output/desktop-agent-ui/visual-review-final/approved.json。

| 文件 | 变更 | 复核依据 |
| --- | --- | --- |
| atelier.spec.ts/asset-history-empty.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；桌面根滚动槽位与文档页面一致，弹层及完整图可达 |
| atelier.spec.ts/asset-picker-1440.png | 更新 | 浮层焦点与完整素材；hairline及四档字号；边界无裁切 |
| atelier.spec.ts/asset-picker-375.png | 更新 | 浮层焦点与完整素材；hairline及四档字号；边界无裁切 |
| atelier.spec.ts/asset-preview.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；桌面根滚动槽位与文档页面一致，弹层及完整图可达 |
| atelier.spec.ts/export-ready.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；桌面根滚动槽位与文档页面一致，弹层及完整图可达 |
| atelier.spec.ts/fabrics-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/fabrics-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/invalid-link-1440.png | 更新 | 访客页面保留完整图片或错误恢复；统一文案与边界；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/invalid-link-390.png | 更新 | 访客页面保留完整图片或错误恢复；统一文案与边界 |
| atelier.spec.ts/login-1440.png | 更新 | 登录独立四档字号；品牌完整；窄屏与错误/发送态可读，无装饰彩条；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/login-390.png | 更新 | 登录独立四档字号；品牌完整；窄屏与错误/发送态可读，无装饰彩条 |
| atelier.spec.ts/projects-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/projects-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/projects-empty.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/projects-error.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/share-1440.png | 更新 | 访客页面保留完整图片或错误恢复；统一文案与边界；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/share-390.png | 更新 | 访客页面保留完整图片或错误恢复；统一文案与边界 |
| atelier.spec.ts/share-expired-1440.png | 更新 | 访客页面保留完整图片或错误恢复；统一文案与边界；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/share-expired-375.png | 更新 | 访客页面保留完整图片或错误恢复；统一文案与边界 |
| atelier.spec.ts/sketch.png | 更新 | 浮层焦点与完整素材；hairline及四档字号；边界无裁切；桌面根滚动槽位与文档页面一致，弹层及完整图可达 |
| atelier.spec.ts/studio-assistant-touch.png | 更新 | 助手/画布独立滚动与轻量状态；无彩条，正文与操作可达 |
| atelier.spec.ts/studio-desktop.png | 更新 | 助手/画布独立滚动与轻量状态；无彩条，正文与操作可达；桌面根滚动槽位与文档页面一致，弹层及完整图可达 |
| atelier.spec.ts/studio-menu-touch.png | 更新 | 助手/画布独立滚动与轻量状态；无彩条，正文与操作可达 |
| atelier.spec.ts/trend-destination.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/trends-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/trends-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-brand-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-brand-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-brand-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-experiment-request-failure.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-experiments-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-experiments-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-experiments-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-experiments-readonly.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-patterns-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-patterns-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-patterns-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-planning-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；补充复核：当前功能居中定位，页面内容与操作保持；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-planning-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；补充复核：当前功能居中定位，页面内容与操作保持；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-planning-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-presentation-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-presentation-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-presentation-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-runway-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-runway-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-runway-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-samples-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-samples-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-samples-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-style-image-failure.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-styles-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-styles-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-styles-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-task-request-failure.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-tasks-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-tasks-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-tasks-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-tasks-readonly.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-team-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-team-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；补充复核：当前功能居中定位，页面内容与操作保持；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-team-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-tech-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-tech-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；补充复核：当前功能居中定位，页面内容与操作保持；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-tech-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| atelier.spec.ts/workspace-tech-readonly.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；补充复核：当前功能居中定位，页面内容与操作保持 |
| atelier.spec.ts/workspace-trends-1280.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；补充复核：当前功能居中定位，页面内容与操作保持；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-trends-1440.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整；补充复核：当前功能居中定位，页面内容与操作保持；文档根滚动槽位稳定，完整图与表单可达 |
| atelier.spec.ts/workspace-trends-390.png | 更新 | 统一12/14/16/24px、hairline及账户菜单；图片保持contain，导航与资料完整 |
| forest-brand.spec.ts/forest-login-1024.png | 更新 | 登录独立四档字号；品牌完整；窄屏与错误/发送态可读，无装饰彩条；文档根滚动槽位稳定，完整图与表单可达 |
| forest-brand.spec.ts/forest-login-1440.png | 更新 | 登录独立四档字号；品牌完整；窄屏与错误/发送态可读，无装饰彩条；文档根滚动槽位稳定，完整图与表单可达 |
| forest-brand.spec.ts/forest-login-320.png | 更新 | 登录独立四档字号；品牌完整；窄屏与错误/发送态可读，无装饰彩条 |
| forest-brand.spec.ts/forest-login-390.png | 更新 | 登录独立四档字号；品牌完整；窄屏与错误/发送态可读，无装饰彩条 |
| forest-brand.spec.ts/forest-login-network-error-320.png | 更新 | 登录独立四档字号；品牌完整；窄屏与错误/发送态可读，无装饰彩条 |
| forest-brand.spec.ts/forest-login-sent-320.png | 更新 | 登录独立四档字号；品牌完整；窄屏与错误/发送态可读，无装饰彩条 |

补充复核：目录按字体和容器变化稳定居中后，重新采集69个场景，7张仅目录位置变化的候选经visual-navigation-review/sheet-1和sheet-2逐项确认后更新。其余67张哈希保持；不以更新快照代替行为修复。

文档滚动槽位补充：38张桌面候选经visual-gutter-review/sheet-1至sheet-7逐项检查后更新。随后将≥768px的根滚动槽位统一到视口工作区，避免页面切换时导航横移；新增5张候选经visual-viewport-gutter-review/sheet-1至sheet-2复核后提升。手机不预留根滚动槽位；没有改动用户图像裁切规则。
