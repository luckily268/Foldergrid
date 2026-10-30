# folder-grid

直接显示在 Windows 桌面上的文件收纳图标。第一层使用普通桌面图标的尺寸，点击图标展开半透明玻璃卡，再单击文档预览或双击用默认程序打开。

## 使用

从 Releases 下载 `folder-grid-setup-0.2.1.exe` 安装。启动后图标显示在**主显示器桌面右上方**，没有普通标题栏或任务栏窗口，后台控制位于系统托盘。

- 第一层默认 48px，并读取 Windows 保存的桌面图标尺寸；图标下方显示名称。
- 顶部的小工具条提供选择目录、新建、刷新和菜单。
- 桌面空白处仍交给 Windows 处理；图标和已展开的卡片接收鼠标输入。
- 点图标展开玻璃卡；Esc 依次关闭搜索、预览和卡片。
- 从资源管理器拖入图标会**真实移动**文件；同名文件不会被覆盖。
- 图标左上角 🎨 可选内置图标或上传自定义封面；右键图标可重命名。
- 右键选择「删除格子…」会先要求确认，并提醒内容会移到桌面。确认后先移出所有文件及子文件夹，再移除空格子；同名自动另起名称，不覆盖已有文件。
- 托盘右键可以选择目录、打开资源管理器、新建、刷新或退出 folder-grid。

当前桌面接入依赖 Windows Explorer。程序不会替换壁纸或改变已有桌面图标的排列。Explorer 重启后会尝试重新连接。当前只在主显示器布置图标。

## 文件和升级

每个格子对应一个真实文件夹；展示信息在根目录的 `grid.json`，自定义封面在 `.icons/`。

新安装默认使用「文档/folder-grid」。升级时优先沿用旧版配置中的文件目录；如果已有「文档/格子」也会继续使用它，**不会改名或搬动已有文件**。软件名、安装项、快捷方式和托盘名称统一为 folder-grid。

## 文档预览

支持 Markdown、TXT、LOG 和 DOCX。DOCX 仅提取段落文本和标题；PDF 和旧 DOC 需使用默认程序打开。预览文件和 DOCX 解压后的正文均有 12MB 上限。

## 开发与测试

需要 Windows 10/11 x64、Node.js 24 LTS（含 npm）。

```powershell
npm ci
npm run check
npm test
npm run test:smoke
npm run test:desktop
npm start
```

`test:smoke` 使用独立配置检查界面；`test:desktop` 进一步验证桌面归属、透明窗口裁剪和键盘焦点，需要当前会话有可用桌面。测试文件放在 `.test-output/`，不使用个人文件。

## 打包与发布

```powershell
npm run dist
```

生成 `dist/folder-grid-setup-0.2.1.exe` 和 `dist/SHA256SUMS.txt`。推送与 package.json 一致的版本标签 `v0.2.1` 后，GitHub Actions 测试并打包，产物放入草稿 Release。完整步骤见 [RELEASE.md](RELEASE.md)。

MIT License，见 [LICENSE](LICENSE)。
