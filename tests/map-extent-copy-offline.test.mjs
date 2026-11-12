import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

globalThis.fetch=()=>{throw Error('외부 요청 금지');};
const result=await build({entryPoints:[fileURLToPath(new URL('../src/dev/mapExtentCopy.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
let bbox=[14135000,4518000,14137000,4520000];
const map={getSize:()=>[1280,800],getView:()=>({getZoom:()=>15.5,getProjection:()=>({getCode:()=> 'EPSG:3857'}),calculateExtent:()=>bbox})};

test('지도 범위 복사: 실제 지도 값·허용 필드만 직렬화·최신 범위',()=>{
 assert.deepEqual(JSON.parse(api.mapExtentText(map)),{crs:'EPSG:3857',bbox,size:[1280,800],zoom:15.5});
 bbox=[1,2,3,4];assert.deepEqual(JSON.parse(api.mapExtentText(map)).bbox,bbox);
 assert.throws(()=>api.mapExtentText({...map,getSize:()=>undefined}));
 assert.throws(()=>api.mapExtentText({...map,getSize:()=>[0,800]}));
 bbox=[NaN,2,3,4];assert.throws(()=>api.mapExtentText(map));
 bbox=[3,2,1,4];assert.throws(()=>api.mapExtentText(map));bbox=[1,2,3,4];
});

test('지도 범위 버튼: 클릭 복사·실패 안내·정리',async()=>{
 const oldDocument=globalThis.document,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const make=()=>({style:{},listeners:{},children:[],setAttribute(k,v){this[k]=v;},addEventListener(k,v){this.listeners[k]=v;},removeEventListener(k){delete this.listeners[k];},append(...items){this.children.push(...items);},remove(){this.removed=true;}});
 globalThis.document={createElement:make};let copied;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{copied=text;}}}});
 try{
  const host=make(),dispose=api.mountMapExtentCopy(map,host);
  const container=host.children[0],[button,status]=container.children;
  assert.equal(button.type,'button');assert.equal(button.textContent,'지도 범위 복사');
  assert.equal(button.style.pointerEvents,'auto');
  assert.equal(container.style.pointerEvents,undefined);
  await button.listeners.click();assert.equal(copied,api.mapExtentText(map));assert.match(status.textContent,/완료/);
  navigator.clipboard.writeText=async()=>{throw Error('비공개 오류 원문');};
  await button.listeners.click();assert.match(status.textContent,/실패/);assert.doesNotMatch(status.textContent,/비공개 오류 원문/);
  dispose();assert.equal(container.removed,true);assert.equal(button.listeners.click,undefined);
 }finally{globalThis.document=oldDocument;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});

test('진단 진입점: DEV 분기 안의 동적 import·지도 및 데이터 변경 없음',async()=>{
 const main=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.match(main,/if \(import\.meta\.env\.DEV\) \{[\s\S]*?import\('\.\/dev\/mapExtentCopy'\)/);
 const source=await readFile(new URL('../src/dev/mapExtentCopy.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/fetch\(|ownershipWms|readEnvironment|setCenter|setZoom|\.fit\(/);
});
