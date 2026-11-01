# 自动更新与正式版发布

当前版本：0.5.0。更新源：公开仓库 luckily268/Foldergrid 的已发布 Releases。

安装版启动 30 秒后检查，此后每 6 小时检查；也可从工具条 ↑ 或托盘检查。下载后用户点击重启更新，文件操作或拖动期间阻止安装，普通退出不自动安装。正式版默认稳定通道，已有显式通道偏好保留。旧开发版可检查更高正式版；不含更新器的旧版本需要手动覆盖安装一次。

## v0.5.0 发布步骤

1. 标签使用 v0.5.0，标题建议「folder-grid v0.5.0 · 书柜分区与多窗口对比」。
2. 正文使用 RELEASE-NOTES-0.5.0.md。
3. 将 Release 附件包解压，独立上传：
   - folder-grid-setup-0.5.0.exe
   - folder-grid-setup-0.5.0.exe.blockmap
   - latest.yml
   - SHA256SUMS.txt
4. 正式发布时不勾选「Set as a pre-release」。草稿对更新客户端不可见。

正式版不需要 dev.yml；不要沿用旧开发版的更新描述文件，不要手改 latest.yml 的版本、大小或 SHA512。上传 ZIP 或仅 EXE 不能代替独立更新附件。

GitHub Actions 仍先生成草稿，正式版本标签自动设置 prerelease 为 false；人工检查附件后发布。后续升级必须递增版本并整套重新构建。禁止覆盖旧版本产物。

构建：npm ci 后 npm run dist。校验脚本清理 dist/update 中旧的 yml，再写入本次通道元数据，避免本机连续构建混用旧开发通道。

本地更新测试只执行检查、下载及校验，不执行安装器，不访问 GitHub；仍需发布后完成已安装版本到线上新版的重启安装验证。当前安装包沿用未签名配置。没有在本次任务中发布远程 Release。
