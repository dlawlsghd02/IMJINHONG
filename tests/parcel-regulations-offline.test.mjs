import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
globalThis.fetch=()=>{throw new Error('외부 통신 금지');};
const root=fileURLToPath(new URL('../',import.meta.url));
const b=await build({stdin:{contents:"export * from './src/ui/parcelRegulations'; export * from './src/services/vworld/landUse';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env.VITE_CADASTRAL_AUTO_BOX':'false'}});
const {renderParcelRegulations,parseLandUse}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
class Element {children=[];textContent='';append(...n){this.children.push(...n);} replaceChildren(...n){this.children=n;}}
globalThis.document={createElement:()=>new Element()};
const id='1120011300105280006';
const row=(code='UQQ810',relation='1',name='도시자연공원구역')=>({pnu:id,prposAreaDstrcCode:code,prposAreaDstrcCodeNm:name,cnflcAt:relation,cnflcAtNm:({'1':'포함','2':'저촉','3':'접함'})[relation],manageNo:'M1',registDt:null,lastUpdtDt:null});
const state=(rows,total=rows.length)=>parseLandUse({landUses:{field:rows,totalCount:total,numOfRows:1000,pageNo:1,resultCode:null,resultMsg:null}},id);
const text=n=>n.textContent+n.children.map(text).join(' ');
const render=s=>{const h=new Element();renderParcelRegulations(h,s);return h;};
test('규제 UI: UQQ810 포함/저촉 표시·중복 요약·원본/관리번호 보존',()=>{
 const s=state([row(),{...row(),manageNo:'M2'},row('UQQ810','2')]);const before=JSON.stringify(s.value.records);
 const h=render(s);assert.match(text(h),/용도구역 · 2/);assert.match(text(h),/포함/);assert.match(text(h),/저촉/);assert.match(text(h),/원본 2건/);assert.equal(JSON.stringify(s.value.records),before);
});
test('규제 UI: 접함 제외·정상 빈 표시에서 규제 부재 단정 금지',()=>{
 const h=render(state([row('UQQ810','3')]));assert.doesNotMatch(text(h),/도시자연공원구역/);assert.match(text(h),/규제 부재를 의미하지/);
 assert.match(text(render(state([]))),/별도로 확인/);
});
test('규제 UI: 미분류·명칭 불일치·관계 불일치 확인 안내',()=>{
 const h=render(state([row('NEW','1','미확인명칭'),row('UQQ810','2','다른명칭'),{...row(),cnflcAtNm:'저촉'}]));
 assert.match(text(h),/분류 미확인 정보/);assert.match(text(h),/다른명칭/);assert.match(text(h),/관계 확인 필요/);
});
test('규제 UI: 부분조회·실패/취소·로딩·이전 상태 제거',()=>{
 const s=state(Array.from({length:1000},()=>row()),1001);const h=render(s);assert.match(text(h),/전체 결과가 아닙니다/);
 renderParcelRegulations(h,{status:'error',message:'취소'});assert.match(text(h),/완료되지 않았/);assert.doesNotMatch(text(h),/도시자연공원구역/);
 renderParcelRegulations(h,{status:'loading',message:''});assert.match(text(h),/조회 중/);
});
