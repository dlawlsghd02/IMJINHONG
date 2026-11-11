import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
globalThis.fetch=()=>{throw Error('외부 요청 금지');};
const result=await build({stdin:{contents:"export * from './src/services/vworld/ownershipWms';",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'offline-image',setup(b){
 b.onResolve({filter:/^ol\/(layer\/Image|source\/ImageStatic)\.js$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export default class Mock { constructor(options){this.options=options;this.listeners={};this.props={};this.source=options.source;this.visible=options.visible;} setZIndex(v){this.z=v;} set(k,v){this.props[k]=v;} setSource(v){this.source=v;} setVisible(v){this.visible=v;} on(k,fn){this.listeners[k]=fn;} dispose(){this.disposed=true;} }`}));
}}]});
const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('소유 WMS URL: 기존 전용 형식·인증·3857·PNG·표준 파라미터 추가 금지',()=>{
 const u=new URL(api.ownershipWmsUrl('offline-key','http://127.0.0.1:5173/',[1,2,3,4],512,256));
 assert.equal(u.pathname,'/ned/wms/getPossessionWMS');assert.equal(u.origin,'https://api.vworld.kr');
 assert.deepEqual([...u.searchParams.keys()].sort(),['bbox','crs','domain','format','height','key','width']);
 assert.equal(u.searchParams.get('crs'),'EPSG:3857');assert.equal(u.searchParams.get('format'),'image/png');
 assert.equal(u.searchParams.get('key'),'offline-key');assert.equal(u.searchParams.get('domain'),'http://127.0.0.1:5173/');
 assert.equal(u.searchParams.get('bbox'),'1,2,3,4');
 for(const b of [[1,2,1,4],[NaN,2,3,4],[1,4,3,2]])assert.throws(()=>api.ownershipWmsUrl('k',undefined,b,512,512));
 assert.throws(()=>api.ownershipWmsUrl('',undefined,[1,2,3,4],512,512));
 assert.throws(()=>api.ownershipWmsUrl('k','not-a-url',[1,2,3,4],512,512));
 assert.throws(()=>api.ownershipWmsUrl('k',undefined,[1,2,3,4],513,512));
});
test('소유 WMS 지도: 최초 OFF·지연·원본 opacity·취소·늦은 이벤트·실패·정리',()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,originalImage=globalThis.HTMLImageElement;
 const timers=new Map(),events=new Map(),messages=[];let id=0;
 globalThis.setTimeout=fn=>{timers.set(++id,fn);return id;};globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.HTMLImageElement=class {naturalWidth=512;naturalHeight=256;removeAttribute(){this.removed=true;}};
 const fire=()=>{const [id,fn]=[...timers.entries()][0];timers.delete(id);fn();};
 const map={on:(k,fn)=>events.set(k,fn),un:k=>events.delete(k),getSize:()=>[1024,512],getView:()=>({getProjection:()=>({getCode:()=> 'EPSG:3857'}),calculateExtent:()=>[1,2,3,4]})};
 let model;
 try{
  model=api.createOwnershipWms(map,'offline-key',undefined,m=>messages.push(m));
  assert.equal(model.layer.visible,false);assert.equal(model.layer.options.opacity,1);assert.equal(model.layer.z,35);assert.equal(timers.size,0);
  model.setEnabled(true);fire();const first=model.layer.source;
  assert.equal(new URL(first.options.url).searchParams.get('width'),'512');assert.equal(new URL(first.options.url).searchParams.get('height'),'256');
  assert.equal(first.options.crossOrigin,undefined);assert.equal(first.options.interpolate,false);
  const image=new HTMLImageElement();first.options.imageLoadFunction({getImage:()=>image},first.options.url);
  first.listeners.imageloadend();assert.match(messages.at(-1),/원본/);
  events.get('movestart')();assert.equal(model.layer.source,null);assert.equal(image.removed,true);
  const count=messages.length;first.listeners.imageloadend();assert.equal(messages.length,count);
  events.get('moveend')();model.setEnabled(false);assert.equal(timers.size,0);assert.equal(model.layer.source,null);assert.equal(model.layer.visible,false);
  model.setEnabled(true);fire();const second=model.layer.source;second.listeners.imageloaderror();
  assert.equal(model.layer.source,null);assert.match(messages.at(-1),/실패/);assert.equal(timers.size,0);
 }finally{model?.dispose();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;globalThis.HTMLImageElement=originalImage;}
 assert.equal(events.size,0);
});
