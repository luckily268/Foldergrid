export function showSpreadsheet(host,bytes){
  const worker=new Worker(new URL('./sheet-worker.js',import.meta.url));
  let disposed=false;
  const timeout=setTimeout(()=>fail('表格解析超时，请用默认程序打开。'),10000);
  function fail(message){if(disposed)return;clearTimeout(timeout);worker.terminate();host.textContent=message;}
  worker.onerror=()=>fail('表格组件加载失败，请用默认程序打开。');
  worker.onmessage=({data})=>{
    if(disposed)return;
    clearTimeout(timeout);worker.terminate();
    if(data.error){host.textContent=data.error;return;}
    const result=data.result;
    const tabs=document.createElement('nav');tabs.className='sheet-tabs';tabs.setAttribute('aria-label','工作表');
    const status=document.createElement('p');status.className='sheet-status';
    const viewport=document.createElement('div');viewport.className='sheet-viewport';viewport.tabIndex=0;
    host.replaceChildren(tabs,status,viewport);
    function select(index){
      const sheet=result.sheets[index];
      [...tabs.children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
      status.textContent='只读预览 · 公式显示已保存的结果'+(sheet.truncated?' · 显示前 '+result.limits.rows+' 行 / '+result.limits.columns+' 列':'')+(result.limitedSheets?' · 显示前 '+result.limits.sheets+' 个工作表':'');
      viewport.replaceChildren();viewport.scrollTop=0;viewport.scrollLeft=0;
      if(!sheet.rows.length){viewport.textContent='此工作表在预览范围内没有内容';return;}
      const table=document.createElement('table');table.className='sheet-table';table.setAttribute('aria-label',sheet.name);
      const head=table.createTHead().insertRow();head.append(document.createElement('th'));
      sheet.columns.forEach(column=>{const th=document.createElement('th');th.scope='col';th.textContent=column;head.append(th);});
      const body=table.createTBody();
      sheet.rows.forEach((values,index)=>{
        const row=body.insertRow(),number=document.createElement('th');number.scope='row';number.textContent=String(sheet.startRow+index);row.append(number);
        values.forEach(value=>{const cell=row.insertCell();cell.textContent=value;});
      });
      viewport.append(table);
    }
    result.sheets.forEach((sheet,index)=>{const button=document.createElement('button');button.type='button';button.textContent=sheet.name;button.onclick=()=>select(index);tabs.append(button);});
    if(result.sheets.length)select(0);else host.textContent='工作簿没有可预览的工作表';
  };
  worker.postMessage(bytes);
  return ()=>{disposed=true;clearTimeout(timeout);worker.terminate();};
}
