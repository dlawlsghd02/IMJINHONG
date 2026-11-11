import type Map from 'ol/Map.js';
import ImageLayer from 'ol/layer/Image.js';
import ImageStatic from 'ol/source/ImageStatic.js';

export function ownershipWmsUrl(key:string,domain:string|undefined,bbox:readonly number[],width:number,height:number){
  if(!key.trim())throw Error('소유정보 WMS 인증 설정 없음');
  if(bbox.length!==4||bbox.some(n=>!Number.isFinite(n)||Math.abs(n)>20_037_509)
    ||bbox[0]>=bbox[2]||bbox[1]>=bbox[3])throw Error('소유정보 WMS 범위 오류');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512)throw Error('소유정보 WMS 크기 오류');
  if(domain){
    let valid=false;
    try{const u=new URL(domain);valid=['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash&&!/\s/.test(domain);}catch{/* 원문 출력 금지 */}
    if(!valid)throw Error('소유정보 WMS domain 설정 오류');
  }
  const url=new URL('https://api.vworld.kr/ned/wms/getPossessionWMS');
  url.search=new URLSearchParams({key:key.trim(),...(domain?{domain}:{}),crs:'EPSG:3857',bbox:bbox.join(','),width:String(width),height:String(height),format:'image/png'}).toString();
  return url.toString();
}

/** 전용 NED 이미지 API. 표준 WMS의 LAYERS/STYLES 등을 추가하지 않는다. */
export function createOwnershipWms(map:Map,key:string,domain:string|undefined,notify:(message:string)=>void){
  const layer=new ImageLayer<ImageStatic>({visible:false,opacity:1});
  layer.setZIndex(35);layer.set('ownershipOverlay',true);
  let enabled=false,disposed=false,generation=0;
  let source:ImageStatic|undefined,image:HTMLImageElement|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
  const clear=()=>{
    generation++;
    if(timer!==undefined)clearTimeout(timer);timer=undefined;
    if(timeout!==undefined)clearTimeout(timeout);timeout=undefined;
    if(image){image.onload=null;image.onerror=null;image.removeAttribute('src');image=undefined;}
    layer.setSource(null);source?.dispose();source=undefined;
  };
  const update=()=>{
    clear();if(!enabled||disposed)return;
    if(map.getView().getProjection().getCode()!=='EPSG:3857'){notify('소유정보 WMS 좌표계 오류');return;}
    const size=map.getSize();
    if(!size||size.some(n=>!Number.isFinite(n)||n<=0)){notify('소유정보 WMS 지도 크기 확인 대기');return;}
    const bbox=map.getView().calculateExtent(size),scale=Math.min(1,512/Math.max(...size));
    let url:string;
    try{url=ownershipWmsUrl(key,domain,bbox,Math.max(1,Math.round(size[0]*scale)),Math.max(1,Math.round(size[1]*scale)));}
    catch{notify('소유정보 WMS 설정 또는 범위 오류');return;}
    const token=generation;
    const fail=()=>{if(token!==generation||!enabled||disposed)return;clear();notify('소유정보 WMS 이미지 조회 실패 · 인증·네트워크·응답 형식 확인 필요');};
    source=new ImageStatic({url,projection:'EPSG:3857',imageExtent:bbox,interpolate:false,
      attributions:'토지소유정보: 국토교통부 · V-World',
      // crossOrigin 미지정: fetch/CORS 우회가 아니라 일반 이미지 표시만 수행한다.
      imageLoadFunction:(wrapper,src)=>{
        if(token!==generation||!enabled||disposed)return;
        const element=wrapper.getImage();
        if(!(element instanceof HTMLImageElement)){fail();return;}
        image=element;
        element.onload=()=>{
          if(token!==generation||!enabled||disposed)return;
          if(!element.naturalWidth||!element.naturalHeight){fail();return;}
        };
        element.onerror=fail;
        timeout=setTimeout(fail,10_000);
        element.src=src;
      },
    });
    source.on('imageloaderror',fail);
    source.on('imageloadend',()=>{
      if(token!==generation||!enabled||disposed)return;
      if(timeout!==undefined)clearTimeout(timeout);timeout=undefined;
      notify('V-World 원본 소유정보 이미지 표시 · 조회 완전성 미확인');
    });
    notify('소유정보 WMS 이미지 불러오는 중…');layer.setSource(source);
  };
  const start=()=>{if(enabled){clear();notify('지도 이동 중 · 소유정보 WMS 갱신 대기');}};
  const end=()=>{if(!enabled||disposed)return;clear();timer=setTimeout(update,350);};
  map.on('movestart',start);map.on('moveend',end);
  return {layer,
    setEnabled(value:boolean){enabled=value;clear();layer.setVisible(value);if(value)end();else notify('소유정보 WMS OFF');},
    dispose(){disposed=true;enabled=false;clear();map.un('movestart',start);map.un('moveend',end);layer.dispose();},
  };
}
