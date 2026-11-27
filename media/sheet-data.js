(function(root){
  'use strict';
  const LIMITS={rows:500,columns:50,sheets:20};
  function readWorkbook(bytes,XLSX){
    const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    if(data.length>12*1024*1024)throw Error('表格超过 12MB，请用默认程序打开');
    if(data[0]!==0x50||data[1]!==0x4b)throw Error('文件不是可读取的 XLSX，可能已加密或损坏，请用 Excel 打开');
    const names=XLSX.read(data,{type:'array',bookSheets:true}).SheetNames;
    const selected=names.slice(0,LIMITS.sheets);
    const workbook=XLSX.read(data,{type:'array',sheets:selected,sheetRows:LIMITS.rows+1,dense:true,cellHTML:false,cellText:true,cellFormula:true});
    const sheets=selected.map(name=>{
      const sheet=workbook.Sheets[name];
      if(!sheet||!sheet['!ref'])return {name,rows:[],columns:[],startRow:1,truncated:false};
      const full=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);
      const range=XLSX.utils.decode_range(sheet['!ref']);
      const endRow=Math.min(range.e.r,LIMITS.rows-1),endCol=Math.min(range.e.c,range.s.c+LIMITS.columns-1);
      const rows=[],columns=[];
      for(let c=range.s.c;c<=endCol;c++)columns.push(XLSX.utils.encode_col(c));
      for(let r=range.s.r;r<=endRow;r++){
        const row=[];
        for(let c=range.s.c;c<=endCol;c++){
          const cell=sheet['!data']?.[r]?.[c]||sheet[XLSX.utils.encode_cell({r,c})];
          row.push(cell?String(cell.w??(cell.v!==undefined?XLSX.utils.format_cell(cell):cell.f?'='+cell.f:'')).slice(0,10000):'');
        }
        rows.push(row);
      }
      return {name,rows,columns,startRow:range.s.r+1,truncated:full.e.r>=LIMITS.rows||full.e.c-range.s.c>=LIMITS.columns};
    });
    return {sheets,limitedSheets:names.length>selected.length,limits:LIMITS};
  }
  if(typeof module==='object'&&module.exports)module.exports={readWorkbook,LIMITS};
  else root.sheetData={readWorkbook,LIMITS};
})(typeof self==='undefined'?globalThis:self);
