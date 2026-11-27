const XLSX=require('../media/vendor/xlsx/xlsx.mini.min.js');
module.exports=function(){
  const book=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([['项目','金额','完成率','日期'],['研发',1234.5,.25,45292],['<img src=x onerror=alert(1)>',0,0,0]]);
  sheet.B2.z='#,##0.00';sheet.C2.z='0%';sheet.D2.z='yyyy-mm-dd';sheet.B3={t:'n',v:1234.5,f:'SUM(B2:B2)',z:'#,##0.00'};
  XLSX.utils.book_append_sheet(book,sheet,'项目总览');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['第二张表'],['对比内容']]),'明细');
  return XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:true});
};
