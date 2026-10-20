# Designer Skills

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **中文**

面向设计师的多模态制作流程，以可安装的 AI 智能体技能提供。

把参考资料或设计简报变成可以继续编辑的成果：Blender 场景、After Effects 工程、交互原型，以及经过核对的交付文件夹。每项技能都说明交付内容、编辑位置和实际结果的检查方法。

**预览版 · 0.1.0-alpha.1** — 首批包含四项技能。附带工具和工作流程的验证范围不同，请查看[验证记录](docs/validation.md)。

![使用附带 Blender 模板生成的产品场景](docs/images/blender-product.png)

## 选择工作流程

| 技能 | 可以请求 | 提供的改进 | 所需环境 |
|---|---|---|---|
| [blender-production](skills/blender-production/SKILL.md) | 产品渲染和可编辑的 `.blend` | 可配置设备模板、场景生成器、独立进程重新打开检查 | Blender；CPU 或受支持的 GPU |
| [after-effects-production](skills/after-effects-production/SKILL.md) | 能继续编辑的动态图形 | 原生图层、清晰合成结构、预览和编辑说明 | After Effects 和脚本或桥接环境 |
| [reference-to-web-toy](skills/reference-to-web-toy/SKILL.md) | 根据参考资料实现可操作的交互 | 动作与控件清单、浏览器对照、成果文件检查器 | 浏览器自动化；检查器需要 Python |
| [asset-delivery](skills/asset-delivery/SKILL.md) | 核对交付文件夹或 ZIP 是否缺漏 | 文件数量、SHA-256、压缩包检查、与基准版本比较 | Python 3.12+ |

本仓库提供工作说明和部分本地工具。应用、经授权的连接器及所需账号需要另行准备。不附带 AE 连接适配器。各项技能不依赖本合集中的其他技能。

四个小型[制作工具](docs/tools.md)随技能目录一起提供。大型应用连接器需要另行安装。

## 安装

在 Node.js 22.20 或更高版本中使用 [Skills CLI](https://github.com/vercel-labs/skills)。请在工作项目中运行：

```bash
npx skills@latest add Bum-Boo/designer-skills
```

交互选择技能与智能体。仅安装一项时：

```bash
npx skills@latest add Bum-Boo/designer-skills --skill blender-production -a codex
```

可以把 `codex` 换成 `claude-code`、`hermes-agent` 等受支持的智能体。添加 `-g` 可安装到用户范围。替换已有同名技能前，请先检查。本命令不会安装 Blender、Adobe 应用或 MCP 服务器。

离线或手动安装时，获取仓库并把选中的**整个技能目录**连同 `LICENSE` 复制到智能体支持的技能路径。请保留脚本与参考文件。路径见[安装详情](docs/installation.md)。

## 使用示例

在请求中写出已安装的技能名称。斜杠或美元符号的调用方式因智能体而异。支持自动发现时，也可以使用普通语言。

```text
用 blender-production 根据附带示例创建可编辑的产品场景。
渲染测试图，重新打开保存的场景，并说明可以编辑的位置。

用 after-effects-production 把这个片头做成可编辑的 AEP。
让文案和时间便于修改，并提供预览与编辑说明。

用 reference-to-web-toy 实现参考资料中可见的控件和交互。
将真实浏览器行为与参考资料进行对照。

用 asset-delivery 比较交付 ZIP 和已批准的文件夹。
不要修改原文件，报告缺少、新增或变化的文件。
```

## 收录范围

收录围绕可编辑成果、实际视觉观察和可核对交付发展而来的制作流程。目前涵盖 3D、动态图形、交互和交付。图像、视频生成及其他设计工具将在核实依赖和实际输出后扩展。

未经修改的厂商技能和通用开发合集继续使用上游版本。本仓库不会重新打包所有已安装技能。请查看[范围与后续候选](docs/scope.md)和[来源说明](docs/provenance.md)。

## 检查包

```bash
python scripts/validate.py
python skills/asset-delivery/scripts/test_delivery_manifest.py
python skills/reference-to-web-toy/scripts/test_verify_static_artifact.py
```

Blender 检查需要使用 Blender 执行技能中的命令。文件检查和测试不能证明视觉质量或自动技能选择。已确认范围与限制见[验证记录](docs/validation.md)。

## 许可证

[MIT](LICENSE)。请保留附带的版权声明。应用订阅、插件、字体和用户素材分别遵循其自身条款。日语和中文文档尚未经过母语审校。
