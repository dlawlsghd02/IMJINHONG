import type {MapFeature} from './types';
import {createOwnershipWms} from '../services/vworld/ownershipWms';

export function createOwnershipWmsControls(onToggle:(enabled:boolean)=>void,mobile=false){
  const root=document.createElement('section');root.className='ownership-controls ownership-wms-controls';
  const button=document.createElement('button');button.type='button';button.textContent='토지소유구분도';button.setAttribute('aria-pressed','false');
  const panel=document.createElement('div');panel.hidden=true;
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const legend=document.createElement('details');legend.className='ownership-wms-legend';legend.open=!mobile;
  const summary=document.createElement('summary');summary.textContent='소유구분 범례';
  const notice=document.createElement('p');notice.textContent='본 지도는 V-World에서 제공하는 토지소유구분도를 표시합니다. 색상별 소유구분에 대한 공식 범례는 확인 중입니다.';
  const caution=document.createElement('p');caution.textContent='지도 색상만으로 소유권을 확정하지 마세요.';
  const source=document.createElement('small');source.textContent='지도 이미지: 국토교통부 · V-World. 공식 범례 미확보. 추정 색상표는 표시하지 않습니다.';
  legend.append(summary,notice,source,caution);
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
