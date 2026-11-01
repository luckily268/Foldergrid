import { getDocument, GlobalWorkerOptions } from './vendor/pdfjs/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

// A single page at a time bounds memory and allows cancellation when switching files.
export function showPDF(host, bytes, onError) {
  let disposed = false, documentPDF, renderTask, task, pageNumber = 1, zoom = 1, fit = true, sequence = 0, resizeTimer;
  host.innerHTML = '<div class="pdf-toolbar"><button id="pdfPrev" title="上一页">←</button><input id="pdfPage" type="number" value="1" min="1" aria-label="页码" /><span id="pdfCount">/ —</span><button id="pdfNext" title="下一页">→</button><button id="pdfMinus" title="缩小">−</button><span id="pdfZoom">适应宽度</span><button id="pdfPlus" title="放大">＋</button><button id="pdfFit">适应宽度</button></div><div class="pdf-status" role="status">正在载入 PDF…</div><div class="pdf-stage"></div>';
  const stage = host.querySelector('.pdf-stage'), status = host.querySelector('.pdf-status'), input = host.querySelector('#pdfPage');
  const controls = [...host.querySelectorAll('button,input')]; controls.forEach(b => b.disabled = true);
  async function render() {
    if (disposed || !documentPDF) return;
    const id = ++sequence; renderTask?.cancel();
    status.textContent = '正在绘制第 ' + pageNumber + ' 页…';
    try {
      const page = await documentPDF.getPage(pageNumber);
      if (disposed || id !== sequence) return;
      const base = page.getViewport({ scale: 1 });
      const scale = fit ? Math.max(.1, (stage.clientWidth - 32) / base.width) : zoom;
      const viewport = page.getViewport({ scale });
      // Guard against unusually large PDF pages and large display scale factors.
      const pixelScale = Math.min(devicePixelRatio || 1, 2, 8192 / viewport.width, 8192 / viewport.height, Math.sqrt(12000000 / (viewport.width * viewport.height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width * pixelScale)); canvas.height = Math.max(1, Math.floor(viewport.height * pixelScale));
      canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
      const current = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [pixelScale, 0, 0, pixelScale, 0, 0] });
      renderTask = current; await current.promise;
      if (disposed || id !== sequence) return;
      stage.replaceChildren(canvas); stage.dataset.renderedPage = String(pageNumber);
      input.value = pageNumber; host.querySelector('#pdfCount').textContent = '/ ' + documentPDF.numPages;
      host.querySelector('#pdfZoom').textContent = Math.round(scale * 100) + '%';
      host.querySelector('#pdfPrev').disabled = pageNumber <= 1; host.querySelector('#pdfNext').disabled = pageNumber >= documentPDF.numPages;
      status.textContent = '第 ' + pageNumber + ' / ' + documentPDF.numPages + ' 页';
      zoom = scale;
    } catch (error) {
      if (!disposed && id === sequence && error.name !== 'RenderingCancelledException') status.textContent = '此页无法绘制：' + error.message;
    }
  }
  function go(page) { if (!documentPDF) return; pageNumber = Math.max(1, Math.min(documentPDF.numPages, Math.trunc(Number(page) || 1))); render(); }
  host.querySelector('#pdfPrev').onclick = () => go(pageNumber - 1);
  host.querySelector('#pdfNext').onclick = () => go(pageNumber + 1);
  input.onchange = () => go(input.value);
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(input.value); } };
  host.querySelector('#pdfMinus').onclick = () => { fit = false; zoom = Math.max(.2, zoom / 1.25); render(); };
  host.querySelector('#pdfPlus').onclick = () => { fit = false; zoom = Math.min(4, zoom * 1.25); render(); };
  host.querySelector('#pdfFit').onclick = () => { fit = true; render(); };
  let lastWidth = 0;
  const observer = new ResizeObserver(() => {
    if (!fit || stage.clientWidth === lastWidth) return;
    lastWidth = stage.clientWidth; clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 70);
  }); observer.observe(stage);
  task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, enableXfa: false,
    cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href, cMapPacked: true,
    iccUrl: new URL('./vendor/pdfjs/iccs/', import.meta.url).href,
    standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('./vendor/pdfjs/wasm/', import.meta.url).href });
  task.promise.then(pdf => {
    if (disposed) return;
    documentPDF = pdf; controls.forEach(b => b.disabled = false); input.max = pdf.numPages; render();
  }).catch(error => {
    if (disposed) return;
    const message = error.name === 'PasswordException' ? '此 PDF 已加密，请使用默认阅读器输入密码打开。' : 'PDF 无法读取，文件可能损坏或格式不完整。';
    status.textContent = message; onError?.(message);
  });
  return () => { disposed = true; sequence++; clearTimeout(resizeTimer); observer.disconnect(); renderTask?.cancel(); task.destroy().catch(() => {}); };
}
