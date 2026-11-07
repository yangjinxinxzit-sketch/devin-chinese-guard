const crypto = require('crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function map(value, translate) {
  if (typeof value === 'string') return translate(value);
  return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,map(v,translate)]));
}
function fixture(suffix='') {
  const english={translation:{ui:{newSession:'New session',count:'{{count}} items',link:'Open <link>details</link>'},labels:{}},review:{tabs:{changes:'Changes'},title:'Review {{name}}'}};
  for(let i=0;i<1010;i++)english.translation.labels['sample'+i]='Sample interface label '+i;
  const chinese=map(english,s=>'译文：'+s);
  chinese.translation.ui.newSession='新建会话';chinese.translation.ui.count='{{count}} 项';chinese.translation.ui.link='打开<link>详情</link>';
  const variables={en:'catalog'+suffix,review:'review'+suffix,main:'main'+suffix,rev:'rev'+suffix,list:'locales'+suffix,init:'initialize'+suffix};
  const {en,review,main,rev,list,init}=variables;
  const source=`var ${en},${review},${main},${rev},${list};
function ${init}(){return(${init}=lazy(()=>{${en}=${JSON.stringify(english.translation)};${review}=${JSON.stringify(english.review)};${main}=${en};${rev}=${review};${list}=[{code:'en',label:'English'},{code:'ja',label:'日本語'},{code:'es',label:'Español'}];}))();}
function createLocale${suffix}({englishOverrides}={}){let resources={en:{translation:englishOverrides?JSON.parse(JSON.stringify(${main})):${main},review:${rev}}};return translator.use(plugin).init({resources:resources,lng:'en',fallbackLng:'en',ns:['translation','review']});}
export{${init}};`;
  return {source,english,chinese,data:{enHashes:map(english,digest),zh:chinese,dict:{'New session':'新建会话'},native:{contents:{}}}};
}
module.exports={fixture,map,digest};
