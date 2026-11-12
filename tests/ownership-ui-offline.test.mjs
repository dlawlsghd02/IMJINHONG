import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
globalThis.fetch=()=>{throw Error('외부 요청 금지');};
const result=await build({stdin:{contents:"export {createOwnershipWmsControls} from './src/features/ownership';",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
class Element{
 children=[];attributes=new Map();listeners=new Map();dataset={};style={};hidden=false;textContent='';
 append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attributes.set(k,v);}
 addEventListener(k,v){this.listeners.set(k,v);}removeEventListener(k){this.listeners.delete(k);}remove(){}
}
globalThis.document={createElement:()=>new Element()};
test('WMS 운영 UI: 잠정 범례 6색·소유권 주의·모바일 접힘·OFF 숨김',()=>{
 const calls=[],ui=api.createOwnershipWmsControls(value=>calls.push(value),true);
 const [button,panel]=ui.root.children,[status,legend]=panel.children;
 assert.equal(panel.hidden,true);assert.equal(legend.open,false);assert.equal(legend.children.length,5);
 assert.equal(legend.children[0].textContent,'소유구분(잠정)');
 const list=legend.children[1];assert.equal(list.children.length,6);
 assert.deepEqual(list.children.map(row=>row.children[1].textContent),['법인','국유지','시·도유지','소유구분 확인 필요','군유지','외국인·외국공공기관']);
 assert.deepEqual(list.children.map(row=>row.children[0].children[0].style.backgroundColor),[
  'rgba(231,189,255,0.50196)','rgba(225,225,225,0.50196)','rgba(255,233,189,0.50196)',
  'rgba(255,227,239,0.50196)','rgba(255,255,189,0.50196)','rgba(233,255,189,0.50196)',
 ]);
 assert.ok(list.children.every(row=>row.children[0].className==='ownership-wms-swatch'&&row.children[0].attributes.get('aria-hidden')==='true'));
 assert.equal(legend.children[2].textContent,'V-World 소유정보 WMS 색상을 일부 필지의 토지임야정보와 대조한 잠정 범례입니다. 공식 범례가 아니며 실제 소유구분과 다를 수 있습니다.');
 assert.match(legend.children[3].textContent,/국토교통부 · V-World/);
 assert.equal(legend.children[4].textContent,'지도 색상만으로 소유권을 확정하지 마세요.');
 button.listeners.get('click')();assert.equal(panel.hidden,false);assert.deepEqual(calls,[true]);
 legend.open=true;legend.open=false;assert.deepEqual(calls,[true]);
 ui.setStatus('조회 실패');assert.equal(status.dataset.state,'error');
 button.listeners.get('click')();assert.equal(panel.hidden,true);assert.equal(button.attributes.get('aria-pressed'),'false');
 const desktop=api.createOwnershipWmsControls(()=>{},false);assert.equal(desktop.root.children[1].children[1].open,true);
 ui.dispose();desktop.dispose();
});
test('보존된 WMS 구성요소: WFS/Worker 설정 미사용·WMS 범례 분리',async()=>{
 const source=await readFile(new URL('../src/features/ownership.ts',import.meta.url),'utf8');
 const mount=source.slice(source.indexOf('export const ownershipFeature:'));
 assert.match(mount,/createOwnershipWms\(/);assert.doesNotMatch(mount,/bindOwnershipViewport|createOwnershipLayer|createOwnershipControls\(|VITE_OWNERSHIP_WORKER_URL/);
 const controls=source.slice(source.indexOf('export function createOwnershipWmsControls'));
 assert.match(controls,/ownershipWmsProvisionalLegend\.forEach/);
 assert.doesNotMatch(controls,/\bownershipLegend\b/);
 assert.doesNotMatch(controls,/fetch\(|requestSandboxJsonp|추정 색상표는 표시하지 않습니다/);
 assert.match(mount,/map.removeLayer/);assert.match(mount,/model.dispose/);
 const css=await readFile(new URL('../src/styles/parcel.css',import.meta.url),'utf8');
 assert.match(css,/\.ownership-wms-controls \.ownership-wms-legend-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
 assert.match(css,/\.ownership-wms-legend-list \.ownership-wms-swatch\s*\{[^}]*background:\s*#fff/);
 assert.match(css,/\.ownership-wms-label\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('운영 기능 등록: 소유정보 UI와 WMS 초기화 제외·기존 기능 유지',async()=>{
 const registry=await readFile(new URL('../src/features/registry.ts',import.meta.url),'utf8');
 assert.doesNotMatch(registry,/\bownershipFeature\b|from\s+['"]\.\/ownership['"]/);
 assert.match(registry,/features:\s*readonly MapFeature\[\]\s*=\s*\[addressSearchFeature,\s*cadastralFeature,\s*zoningFeature\]/);
 const main=await readFile(new URL('../src/main.ts',import.meta.url),'utf8');
 assert.match(main,/features\.forEach/);
 assert.doesNotMatch(main,/ownershipFeature|createOwnershipWms/);
});
