import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Fill, Style } from 'ol/style.js';
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { MapFeature } from './types';
import type { LandLedger } from '../services/vworld/landLedger';
import { ownershipCodeDefinition } from '../services/ownershipCodes';
import {createOwnershipWms} from '../services/vworld/ownershipWms';
export { ownershipCodes, ownershipCodeDefinition } from '../services/ownershipCodes';

export const ownershipLegend = [
  {id:'individual',label:'개인',color:'#F2D77A'},
  {id:'corporation',label:'법인',color:'#76B7E5'},
  {id:'national',label:'국유지',color:'#DC7777'},
  {id:'public',label:'시·도유지',color:'#A48BD4'},
  {id:'municipal',label:'군유지',color:'#8B5A2B'},
  {id:'clan',label:'종중·문중',color:'#81B88C'},
  {id:'other',label:'기타',color:'#A6ACB4'},
  {id:'unknown',label:'미확인',color:'#E5E7EB'},
] as const;
export type OwnershipCategory = typeof ownershipLegend[number]['id'];
export function classifyOwnership(value: Pick<LandLedger,'ownershipCode'|'ownershipName'> | null, source:'ledger'|'wfs'='ledger'): OwnershipCategory {
  const definition=ownershipCodeDefinition(value?.ownershipCode);
  if(!definition)return 'unknown';
  // WFS는 코드만 제공한다. 선택 필지 응답은 원본 명칭도 일치해야 한다.
  return source==='wfs' || value?.ownershipName===definition.officialName ? definition.category : 'unknown';
}
// Future verified WMS/WFS adapter boundary. No network or per-parcel loader here.
export type OwnershipDataset = {status:'not-loaded'|'loading'|'error'; mode:'actual'|'mock'} |
  {status:'ready';mode:'actual'|'mock';partial:boolean;items:readonly {
    feature:Feature<Geometry>;ownership:Pick<LandLedger,'ownershipCode'|'ownershipName'>|null;
    classificationSource?:'ledger'|'wfs';
  }[]};
// A map-scoped channel shares an existing selection result, never an API request.
const channels = new WeakMap<object,{data:OwnershipDataset;listeners:Set<(data:OwnershipDataset)=>void>}>();
function channel(map:object) {
  let value=channels.get(map);
  if(!value){value={data:{status:'not-loaded',mode:'actual'},listeners:new Set()};channels.set(map,value);}
  return value;
}
export function publishOwnership(map:object,data:OwnershipDataset) {
  const value=channel(map);value.data=data;value.listeners.forEach(listener=>listener(data));
}
export function subscribeOwnership(map:object,listener:(data:OwnershipDataset)=>void) {
  const value=channel(map);value.listeners.add(listener);listener(value.data);
  return ()=>{value.listeners.delete(listener);};
}
export function selectedOwnershipData(feature:Feature<Geometry>,ledger:LandLedger):OwnershipDataset {
  const geometry=feature.getGeometry();
  if(feature.get('pnu')!==ledger.pnu || !geometry || !['Polygon','MultiPolygon'].includes(geometry.getType()))
    return {status:'error',mode:'actual'};
  // Copy geometry only; do not carry unrelated parcel properties into the overlay.
  const polygon=new Feature<Geometry>(geometry.clone());
  return {status:'ready',mode:'actual',partial:true,items:[{feature:polygon,ownership:{ownershipCode:ledger.ownershipCode,ownershipName:ledger.ownershipName}}]};
}
export function createOwnershipLayer() {
  const source = new VectorSource<Feature<Geometry>>();
  const styles = new Map(ownershipLegend.map(item=>[item.id,new Style({fill:new Fill({color:item.color})})]));
  const layer = new VectorLayer({source,visible:false,opacity:0.4,
    style:feature=>styles.get(feature.get('ownershipCategory') as OwnershipCategory) ?? styles.get('unknown')});
  layer.setZIndex(35); layer.set('ownershipOverlay',true);
  let enabled=false;
  return {layer,
    setEnabled(value:boolean){enabled=value;layer.setVisible(enabled);},
    setData(data:OwnershipDataset){
      source.clear();
      if(data.status==='ready') source.addFeatures(data.items.map(item=>{
        const feature=item.feature.clone();
        feature.set('ownershipCode',item.ownership?.ownershipCode ?? null);
        feature.set('ownershipName',item.ownership?.ownershipName ?? null);
        feature.set('ownershipOfficialName',ownershipCodeDefinition(item.ownership?.ownershipCode)?.officialName ?? null);
        feature.set('ownershipCategory',classifyOwnership(item.ownership,item.classificationSource));return feature;
      }));
    },
    dispose(){source.clear();layer.dispose();source.dispose();},
  };
}
export function createOwnershipControls(onToggle:(enabled:boolean)=>void) {
  const root=document.createElement('section');root.className='ownership-controls';
  const button=document.createElement('button');button.type='button';button.textContent='토지소유구분도';button.setAttribute('aria-pressed','false');
  const legend=document.createElement('div');legend.hidden=true;
  const note=document.createElement('p');note.setAttribute('role','status');
  const list=document.createElement('ul');
  ownershipLegend.forEach(item=>{const li=document.createElement('li'),swatch=document.createElement('span');
    swatch.style.backgroundColor=item.color;swatch.setAttribute('aria-hidden','true');li.append(swatch,document.createTextNode(item.label));list.append(li);});
  legend.append(note,list);root.append(button,legend);
  let enabled=false;
  const click=()=>{enabled=!enabled;button.setAttribute('aria-pressed',String(enabled));legend.hidden=!enabled;onToggle(enabled);};
  button.addEventListener('click',click);
  const setData=(data:OwnershipDataset,message?:string)=>{note.textContent=message ?? (data.mode==='mock'?'모의 데이터 · ':'')+
    (data.status==='not-loaded'?'전국 소유정보 미연결 · 지도 색칠 자료가 없습니다.':data.status==='loading'?'소유정보 조회 중':data.status==='error'?'소유정보 조회 실패':
      data.status==='ready' ? `${data.items.length}개 도형 · ${data.partial?'일부 자료':'제공된 자료'}만 표시합니다.` : '소유정보 상태 미확인')+ ' 현재 선택한 필지의 확인된 소유구분만 표시합니다. 전국 필지 소유구분도는 아직 연결되지 않았습니다. 공식 코드표로 분류하며, 정의되지 않은 코드는 미확인으로 표시합니다.';};
  setData({status:'not-loaded',mode:'actual'});
  return {root,setData,dispose(){button.removeEventListener('click',click);root.remove();}};
}
/** 한 지역 21필지의 실측 대응. 공식 WMS 범례가 아니며 WFS 자체 색상표와 별개다. */
export const ownershipWmsProvisionalLegend = [
  {label:'법인',color:'rgba(231,189,255,0.50196)'},
  {label:'국유지',color:'rgba(225,225,225,0.50196)'},
  {label:'시·도유지',color:'rgba(255,233,189,0.50196)'},
  {label:'소유구분 확인 필요',color:'rgba(255,227,239,0.50196)'},
  {label:'군유지',color:'rgba(255,255,189,0.50196)'},
  {label:'외국인·외국공공기관',color:'rgba(233,255,189,0.50196)'},
] as const;

export function createOwnershipWmsControls(onToggle:(enabled:boolean)=>void,mobile=false){
  const root=document.createElement('section');root.className='ownership-controls ownership-wms-controls';
  const button=document.createElement('button');button.type='button';button.textContent='토지소유구분도';button.setAttribute('aria-pressed','false');
  const panel=document.createElement('div');panel.hidden=true;
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const legend=document.createElement('details');legend.className='ownership-wms-legend';legend.open=!mobile;
  const summary=document.createElement('summary');summary.textContent='소유구분(잠정)';
  const list=document.createElement('ul');list.className='ownership-wms-legend-list';
  ownershipWmsProvisionalLegend.forEach(item=>{
    const row=document.createElement('li');
    const swatch=document.createElement('span');swatch.className='ownership-wms-swatch';swatch.setAttribute('aria-hidden','true');
    const fill=document.createElement('i');fill.style.backgroundColor=item.color;swatch.append(fill);
    const label=document.createElement('div');label.className='ownership-wms-label';label.textContent=item.label;
    row.append(swatch,label);list.append(row);
  });
  const notice=document.createElement('p');notice.textContent='V-World 소유정보 WMS 색상을 일부 필지의 토지임야정보와 대조한 잠정 범례입니다. 공식 범례가 아니며 실제 소유구분과 다를 수 있습니다.';
  const caution=document.createElement('p');caution.textContent='지도 색상만으로 소유권을 확정하지 마세요.';
  const source=document.createElement('small');source.textContent='지도 이미지: 국토교통부 · V-World. 범례: 일부 필지 실측에 따른 잠정 대응.';
  legend.append(summary,list,notice,source,caution);
  const help=document.createElement('details');help.className='ownership-wms-help';
  const helpTitle=document.createElement('summary');helpTitle.textContent='표시 안내';
  const helpText=document.createElement('p');helpText.textContent='V-World 원본 이미지입니다. 지번·면적 라벨과 축척별 표시 여부는 서버 스타일을 따릅니다. 조회 완전성은 미확인입니다.';
  help.append(helpTitle,helpText);panel.append(status,legend,help);root.append(button,panel);
  let enabled=false;
  const click=()=>{enabled=!enabled;button.setAttribute('aria-pressed',String(enabled));panel.hidden=!enabled;onToggle(enabled);};
  button.addEventListener('click',click);
  return {root,setStatus(message:string){status.textContent=message;status.dataset.state=/실패|오류/.test(message)?'error':/불러오는|대기|이동/.test(message)?'loading':'normal';},dispose(){button.removeEventListener('click',click);root.remove();}};
}
export const ownershipFeature:MapFeature={id:'ownership',mount({map,zoningHost,vworldApiKey,vworldDomain}){
  const ui=createOwnershipWmsControls(value=>model.setEnabled(value),window.matchMedia('(max-width: 900px)').matches);
  const model=createOwnershipWms(map,vworldApiKey,vworldDomain,message=>ui.setStatus(message));
  map.addLayer(model.layer);zoningHost.parentElement?.append(ui.root);
  return ()=>{ui.dispose();map.removeLayer(model.layer);model.dispose();};
}};
