import fs from 'node:fs';import path from 'node:path';
// Preserve the original UI assets. Only the Worker build outputs are regenerated.
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.txt':'text/plain; charset=utf-8'};
const assets={};function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(['server','.openai'].includes(ent.name))continue;const p=path.join(dir,ent.name);if(ent.isDirectory())walk(p);else assets['/'+path.relative('dist',p)]={type:types[path.extname(p)]||'application/octet-stream',base64:fs.readFileSync(p).toString('base64')};}}walk('dist');
fs.writeFileSync('worker/assets.generated.js','export const ASSETS='+JSON.stringify(assets)+';\n');
// These buildless modules use named exports/imports only. Preserve each source module in Git.
const modules=['dist/domain.js','dist/storage.js','dist/key-range.js','dist/repository.js','dist/import-core.js','worker/d1-repository.js','worker/api.js','worker/assets.generated.js','worker/index.js'];
let out='// Generated from the existing application and server modules.\n';
for(const p of modules){let s=fs.readFileSync(p,'utf8').replace(/^import .*?;\s*$/gm,'').replace(/^export \{[^}]*\} from .*?;\s*$/gm,'').replace(/\bexport (?=(?:async )?(?:function|class|const|let)\b)/g,'');if(p==='dist/repository.js')s='const req=request;\n'+s;out+='\n// '+p+'\n'+s;}
fs.mkdirSync('dist/server',{recursive:true});fs.writeFileSync('dist/server/index.js',out);if(fs.existsSync('.openai/hosting.json')){fs.mkdirSync('dist/.openai',{recursive:true});fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');}console.log('Built application Worker and '+Object.keys(assets).length+' retained assets.');
