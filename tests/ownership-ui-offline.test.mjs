import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
globalThis.fetch=()=>{throw Error('외부 요청 금지');};
const result=await build({stdin:{contents:"export {createOwnershipWmsControls} from './src/features/ownership';",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
class Element{
 children=[];attributes=new Map();listeners=new Map();dataset={};hidden=false;textContent='';
 append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attributes.set(k,v);}
 addEventListener(k,v){this.listeners.set(k,v);}removeEventListener(k){this.listeners.delete(k);}remove(){}
}
globalThis.document={createElement:()=>new Element()};
test('WMS 운영 UI: 공식 범례 확인중·소유권 주의·모바일 접힘·OFF 숨김',()=>{
 const calls=[],ui=api.createOwnershipWmsControls(value=>calls.push(value),true);
 const [button,panel]=ui.root.children,[status,legend]=panel.children;
 assert.equal(panel.hidden,true);assert.equal(legend.open,false);assert.equal(legend.children.length,4);
 assert.equal(legend.children[1].textContent,'본 지도는 V-World에서 제공하는 토지소유구분도를 표시합니다. 색상별 소유구분에 대한 공식 범례는 확인 중입니다.');
 assert.equal(legend.children[3].textContent,'지도 색상만으로 소유권을 확정하지 마세요.');
 button.listeners.get('click')();assert.equal(panel.hidden,false);assert.deepEqual(calls,[true]);
 legend.open=true;legend.open=false;assert.deepEqual(calls,[true]);
 ui.setStatus('조회 실패');assert.equal(status.dataset.state,'error');
 button.listeners.get('click')();assert.equal(panel.hidden,true);assert.equal(button.attributes.get('aria-pressed'),'false');
 const desktop=api.createOwnershipWmsControls(()=>{},false);assert.equal(desktop.root.children[1].children[1].open,true);
 ui.dispose();desktop.dispose();
});
test('운영 초기화: WMS만 생성·WFS/Worker 설정 미사용·임의 범례 없음',async()=>{
 const source=await readFile(new URL('../src/features/ownership.ts',import.meta.url),'utf8');
 const mount=source.slice(source.indexOf('export const ownershipFeature:'));
 assert.match(mount,/createOwnershipWms\(/);assert.doesNotMatch(mount,/bindOwnershipViewport|createOwnershipLayer|createOwnershipControls\(|VITE_OWNERSHIP_WORKER_URL/);
 const controls=source.slice(source.indexOf('export function createOwnershipWmsControls'));
 assert.doesNotMatch(controls,/backgroundColor|ownershipLegend|#[0-9a-fA-F]{6}/);
 assert.match(mount,/map.removeLayer/);assert.match(mount,/model.dispose/);
});
