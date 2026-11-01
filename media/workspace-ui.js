(function () {
  "use strict";
  const layer = document.getElementById("workspaceLayer");
  const content = document.getElementById("workspaceContent");
  const title = document.getElementById("workspaceTitle");
  let state = { folders: [], rules: [], shortcuts: {} }, page = "search", plan = null, draft = [];
  const send = msg => window.fg.send(msg);
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const button = (id, text, primary) => '<button id="' + id + '" class="ws-button' + (primary ? ' primary' : '') + '">' + text + '</button>';
  function open(next) {
    page = next || "search"; layer.hidden = false;
    document.querySelectorAll(".workspace-tabs button").forEach(b => b.classList.toggle("selected", b.dataset.page === page));
    title.textContent = { search: "搜索所有格子", organize: "给桌面腾点空间", rules: "按你的习惯分类", help: "随时找到需要的文件" }[page];
    if (page === "search") renderSearch();
    if (page === "organize") renderOrganize();
    if (page === "rules") { draft = state.rules.map(r => ({ ...r })); renderRules(); }
    if (page === "help") renderHelp();
  }
  function close() { layer.hidden = true; send({ type: "endPeek" }); document.getElementById("globalSearchBtn").focus(); }
  function renderSearch() {
    content.innerHTML = '<p class="ws-intro">在所有格子和映射文件夹的第一层查找文件。空格分隔多个关键词。</p><div class="ws-search"><span>⌕</span><input id="globalSearchInput" type="search" placeholder="输入文件名或格子名…" aria-label="搜索文件名或格子名" autocomplete="off" /></div><div class="ws-results-head"><span id="resultCount"></span><span>Enter 打开 · ↑↓ 选择</span></div><div id="globalResults" class="ws-results"></div>';
    const input = document.getElementById("globalSearchInput");
    input.addEventListener("input", updateResults);
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); document.querySelector(".ws-result")?.focus(); }
      if (e.key === "Enter") document.querySelector(".ws-result")?.click();
    });
    updateResults(); input.focus(); send({ type: "focusInput", id: "globalSearchInput" });
  }
  function updateResults() {
    const input = document.getElementById("globalSearchInput");
    if (!input) return;
    const all = state.folders.flatMap(f => f.files.map(file => ({ ...file, folderName: f.name, kind: f.kind })));
    const results = window.fileView.select(all, input.value, "all", input.value.trim() ? "name" : "newest");
    const shown = results.slice(0, 200);
    document.getElementById("resultCount").textContent = results.length + " 项" + (results.length > 200 ? " · 显示前 200 项，请缩小搜索范围" : "");
    const list = document.getElementById("globalResults"); list.innerHTML = "";
    if (!shown.length) { list.innerHTML = '<div class="ws-empty">没有找到文件<span>试试更短的关键词，或添加一个文件夹映射。</span></div>'; return; }
    shown.forEach(file => {
      const row = document.createElement("div"); row.className = "ws-result-row";
      const b = document.createElement("button"); b.className = "ws-result"; b.title = file.path;
      b.innerHTML = '<span class="ws-file-icon">' + escape(file.icon) + '</span><span><strong>' + escape(file.name) + '</strong><small>' + escape(file.folderName) + (file.kind === "portal" ? " · 映射" : "") + " · " + escape(file.whenLabel) + '</small></span><span class="ws-file-size">' + escape(file.sizeLabel) + '</span>';
      b.onclick = () => send({ type: "open", path: file.path });
      b.onkeydown = e => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault(); const buttons = [...list.querySelectorAll(".ws-result")], idx = buttons.indexOf(b);
        buttons[Math.max(0, Math.min(buttons.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
      };
      const reveal = document.createElement("button"); reveal.className = "ws-reveal"; reveal.textContent = "↗"; reveal.title = "在资源管理器中显示"; reveal.setAttribute("aria-label", "定位 " + file.name);
      reveal.onclick = () => send({ type: "reveal", path: file.path });
      row.append(b, reveal); list.append(row);
    });
  }
  function renderOrganize() {
    content.innerHTML = '<p class="ws-intro">把桌面第一层的文件按规则移入格子。文件夹、隐藏文件、未匹配项目会留在桌面；映射文件夹不参与接收。</p><div class="ws-callout"><strong>先看清单，再确认移动</strong><span>目标已有同名文件会跳过。最近的整理支持撤销。</span></div><div class="ws-actions">' + button("planBtn", "生成移动预览", true) + button("editRulesBtn", "编辑规则") + button("undoBtn", "撤销最近一次整理") + '</div><div id="organizationDetails" class="ws-plan"></div>';
    document.getElementById("undoBtn").disabled = !state.undoAvailable;
    document.getElementById("planBtn").onclick = () => { plan = null; document.getElementById("organizationDetails").textContent = "正在生成预览…"; send({ type: "planOrganization" }); };
    document.getElementById("undoBtn").onclick = () => send({ type: "undoOrganization" });
    document.getElementById("editRulesBtn").onclick = () => open("rules");
    if (plan) renderPlan();
  }
  function renderPlan() {
    const details = document.getElementById("organizationDetails"); if (!details || !plan) return;
    details.innerHTML = '<div class="ws-plan-summary"><strong>' + plan.items.length + ' 个文件待整理</strong><span>' + plan.skipped.length + ' 项已跳过</span></div><p class="ws-path">来源：' + escape(plan.source) + '<br>目标：' + escape(plan.root) + '</p>' +
      (plan.items.length ? '<div class="ws-table-wrap"><table><thead><tr><th>文件</th><th>移入格子</th></tr></thead><tbody>' + plan.items.map(item => '<tr><td title="' + escape(item.source) + '">' + escape(item.name) + '</td><td>' + escape(item.cell) + '</td></tr>').join("") + '</tbody></table></div>' + button("executeBtn", "确认清单并整理 " + plan.items.length + " 项", true) : '<p class="ws-empty">没有需要移动的文件。可以调整规则后重新预览。</p>') +
      failures(plan.skipped);
    const execute = document.getElementById("executeBtn");
    if (execute) execute.onclick = () => send({ type: "executeOrganization", planId: plan.id });
  }
  function failures(items) {
    if (!items.length) return "";
    return '<details class="ws-failures"><summary>查看 ' + items.length + ' 项未处理原因</summary><ul>' + items.map(f => '<li>' + escape(f.name) + '：' + escape(f.reason) + '</li>').join("") + '</ul></details>';
  }
  function renderRules() {
    content.innerHTML = '<p class="ws-intro">按从上到下的顺序匹配第一条规则。扩展名用逗号分隔；同时填写关键词时，两项都须满足。保存后手动生成预览。</p><div id="ruleRows" class="ws-rules"></div><div class="ws-actions">' + button("addRuleBtn", "＋ 添加规则") + button("saveRulesBtn", "保存规则", true) + '</div><p id="ruleFeedback" aria-live="polite"></p>';
    const rows = document.getElementById("ruleRows");
    draft.forEach((rule, i) => {
      const row = document.createElement("div"); row.className = "ws-rule";
      row.innerHTML = '<div class="ws-rule-number">' + (i + 1) + '</div><label class="ws-enabled"><input type="checkbox" ' + (rule.enabled !== false ? 'checked' : '') + ' />启用</label><label>移入格子<input data-field="target" value="' + escape(rule.target) + '" maxlength="100" placeholder="例如：工作资料" /></label><label>扩展名<input data-field="extensions" value="' + escape(rule.extensions) + '" placeholder="pdf,docx,txt" /></label><label>文件名包含<input data-field="keyword" value="' + escape(rule.keyword) + '" maxlength="100" placeholder="可选，如：发票" /></label><div class="ws-rule-buttons"><button data-action="up" title="上移" aria-label="上移规则">↑</button><button data-action="down" title="下移" aria-label="下移规则">↓</button><button data-action="remove" title="删除规则" aria-label="删除规则">✕</button></div>';
      row.querySelector('input[type="checkbox"]').onchange = e => rule.enabled = e.target.checked;
      row.querySelectorAll("[data-field]").forEach(input => { input.oninput = () => rule[input.dataset.field] = input.value; input.onfocus = () => send({ type: "focusInput", id: "rulesInput" }); });
      row.querySelector('[data-action="up"]').disabled = i === 0;
      row.querySelector('[data-action="down"]').disabled = i === draft.length - 1;
      row.querySelectorAll("[data-action]").forEach(b => b.onclick = () => {
        if (b.dataset.action === "remove") draft.splice(i, 1);
        else { const j = i + (b.dataset.action === "up" ? -1 : 1); [draft[i], draft[j]] = [draft[j], draft[i]]; }
        renderRules();
      });
      rows.append(row);
    });
    document.getElementById("addRuleBtn").onclick = () => { if (draft.length < 100) { draft.push({ target: "", extensions: "", keyword: "", enabled: true }); renderRules(); rows.lastElementChild?.scrollIntoView(); } };
    document.getElementById("saveRulesBtn").onclick = () => send({ type: "saveRules", rules: draft });
  }
  function renderHelp() {
    const keys = [["peek", "Ctrl + Shift + Space", "呼出 / 收回桌面格子"], ["search", "Ctrl + Shift + F", "搜索所有格子"], ["hide", "Ctrl + Shift + H", "隐藏 / 显示格子"]];
    content.innerHTML = '<p class="ws-intro">文件夹映射让你从桌面访问其他磁盘上的资料，原文件保留在原位置。</p><div class="ws-callout"><strong>添加映射</strong><span>点击工具条 ⊞ 选择文件夹。映射仅供浏览、搜索、预览和打开；右键移除映射不会删除原文件。</span></div><div class="ws-shortcuts">' + keys.map(([key, label, desc]) => '<div><span>' + desc + '</span><kbd>' + label + '</kbd><small>' + (state.shortcuts[key]?.registered ? "已注册" : "未注册，可使用工具条或托盘菜单") + '</small></div>').join("") + '</div><p class="ws-intro">Esc 关闭当前面板；搜索覆盖各格子的第一层，不扫描全盘。映射暂不可用时，检查磁盘连接后点击刷新。</p>';
  }
  document.getElementById("workspaceClose").onclick = close;
  layer.addEventListener("click", e => { if (e.target === layer) close(); });
  document.querySelectorAll(".workspace-tabs button").forEach(b => b.onclick = () => open(b.dataset.page));
  document.getElementById("globalSearchBtn").onclick = () => open("search");
  document.getElementById("organizeBtn").onclick = () => open("organize");
  document.getElementById("portalBtn").onclick = () => send({ type: "addPortal" });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !layer.hidden) { e.preventDefault(); close(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); open("search"); }
  });
  window.fg.onMessage(({ data: msg }) => {
    if (msg.type === "state") {
      const changedRoot = state.root && state.root !== msg.payload.root;
      if (changedRoot) plan = null;
      state = msg.payload;
      if (changedRoot && !layer.hidden && page === "organize") renderOrganize();
      if (!layer.hidden && page === "search") updateResults();
      const undo = document.getElementById("undoBtn"); if (undo) undo.disabled = !state.undoAvailable;
    }
    if (msg.type === "requestGlobalSearch") open("search");
    if (msg.type === "organizationPlan") { plan = msg.payload; if (page === "organize") renderPlan(); }
    if (msg.type === "organizationResult") {
      plan = null;
      if (page === "organize" && !layer.hidden) {
        const r = msg.payload;
        document.getElementById("organizationDetails").innerHTML = '<div class="ws-callout"><strong>' + (r.restored === undefined ? "已整理 " + r.moved : "已移回 " + r.restored) + ' 项</strong><span>' + r.failed.length + ' 项未处理</span></div>' + failures(r.failed);
      }
    }
    if (msg.type === "toast" && page === "rules" && !layer.hidden) document.getElementById("ruleFeedback").textContent = msg.message;
  });
  send({ type: "ready" });
})();
