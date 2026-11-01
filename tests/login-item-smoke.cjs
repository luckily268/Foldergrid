// Uses an isolated temporary Run entry, and always removes it. No real folder-grid startup preference is changed.
const {app}=require('electron'), assert=require('node:assert/strict');
const {createStartup}=require('../src/startup');
const name='folder-grid-test-'+process.pid;
app.whenReady().then(()=>{
  const controller=createStartup({app,enabled:true,name});
  try {
    assert.equal(controller.setEnabled(true).enabled,true);
    const item=app.getLoginItemSettings({path:process.execPath,args:[]}).launchItems.find(i=>i.name===name);
    assert.ok(item);assert.deepEqual(item.args,[]);
    app.setLoginItemSettings({name,path:process.execPath,args:[],openAtLogin:true,enabled:false});
    assert.equal(controller.getState().blocked,true);
    assert.equal(controller.setEnabled(true).enabled,true);
    assert.equal(controller.setEnabled(false).enabled,false);
    console.log(JSON.stringify({passed:true,checks:['real-windows-startup-register','external-disable-detected','explicit-reenable','startup-remove'],userPreferenceChanged:false}));
  } finally {app.setLoginItemSettings({name,path:process.execPath,args:[],openAtLogin:false,enabled:false});}
}).then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
