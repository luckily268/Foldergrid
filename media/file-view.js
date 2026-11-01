(function (root) {
  "use strict";
  const groups = {
    document: "pdf doc docx xls xlsx ppt pptx txt md markdown log csv rtf odt ods odp",
    image: "png jpg jpeg gif webp bmp avif heic svg ico tiff",
    video: "mp4 mov mkv avi webm m4v", audio: "mp3 wav flac m4a ogg aac",
    archive: "zip rar 7z tar gz xz", shortcut: "lnk url"
  };
  function category(file) {
    if (file.isDir) return "folder";
    const ext = file.extension || file.name.split(".").pop().toLowerCase();
    return Object.keys(groups).find(key => groups[key].split(" ").includes(ext)) || "other";
  }
  function select(files, query, type, sort) {
    const tokens = String(query || "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return files.filter(f => (!type || type === "all" || category(f) === type) && tokens.every(t => (f.name + " " + (f.folderName || "")).toLocaleLowerCase().includes(t))).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let diff = 0;
      if (sort === "newest") diff = (b.mtimeMs || 0) - (a.mtimeMs || 0);
      if (sort === "size") diff = (b.size || 0) - (a.size || 0);
      if (sort === "type") diff = (a.extension || "").localeCompare(b.extension || "");
      return diff || a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    });
  }
  const api = { category, select };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.fileView = api;
})(typeof window === "undefined" ? globalThis : window);
