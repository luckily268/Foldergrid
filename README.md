# Foldergrid Windows 开发版

基于用户提供的 `folder-grid-source-0.3.0.zip` 开发，当前版本为 `0.4.0-dev.1`。目标系统：**Windows 10/11 x64**。采用 Electron + 原生 JavaScript；Win32 桌面接入使用 Koffi。

保留 v0.3.0 的桌面嵌入、玻璃卡预览、格子与文件自由拖动、回收站、底色、封面和位置保存。源码来源与比较见 [UPSTREAM.md](UPSTREAM.md)、[产品调研与开发说明](docs/产品调研与开发说明.md)。

## 本次新增

- **搜索所有格子**：工具条 `⌕`，按文件名和格子名搜索。空格分隔多个关键词；支持键盘选择、打开和定位。覆盖格子及映射文件夹的第一层，不递归扫描全盘。
- **排序与筛选**：格子卡片内提供自由摆放、名称、最近修改、类型、大小排序，以及文档、图片、文件夹等筛选。排序按格子保存；拖动文件后恢复自由摆放。
- **文件夹映射**：工具条 `⊞`，选择其他磁盘上的文件夹。文件保留在原位置，支持浏览、搜索、预览和打开；此版本的映射不支持拖入、移出和回收。右键移除映射保留原文件。
- **桌面分类**：工具条 `▤`，生成移动预览，显示来源、目标和跳过原因，再由系统对话框确认。默认包含文档、图片、音视频、压缩包和快捷方式规则。
- **自定义规则**：按扩展名、文件名关键词分类；可启停、增删和调整优先级。两项同时填写时须同时满足，采用第一条匹配规则。规则保存后手动预览和执行，不在后台持续搬文件。
- **撤销整理**：持久保存移动记录，可逐次撤销最近的整理。原位置出现同名文件或整理后的文件被修改时会跳过，保留文件并显示原因。
- **快捷呼出**：`Ctrl+Shift+Space` 呼出/收回，`Ctrl+Shift+F` 搜索全部，`Ctrl+Shift+H` 隐藏/显示。失去焦点或关闭工作台后退出置顶。工作台「使用提示」显示快捷键注册结果；被占用时仍可用工具条、托盘菜单。

分类只处理当前 Windows 用户桌面第一层的普通文件；文件夹、隐藏文件、目录联接、未匹配文件不参与。预览 10 分钟后过期。执行前重新检查文件；同名目标不覆盖。跨盘移动沿用 v0.3.0 的复制成功后删除来源逻辑。异常中断留下的 `pending` 记录可供检查，不会自动猜测文件状态。

## Windows 开发

安装 Node.js 24 LTS（包含 npm），解压源码，在项目目录运行：

```powershell
npm ci
npm run check
npm test
npm run test:smoke
npm run test:desktop
npm start
```

`test:smoke` 在临时目录执行 v0.3.0 界面回归及新增功能回归。`test:desktop` 需要当前 Windows 会话有可用桌面，另检查桌面归属和裁剪。结果和截图位于 `.test-output/`。

## macOS 开发

```sh
npm ci
npm run check
npm test
npm run test:window
```

macOS 可运行数据层测试和窗口模式界面测试；`npm start` 的真实桌面模式仍只支持 Windows。macOS 界面通过不能替代 Windows 的桌面嵌入、DPI、多屏、快捷键和资源管理器拖放验收。

## Windows 打包

在 Windows 上执行：

```powershell
npm run dist
```

产物是 `dist/folder-grid-setup-0.4.0-dev.1.exe` 与 `dist/SHA256SUMS.txt`。已有 GitHub Actions 可在 Windows runner 检查、测试和打包；本次没有推送或创建 Release。附带的 Windows 解压试用包在 macOS 交叉打包，未作 Windows 实机验收，使用方式见 [Windows试用指南](docs/Windows试用指南.md)。

## 数据

每个普通格子对应根目录的真实子文件夹，`grid.json` 保存映射、封面、布局、排序等信息，`.icons/` 保存自定义封面。`%APPDATA%/folder-grid/config.json` 保存根目录与分类规则；同级 `organization-history.json` 保存撤销记录。文件预览沿用原版的 Markdown/TXT/LOG/DOCX 支持，PDF/旧 DOC 使用默认程序打开。

保留原项目 MIT 许可证，见 [LICENSE](LICENSE)。
