import {AbsoluteFill,Sequence,staticFile,useCurrentFrame,useVideoConfig,interpolate,Easing} from 'remotion';
import {Audio,Video} from '@remotion/media';
import events from './capture-events.json';

const ink='#101820',white='#DEE5E9',muted='#9BAAB7',accent='#B58954';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
type Clip=keyof typeof events;

// Cursor positions come exclusively from actual Playwright click coordinates.
const RecordedCursor=({clip}:{clip:Clip})=>{
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const time=frame/fps;
 const points=events[clip] as {t:number;x:number;y:number}[];
 const target=points.findIndex(p=>time<=p.t+.45);if(target<0)return null;
 const p=points[target],prev=points[Math.max(0,target-1)];
 if(!(time>p.t-.65&&time<p.t+.45))return null;
 const k=interpolate(time,[p.t-.5,p.t],[0,1],clamp);
 const x=prev.x+(p.x-prev.x)*k,y=prev.y+(p.y-prev.y)*k;
 return <svg width={28} height={36} viewBox="0 0 28 36" style={{position:'absolute',left:x,top:y}}><path d="M2 2 L2 28 L9 21 L15 33 L20 30 L14 19 L25 18 Z" fill="#101820" stroke="white" strokeWidth="2"/></svg>;
};

const Footage=({clip,crop,move=0}:{clip:Clip;crop:[number,number,number];move?:number})=>{
 const frame=useCurrentFrame();
 const [x,y,w]=crop;
 const zoom=interpolate(frame,[0,209],[1,1+move],clamp);
 let cx=x,cy=y,cw=w;
 if(clip==='03-dossier')cy=interpolate(frame,[0,120,165,210,270,300,330],[150,150,300,300,500,500,150],clamp);
 if(clip==='04-verification')cy=interpolate(frame,[0,32,55,170,200,509],[600,600,240,240,600,600],{...clamp,easing:Easing.bezier(.22,.61,.36,1)});
 if(clip==='02-object'){
  const k=interpolate(frame,[233,299],[0,1],{...clamp,easing:Easing.bezier(.22,.61,.36,1)});
  cx=x+(600-x)*k;cy=y+(150-y)*k;cw=w+(1360-w)*k;
 }
 const scale=1728/cw;
 return <div style={{position:'absolute',left:96,top:110,width:1728,height:830,overflow:'hidden',background:'#f5f5f7'}}>
  <div style={{position:'absolute',inset:0,scale:zoom,transformOrigin:'50% 50%'}}>
   <div style={{position:'absolute',left:-cx*scale,top:-cy*scale,width:2560,height:1440,scale,transformOrigin:'0 0'}}>
    <Video src={staticFile(`footage/${clip}.mp4`)} muted style={{position:'absolute',width:2560,height:1440}}/>
    <RecordedCursor clip={clip}/>
   </div>
  </div>
 </div>;
};

const Caption=({title,note}:{title:string;note:string})=>{
 const f=useCurrentFrame();
 return <div style={{position:'absolute',left:96,right:96,top:963,display:'flex',justifyContent:'space-between',alignItems:'center',opacity:interpolate(f,[0,18],[0,1],clamp)}}>
  <div style={{fontSize:32,fontWeight:500,letterSpacing:'.025em',color:white}}>{title}</div>
  <div style={{fontSize:19,color:muted,textAlign:'right',maxWidth:610,lineHeight:1.3}}>{note}</div>
 </div>;
};

export const OpeningScene=()=> <><Footage clip="01-city" crop={[0,80,2560]} move={.025}/><Caption title="SAQ QURYLYS" note="Система анализа строительных объектов"/></>;
export const MapSelectionScene=()=> <><Footage clip="02-object" crop={[0,80,2560]}/><Caption title="ОБЪЕКТ ПРОВЕРКИ" note="SQ-001 · Янтарный мыс · DEMO"/></>;
export const DossierScene=()=> <><Footage clip="03-dossier" crop={[600,150,1360]}/><Caption title="ДОСЬЕ ОБЪЕКТА" note="Сведения, документы и связи · учебные данные"/></>;
export const SourceVerificationScene=()=> <><Footage clip="04-verification" crop={[850,240,1200]}/><Caption title="КАЖДЫЙ ФАКТ ИМЕЕТ ИСТОЧНИК" note="Сверка цитаты с сохранённым DEMO-материалом"/></>;
export const InvestigationResultScene=()=> <><Footage clip="05-result" crop={[600,150,1360]} move={.012}/><Caption title="ОТ ИНФОРМАЦИИ — К ФАКТУ" note="Черновик сигнала · Решение принимает человек"/></>;
export const BrandEndingScene=()=>{
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:ink,justifyContent:'center',paddingLeft:180,opacity:interpolate(frame,[0,24],[0,1],clamp)}}>
  <div style={{width:64,height:3,background:accent,marginBottom:36}}/>
  <div style={{fontSize:104,fontWeight:600,letterSpacing:'.025em',color:white}}>SAQ QURYLYS</div>
  <div style={{fontSize:38,color:muted,marginTop:24}}>От источника — к проверяемому факту.</div>
  <div style={{position:'absolute',left:180,bottom:110,fontSize:21,color:muted}}>Демонстрационный сценарий. Решение принимает человек.</div>
 </AbsoluteFill>;
};

export const ProductFilm=()=>{
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:ink,fontFamily:'Segoe UI, Arial, sans-serif'}}>
  <div style={{position:'absolute',left:96,top:72,color:muted,fontSize:18,letterSpacing:'.08em'}}>SAQ QURYLYS / ӨСКЕМЕН</div>
  <div style={{position:'absolute',right:96,top:72,color:accent,fontSize:18,letterSpacing:'.06em'}}>DEMO · ВЫМЫШЛЕННЫЕ ОБЪЕКТЫ И МАТЕРИАЛЫ</div>
  <Sequence name="01 · Город" from={0} durationInFrames={210}><OpeningScene/></Sequence>
  <Sequence name="02 · Объект" from={210} durationInFrames={300}><MapSelectionScene/></Sequence>
  <Sequence name="03 · Досье и связи" from={510} durationInFrames={390}><DossierScene/></Sequence>
  <Sequence name="04 · Источник и проверка" from={900} durationInFrames={510}><SourceVerificationScene/></Sequence>
  <Sequence name="05 · Результат" from={1410} durationInFrames={270}><InvestigationResultScene/></Sequence>
  <Sequence name="06 · Бренд" from={1680} durationInFrames={120}><BrandEndingScene/></Sequence>
  <Audio src={staticFile('atmosphere.wav')}/>
  {frame>=1670&&frame<1680?<AbsoluteFill style={{background:ink,opacity:interpolate(frame,[1670,1679],[0,1],clamp)}}/>:null}
 </AbsoluteFill>;
};
