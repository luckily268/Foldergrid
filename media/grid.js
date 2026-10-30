(function () {
  "use strict";

  /*
   * 桌面端：preload 暴露的 window.fg 顶替了 VSCode 的 acquireVsCodeApi。
   * 消息协议和 webview 版完全一样（postMessage / onMessage），
   * 所以下面所有逻辑都不用改。
   */
  var vscode = {
    postMessage: function (msg) {
      window.fg.send(msg);
    }
  };

  var grid = document.getElementById("grid");
  var overlay = document.getElementById("overlay");
  var panel = document.getElementById("panel");
  var panelTitle = document.getElementById("panelTitle");
  var panelCount = document.getElementById("panelCount");
  var filesEl = document.getElementById("files");
  var toastEl = document.getElementById("toast");
  var rootPathEl = document.getElementById("rootPath");
  var backBtn = document.getElementById("back");
  var newBtn = document.getElementById("newBtn");
  var refreshBtn = document.getElementById("refreshBtn");
  var revealBtn = document.getElementById("revealBtn");
  var searchBtn = document.getElementById("searchBtn");
  var searchRow = document.getElementById("searchRow");
  var searchInput = document.getElementById("searchInput");
  var searchClear = document.getElementById("searchClear");

  var folders = [];
  var currentId = null;
  var toastTimer = null;
  var previewClickTimer = null;
  var searchQuery = "";
  var desktopIconSize = 48;

  /* ---------------- 工具 ---------------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2600);
  }

  function findFolder(id) {
    for (var i = 0; i < folders.length; i++) {
      if (folders[i].id === id) return folders[i];
    }
    return null;
  }

  function tileEl(id) {
    return grid.querySelector('.tile[data-id="' + id + '"]');
  }

  /* 桌面端拖进来的是真实文件对象，用 preload 的 webUtils 换出绝对路径 */
  function readPaths(dt) {
    var out = [];
    if (!dt || !dt.files || !dt.files.length) return out;
    for (var i = 0; i < dt.files.length; i++) {
      var p = window.fg.pathForFile(dt.files[i]);
      if (p) out.push(p);
    }
    return out;
  }

  /* ---------------- 渲染网格 ---------------- */

  function render() {
    grid.innerHTML = "";

    if (!folders.length) {
      var hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.innerHTML =
        "还没有格子<br><span>点右上角 ＋ 建第一个，或者直接在这个目录下新建文件夹</span>";
      grid.appendChild(hint);
    }

    folders.forEach(function (f) {
      var wrap = document.createElement("div");
      wrap.className = "tile-wrap";

      var tile = document.createElement("button");
      tile.className = "tile";
      tile.type = "button";
      tile.dataset.id = f.id;
      tile.style.setProperty("--h", f.hue);
      tile.title = f.path + "（右键重命名或删除）";
      tile.innerHTML = faceHTML(f) + '<div class="tile-name">' + escapeHtml(f.name) + "</div>";

      tile.addEventListener("click", function () {
        openFolder(f.id);
      });

      tile.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        vscode.postMessage({ type: "cellMenu", folderId: f.id });
      });

      tile.addEventListener("dragover", function (e) {
        e.preventDefault();
        try {
          e.dataTransfer.dropEffect = "move";
        } catch (err) {}
        tile.classList.add("drop-target");
      });

      tile.addEventListener("dragleave", function () {
        tile.classList.remove("drop-target");
      });

      tile.addEventListener("drop", function (e) {
        e.preventDefault();
        tile.classList.remove("drop-target");
        var paths = readPaths(e.dataTransfer);
        if (paths.length) {
          vscode.postMessage({ type: "move", folderId: f.id, paths: paths });
        }
      });

      wrap.appendChild(tile);

      var edit = document.createElement("button");
      edit.className = "tile-edit";
      edit.type = "button";
      edit.title = "换个图标";
      edit.textContent = "🎨";
      edit.addEventListener("click", function (e) {
        e.stopPropagation();
        openIconPicker(f.id);
      });
      wrap.appendChild(edit);

      var search = document.createElement("button");
      search.className = "tile-search";
      search.type = "button";
      search.title = "在这个格子里搜索";
      search.textContent = "🔍";
      search.addEventListener("click", function (e) {
        e.stopPropagation();
        openFolder(f.id, true);
      });
      wrap.appendChild(search);

      grid.appendChild(wrap);
    });

    var add = document.createElement("button");
    add.className = "tile new";
    add.type = "button";
    add.innerHTML =
      '<div class="tile-face"><span class="icon">＋</span></div>' +
      '<div class="tile-name">新建格子</div>';
    add.addEventListener("click", function () {
      askText("新建格子", "新格子", function (name) {
        vscode.postMessage({ type: "newCell", name: name });
      });
    });
    grid.appendChild(add);
  }

  /* 格子封面的三种形态 */
  function faceHTML(f) {
    var icon = f.icon || { type: "auto" };
    var body;

    if (icon.type === "image" && icon.url) {
      body = '<img class="tile-img" src="' + escapeHtml(icon.url) + '" alt="" draggable="false" />';
    } else if (icon.type === "emoji" && icon.value) {
      body = '<span class="icon face-anim">' + escapeHtml(icon.value) + "</span>";
    } else if (!f.files.length) {
      body = '<span class="icon face-anim">' + escapeHtml(f.fallbackIcon || "📁") + "</span>";
    } else {
      body = miniGridHTML(f.files, Math.max(22, Math.round(desktopIconSize * 0.78)));
    }

    return (
      '<div class="tile-face">' +
      body +
      '<span class="badge">' + f.files.length + "</span>" +
      "</div>"
    );
  }

  /* 自动排列：取前 9 个文件的小图标，1/2/3 列自适应 */
  function miniGridHTML(files, width) {
    var picked = files.slice(0, 9);
    var n = picked.length;
    if (!n) return "";

    var cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    var w = width || (cols === 1 ? 44 : cols === 2 ? 56 : 64);
    var font = Math.max(8, Math.round((w / cols) * 0.55));

    var cells = picked
      .map(function (file) {
        return (
          '<i class="mini" style="--h:' + file.hue + ";font-size:" + font + 'px">' +
          escapeHtml(file.icon) +
          "</i>"
        );
      })
      .join("");

    return (
      '<div class="mini-grid face-anim" style="width:' + w + "px;grid-template-columns:repeat(" + cols + ',1fr)">' +
      cells +
      "</div>"
    );
  }

  /* ---------------- 放大 / 收起 ---------------- */

  function openFolder(id, focusSearch) {
    var f = findFolder(id);
    if (!f) return;

    currentId = id;

    /* 每次打开都从干净的搜索状态开始 */
    searchQuery = "";
    if (searchInput) searchInput.value = "";
    if (searchRow) searchRow.hidden = true;

    panelTitle.textContent = f.name;
    renderFiles(f);
    panel.style.setProperty("--h", f.hue);

    var tile = tileEl(id);
    var r = tile
      ? tile.getBoundingClientRect()
      : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 120, height: 120 };

    /* 卡片尺寸：不铺满，留出四周的网格 */
    var w = Math.max(300, Math.min(880, window.innerWidth - 88));
    var h = Math.max(240, Math.min(620, window.innerHeight - 132));
    var left = Math.round((window.innerWidth - w) / 2);
    var top = Math.round((window.innerHeight - h) / 2);
    var radius = Math.min(56, Math.round(h * 0.11));

    panel.classList.remove("open");
    panel.style.transition = "none";
    panel.style.top = r.top + "px";
    panel.style.left = r.left + "px";
    panel.style.width = r.width + "px";
    panel.style.height = r.height + "px";
    panel.style.borderRadius = "50%";
    panel.style.opacity = "0";

    overlay.hidden = false;
    overlay.classList.remove("show");
    void overlay.offsetWidth;
    overlay.classList.add("show");
    document.body.classList.add("modal-open");

    void panel.offsetWidth;

    panel.style.transition =
      "top .46s cubic-bezier(.22,1,.36,1)," +
      "left .46s cubic-bezier(.22,1,.36,1)," +
      "width .46s cubic-bezier(.22,1,.36,1)," +
      "height .46s cubic-bezier(.22,1,.36,1)," +
      "border-radius .52s cubic-bezier(.6,0,.3,1)," +
      "opacity .18s ease";

    panel.style.top = top + "px";
    panel.style.left = left + "px";
    panel.style.width = w + "px";
    panel.style.height = h + "px";
    panel.style.borderRadius = radius + "px";
    panel.style.opacity = "1";

    panel.classList.add("open");

    if (focusSearch) openSearch(true);
  }

  function closeFolder() {
    if (!currentId) return;

    if (previewPath) closePreview();

    var tile = tileEl(currentId);
    var r = tile
      ? tile.getBoundingClientRect()
      : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 1, height: 1 };

    panel.classList.remove("open");
    panel.style.transition =
      "top .38s ease, left .38s ease, width .38s ease, height .38s ease," +
      "border-radius .42s cubic-bezier(.6,0,.3,1), opacity .22s ease .1s";
    panel.style.top = r.top + "px";
    panel.style.left = r.left + "px";
    panel.style.width = r.width + "px";
    panel.style.height = r.height + "px";
    panel.style.borderRadius = Math.round(r.width * 0.21) + "px";
    panel.style.opacity = "0";

    overlay.classList.remove("show");
    document.body.classList.remove("modal-open");

    currentId = null;
    window.setTimeout(function () {
      if (currentId) return; /* 期间又打开了别的格子 */
      overlay.hidden = true;
      panel.style.opacity = "";
    }, 420);
  }

  /* ---------------- 文件卡片 ---------------- */

  function renderFiles(f) {
    filesEl.innerHTML = "";

    var list = f.files;
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      list = list.filter(function (file) {
        return file.name.toLowerCase().indexOf(q) !== -1;
      });
    }

    panelCount.textContent = searchQuery
      ? list.length + " / " + f.files.length + " 个匹配"
      : f.files.length + " 个项目";

    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "files-empty";
      empty.innerHTML = searchQuery
        ? "没有匹配「" +
          escapeHtml(searchQuery) +
          "」的文件<br><span>换个关键词，或者点右上角清空搜索</span>"
        : "这个格子还是空的<br><span>从资源管理器把文件拖到格子上，就会移进这个文件夹</span>";
      filesEl.appendChild(empty);
      return;
    }

    list.forEach(function (file) {
      var el = document.createElement("button");
      el.className = "file";
      el.type = "button";
      el.style.setProperty("--h", file.hue);
      el.title = file.path;

      var thumb = file.thumb
        ? '<div class="thumb"><img src="' + escapeHtml(file.thumb) + '" alt="" draggable="false" /></div>'
        : '<div class="thumb"><span>' + escapeHtml(file.icon) + "</span></div>";

      el.innerHTML =
        thumb +
        '<div class="fbody">' +
        '<div class="fname">' +
        escapeHtml(file.name) +
        "</div>" +
        '<div class="fmeta">' +
        escapeHtml(file.sizeLabel) +
        " · " +
        escapeHtml(file.whenLabel) +
        "</div>" +
        "</div>" +
        '<span class="reveal" title="在资源管理器中显示">↗</span>';

      el.addEventListener("click", function (e) {
        if (e.target && e.target.classList.contains("reveal")) return;
        if (file.isDir) {
          vscode.postMessage({ type: "reveal", path: file.path });
          return;
        }
        if (!previewable(file.name)) {
          vscode.postMessage({ type: "open", path: file.path });
          return;
        }
        /* 单击先等 220ms：如果紧接着来了双击，就取消预览直接打开 */
        clearTimeout(previewClickTimer);
        previewClickTimer = setTimeout(function () {
          previewClickTimer = null;
          openPreview(file, el);
        }, 220);
      });

      el.addEventListener("dblclick", function () {
        clearTimeout(previewClickTimer);
        previewClickTimer = null;
        if (previewPath) closePreview();
        vscode.postMessage({ type: "open", path: file.path });
      });

      var star = el.querySelector(".reveal");
      if (star) {
        star.addEventListener("click", function (e) {
          e.stopPropagation();
          vscode.postMessage({ type: "reveal", path: file.path });
        });
      }

      filesEl.appendChild(el);
    });
  }

  function refreshOpen() {
    if (!currentId) return;
    var f = findFolder(currentId);
    if (!f) {
      closeFolder();
      return;
    }
    var keep = filesEl.scrollTop;
    panelTitle.textContent = f.name;
    renderFiles(f);
    filesEl.scrollTop = keep; /* 自动刷新时别把滚动位置弹回顶部 */
  }

  /* ---------------- 格内搜索 ---------------- */

  function openSearch(focus) {
    if (!searchRow) return;
    searchRow.hidden = false;
    if (focus) {
      searchInput.focus();
      vscode.postMessage({ type: "focusInput", id: "searchInput" });
    }
  }

  function closeSearch() {
    if (!searchRow) return;
    searchRow.hidden = true;
    searchQuery = "";
    searchInput.value = "";
    var f = findFolder(currentId);
    if (f) renderFiles(f);
  }

  /* ---------------- 文档预览 ---------------- */

  var previewEls = null;
  var previewPath = null;
  var previewSource = null;

  function ensurePreview() {
    if (previewEls) return previewEls;

    var layer = document.createElement("div");
    layer.className = "preview-layer";
    layer.hidden = true;
    layer.innerHTML =
      '<div class="preview-card">' +
      '<div class="preview-head">' +
      '<span class="preview-icon" id="pvIcon">📄</span>' +
      '<span class="preview-title" id="pvTitle"></span>' +
      '<span class="preview-kind" id="pvKind"></span>' +
      '<button class="preview-close" id="pvClose" type="button" title="关闭 (Esc)">✕</button>' +
      "</div>" +
      '<div class="preview-body" id="pvBody"></div>' +
      "</div>";
    document.body.appendChild(layer);

    layer.addEventListener("click", function (e) {
      if (e.target === layer) closePreview();
    });
    layer.querySelector("#pvClose").addEventListener("click", closePreview);

    previewEls = {
      layer: layer,
      card: layer.querySelector(".preview-card"),
      icon: layer.querySelector("#pvIcon"),
      title: layer.querySelector("#pvTitle"),
      kind: layer.querySelector("#pvKind"),
      body: layer.querySelector("#pvBody")
    };
    return previewEls;
  }

  function extLabel(name) {
    var i = name.lastIndexOf(".");
    return i > 0 ? name.slice(i + 1).toUpperCase() : "FILE";
  }

  /* 只有这几种走预览，其他格式单击就直接打开 */
  var PREVIEWABLE = ["MD", "MARKDOWN", "TXT", "LOG", "DOCX", "DOC", "PDF"];

  function previewable(name) {
    return PREVIEWABLE.indexOf(extLabel(name)) !== -1;
  }

  function fallbackRect() {
    return {
      top: Math.round(window.innerHeight / 2 - 40),
      left: Math.round(window.innerWidth / 2 - 40),
      width: 80,
      height: 80
    };
  }

  function openPreview(file, el) {
    var p = ensurePreview();
    previewPath = file.path;
    previewSource = el;

    p.title.textContent = file.name;
    p.icon.textContent = file.icon || "📄";
    p.kind.textContent = extLabel(file.name);
    p.body.scrollTop = 0;
    p.body.innerHTML = '<div class="pv-loading">正在读取…</div>';

    var r = el && el.isConnected ? el.getBoundingClientRect() : null;
    if (!r || !r.width) r = fallbackRect();

    var w = Math.max(320, Math.min(900, window.innerWidth - 80));
    var h = Math.max(260, Math.min(680, window.innerHeight - 110));
    var left = Math.round((window.innerWidth - w) / 2);
    var top = Math.round((window.innerHeight - h) / 2);
    var radius = Math.min(52, Math.round(h * 0.1));

    var card = p.card;
    card.classList.remove("open");
    card.style.transition = "none";
    card.style.top = r.top + "px";
    card.style.left = r.left + "px";
    card.style.width = r.width + "px";
    card.style.height = r.height + "px";
    card.style.borderRadius = "50%";
    card.style.opacity = "0";

    p.layer.hidden = false;

    void card.offsetWidth;

    card.style.transition =
      "top .42s cubic-bezier(.22,1,.36,1)," +
      "left .42s cubic-bezier(.22,1,.36,1)," +
      "width .42s cubic-bezier(.22,1,.36,1)," +
      "height .42s cubic-bezier(.22,1,.36,1)," +
      "border-radius .48s cubic-bezier(.6,0,.3,1)," +
      "opacity .18s ease";

    card.style.top = top + "px";
    card.style.left = left + "px";
    card.style.width = w + "px";
    card.style.height = h + "px";
    card.style.borderRadius = radius + "px";
    card.style.opacity = "1";
    card.classList.add("open");

    vscode.postMessage({ type: "preview", path: file.path });
  }

  function closePreview() {
    if (!previewEls || !previewPath) return;

    var card = previewEls.card;
    var el = previewSource;
    var r = el && el.isConnected ? el.getBoundingClientRect() : null;
    if (!r || !r.width) r = fallbackRect();

    card.classList.remove("open");
    card.style.transition =
      "top .3s ease, left .3s ease, width .3s ease, height .3s ease," +
      "border-radius .34s ease, opacity .2s ease .06s";
    card.style.top = r.top + "px";
    card.style.left = r.left + "px";
    card.style.width = r.width + "px";
    card.style.height = r.height + "px";
    card.style.borderRadius = "50%";
    card.style.opacity = "0";

    previewPath = null;
    previewSource = null;

    window.setTimeout(function () {
      if (previewPath) return;
      previewEls.layer.hidden = true;
    }, 320);
  }

  function renderPreview(data) {
    var p = ensurePreview();
    if (data.label) p.kind.textContent = data.label;

    if (data.kind === "markdown") {
      p.body.innerHTML = '<div class="pv-doc">' + renderMarkdown(data.text || "") + "</div>";
    } else if (data.kind === "html") {
      p.body.innerHTML = '<div class="pv-doc">' + (data.html || "") + "</div>";
    } else {
      p.body.innerHTML =
        '<div class="pv-fallback">' +
        '<div class="pv-badge">' + escapeHtml(data.label || "文件") + "</div>" +
        '<div class="pv-hint">' + escapeHtml(data.hint || "这个格式暂不支持预览") + "</div>" +
        '<button class="pv-open" type="button">用默认程序打开</button>' +
        "</div>";

      var btn = p.body.querySelector(".pv-open");
      var target = previewPath;
      if (btn && target) {
        btn.addEventListener("click", function () {
          vscode.postMessage({ type: "open", path: target });
        });
      }
    }
    p.body.scrollTop = 0;
  }

  /* 极简 Markdown：标题 / 列表 / 引用 / 代码块 / 行内样式，够看文档就行 */
  function renderMarkdown(src) {
    var lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var list = null;
    var i = 0;

    function closeList() {
      if (list) {
        out.push("</" + list + ">");
        list = null;
      }
    }

    while (i < lines.length) {
      var line = lines[i];

      if (/^```/.test(line)) {
        closeList();
        var code = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        i++;
        out.push('<pre class="pv-code"><code>' + escapeHtml(code.join("\n")) + "</code></pre>");
        continue;
      }

      if (!line.trim()) {
        closeList();
        i++;
        continue;
      }

      var heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        var lv = heading[1].length;
        out.push("<h" + lv + ">" + inlineMd(heading[2]) + "</h" + lv + ">");
        i++;
        continue;
      }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        closeList();
        out.push("<hr />");
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        closeList();
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        out.push("<blockquote>" + inlineMd(quote.join(" ")) + "</blockquote>");
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        if (list !== "ul") {
          closeList();
          out.push("<ul>");
          list = "ul";
        }
        out.push("<li>" + inlineMd(line.replace(/^\s*[-*+]\s+/, "")) + "</li>");
        i++;
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        if (list !== "ol") {
          closeList();
          out.push("<ol>");
          list = "ol";
        }
        out.push("<li>" + inlineMd(line.replace(/^\s*\d+[.)]\s+/, "")) + "</li>");
        i++;
        continue;
      }

      closeList();
      var buf = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,6}\s|>|```|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      out.push("<p>" + inlineMd(buf.join(" ")) + "</p>");
    }

    closeList();
    return out.join("\n");
  }

  function inlineMd(text) {
    var s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<span class="pv-img">🖼️ $1</span>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, href) {
      if (!/^(https?:|#|\/|\.)/i.test(href)) return label;
      return '<a href="' + href + '">' + label + "</a>";
    });
    return s;
  }

  /* ---------------- 图标选择 ---------------- */

  var EMOJI_SET = [
    "📁", "💼", "🖼️", "🎬", "🎵", "📝", "📚", "🧩",
    "🗂️", "🧾", "⭐", "❤️", "🔥", "⚡", "🎯", "🚀",
    "🌱", "☕", "🍀", "🏠", "💡", "🛠️", "📦", "🎨"
  ];

  var pickerId = null;
  var pendingIconData = null;
  var iconModal = null;

  function buildModal() {
    var el = document.createElement("div");
    el.className = "modal-backdrop";
    el.hidden = true;
    el.innerHTML =
      '<div class="modal">' +
      '<div class="modal-head">' +
      '<div class="modal-title" id="iconTitle">选择图标</div>' +
      '<button class="modal-close" id="iconClose" type="button" title="关闭">✕</button>' +
      "</div>" +
      '<div class="modal-body">' +
      '<div class="modal-label">跟随里面的文件</div>' +
      '<div id="autoRow"></div>' +
      '<div class="modal-label">内置图标</div>' +
      '<div class="emoji-grid" id="emojiGrid"></div>' +
      '<div class="modal-label">自定义图片</div>' +
      '<div class="upload-row">' +
      '<button class="pick-btn" id="pickBtn" type="button">选择图片…</button>' +
      '<span class="upload-hint">居中等比裁成正方形</span>' +
      "</div>" +
      '<div class="crop-preview" id="cropPreview" hidden>' +
      '<img id="cropImg" alt="" />' +
      '<div class="crop-actions">' +
      '<button class="btn-primary" id="applyIcon" type="button">应用</button>' +
      '<button class="btn-ghost" id="cancelIcon" type="button">取消</button>' +
      "</div>" +
      "</div>" +
      '<input type="file" id="iconFile" accept="image/*" style="display:none" />' +
      "</div>" +
      "</div>";
    document.body.appendChild(el);

    el.addEventListener("click", function (e) {
      if (e.target === el) closeIconPicker();
    });

    el.querySelector("#iconClose").addEventListener("click", closeIconPicker);

    el.querySelector("#pickBtn").addEventListener("click", function () {
      el.querySelector("#iconFile").click();
    });

    el.querySelector("#iconFile").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      cropSquare(
        file,
        256,
        function (dataUrl) {
          pendingIconData = dataUrl;
          el.querySelector("#cropImg").src = dataUrl;
          el.querySelector("#cropPreview").hidden = false;
        },
        function () {
          toast("这张图读不出来，换一张试试");
        }
      );
    });

    el.querySelector("#applyIcon").addEventListener("click", function () {
      if (!pendingIconData || !pickerId) return;
      vscode.postMessage({
        type: "setIcon",
        folderId: pickerId,
        icon: { type: "image" },
        dataUrl: pendingIconData
      });
      closeIconPicker();
    });

    el.querySelector("#cancelIcon").addEventListener("click", function () {
      pendingIconData = null;
      el.querySelector("#cropPreview").hidden = true;
    });

    return el;
  }

  /* 居中正方形等比裁剪，缩放成 size×size 的 PNG */
  function cropSquare(file, size, ok, fail) {
    var reader = new FileReader();
    reader.onerror = fail;
    reader.onload = function () {
      var img = new Image();
      img.onerror = fail;
      img.onload = function () {
        var side = Math.min(img.width, img.height);
        var sx = Math.round((img.width - side) / 2);
        var sy = Math.round((img.height - side) / 2);
        var canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        ok(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function openIconPicker(folderId) {
    var f = findFolder(folderId);
    if (!f) return;
    if (!iconModal) iconModal = buildModal();

    pickerId = folderId;
    pendingIconData = null;

    var icon = f.icon || { type: "auto" };
    var curType = icon.type || "auto";

    iconModal.querySelector("#iconTitle").textContent = "图标 · " + f.name;

    var autoRow = iconModal.querySelector("#autoRow");
    autoRow.innerHTML = "";

    var previewHTML = f.files.length
      ? miniGridHTML(f.files, 40)
      : '<span style="font-size:22px">' + escapeHtml(f.fallbackIcon || "📁") + "</span>";

    var autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "auto-opt" + (curType === "auto" ? " active" : "");
    autoBtn.innerHTML =
      '<span class="auto-preview">' +
      previewHTML +
      "</span>" +
      '<span class="auto-text">自动排列<em>当前 ' +
      f.files.length +
      " 个文件</em></span>";
    autoBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "setIcon", folderId: f.id, icon: { type: "auto" } });
      closeIconPicker();
    });
    autoRow.appendChild(autoBtn);

    var emojiGrid = iconModal.querySelector("#emojiGrid");
    emojiGrid.innerHTML = "";
    EMOJI_SET.forEach(function (emoji) {
      var b = document.createElement("button");
      b.type = "button";
      b.className =
        "emoji-btn" + (curType === "emoji" && icon.value === emoji ? " active" : "");
      b.textContent = emoji;
      b.addEventListener("click", function () {
        vscode.postMessage({
          type: "setIcon",
          folderId: f.id,
          icon: { type: "emoji", value: emoji }
        });
        closeIconPicker();
      });
      emojiGrid.appendChild(b);
    });

    iconModal.querySelector("#cropPreview").hidden = true;
    iconModal.hidden = false;
  }

  function closeIconPicker() {
    if (!iconModal) return;
    iconModal.hidden = true;
    pickerId = null;
    pendingIconData = null;
  }

  /* ---------------- 文字输入弹窗（桌面端没有 showInputBox） ---------------- */

  var textModal = null;

  function askText(title, initial, onOk) {
    if (!textModal) {
      var el = document.createElement("div");
      el.className = "modal-backdrop";
      el.hidden = true;
      el.innerHTML =
        '<div class="modal prompt-modal">' +
        '<div class="modal-head">' +
        '<div class="modal-title" id="askTitle"></div>' +
        '<button class="modal-close" id="askClose" type="button">✕</button>' +
        "</div>" +
        '<div class="modal-body">' +
        '<input class="prompt-input" id="askInput" type="text" />' +
        '<div class="prompt-actions">' +
        '<button class="btn-ghost" id="askCancel" type="button">取消</button>' +
        '<button class="btn-primary" id="askOk" type="button">确定</button>' +
        "</div>" +
        "</div>" +
        "</div>";
      document.body.appendChild(el);

      function hide() {
        el.hidden = true;
      }

      function submit() {
        var v = el.querySelector("#askInput").value.trim();
        if (!v) {
          el.querySelector("#askInput").focus();
          return;
        }
        hide();
        if (textModal.onOk) textModal.onOk(v);
      }

      el.addEventListener("click", function (e) {
        if (e.target === el) hide();
      });
      el.querySelector("#askClose").addEventListener("click", hide);
      el.querySelector("#askCancel").addEventListener("click", hide);
      el.querySelector("#askOk").addEventListener("click", submit);
      el.querySelector("#askInput").addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          hide();
        }
      });

      textModal = { el: el, onOk: null };
    }

    textModal.onOk = onOk;
    textModal.el.querySelector("#askTitle").textContent = title;
    var input = textModal.el.querySelector("#askInput");
    input.value = initial || "";
    textModal.el.hidden = false;
    input.focus();
    input.select();
    vscode.postMessage({ type: "focusInput", id: "askInput" });
  }

  /* ---------------- 事件 ---------------- */

  window.fg.onMessage(function (e) {
    var msg = e.data;
    if (!msg || !msg.type) return;

    if (msg.type === "state") {
      folders = (msg.payload && msg.payload.folders) || [];
      var desktop = msg.payload && msg.payload.desktop;
      if (desktop) {
        desktopIconSize = Math.max(32, Math.min(128, Number(desktop.iconSize) || 48));
        document.body.style.setProperty("--desktop-icon-size", desktopIconSize + "px");
      }
      if (rootPathEl) rootPathEl.textContent = (msg.payload && msg.payload.root) || "";
      render();
      refreshOpen();
    } else if (msg.type === "inputFocused") {
      var focusEl = document.getElementById(msg.id);
      if (focusEl) focusEl.focus();
    } else if (msg.type === "requestRenameCell") {
      var renameTarget = findFolder(msg.folderId);
      if (renameTarget) askText("重命名格子", renameTarget.name, function (name) { vscode.postMessage({ type: "renameCell", folderId: renameTarget.id, name: name }); });
    } else if (msg.type === "requestNewCell") {
      askText("新建格子", "新格子", function (name) { vscode.postMessage({ type: "newCell", name: name }); });
    } else if (msg.type === "previewData") {
      if (msg.path === previewPath) renderPreview(msg.payload || {});
    } else if (msg.type === "toast") {
      toast(msg.message || "");
    }
  });

  // 预览中的链接交给系统浏览器，应用窗口始终停留在格子页面。
  document.addEventListener("click", function (event) {
    var link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    var href = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) vscode.postMessage({ type: "openExternal", url: href });
    else toast("此链接暂不支持，请在原文档中打开");
  });
  document.addEventListener("dragover", function (event) { event.preventDefault(); });
  document.addEventListener("drop", function (event) { event.preventDefault(); });

  backBtn.addEventListener("click", closeFolder);

  if (rootPathEl) {
    rootPathEl.addEventListener("click", function () {
      vscode.postMessage({ type: "pickRoot" });
    });
  }

  if (newBtn) {
    newBtn.addEventListener("click", function () {
      askText("新建格子", "新格子", function (name) {
        vscode.postMessage({ type: "newCell", name: name });
      });
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "refresh" });
    });
  }

  if (revealBtn) {
    revealBtn.addEventListener("click", function () {
      var f = findFolder(currentId);
      if (f) vscode.postMessage({ type: "reveal", path: f.path });
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener("click", function () {
      if (searchRow.hidden) openSearch(true);
      else closeSearch();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      searchQuery = searchInput.value.trim();
      var f = findFolder(currentId);
      if (f) renderFiles(f);
    });

    /* 在搜索框里按 Esc 只收起搜索，不要顺手把整张卡关了 */
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSearch();
      }
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", function () {
      searchInput.value = "";
      searchQuery = "";
      var f = findFolder(currentId);
      if (f) renderFiles(f);
      searchInput.focus();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (currentId && (e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      openSearch(true);
    }
  });

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeFolder();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (textModal && !textModal.el.hidden) return;
    if (iconModal && !iconModal.hidden) {
      closeIconPicker();
      return;
    }
    if (previewPath) {
      closePreview();
      return;
    }
    if (searchRow && !searchRow.hidden) {
      closeSearch();
      return;
    }
    if (currentId) closeFolder();
  });

  window.addEventListener("resize", function () {
    if (currentId) closeFolder();
  });

  document.getElementById("rootBtn").addEventListener("click", function () { vscode.postMessage({ type: "pickRoot" }); });
  document.getElementById("menuBtn").addEventListener("click", function () { vscode.postMessage({ type: "desktopMenu" }); });

  // 使用真实窗口区域裁剪，鼠标经过时不再切换透明/透传窗口样式。
  var regionsPending = false, lastRegions = "", regionUntil = 0;
  function scheduleRegions() {
    regionUntil = performance.now() + 550;
    if (regionsPending) return;
    regionsPending = true;
    requestAnimationFrame(reportRegions);
  }
  function reportRegions() {
    var rects = [];
    document.querySelectorAll(".topbar, .tile-wrap, .tile.new, .empty-hint, .panel, .preview-card, .modal, .toast.show").forEach(function (el) {
      if (el.closest("[hidden]")) return;
      var box = el.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) return;
      if (el.classList.contains("panel") && !el.classList.contains("open")) return;
      var pad = 12;
      rects.push({ x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(innerWidth, box.right + pad) - Math.max(0, box.x - pad), height: Math.min(innerHeight, box.bottom + pad) - Math.max(0, box.y - pad) });
    });
    var key = JSON.stringify(rects);
    if (key !== lastRegions) { lastRegions = key; vscode.postMessage({ type: "desktopRegions", rects: rects }); }
    if (performance.now() < regionUntil) requestAnimationFrame(reportRegions);
    else regionsPending = false;
  }
  new MutationObserver(scheduleRegions).observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["hidden", "class", "style"] });
  document.addEventListener("scroll", scheduleRegions, true);
  window.addEventListener("resize", scheduleRegions);
  document.addEventListener("focusin", function (event) {
    if (event.target.id === "askInput" || event.target.id === "searchInput") vscode.postMessage({ type: "focusInput", id: event.target.id });
  });
  scheduleRegions();

  render();
  vscode.postMessage({ type: "ready" });
})();
