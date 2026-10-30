"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

/*
 * 渲染层只拿到这三个能力，拿不到 Node、也拿不到 ipcRenderer 本体。
 * onMessage 故意把回调包成 { data: payload }，这样 grid.js 里那套
 * "e.data" 的写法可以原样沿用，不用改逻辑。
 */
contextBridge.exposeInMainWorld("fg", {
  send: function (msg) {
    ipcRenderer.send("fg", msg);
  },
  onMessage: function (cb) {
    ipcRenderer.on("fg", function (event, payload) {
      cb({ data: payload });
    });
  },
  pathForFile: function (file) {
    try {
      return webUtils.getPathForFile(file);
    } catch (err) {
      return "";
    }
  }
});
