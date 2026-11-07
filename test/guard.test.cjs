const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const acorn=require('acorn');
const {build,run,sha}=require('../engine.cjs');
const {analyze,walk,valid}=require('../lib/analyzer.cjs');
const {readiness,elapsedSeconds}=require('../lib/runtime.cjs');
const {fixture}=require('./fixture.cjs');

test('AST discovery survives renamed identifiers; resource values and markup are preserved',()=>{
  for(const suffix of ['','Renamed']) {
    const f=fixture(suffix),built=build(f.source,'test-build',f.data);
    assert.equal(built.stats.missing,0);assert.deepEqual(analyze(f.source).english,f.english);
    let expression;walk(acorn.parse(built.output,{ecmaVersion:'latest',sourceType:'module'}),n=>{if(n.type==='Property'&&n.key.name==='resources'&&n.value.type==='SequenceExpression')expression=n.value;});
    assert(expression);const id=expression.expressions.at(-1).name,storage=new Map();
    const context={[id]:{en:JSON.parse(JSON.stringify(f.english))},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}};
    const code='('+built.output.slice(expression.start,expression.end)+')';
    const output=vm.runInNewContext(code,context,{timeout:3000});
    assert.deepEqual(JSON.parse(JSON.stringify(output.en)),f.english);assert.deepEqual(JSON.parse(JSON.stringify(output.zh)),f.chinese);
    assert.equal(storage.get('devin-language'),'zh');storage.set('devin-language','en');vm.runInNewContext(code,context,{timeout:3000});assert.equal(storage.get('devin-language'),'en');
  }
});
test('changed English fingerprints and invalid placeholders fall back safely',()=>{
  const f=fixture();f.data.enHashes.translation.ui.newSession='changed';
  delete f.data.dict['New session'];f.data.zh.translation.ui.count='漏掉占位符';
  const built=build(f.source,'test-build',f.data);
  assert.equal(built.chinese.translation.ui.newSession,'New session');assert.equal(built.chinese.translation.ui.count,'{{count}} items');assert.equal(built.stats.missing,2);
  assert(valid('{{count}} items','{{count}} 项'));assert(!valid('{{count}} items','项目'));
});
test('pending restart survives polling and extension reload until main-process identity changes',()=>{
  const runtime={kind:'running',id:'boot-a',startedAt:'2026-01-01T00:00:00.000Z'};
  const legacy={installedAt:'2026-01-01T00:00:07.000Z'};
  assert.equal(readiness(legacy,runtime).state,'pending-restart');
  assert.equal(readiness({...legacy,appliedRuntime:runtime},runtime).state,'pending-restart');
  assert.equal(readiness(legacy,{...runtime,id:'boot-b',startedAt:'2026-01-01T00:10:00.000Z'}).state,'healthy');
  assert.equal(readiness({...legacy,appliedRuntime:runtime},{...runtime,id:'boot-b'}).state,'healthy');
  assert.equal(readiness(legacy,{kind:'unknown'}).state,'restart-unverified');assert.equal(readiness(legacy,{kind:'not-running'}).state,'prepared');
  assert.equal(elapsedSeconds('12:34'),754);assert.equal(elapsedSeconds('2-01:02:03'),176523);assert.equal(elapsedSeconds('bad'),null);
});
test('repair, new asset versions, corruption checks, rollback and unknown layouts',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'devin-chinese-test-'));
  try {
    const appRoot=path.join(folder,'app'),host=path.join(appRoot,'out/vs/workbench/devin-webapp-host');fs.mkdirSync(path.join(host,'assets'),{recursive:true});
    const runtime={kind:'running',id:'boot-a',startedAt:'2026-01-01T00:00:00.000Z'};
    const options={appRoot,stateDir:path.join(folder,'state'),userData:path.join(folder,'user'),extensionsRoot:path.join(folder,'extensions'),runtime};
    function version(commit,file,source){fs.writeFileSync(path.join(appRoot,'product.json'),JSON.stringify({nameShort:'Devin',applicationName:'devin',windsurfVersion:'test-'+commit,commit}));fs.writeFileSync(path.join(host,'index.js'),'import "./assets/'+file+'";');fs.writeFileSync(path.join(host,'assets',file),source);}
    const source=fixture().source;version('a','first.js',source);
    assert.equal(run({...options,manual:true,action:'apply'}).state,'repaired');const first=path.join(host,'assets/first.js'),patched=fs.readFileSync(first,'utf8');
    assert.equal(run({...options,action:'apply'}).state,'pending-restart');assert.equal(run({...options,action:'apply'}).state,'pending-restart');assert.equal(fs.readFileSync(first,'utf8'),patched);
    assert.equal(run({...options,action:'apply',runtime:{...runtime,id:'boot-b',startedAt:new Date(Date.now()+5000).toISOString()}}).state,'healthy');
    fs.appendFileSync(first,'\n// external modification');assert.throws(()=>run({...options,action:'apply'}),/refusing to overwrite/);assert(fs.readFileSync(first,'utf8').endsWith('external modification'));
    fs.writeFileSync(first,patched);assert.equal(run({...options,action:'restore'}).state,'restored');assert.equal(fs.readFileSync(first,'utf8'),source);
    assert.equal(run({...options,action:'apply'}).state,'paused');assert.equal(run({...options,action:'apply',manual:true}).state,'repaired');
    version('b','next-hash.js',fixture('Next').source);assert.equal(run({...options,action:'apply'}).state,'repaired');
    assert.equal(fs.readdirSync(path.join(options.stateDir,'versions')).length,2);
    assert.equal(sha(fs.readFileSync(path.join(options.stateDir,'versions/test-a-a/frontend.original.js'))),sha(source));
    version('c','unknown.js','export const changed = true;');assert.throws(()=>run({...options,action:'apply'}),/automatic repair stopped/);assert.equal(fs.readFileSync(path.join(host,'assets/unknown.js'),'utf8'),'export const changed = true;');
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
