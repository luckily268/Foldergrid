"use strict";
const { execFile } = require("child_process");
function explorerDirectory(handle) {
  if (!/^\d+$/.test(String(handle))) return Promise.reject(new Error("窗口无效"));
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $s=New-Object -ComObject Shell.Application; $p=@($s.Windows() | Where-Object { [string]$_.HWND -eq '${handle}' } | ForEach-Object { try { $_.Document.Folder.Self.Path } catch {} } | Sort-Object -Unique); ConvertTo-Json -Compress -InputObject $p`;
  return new Promise((resolve,reject) => execFile("powershell.exe", ["-NoProfile","-NonInteractive","-Command",script], { windowsHide:true, timeout:8000, encoding:"utf8" }, (error,out) => {
    if (error) return reject(new Error("无法读取资源管理器目录，请选择目标目录"));
    try { const paths=JSON.parse(out.replace(/^\uFEFF/,"")); if (paths.length !== 1) throw Error(); resolve(paths[0]); }
    catch (_) { reject(new Error("无法唯一识别资源管理器标签页，请选择目标目录")); }
  }));
}
module.exports={explorerDirectory};
