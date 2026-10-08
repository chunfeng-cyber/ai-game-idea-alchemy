# 第三方来源与许可说明

更新日期：2026-10-08。项目代码采用MIT许可；本文记录第三方素材与依赖的独立许可。随源码分发的界面位图和图集已获所有者商用及再分发确认，见 [ASSETS.md](ASSETS.md)；下面的图标许可不自动覆盖其他素材。

## 内置线性图标：Lucide / Feather

原组件加载 `https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js`。本次为离线可用性移除了 CDN，由 `public/alchemy-app.js` 中 `iconPaths` 保存少量简化线性图标；并非把 Lucide 整库打包进组件。

这些图标按原界面的 Lucide 表达手工简化，基础路径仍有与上游一致的部分。例如 `maximize-2` 的 `M15 3h6v6` 与 `M9 21H3v-6` 与 Lucide 1.17.0 一致；不把重新排版或合并 SVG 路径视为来源消失，保留下列第三方许可。`radio` 列在上游的 Feather 派生图标清单中，另保留其 MIT 版权与许可。

当前内置名称：`radio`、`maximize-2`、`hand`、`gamepad-2`、`palette`、`library`、`sparkles`、`shapes`、`circle-dot`、`gem`、`boxes`、`pencil`、`grid-3x3`、`blocks`、`layers-3`。

核验来源：

- [Lucide 1.17.0 实际发布包 LICENSE](https://cdn.jsdelivr.net/npm/lucide@1.17.0/LICENSE)
- [Lucide 1.17.0 实际发布包 UMD](https://cdn.jsdelivr.net/npm/lucide@1.17.0/dist/umd/lucide.js)
- [Lucide 官方仓库 LICENSE](https://github.com/lucide-icons/lucide/blob/main/LICENSE)

以下年份及作者名称逐字来自上述发布包 LICENSE，不依据当前日期推测。

### ISC License — Lucide

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### MIT License — 上游明确列出的 Feather 派生图标

以下许可对应 Lucide 发布包中列出的 Feather 派生图标；本组件的 `radio` 属于该清单。完整清单见上面的精确版本 LICENSE。

```text
The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm 依赖

源码交付不包含 `node_modules` 或预编译 `dist`。依赖版本由 `package-lock.json` 固定；安装后，各包自带的 LICENSE/NOTICE 仍适用。下表来自本次安装包的 package.json 与锁文件，是直接依赖概览，不替代传递依赖的完整许可清单。

| 许可 | 当前直接依赖 |
| --- | --- |
| MIT | `@modelcontextprotocol/sdk`、`zod`、`@eslint/js`、`@types/node`、`eslint`、`globals`、`typescript-eslint` |
| Apache-2.0 | `sharp`、`@openai/codex`、`typescript` |

安装包可能还包含第三方原生组件及其单独许可，例如 Sharp 的图像处理组件。发布含依赖或二进制的发行版时，应同时携带实际安装包的对应许可；本源码包没有将这些二进制复制进仓库。

## 字体与外部内容

- 海报渲染使用运行环境提供的字体，源码包没有附带微软雅黑或其他字体文件。CSS 字体名称不构成对字体文件的再分发授权。
- 新闻标题、榜单和来源链接的权利属于各来源及原作者。公开接口可读取不等于内容获得了本项目的开源许可；正文、视频、角色、商标和第三方图片也没有被此文件重新授权。
- 用户自行配置模型生成的结果遵循其供应商条款和输入素材权利；代码许可证不会自动覆盖生成结果。
