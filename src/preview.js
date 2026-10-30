"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const PREVIEW_LIMIT = 12 * 1024 * 1024;

function readZipEntry(buf, wanted) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const outputSize = buf.readUInt32LE(p + 24);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (name === wanted) {
      if (outputSize > PREVIEW_LIMIT || localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      if (start + compSize > buf.length) return null;
      const raw = buf.subarray(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: PREVIEW_LIMIT });
      return null;
    }

    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/* w:t 里的文本已经是 XML 转义过的，直接拼进 HTML 是安全的，不要 decode */
function docxToHtml(buf) {
  let xml = null;
  try {
    xml = readZipEntry(buf, "word/document.xml");
  } catch (err) {
    xml = null;
  }
  if (!xml) return '<p class="pv-note">这个 .docx 读不出正文，可能文件结构不标准。</p>';

  const paras = xml.toString("utf8").split(/<\/w:p>/);
  const out = [];

  paras.forEach(function (para) {
    const runs = para.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g);
    if (!runs) return;

    let text = "";
    runs.forEach(function (run) {
      text += run.replace(/<[^>]*>/g, "");
    });
    if (!text.trim()) return;

    const style = para.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
    const val = style ? style[1] : "";
    const heading = val.match(/^heading\s*(\d)$/i) || val.match(/^(\d)$/);

    if (heading && Number(heading[1]) <= 6) {
      out.push("<h" + heading[1] + ">" + text + "</h" + heading[1] + ">");
    } else {
      out.push("<p>" + text + "</p>");
    }
  });

  if (!out.length) return '<p class="pv-note">这个文档里没有可提取的文字。</p>';
  return out.join("\n");
}

function readPreview(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (err) {
    return { kind: "unsupported", label: "读取失败", hint: "文件可能已经被移走或删除" };
  }
  if (!st.isFile()) return { kind: "unsupported", label: "文件夹", hint: "请在资源管理器中打开" };
  if (st.size > PREVIEW_LIMIT) {
    return { kind: "unsupported", label: ext.toUpperCase(), hint: "文件超过 12MB，请用默认程序打开" };
  }

  if (ext === "md" || ext === "markdown" || ext === "txt" || ext === "log") {
    return { kind: "markdown", text: fs.readFileSync(filePath, "utf8") };
  }

  if (ext === "docx") {
    return { kind: "html", html: docxToHtml(fs.readFileSync(filePath)) };
  }

  if (ext === "pdf") {
    return {
      kind: "unsupported",
      label: "PDF",
      hint: "PDF 需要 pdf.js 这类渲染引擎才能内嵌显示，现在请用默认程序打开"
    };
  }

  if (ext === "doc") {
    return {
      kind: "unsupported",
      label: "DOC",
      hint: "Word 97 的二进制格式没有可靠的纯文本提取方式，请用默认程序打开"
    };
  }

  return { kind: "unsupported", label: ext.toUpperCase() || "文件", hint: "这个格式暂不支持内嵌预览" };
}


module.exports = { readPreview, readZipEntry, docxToHtml };
