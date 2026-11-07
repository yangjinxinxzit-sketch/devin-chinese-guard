# Devin Chinese Guard · Devin 中文更新维护

适用于 **macOS Devin Desktop** 的非官方简体中文补丁和更新维护扩展。覆盖智能体主界面、应用设置、首选项、快捷键和通知等界面，并在客户端更新后自动检查和修复可识别的语言资源。

它在本机运行，不调用模型或在线翻译接口。运行时原件、缓存和备份留在本机。

## 功能

- 根据 JavaScript AST 识别语言初始化位置，不依赖固定资源文件名或压缩变量名。
- 保留原始英文资源，增加“简体中文”，并检查占位符和富文本标签。
- 启动时及运行期间每五分钟检查一次；可识别的更新自动修复。
- 区分“文件已修复”和“当前进程已完整重启”，避免旧界面仍英文时误报成功。
- 按客户端版本和构建编号备份，支持带哈希校验的回退。
- 显示层补充翻译会避开编辑器、终端、输入框和可识别的消息正文区域。

**兼容范围：** 在 macOS 上适配过 Devin 3.11.216、3.11.228、3.11.231 和 3.11.238。尚未验证 Windows、Linux 或其他安装路径。未来官方改变前端结构时可能需要重新适配；程序会停止处理未知结构。3.11.238 的本机记录仍有 2 条新增文案保留英文。第三方智能体名称和动态简介也可能保持原文。

## 安装

1. 先正常安装并打开官方 Devin Desktop。
2. 建议安装官方中文语言包 `MS-CEINTL.vscode-language-pack-zh-hans`，将编辑器显示语言设为 `zh-cn`；它负责编辑器和菜单部分。
3. 从 [Releases](https://github.com/yangjinxinxzit-sketch/devin-chinese-guard/releases) 下载 `devin-chinese-guard-*.vsix`。
4. 在 Devin 的命令面板执行 **Extensions: Install from VSIX...**，选择下载文件。
5. 按提示**完全退出 Devin，再从 Dock 或“应用程序”重新打开**。

也可以使用 Devin 自带的命令行安装：

```sh
"/Applications/Devin.app/Contents/Resources/app/bin/devin-desktop" \
  --install-extension ./devin-chinese-guard-1.0.3.vsix --force
```

仅“重新加载窗口”或重启扩展服务，可能仍使用当前应用进程里的旧界面，因此不会清除“等待完整重启”的状态。扩展不会自动退出正在工作的 Devin；退出按钮由你选择。

## 使用与回退

命令面板提供：

| 命令 | 用途 |
| --- | --- |
| `Devin 汉化：检查并修复` | 手动检查、修复并恢复自动维护 |
| `Devin 汉化：查看维护状态` | 查看资源、版本及完整重启状态 |
| `Devin 汉化：回退当前版本补丁` | 核对备份后恢复本次补丁前的资源，并暂停自动维护 |

设置 `devinChinese.autoRepair` 可开关自动检查。回退之后再执行“检查并修复”即可恢复维护。

备份和状态位于：

```text
~/Library/Application Support/DevinChineseGuard/
├── versions/<客户端版本>-<构建编号>/
│   ├── record.json
│   ├── frontend.original.js
│   └── missing-phrases.json
└── status.json
```

这些文件仅在使用者本机生成。遇到资源或备份哈希不匹配时，程序会拒绝覆盖；不要把旧版备份直接放回新版客户端。

## 从源码构建

需要 Node.js 22+、npm 和 Python 3.9+。安装成 VSIX 后，扩展使用 Devin 自带的运行环境。

```sh
npm ci --ignore-scripts
npm test
npm run pack
```

产物在 `dist/`，同时生成 `SHA256SUMS`。打包采用文件白名单，不会把 `.git`、测试、个人配置、运行记录或客户端备份带入安装包。

测试默认使用项目自行生成的界面夹具，其他人和 CI 无需安装 Devin。若本机装有 Devin，可额外执行：

```sh
npm run verify:local
```

该命令只读检查本机客户端与本工具的版本备份，不写入客户端。缺失译文会报告并保留英文，不会因此伪造完整覆盖率。

## 边界与来源

本扩展修改 Devin 安装目录中的前端资源，必要时补充官方语言包并清理生成缓存，需要相应目录的写权限。它不修改模型路由、项目文件或账号权限。

这是本地补丁，不能保证未来所有客户端版本都兼容；资源修改也可能触发客户端完整性提示。出现问题时先回退，必要时重新安装对应的官方客户端，而不是关闭系统安全保护。

DOM 保护范围取决于客户端的容器结构；若新版布局改变，需重新验证。部分译文来自机器翻译，欢迎提交带英文原文和界面位置的修正；提交截图、日志前请移除账号、会话内容及凭据。

代码使用 [MIT License](LICENSE)。显示层和部分词库基于 [N1n3VASthR33H/devin-zh](https://github.com/vvvvvvvvvashhh/devin-zh) 的 MIT 版本适配，原声明见 [THIRD_PARTY_LICENSE](THIRD_PARTY_LICENSE)，完整来源见 [NOTICE](NOTICE)。本仓库不分发 Devin 客户端、原始客户端 bundle 或全量英文目录；英文指纹仅用于校验原文是否变化。
