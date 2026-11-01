"use strict";

// 只操作本应用的 HWND。桌面宿主由 Explorer 管理，不替换壁纸、不改桌面设置。
let cached = null;
function createWindowsDesktop() {
  if (cached) return cached;
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const POINT = koffi.struct("FG_TARGET_POINT", {x:"long",y:"long"});
  const WindowFromPoint=user32.func("uintptr_t __stdcall WindowFromPoint(FG_TARGET_POINT point)");
  const GetCursorPos=user32.func("int __stdcall GetCursorPos(_Out_ FG_TARGET_POINT *point)");
  const GetClassName=user32.func("int __stdcall GetClassNameW(uintptr_t hwnd, _Out_ void *buffer, int max)");
  const advapi32 = koffi.load("advapi32.dll");
  const gdi32 = koffi.load("gdi32.dll");
  const FindWindow = user32.func("uintptr_t __stdcall FindWindowW(str16 className, str16 title)");
  const FindWindowEx = user32.func("uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, str16 className, str16 title)");
  const GetWindow = user32.func("uintptr_t __stdcall GetWindow(uintptr_t hwnd, uint command)");
  const GetAncestor = user32.func("uintptr_t __stdcall GetAncestor(uintptr_t hwnd, uint flags)");
  const GetForegroundWindow = user32.func("uintptr_t __stdcall GetForegroundWindow()");
  const IsWindow = user32.func("int __stdcall IsWindow(uintptr_t hwnd)");
  const GetWindowLong = user32.func("intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int index)");
  const SetWindowLong = user32.func("intptr_t __stdcall SetWindowLongPtrW(uintptr_t hwnd, int index, intptr_t value)");
  const SetWindowPos = user32.func("int __stdcall SetWindowPos(uintptr_t hwnd, uintptr_t after, int x, int y, int width, int height, uint flags)");
  const GetWindowRgn = user32.func("int __stdcall GetWindowRgn(uintptr_t hwnd, uintptr_t region)");
  const CreateRectRgn = gdi32.func("uintptr_t __stdcall CreateRectRgn(int left, int top, int right, int bottom)");
  const PtInRegion = gdi32.func("int __stdcall PtInRegion(uintptr_t region, int x, int y)");
  const DeleteObject = gdi32.func("int __stdcall DeleteObject(uintptr_t object)");
  const GetLastError = kernel32.func("uint __stdcall GetLastError()");
  const SetLastError = kernel32.func("void __stdcall SetLastError(uint error)");
  const RegGetValue = advapi32.func("long __stdcall RegGetValueW(uintptr_t key, str16 subKey, str16 value, uint flags, void *type, _Out_ void *data, _Inout_ uint *size)");

  function findHost() {
    const progman = FindWindow("Progman", null);
    if (progman) {
      const view = FindWindowEx(progman, 0, "SHELLDLL_DefView", null);
      if (view) return view;
    }
    let after = 0;
    for (let i = 0; i < 4096; i++) {
      after = FindWindowEx(0, after, null, null);
      if (!after) break;
      const view = FindWindowEx(after, 0, "SHELLDLL_DefView", null);
      if (view) return view;
    }
    return 0;
  }

  function metrics() {
    const data = Buffer.alloc(4), size = [4];
    const status = RegGetValue(0xffffffff80000001n, "Software\\Microsoft\\Windows\\Shell\\Bags\\1\\Desktop", "IconSize", 0x10, null, data, size);
    const value = status === 0 ? data.readUInt32LE() : 48;
    return { iconSize: Math.max(32, Math.min(128, value)) };
  }

  function handle(win) {
    const buffer = win.getNativeWindowHandle();
    return buffer.length === 8 ? buffer.readBigUInt64LE() : buffer.readUInt32LE();
  }

  function owner() { const view = findHost(); return view ? GetAncestor(view, 2) : 0; }

  function lower(win) {
    if (win.isDestroyed()) return;
    SetWindowPos(handle(win), 1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0200);
  }

  function layout(win, rect) {
    if (!SetWindowPos(handle(win), 1, rect.x, rect.y, rect.width, rect.height, 0x0010 | 0x0200)) throw new Error("无法设置桌面区域：" + GetLastError());
  }

  function attach(win, rect) {
    const host = owner();
    if (!host) throw new Error("Explorer 桌面尚未就绪");
    const hwnd = handle(win);
    // 保留 WS_POPUP 和 DWM 顶层透明合成。GWLP_HWNDPARENT 设置 owner，不能用 SetParent 改成 WS_CHILD。
    SetLastError(0);
    SetWindowLong(hwnd, -8, host);
    const error = GetLastError();
    if (error || BigInt(GetWindow(hwnd, 4)) !== BigInt(host)) throw new Error("连接桌面失败：" + error);
    layout(win, rect);
    return { owner: String(host), hwnd: String(hwnd), composition: "top-level" };
  }

  function connected(win) {
    if (win.isDestroyed()) return false;
    const host = owner(), hwnd = handle(win);
    return !!host && !!IsWindow(hwnd) && !(Number(GetWindowLong(hwnd, -16)) & 0x40000000) && BigInt(GetWindow(hwnd, 4)) === BigInt(host);
  }

  function ignoresMouse(win) { return !!(Number(GetWindowLong(handle(win), -20)) & 0x20); }

  function focused(win) { return BigInt(GetForegroundWindow()) === BigInt(handle(win)); }

  function regionContains(win, x, y) {
    const region = CreateRectRgn(0, 0, 0, 0);
    try {
      if (!GetWindowRgn(handle(win), region)) throw new Error("窗口尚未裁剪");
      return !!PtInRegion(region, x, y);
    } finally { DeleteObject(region); }
  }

  function dropTarget() {
    const pos={}; if(!GetCursorPos(pos)) throw new Error("无法读取拖放位置");
    const hwnd=WindowFromPoint(pos), top=GetAncestor(hwnd,2), buffer=Buffer.alloc(512);
    GetClassName(top,buffer,256); const name=buffer.toString("utf16le").split("\0")[0];
    if(["Progman","WorkerW"].includes(name)) return {type:"desktop"};
    if(["CabinetWClass","ExploreWClass"].includes(name)) return {type:"explorer",handle:String(top)};
    throw new Error("请放到桌面空白处或文件资源管理器内容区域");
  }
  return cached = { attach, connected, layout, metrics, findHost, ignoresMouse, lower, focused, regionContains, dropTarget };
}

module.exports = { createWindowsDesktop };
