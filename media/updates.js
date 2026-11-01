(function () {
  "use strict";
  const box = document.getElementById("updateNotice"), label = document.getElementById("updateMessage"), action = document.getElementById("updateAction"), progress = document.getElementById("updateProgress");
  let state = {};
  document.getElementById("updateBtn").onclick = () => window.fg.send({ type: "updateCheck" });
  document.getElementById("updateClose").onclick = () => window.fg.send({ type: "updateDismiss" });
  action.onclick = () => window.fg.send({ type: state.status === "available" ? "updateDownload" : state.status === "downloaded" ? "updateInstall" : "updateCheck" });
  window.fg.onMessage(({ data: msg }) => {
    if (msg.type !== "updateState") return;
    state = msg.payload; box.hidden = !state.visible; label.textContent = state.message;
    progress.hidden = state.status !== "downloading"; progress.value = state.percent;
    action.textContent = state.status === "available" ? "下载更新" : state.status === "downloaded" ? "重启更新" : "检查更新";
    action.disabled = ["checking", "downloading", "installing", "disabled"].includes(state.status);
  });
})();
