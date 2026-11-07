const fs=require('fs'),path=require('path');
const {build,defaults,sha}=require('../engine.cjs');
const root=process.argv[2]||defaults().appRoot;
const product=JSON.parse(fs.readFileSync(path.join(root,'product.json'),'utf8'));
const {discover}=require('../engine.cjs');
const folder=path.join(defaults().stateDir,'versions',product.windsurfVersion+'-'+product.commit),recordFile=path.join(folder,'record.json');
let source;
if(fs.existsSync(recordFile)) {
  const record=JSON.parse(fs.readFileSync(recordFile,'utf8'));
  if(path.resolve(record.appRoot)!==path.resolve(root))throw Error('Backup belongs to another application');
  const saved=record.files.find(x=>x.file===record.target);
  source=fs.readFileSync(path.join(folder,saved.backup),'utf8');
  if(sha(source)!==record.originalHash)throw Error('Original resource backup hash does not match');
} else source=discover(root).source;
const result=build(source,product.commit);
console.log(JSON.stringify({readOnly:true,version:product.windsurfVersion,stats:result.stats,missing:result.missing},null,2));
