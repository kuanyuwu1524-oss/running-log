/* ===== 課表結構：資料模型 =====
 session.structure = {
   source: 'inferred' | 'laps' | 'manual',   // 依標題推估 / 實際分圈 / 手動描述
   plan: [ Step | Repeat ],                  // 用於「步驟」清單
   blocks: [ {kind, sec, dist, pace, hr} ]   // 攤平後用於繪圖（高度=強度，寬度=時間）
 }
 Step   = {type:'step', kind:'warmup'|'work'|'recover'|'cooldown'|'steady'|'race', sec, dist, pace, paceLo, paceHi, hr, label, est}
 Repeat = {type:'repeat', n, steps:[Step...], skipLast:true}
 實際分圈資料（TCX / Garmin 分段 CSV）匯入後存在 edits[id].laps = [{sec, dist, hr, kind?}]，
 會以 lapsToStructure() 取代推估結構，方塊高度改用該圈實際配速。
*/
const KIND={warmup:{c:'#E03131',zh:'熱身',en:'Warm Up'},work:{c:'#1E78D7',zh:'主課',en:'Run'},recover:{c:'#6f6f73',zh:'恢復',en:'Recover'},
 cooldown:{c:'#2F9E44',zh:'緩和',en:'Cool Down'},steady:{c:'#1E78D7',zh:'跑步',en:'Run'},race:{c:'#7048E8',zh:'比賽 / 測驗',en:'Race'},rest:{c:'#6f6f73',zh:'休息',en:'Rest'}};
const ZONE={thrPace:279,lthr:177}; // 閾值配速 4:39/km、乳酸閾值心率 177（可在設定修改）
const EASY_PACE=385, WORK_PACE_DEFAULT=272;

function fmtSec(s){if(s==null||!isFinite(s))return '--';s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${m}:${String(x).padStart(2,'0')}`}
function fmtDist(m){if(m==null)return '';return m>=1000?(+(m/1000).toFixed(2))+' km':Math.round(m)+' m'}
function parsePaceTok(s){const m=String(s).match(/(\d)\s*[’'′:：]\s*(\d{2})/);return m?(+m[1])*60+(+m[2]):null}
function parseDistTok(num,unit){num=parseFloat(num);if(unit&&/k/i.test(unit))return num*1000;if(unit&&/m/i.test(unit))return num;return num<=25?num*1000:num}

function parseRecovery(t){
  let m;
  if(m=t.match(/(?:\bR|\br|rest|休息?|恢復)\s*[:：]?\s*(\d+)\s*[:：’']\s*(\d{2})/))return{sec:+m[1]*60+(+m[2])};
  if(m=t.match(/(?:\bR|\br|rest|休息?)\s*[:：]?\s*(\d+)\s*(m(?!in)|公尺)/))return{dist:+m[1]};
  if(m=t.match(/(?:\bR|\br|rest|休息?)\s*[:：]?\s*(\d+)\s*(s|秒)/i))return{sec:+m[1]};
  if(m=t.match(/(?:\bR|\br|rest|休息?)\s*[:：]?\s*(\d+(?:\.\d)?)\s*(min|分|')?/))return{sec:parseFloat(m[1])*60};
  return null;
}
function parseTargetPace(t){const m=t.match(/(\d\s*[’'′:]\s*\d{2})\s*[-~～]\s*(\d\s*[’'′:]\s*\d{2})/);if(m){const a=parsePaceTok(m[1]),b=parsePaceTok(m[2]);return{lo:Math.min(a,b),hi:Math.max(a,b),mid:(a+b)/2}}
  const s=t.match(/@\s*(\d\s*[’'′:]\s*\d{2})/);if(s){const a=parsePaceTok(s[1]);return{lo:a,hi:a,mid:a}}return null}

/* 依標題 + 總距離/時間推估課表 */
function inferStructure(a,cls,descOverride){
  const t=(descOverride||a.title||'').replace(/[×xX＊]/g,'*');const total=a.sec, distM=a.dist*1000;
  const tp=parseTargetPace(t); const rec=parseRecovery(t)||null; const plan=[]; let est=true;
  const avgPace=a.dist>0?a.sec/a.dist:EASY_PACE;
  const workPace=tp?tp.mid:WORK_PACE_DEFAULT;
  const S=(kind,o)=>Object.assign({type:'step',kind},o);
  const recStep=()=>rec?(rec.sec?S('recover',{sec:rec.sec,label:fmtSec(rec.sec)}):S('recover',{dist:rec.dist,sec:rec.dist/1000*420,label:fmtDist(rec.dist)+' 慢跑'})):S('recover',{sec:60,label:'1:00',assumed:true});
  let work=[]; // [{reps, dist|sec}]
  let m, re=/(\d+(?:\.\d+)?)\s*(km|k|m|公尺)?\s*\*\s*(\d+)/gi;
  while((m=re.exec(t))){const d=parseDistTok(m[1],m[2]);if(d>=100&&d<=10000)work.push({n:+m[3],dist:d})}
  // 「2k*3 1k」後面多一趟
  if(work.length&&(m=t.match(/\*\s*\d+\s+(\d+(?:\.\d+)?)\s*(k|km|m)\b/i)))work.push({n:1,dist:parseDistTok(m[1],m[2])});
  if(!work.length&&(m=t.match(/(\d+(?:\.\d+)?)\s*(k|km)\s*\+\s*(\d+(?:\.\d+)?)\s*(k|km)/i))&&!/easy|輕鬆/i.test(t))work=[{n:1,dist:+m[1]*1000},{n:1,dist:+m[3]*1000}];
  let timeBlocks=[];
  if(!work.length&&(m=t.match(/(\d+)\s*(?:mins?|分鐘?)\s*\+\s*(\d+)\s*(?:mins?|分鐘?)/i)))timeBlocks=[+m[1]*60,+m[2]*60];
  const isCooper=/cooper/i.test(t), isTempo=/tempo|節奏|LT\b|閾值|乳酸/i.test(t), isFart=/fart|farklek|法特/i.test(t);
  let tempoMin=(m=t.match(/(\d+)\s*(?:mins?|分鐘)/i))?+m[1]:null;
  const hmp=t.match(/(\d+(?:\.\d+)?)\s*k\s*(HMP|MP|半馬配速|馬配速)/i);
  const lastK=t.match(/最後\s*(\d+(?:\.\d+)?)\s*k/i), fastFinish=/fast\s*finish/i.test(t);
  const strides=t.match(/(\d+)?\s*\*?\s*(strides?|加速跑)/i);
  const wucd=(workSec)=>{let rem=total-workSec;if(rem<240)return null;return{wu:rem*0.6,cd:rem*0.4}};
  const addWuCd=(inner,workSec)=>{const w=wucd(workSec);if(w)plan.push(S('warmup',{sec:w.wu,dist:w.wu/EASY_PACE*1000,label:'約 '+fmtSec(w.wu),assumed:true}));plan.push(...inner);if(w)plan.push(S('cooldown',{sec:w.cd,dist:w.cd/EASY_PACE*1000,label:'約 '+fmtSec(w.cd),assumed:true}))};
  if(cls==='race'){plan.push(S('race',{sec:total,dist:distM,pace:avgPace,label:fmtDist(distM)}));}
  else if(isCooper){const ws=Math.min(720,total);addWuCd([S('race',{sec:ws,pace:ws/(distM/1000)*(total>900?0.92:1),label:'12:00 全力（Cooper）'})],ws);}
  else if(work.length){
    const inner=[];let ws=0;
    work.forEach((w,gi)=>{const st=S('work',{dist:w.dist,sec:w.dist/1000*workPace,pace:workPace,paceLo:tp&&tp.lo,paceHi:tp&&tp.hi,label:fmtDist(w.dist)+(tp?` @ ${fmtSec(tp.lo)}${tp.hi!==tp.lo?'–'+fmtSec(tp.hi):''}/km`:'')});
      ws+=w.n*st.sec;const r=recStep();ws+=(w.n-1)*r.sec;
      if(w.n>1)inner.push({type:'repeat',n:w.n,steps:[st,r],skipLast:true});else inner.push(st);
      if(gi<work.length-1){inner.push(recStep());ws+=r.sec}});
    addWuCd(inner,ws);
  }
  else if(timeBlocks.length){const p=tp?tp.mid:ZONE.thrPace+10;const inner=[];let ws=0;timeBlocks.forEach((s,i)=>{inner.push(S('work',{sec:s,pace:p,dist:s/p*1000,label:fmtSec(s)+(tp?` @ ${fmtSec(tp.lo)}–${fmtSec(tp.hi)}/km`:'')}));ws+=s;if(i<timeBlocks.length-1){const r=rec?recStep():S('recover',{sec:120,label:'2:00',assumed:true});inner.push(r);ws+=r.sec}});addWuCd(inner,ws)}
  else if(hmp){const d=+hmp[1]*1000,p=tp?tp.mid:ZONE.thrPace+20;const ws=d/1000*p;const rest=total-ws;
    if(rest>0){plan.push(S('warmup',{sec:Math.min(rest,600),label:'約 '+fmtSec(Math.min(rest,600)),assumed:true}))}
    plan.push(S('work',{dist:d,sec:ws,pace:p,label:fmtDist(d)+' 半馬配速'}));if(rest>600)plan.push(S('cooldown',{sec:rest-600,label:'約 '+fmtSec(rest-600)+'（輕鬆）'}))}
  else if(isTempo&&tempoMin&&cls!=='long'){const s=tempoMin*60,p=tp?tp.mid:ZONE.thrPace+10;addWuCd([S('work',{sec:s,pace:p,dist:s/p*1000,label:fmtSec(s)+' 節奏跑'+(tp?` @ ${fmtSec(tp.lo)}–${fmtSec(tp.hi)}/km`:'')})],s)}
  else if((lastK||fastFinish)&&a.dist>=8){const fk=lastK?+lastK[1]:3;const fp=tp?tp.mid:Math.min(avgPace-25,330);const fs=fk*fp;const ss=Math.max(total-fs,0);
    plan.push(S('steady',{sec:ss,dist:(a.dist-fk)*1000,pace:ss/Math.max(a.dist-fk,0.1),label:fmtDist((a.dist-fk)*1000)+' 穩定'}));plan.push(S('work',{dist:fk*1000,sec:fs,pace:fp,label:`最後 ${fk} km 加速`+(tp?` @ ${fmtSec(tp.lo)}–${fmtSec(tp.hi)}/km`:'（配速推估）')}))}
  else if((isTempo||isFart||cls==='workout')&&cls!=='long'){
    if(isFart&&!work.length){const inner=[{type:'repeat',n:6,steps:[S('work',{sec:120,pace:WORK_PACE_DEFAULT,label:'2:00 快（推估）',assumed:true}),S('recover',{sec:90,label:'1:30 慢（推估）',assumed:true})],skipLast:true}];addWuCd(inner,6*120+5*90)}
    else{const s=Math.max(total*0.5,600);addWuCd([S('work',{sec:s,pace:ZONE.thrPace+10,label:'主課表（細節不明，約 '+fmtSec(s)+'）',assumed:true})],s)}}
  else{ // 輕鬆 / 長距離 / 恢復：單一穩定方塊
    plan.push(S('steady',{sec:total,dist:distM,pace:avgPace,hr:a.hr,label:fmtDist(distM)+' · '+fmtSec(avgPace)+'/km'}));
    if(strides){const n=+(strides[1]||4);plan.push({type:'repeat',n,steps:[S('work',{sec:20,pace:230,label:'20 秒加速',assumed:true}),S('recover',{sec:60,label:'1:00',assumed:true})],skipLast:true})}
  }
  return {source:descOverride?'manual':'inferred',plan,blocks:flatten(plan)};
}
function flatten(plan){const out=[];plan.forEach(p=>{if(p.type==='repeat'){for(let i=0;i<p.n;i++)p.steps.forEach((s,j)=>{if(p.skipLast&&i===p.n-1&&j===p.steps.length-1&&s.kind==='recover')return;out.push(s)})}else out.push(p)});return out}

/* 強度 → 高度（0~1）。以閾值配速 4:39/km、LTHR 177 為基準 */
function intensity(b){
  if(b.kind==='warmup'||b.kind==='cooldown')return b.pace?Math.min(paceInt(b.pace),0.78):0.72;
  if(b.kind==='recover'||b.kind==='rest')return b.pace?Math.min(paceInt(b.pace),0.6):0.55;
  let v=b.pace?paceInt(b.pace):1.0; if(b.hr&&(b.kind==='steady'))v=(v+b.hr/ZONE.lthr)/2; return v;
}
function paceInt(p){return ZONE.thrPace/p}
function heightFrac(I){return Math.max(0.12,Math.min(1,(I-0.5)/(1.12-0.5)))}

/* 產生 Garmin 風格 SVG */
function workoutSVG(st,W,H,opt={}){
  const bl=st.blocks.filter(b=>b.sec>0);if(!bl.length)return '';
  const gap=opt.gap!=null?opt.gap:Math.max(1.5,W/160);const pad=opt.pad||0;
  const tot=bl.reduce((s,b)=>s+b.sec,0);
  const minW=opt.minW!=null?opt.minW:Math.max(3,W/60);
  let ws=bl.map(b=>Math.max(minW,b.sec/tot*(W-2*pad-gap*(bl.length-1))));
  const sc=(W-2*pad-gap*(bl.length-1))/ws.reduce((a,b)=>a+b,0);ws=ws.map(w=>w*sc);
  const r=Math.min(opt.r||W/90,6);let x=pad,s='';
  bl.forEach((b,i)=>{const h=Math.max(4,heightFrac(intensity(b))*(H-2*pad));const y=H-pad-h;const w=Math.max(1,ws[i]);const rr=Math.min(r,w/2);
    s+=`<path d="M${x},${H-pad} V${y+rr} Q${x},${y} ${x+rr},${y} H${x+w-rr} Q${x+w},${y} ${x+w},${y+rr} V${H-pad} Z" fill="${(KIND[b.kind]||KIND.steady).c}"><title>${(KIND[b.kind]||{}).zh||''} ${fmtSec(b.sec)}${b.pace?' · '+fmtSec(b.pace)+'/km':''}</title></path>`;x+=w+gap});
  return `<svg viewBox="0 0 ${W} ${H}" width="${opt.width||W}" height="${opt.height||H}" preserveAspectRatio="none" style="background:${opt.bg||'transparent'};border-radius:${opt.br||0}px">${s}</svg>`;
}

/* 分圈資料 → 結構（高度用實際配速） */
function lapsToStructure(laps){
  const L=laps.filter(l=>l.sec>0);const paces=L.filter(l=>l.dist>0).map(l=>l.sec/(l.dist/1000)).sort((a,b)=>a-b);
  const med=paces.length?paces[Math.floor(paces.length/2)]:EASY_PACE;const fastest=paces[0]||med;
  const thr=(fastest<med-20)?(fastest+med)/2:null; // 有明顯快慢差才分主課/恢復
  let blocks=L.map(l=>{const p=l.dist>0?l.sec/(l.dist/1000):null;let k=l.kind;
    if(!k){k=thr==null?'steady':(p!=null&&p<thr?'work':'recover')}return{kind:k,sec:l.sec,dist:l.dist,pace:p,hr:l.hr}});
  if(thr!=null){const fw=blocks.findIndex(b=>b.kind==='work'),lw=blocks.length-1-[...blocks].reverse().findIndex(b=>b.kind==='work');
    blocks.forEach((b,i)=>{if(b.kind==='recover'&&i<fw)b.kind='warmup';if(b.kind==='recover'&&i>lw)b.kind='cooldown'})}
  const plan=blocks.map((b,i)=>Object.assign({type:'step',label:`第 ${i+1} 圈 · ${fmtDist(b.dist)} · ${fmtSec(b.sec)}`+(b.pace?` · ${fmtSec(b.pace)}/km`:'')+(b.hr?` · ${Math.round(b.hr)} bpm`:'')},b));
  return{source:'laps',plan,blocks};
}
function parseTCX(text){const doc=new DOMParser().parseFromString(text,'application/xml');const laps=[...doc.getElementsByTagName('Lap')].map(l=>{const g=n=>{const e=l.getElementsByTagName(n)[0];return e?e.textContent:null};
  const hrE=l.getElementsByTagName('AverageHeartRateBpm')[0];const it=g('Intensity');return{sec:+g('TotalTimeSeconds'),dist:+g('DistanceMeters'),hr:hrE?+hrE.textContent.trim():null,kind:it==='Resting'?'recover':null}});
  return laps.filter(l=>l.sec>0)}
function parseSplitsCSV(text){const rows=parseCSV(text);const h=rows[0].map(x=>x.trim());const ix=(...n)=>h.findIndex(c=>n.includes(c));
  const iL=ix('Laps','Split','圈數','分段'),iT=ix('Time','時間'),iD=ix('Distance','距離'),iH=ix('Avg HR','平均心率'),iS=ix('Step Type','步驟類型');
  if(iT<0||iD<0)throw new Error('找不到「時間」或「距離」欄位');
  const map={'Warm Up':'warmup','熱身':'warmup','Run':'work','跑步':'work','Active':'work','Recover':'recover','Recovery':'recover','恢復':'recover','Rest':'rest','休息':'rest','Cool Down':'cooldown','緩和':'cooldown'};
  return rows.slice(1).filter(r=>r.length>2&&!/summary|摘要|總計/i.test(r[iL>=0?iL:0])).map(r=>{let d=num(r[iD]);if(d!=null&&d<100)d*=1000;
    return{sec:parseDur(r[iT]),dist:d,hr:iH>=0?num(r[iH]):null,kind:iS>=0?(map[(r[iS]||'').trim()]||null):null}}).filter(l=>l.sec>0)}
