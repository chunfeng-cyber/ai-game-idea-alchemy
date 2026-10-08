# 素材清单与授权边界

更新日期：2026-10-08。本清单覆盖随源码分发的公共图像文件及 `public/alchemy-art-assets.js` 内嵌图像。

项目代码采用 [MIT License](LICENSE)。项目所有者于2026-10-08明确确认“可以商用，确认没问题，新公开库”，授权本清单所列界面图片与图集随新公开源码分发、修改及商用，按项目MIT许可提供。该授权依据所有者的明确声明；原始作者/生成服务记录没有因此补造。第三方图标与依赖继续按其原许可分发，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 独立公共图像文件

“既有项目素材”表示文件在此前项目中已经存在，当前文件与仓库文档未提供可核实的完整原始作者/生成服务/许可记录，不是对其来源的推测。

| 文件 | 尺寸 | 用途/当前证据 | 授权状态 |
| --- | --- | --- | --- |
| `public/app-icon-1024.png` | 1024×1024 | 既有应用图标素材；未找到该文件的原始许可记录 | 所有者已确认，MIT |
| `public/og.png` | 1731×909 | 社交分享图；`worker/index.ts` 引用 | 所有者已确认，MIT |
| `public/gameplay.jpg` | 480×853 | 既有玩法示例图；与 HTML 的玩法图 base64 完全同一字节内容 | 所有者已确认，MIT |
| `public/report-icons.jpg` | 900×600 | 既有报告图标图集；与 HTML 的报告图集 base64 完全同一字节内容 | 所有者已确认，MIT |
| `public/trend-icons-2026-08-20-v1.png` | 1983×793 | 既有热点图标图集；保留的历史静态资产，不代表实时热榜数据 | 所有者已确认，MIT |
| `public/favicon.svg` | 24×24 | 既有应用 favicon；文件无作者/许可声明 | 所有者已确认，MIT |
| `public/file.svg` | 16×16 | 既有脚手架图标；当前文件无作者/许可声明，未据相似造型认定具体上游 | 所有者已确认，MIT |
| `public/globe.svg` | 16×16 | 同上 | 所有者已确认，MIT |
| `public/window.svg` | 16×16 | 同上 | 所有者已确认，MIT |

## 脚本内嵌位图

这些图集随 `public/alchemy-art-assets.js` 分发，MCP 内联同一脚本；不复制 `public/generated/` 或私人 Docs 图片。以下SHA256用于识别具体内容；包括分类标签位图在内的许可均依据上方所有者授权声明。

| HTML 标识 | 尺寸 | SHA256 前 16 位 | 来源证据/授权状态 |
| --- | --- | --- | --- |
| `--alchemy-current-gameplay` | 480×853 | `256e15181374cd52` | 与 `public/gameplay.jpg` 相同；所有者已确认，MIT |
| `--alchemy-report-icon-atlas` | 900×600 | `efe59ee15b21614a` | 与 `public/report-icons.jpg` 相同；所有者已确认，MIT |
| `--alchemy-capybara-style-atlas` | 960×480 | `030df3cedcdfd6c3` | 既有卡皮巴拉风格图集，未找到独立原始许可记录；所有者已确认，MIT |
| `--alchemy-material-tile-atlas` | 1024×1024 | `d7c44debfce13c06` | 既有素材底板图集，未找到独立原始许可记录；所有者已确认，MIT |
| `--alchemy-material-icon-atlas` | 1024×896 | `698743bf1ad820d2` | 既有素材图标图集，未找到独立原始许可记录；所有者已确认，MIT |
| `--alchemy-style-atlas` | 1024×1024 | `bcc93b1d7ad208025` | 既有美术示例图集，未找到独立原始许可记录；所有者已确认，MIT |
| `#alchemy-gameplay-reference-art` 初始 `src` | — | — | 重复初始图片已移除；上述玩法图集及独立文件仍保留 |

## 内置 SVG 与样例数据

- `public/alchemy-app.js` 的 `iconPaths` 是从原 Lucide 界面表达手工简化的少量线性图标，部分基础路径与 Lucide 1.17.0 一致；保留 ISC 和 Feather 派生图标的 MIT 许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。运行时不再请求 Lucide CDN。
- 海报渲染器中用代码绘制的边框、徽章和简单图标随项目代码管理；没有据此把相关示例位图或参考海报重新授权。
- `worker/trend-video-seed.json` 是历史样例数据，含原有主题/新闻检索链接、日期和风险说明。它不是实时来源，也不是其中品牌、角色、视频或新闻内容的使用授权；当前真实热点功能不拿这些种子冒充实时数据。
- 实时抓取的来源标题和链接保留来源语义；源码不包含来源网站整篇文章或原视频，不能把第三方内容视为本项目拥有。

## 不属于源码素材授权范围

- `.alchemy-runtime/` 的密钥配置、缓存报告和抓取缓存。
- `public/generated/` 的用户生成图、卡片和海报。
- 原项目私有 Docs 中的完整参考图、输出截图、本机输出和下载文件。
- Windows 或 Linux 上安装的字体文件；项目只使用环境提供的字体，不打包微软雅黑。

上述目录或结果不因代码开源而获得公共再分发授权。本次准备的源码包排除运行缓存和生成结果；后续若另行展示案例，应分别记录模型服务、输入素材来源与所有者的公开许可。
