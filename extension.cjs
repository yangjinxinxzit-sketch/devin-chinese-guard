const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const engine = require('./engine.cjs');
function activate(context) {
  const output = vscode.window.createOutputChannel('Devin 中文更新维护');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  status.text = '$(globe) 中文维护'; status.command = 'devinChinese.status'; status.show();
  const defaultOptions = engine.defaults();
  const match = /[\\/]User[\\/](?:profiles[\\/][^\\/]+[\\/])?globalStorage(?:[\\/]|$)/i.exec(context.globalStorageUri.fsPath);
  const official = vscode.extensions.getExtension('ms-ceintl.vscode-language-pack-zh-hans');
  const options = { ...defaultOptions, appRoot: vscode.env.appRoot, runtimeExpected:true,
    userData: match ? context.globalStorageUri.fsPath.slice(0, match.index) : defaultOptions.userData,
    extensionsRoot: official ? path.dirname(official.extensionPath) : defaultOptions.extensionsRoot };
  const initialCommit = JSON.parse(fs.readFileSync(path.join(options.appRoot,'product.json'),'utf8')).commit;
  let busy = false;
  async function offerFullRestart(result, manual=false, restore=false) {
    const noticeKey=result.commit+':'+(result.runtime?.id||'unknown')+':'+(restore?'restore':'repair');
    if(!manual && context.globalState.get('restartNotice')===noticeKey)return;
    await context.globalState.update('restartNotice',noticeKey);
    const message=restore?'补丁已回退。请完全退出 Devin，再从 Dock 或“应用程序”重新打开。'
      :'Devin '+result.version+' 的汉化文件已准备好，当前界面仍需完整重启。请完全退出 Devin，再从 Dock 或“应用程序”重新打开；只重新加载窗口可能继续显示旧界面。';
    const action=await vscode.window.showInformationMessage(message,{modal:true},'完全退出 Devin','稍后');
    if(action==='完全退出 Devin')await vscode.commands.executeCommand('workbench.action.quit');
  }
  async function check(manual = false, restore = false) {
    if (busy || (!manual && !vscode.workspace.getConfiguration('devinChinese').get('autoRepair',true))) return;
    busy = true;
    try {
      const result = engine.run({ ...options, manual, action: restore ? 'restore' : 'apply' });
      output.appendLine(new Date().toISOString() + ' ' + JSON.stringify(result));
      if (result.state === 'busy') return;
      status.text = result.state === 'paused' || restore ? '$(globe) 中文维护已暂停' : result.reloadRequired ? '$(sync) 中文待完整重启' : '$(globe) 中文资源就绪';
      status.tooltip = 'Devin '+result.version+'：'+(result.reloadRequired?'文件已修复，当前主进程尚未重启':result.stats?.missing?result.stats.missing+' 条新增文案保留英文':'资源匹配，完整重启检查通过');
      if (result.reloadRequired || restore) {
        busy = false;
        await offerFullRestart(result,manual,restore);
      } else if (manual) await vscode.window.showInformationMessage(result.state === 'healthy' ? 'Devin '+result.version+'：资源完整，已完成完整重启检查。' : '自动汉化维护已暂停。');
    } catch (error) {
      status.text = '$(globe) 中文维护需检查';
      output.appendLine(new Date().toISOString() + ' ERROR ' + error.message);
      const key = initialCommit + ':' + error.message;
      if (manual || context.globalState.get('lastError') !== key) {
        await context.globalState.update('lastError',key);
        await vscode.window.showWarningMessage('汉化自动维护已停止，未覆盖未知新版文件：' + error.message);
      }
    } finally { busy = false; }
  }
  context.subscriptions.push(output,status,
    vscode.commands.registerCommand('devinChinese.repair',()=>check(true,false)),
    vscode.commands.registerCommand('devinChinese.restore',()=>check(true,true)),
    vscode.commands.registerCommand('devinChinese.status',async()=>{ output.show(); const result=engine.run({...options,action:'status'}); output.appendLine(JSON.stringify(result,null,2)); if(result.reloadRequired)await offerFullRestart(result,true); }),
    vscode.workspace.onDidChangeConfiguration(e=>{if(e.affectsConfiguration('devinChinese.autoRepair'))check();}));
  const startup=setTimeout(()=>check(),1500), periodic=setInterval(()=>check(),300000);
  context.subscriptions.push({dispose(){clearTimeout(startup);clearInterval(periodic);}});
  output.appendLine('Activated: automatic startup check and five-minute update check; no workspace files, model API, or network used.');
}
module.exports={activate,deactivate(){}};
