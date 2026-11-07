const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const acorn = require('acorn');
const { analyze, walkValues, valid } = require('./lib/analyzer.cjs');
const { buildRuntime } = require('./lib/dom-runtime');
const { detectRuntime, readiness } = require('./lib/runtime.cjs');
const MARK = '/*devin-chinese-guard:v1*/';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const load = (file, fallback = null) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); };
const defaults = () => ({ appRoot: '/Applications/Devin.app/Contents/Resources/app', stateDir: path.join(os.homedir(), 'Library/Application Support/DevinChineseGuard'), userData: path.join(os.homedir(), 'Library/Application Support/Devin'), extensionsRoot: path.join(os.homedir(), '.devin/extensions') });

function seedData() {
  return { enHashes: load(path.join(__dirname, 'data/english-hashes.json')), zh: load(path.join(__dirname, 'data/chinese-catalogs.json')), dict: load(path.join(__dirname, 'data/dictionary.json')), native: load(path.join(__dirname, 'data/native.i18n.json')) };
}
function build(source, version, data = seedData()) {
  if (source.includes(MARK) || source.includes('/*codex-devin-zh-resources*/')) throw Error('Existing localization has no matching state; refusing to overwrite');
  const found = analyze(source);
  if (found.hasChinese) throw Error('This version already provides a Chinese locale; verify the official locale before patching');
  const missing = [], stats = { strings: 0, translated: 0, retainedNames: 0 };
  function translate(en, oldHash, oldZh, key) {
    if (typeof en === 'string') {
      stats.strings++;
      const candidate = sha(en) === oldHash && valid(en, oldZh) ? oldZh : data.dict[en];
      if (valid(en, candidate)) { if (candidate !== en) stats.translated++; else stats.retainedNames++; return candidate; }
      missing.push({ key, english: en }); return en;
    }
    if (!en || typeof en !== 'object') return en;
    const out = Array.isArray(en) ? [] : {};
    for (const [name, value] of Object.entries(en)) Object.defineProperty(out, name, { value: translate(value, oldHash?.[name], oldZh?.[name], key + '.' + name), enumerable: true, writable: true, configurable: true });
    return out;
  }
  const chinese = translate(found.english, data.enHashes, data.zh, 'resources');
  // One migration per application build. An explicit later language choice is
  // preserved on subsequent starts of the same build. No account data is read.
  const migration = `(()=>{try{if(typeof localStorage!=="undefined"&&localStorage.getItem("devin-chinese-guard-build")!==${JSON.stringify(version)}){localStorage.setItem("devin-language","zh");localStorage.setItem("devin-chinese-guard-build",${JSON.stringify(version)})}}catch{}})()`;
  const resource = found.resource.name;
  const edits = [
    { start: found.resource.start, end: found.resource.end, text: `(${resource}.zh=${JSON.stringify(chinese)},${migration},${resource})` },
    { start: found.registry.start + 1, end: found.registry.start + 1, text: '{code:"zh",label:"简体中文"},' },
  ];
  let output = source;
  for (const edit of edits.sort((a,b) => b.start-a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  let runtime = buildRuntime(data.dict).code;
  runtime = runtime.replace("'pre', 'code', 'kbd'", "'[aria-label=\"User message\"]','[aria-label=\"Devin message\"]','[aria-label=\"用户消息\"]','[aria-label=\"Devin 消息\"]','[aria-label=\"Devin消息\"]','[data-testid*=\"message-content\"]','[data-testid*=\"session-title\"]','a[href*=\"/sessions/\"]','pre','code','kbd'");
  runtime = runtime.replace("'nav', 'header', 'footer', 'menu', 'button'", "'h1','h2','h3','h4','h5','h6','section','[id=\"devin-terminal\"]','nav','header','footer','menu','button'");
  output += '\n' + MARK + runtime;
  acorn.parse(output, { ecmaVersion: 'latest', sourceType: 'module' });
  let checked = 0;
  function verify(en, zh) {
    if (typeof en === 'string') { if (!valid(en, zh) && en !== zh) throw Error('Placeholder or markup mismatch'); checked++; }
    else if (en && typeof en === 'object') { if (Object.keys(en).join('\0') !== Object.keys(zh).join('\0')) throw Error('Catalog keys changed'); for (const key of Object.keys(en)) verify(en[key], zh[key]); }
  }
  verify(found.english, chinese);
  return { output, english: found.english, chinese, stats: { ...stats, missing: missing.length, placeholderChecks: checked }, missing };
}
function discover(appRoot) {
  const root = path.join(appRoot, 'out/vs/workbench/devin-webapp-host');
  if (!fs.existsSync(root)) throw Error('Devin frontend directory changed; automatic repair stopped');
  const index = path.join(root, 'index.js');
  const references = fs.existsSync(index) ? [...fs.readFileSync(index, 'utf8').matchAll(/(?:from|import)\s*["'`]([^"'`]+\.js)["'`]/g)].map(m => path.resolve(root, m[1])) : [];
  const files = references.length ? [...new Set(references)] : fs.readdirSync(path.join(root, 'assets')).filter(f => f.endsWith('.js')).map(f => path.join(root, 'assets', f));
  const matches = [];
  for (const file of files) {
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('fallbackLng') || !source.includes('English') || !source.includes('review')) continue;
    try { analyze(source); matches.push({ file, source }); } catch (_) {}
  }
  if (matches.length !== 1) throw Error('Cannot identify one supported locale module; automatic repair stopped without changing files');
  return matches[0];
}
function atomic(file, data) {
  const temp = file + '.chinese-guard-' + process.pid;
  fs.copyFileSync(file, temp); fs.chmodSync(temp, fs.statSync(file).mode);
  fs.writeFileSync(temp, data); fs.renameSync(temp, file);
}
function clearCaches(options, backup) {
  const roots = [path.join(options.userData, 'Code Cache/js'), path.join(options.userData, 'Code Cache/wasm'), path.join(options.userData, 'clp')];
  const cached = path.join(options.userData, 'CachedData');
  if (fs.existsSync(cached)) for (const v of fs.readdirSync(cached)) for (const sub of ['chrome/js','chrome/wasm']) roots.push(path.join(cached,v,sub));
  const kept = [];
  for (const [i, root] of roots.entries()) if (fs.existsSync(root)) {
    const dest = path.join(backup, 'caches', String(Date.now()), String(i)); fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.renameSync(root, dest); kept.push(dest); } catch (_) { /* A running cache is safe to keep; the reload prompt remains mandatory. */ }
  }
  return kept;
}
function mergeNative(options, data, product) {
  if (!fs.existsSync(options.extensionsRoot)) return null;
  const dirs = fs.readdirSync(options.extensionsRoot).filter(x => /^ms-ceintl\.vscode-language-pack-zh-hans-\d/.test(x)).sort((a,b) => b.localeCompare(a, undefined, { numeric:true }));
  const registered = load(path.join(options.userData,'languagepacks.json'))?.['zh-cn']?.translations?.vscode;
  const pack = registered && registered.startsWith(options.extensionsRoot+path.sep) && fs.existsSync(registered) ? registered : dirs.map(d => path.join(options.extensionsRoot,d,'translations/main.i18n.json')).find(f=>fs.existsSync(f));
  if (!pack) return null;
  const before = fs.readFileSync(pack), translated = JSON.parse(before);
  const metadataFile = path.join(options.appRoot,'out/nls.metadata.json');
  if (!fs.existsSync(metadataFile)) return null;
  const meta = load(metadataFile); let added=0;
  for (const [module, values] of Object.entries(data.native.contents || {})) {
    const messages = meta.messages[module] || [], keys = meta.keys[module] || [];
    const english = Object.fromEntries(keys.map((k,i)=>[typeof k==='string'?k:k.key,messages[i]]));
    for (const [key, value] of Object.entries(values)) {
      const current = translated.contents?.[module]?.[key];
      if (english[key] && valid(english[key],value) && (!current || current===english[key])) {
        translated.contents ||= {}; translated.contents[module] ||= {}; translated.contents[module][key]=value; added++;
      }
    }
  }
  return added ? { file:pack, before, after:Buffer.from(JSON.stringify(translated)+'\n'), added } : null;
}
function run(input={}) {
  const options={...defaults(),...input};
  const root=fs.realpathSync(options.appRoot), productFile=path.join(root,'product.json'), product=load(productFile);
  if (!/devin/i.test([product.nameShort,product.applicationName].join(' ')) || !product.commit) throw Error('Not a supported Devin installation');
  options.appRoot=root;
  fs.mkdirSync(options.stateDir,{recursive:true,mode:0o700});
  const policyFile=path.join(options.stateDir,'policy.json'), policy=load(policyFile,{paused:false});
  const version=String(product.windsurfVersion||product.version), buildId=version+'-'+product.commit;
  const folder=path.join(options.stateDir,'versions',buildId.replace(/[^a-zA-Z0-9._-]/g,'_'));
  const recordFile=path.join(folder,'record.json'), record=load(recordFile);
  let runtime = input.runtime || detectRuntime(root);
  if(input.runtimeExpected && runtime.kind==='not-running')runtime={kind:'unknown',reason:'main-process-unverified'};
  if (input.action==='status') return { ...readiness(record,runtime),version,commit:product.commit,policy,record,stateDir:options.stateDir };
  if (policy.paused && !input.manual && input.action!=='restore') return { state:'paused',version,changed:false };
  const lock=path.join(options.stateDir,'repair.lock');
  try { fs.mkdirSync(lock); } catch(e) {
    const owner=load(path.join(lock,'owner.json')); let alive=true;
    if(owner?.pid) try { process.kill(owner.pid,0); } catch(e) { if(e.code==='ESRCH')alive=false; }
    if(alive)return{state:'busy',version,changed:false};
    fs.rmSync(lock,{recursive:true});fs.mkdirSync(lock);
  }
  writeJson(path.join(lock,'owner.json'),{pid:process.pid});
  try {
    if(input.action==='restore') {
      if(!record)throw Error('No backup for this exact application build');
      for(const item of record.files)if(!item.file.startsWith(root+path.sep)&&!item.file.startsWith(options.extensionsRoot+path.sep))throw Error('Backup target is outside the authorized installation');
      for(const item of record.files)if(sha(fs.readFileSync(item.file))!==item.patchedHash||sha(fs.readFileSync(path.join(folder,item.backup)))!==item.originalHash)throw Error('Resource or backup changed; refusing to overwrite');
      for(const item of record.files)atomic(item.file,fs.readFileSync(path.join(folder,item.backup)));
      clearCaches(options,path.join(folder,'rollback-'+Date.now()));writeJson(policyFile,{...policy,paused:true});
      const result={state:'restored',version,changed:true,reloadRequired:true};writeJson(path.join(options.stateDir,'status.json'),result);return result;
    }
    const data=seedData(); let found, built;
    if(record&&fs.existsSync(record.target)) {
      const current=fs.readFileSync(record.target,'utf8'),hash=sha(current);
      if(hash===record.patchedHash) {
        const native=mergeNative(options,data,product);
        if(native) {
          const backup='language-pack.'+sha(native.before).slice(0,16)+'.original.json';
          const saved=path.join(folder,backup);
          if(!fs.existsSync(saved))fs.writeFileSync(saved,native.before,{mode:0o600});
          if(sha(fs.readFileSync(native.file))!==sha(native.before))throw Error('Language pack changed during preparation');
          atomic(native.file,native.after);
          record.files=record.files.filter(f=>f.file!==native.file);
          record.files.push({file:native.file,backup,originalHash:sha(native.before),patchedHash:sha(native.after)});
          record.lastPatchedAt=new Date().toISOString();record.appliedRuntime=runtime;
          writeJson(recordFile,record);clearCaches(options,folder);
          const result={...readiness(record,runtime),state:'repaired',version,commit:product.commit,changed:true,reloadRequired:runtime.kind!=='not-running',stats:record.stats,recordFile,nativeAdded:native.added};
          writeJson(path.join(options.stateDir,'status.json'),result);return result;
        }
        if(input.manual)writeJson(policyFile,{...policy,paused:false});
        const result={...readiness(record,runtime),version,commit:product.commit,changed:false,stats:record.stats,recordFile};
        writeJson(path.join(options.stateDir,'status.json'),result);return result;
      }
      if(hash!==record.originalHash)throw Error('Resource changed within the same application build; refusing to overwrite');
      found={file:record.target,source:current};
    } else found=discover(root);
    built=build(found.source,product.commit,data);
    const changes=[{file:found.file,before:Buffer.from(found.source),after:Buffer.from(built.output),backup:'frontend.original.js'}];
    const native=mergeNative(options,data,product);if(native)changes.push({...native,backup:'language-pack.original.json'});
    const relative=path.relative(path.join(root,'out'),found.file).split(path.sep).join('/');
    if(Object.hasOwn(product.checksums||{},relative)) {
      const before=fs.readFileSync(productFile);product.checksums[relative]=crypto.createHash('sha256').update(built.output).digest('base64').replace(/=+$/,'');
      changes.push({file:productFile,before,after:Buffer.from(JSON.stringify(product,null,'\t')+'\n'),backup:'product.original.json'});
    }
    if(input.action==='preview')return{state:'preview',version,commit:product.commit,target:found.file,stats:built.stats,missing:built.missing};
    fs.mkdirSync(folder,{recursive:true});
    for(const change of changes) {
      if(sha(fs.readFileSync(change.file))!==sha(change.before))throw Error('Application updated during preparation; no patch committed');
      const backup=path.join(folder,change.backup);
      if(fs.existsSync(backup)&&sha(fs.readFileSync(backup))!==sha(change.before))throw Error('Existing backup differs; refusing to overwrite it');
      if(!fs.existsSync(backup))fs.writeFileSync(backup,change.before,{mode:0o600});
    }
    const done=[];
    try {
      for(const change of changes) {if(sha(fs.readFileSync(change.file))!==sha(change.before))throw Error('Resource changed during commit');atomic(change.file,change.after);done.push(change);}
      const next={version,commit:product.commit,appRoot:root,target:found.file,originalHash:sha(found.source),patchedHash:sha(built.output),installedAt:new Date().toISOString(),appliedRuntime:runtime,stats:built.stats,files:changes.map(c=>({file:c.file,backup:c.backup,originalHash:sha(c.before),patchedHash:sha(c.after)}))};
      writeJson(recordFile,next);writeJson(path.join(folder,'missing-phrases.json'),built.missing);
      clearCaches(options,folder);
      if(input.manual)writeJson(policyFile,{...policy,paused:false});
      const result={...readiness(next,runtime),state:'repaired',version,commit:product.commit,changed:true,reloadRequired:runtime.kind!=='not-running',stats:built.stats,recordFile,nativeAdded:native?.added||0};
      writeJson(path.join(options.stateDir,'status.json'),result);return result;
    } catch(error) {for(const change of done.reverse())atomic(change.file,change.before);throw error;}
  } finally {fs.rmSync(lock,{recursive:true,force:true});}
}
if(require.main===module) {
  const args=process.argv.slice(2),options={action:args[0]||'status'};
  for(let i=1;i<args.length;i++)if(args[i]==='--manual')options.manual=true;else if(args[i]==='--app-root')options.appRoot=args[++i];else if(args[i]==='--state-dir')options.stateDir=args[++i];else if(args[i]==='--user-data')options.userData=args[++i];else if(args[i]==='--extensions-root')options.extensionsRoot=args[++i];else throw Error('Unknown option: '+args[i]);
  try{console.log(JSON.stringify(run(options),null,2));}catch(e){console.error(JSON.stringify({state:'error',message:e.message}));process.exitCode=1;}
}
module.exports={run,build,discover,defaults,MARK,sha};
