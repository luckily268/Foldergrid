'use strict';
importScripts('./vendor/xlsx/xlsx.mini.min.js','./sheet-data.js');
self.onmessage=event=>{
  try{self.postMessage({result:self.sheetData.readWorkbook(event.data,self.XLSX)});}
  catch(_){self.postMessage({error:'表格无法预览，文件可能已加密、损坏或格式不受支持。请用默认程序打开。'});}
};
