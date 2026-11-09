import {api} from './api.js';
import {ASSETS} from './assets.generated.js';
export default {async fetch(request,env){const url=new URL(request.url);if(url.pathname==='/api/repository')return api(request,env);
 const path=url.pathname==='/'?'/index.html':url.pathname,asset=ASSETS[path];if(!asset)return new Response('Not found',{status:404});if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const bytes=Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0));return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':asset.type,'cache-control':'private, no-cache','x-content-type-options':'nosniff'}});
}};
