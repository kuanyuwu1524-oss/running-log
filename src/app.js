'use strict';
const LS={edits:'rt_edits_v1',extra:'rt_extra_v1',settings:'rt_settings_v1'};
const load_=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}};
let edits=load_(LS.edits,{}), extra=load_(LS.extra,[]);
const DATA_MAXHR=Math.max(...BASE.map(a=>a.maxhr||0));
let settings=Object.assign({restHR:55,maxHR:DATA_MAXHR,sex:'m',mode:'mixed',acwr:'ewma',range:180,thrPace:279,lthr:177},load_(LS.settings,{}));
const save=()=>{localStorage.setItem(LS.edits,JSON.stringify(edits));localStorage.setItem(LS.extra,JSON.stringify(extra));localStorage.setItem(LS.settings,JSON.stringify(settings))};
const $=s=>document.querySelector(s);
function toast(m,ms=2600){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(toast._t);toast._t=setTimeout(()=>t.style.display='none',ms)}

/* ---------- 解析工具 ---------- */
function num(s){if(s==null)return null;s=String(s).trim().replace(/^'/,'').replace(/,/g,'');if(s===''||s==='--')return null;const v=parseFloat(s);return isFinite(v)?v:null}
function parseDur(s){s=String(s||'').trim();if(!s||s==='--')return null;const p=s.split(':').map(Number);if(p.some(isNaN))return null;while(p.length<3)p.unshift(0);return p[0]*3600+p[1]*60+p[2]}
function parseCSV(text){text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
  else if(c==='"')q=true;else if(c===','){row.push(f);f=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f=''}else f+=c}
  if(f!==''||row.length){row.push(f);rows.push(row)}return rows.filter(r=>r.some(x=>x!==''))}
const dkey=s=>s.slice(0,10);
function dateAdd(k,n){const d=new Date(k+'T00:00:00');d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function todayKey(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function mondayOf(k){const d=new Date(k+'T00:00:00');const wd=(d.getDay()+6)%7;return dateAdd(k,-wd)}

/* ---------- 分類 ---------- */
const TYPES={race:'比賽',test:'測驗',workout:'課表',long:'長距離',recovery:'恢復跑',easy:'輕鬆跑'};
function classify(a){const t=a.title||'';
  if(/賽|race|馬拉松|Freeway 5k|舒跑杯/i.test(t)&&!/賽前|輕鬆/.test(t))return 'race';
  if(/cooper|體測|pro5|測驗/i.test(t))return 'test';
  if(/\d\s*(k|km|m)?\s*[*×xX]\s*\d|fart|farklek|interval|間歇|run workout|\bLT\b|強度|tempo|節奏|HMP|\d+\s*mins?\s*\+|\d+k\s*\+\s*\d+k|\bR:\d|- 1\.2\b/i.test(t))return a.dist>=14&&/週五tempo|還沒恢復/.test(t)?'long':'workout';
  if(a.dist>=14)return 'long';
  if(/recovery|恢復|jog|輕鬆/i.test(t)||a.dist<4)return 'recovery';
  return 'easy';}

/* ---------- 合併資料與編輯 ---------- */
let ALL=[];
function rebuild(){const m=new Map();BASE.forEach(a=>m.set(a.id,a));extra.forEach(a=>{if(!m.has(a.id))m.set(a.id,a)});
  ZONE.thrPace=settings.thrPace;ZONE.lthr=settings.lthr;
  ALL=[...m.values()].sort((a,b)=>a.date<b.date?-1:1).map(a0=>{const e=edits[a0.id]||{};const a=Object.assign({},a0);
    a.cls=classify(a);a.pace=a.dist>0?a.sec/a.dist:null;a.rpe=e.rpe??null;
    a.temp=e.temp!==undefined?e.temp:a0.temp;a.hum=e.hum!==undefined?e.hum:a0.hum;a.wxEdited=e.temp!==undefined||e.hum!==undefined;
    a.srpe=a.rpe!=null?a.rpe*a.sec/60:null;a.trimp=trimp(a);
    if(settings.mode==='srpe'){a.load=a.srpe??0;a.loadType=a.srpe!=null?'sRPE':'—'}
    else if(settings.mode==='trimp'){a.load=a.trimp??0;a.loadType='TRIMP'}
    else{a.load=a.srpe??a.trimp??0;a.loadType=a.srpe!=null?'sRPE':'TRIMP'}
    a.structure=e.laps&&e.laps.length?lapsToStructure(e.laps):inferStructure(a,a.cls,e.desc||null);
    return a})}
function trimp(a){if(!a.hr)return null;const r=settings.restHR,mx=settings.maxHR;let x=(a.hr-r)/(mx-r);x=Math.max(0,Math.min(1,x));
  const [k,b]=settings.sex==='f'?[0.86,1.67]:[0.64,1.92];return a.sec/60*x*k*Math.exp(b*x)}

/* ---------- ACWR ---------- */
function dailySeries(){if(!ALL.length)return[];const start=dkey(ALL[0].date);let end=todayKey();const last=dkey(ALL[ALL.length-1].date);if(last>end)end=last;
  const byDay={};ALL.forEach(a=>{const k=dkey(a.date);byDay[k]=(byDay[k]||0)+a.load});
  const out=[];let k=start,i=0,ea=0,ec=0;const la=2/(7+1),lc=2/(28+1);const buf=[];
  while(k<=end){const L=byDay[k]||0;buf.push(L);ea=la*L+(1-la)*ea;ec=lc*L+(1-lc)*ec;
    const a7=buf.slice(-7).reduce((s,x)=>s+x,0)/7,c28=buf.slice(-28).reduce((s,x)=>s+x,0)/28;
    out.push({k,load:L,acute:a7,chronic:c28,ra:i>=27&&c28>0?a7/c28:null,ew:i>=27&&ec>0?ea/ec:null});k=dateAdd(k,1);i++}
  return out}
function zoneOf(v){if(v==null)return['--',''];if(v<0.8)return['偏低（< 0.8）','zone-low'];if(v<=1.3)return['最佳區間（0.8–1.3）','zone-ok'];if(v<=1.5)return['注意（1.3–1.5）','zone-warn'];return['高風險（> 1.5）','zone-bad']}

/* ---------- 週跑量 ---------- */
function weekly(){const w={};ALL.forEach(a=>{const m=mondayOf(dkey(a.date));w[m]=(w[m]||0)+a.dist});
  if(!ALL.length)return[];let k=mondayOf(dkey(ALL[0].date));const end=mondayOf(todayKey()>dkey(ALL[ALL.length-1].date)?todayKey():dkey(ALL[ALL.length-1].date));const out=[];
  while(k<=end){out.push({k,km:w[k]||0});k=dateAdd(k,7)}return out}

/* ---------- 畫面 ---------- */
let chW,chA;
const zonePlugin={id:'zones',beforeDatasetsDraw(c){const y=c.scales.y,{left,right}=c.chartArea,ctx=c.ctx;const band=(a,b,col)=>{const ya=y.getPixelForValue(a),yb=y.getPixelForValue(Math.min(b,y.max));ctx.fillStyle=col;ctx.fillRect(left,yb,right-left,ya-yb)};
  ctx.save();band(0.8,1.3,'rgba(47,158,68,.18)');if(y.max>1.5)band(1.5,y.max,'rgba(224,49,49,.16)');band(1.3,1.5,'rgba(240,140,0,.10)');ctx.restore()}};
function renderCards(ds,wk){const tk=todayKey(),mon=mondayOf(tk);const thisW=ALL.filter(a=>dkey(a.date)>=mon).reduce((s,a)=>s+a.dist,0);
  const prev=wk.filter(w=>w.k<mon).slice(-4);const avg4=prev.reduce((s,w)=>s+w.km,0)/(prev.length||1);
  const last=[...ds].reverse().find(d=>d.ew!=null)||{};const z=zoneOf(last.ew),zr=zoneOf(last.ra);
  const nr=ALL.filter(a=>a.rpe!=null).length;
  $('#cards').innerHTML=`
  <div class="card"><div class="k">本週跑量（${mon.slice(5)} 起）</div><div class="v">${thisW.toFixed(1)} km</div><div class="s">${ALL.filter(a=>dkey(a.date)>=mon).length} 次</div></div>
  <div class="card"><div class="k">前 4 週平均（不含本週）</div><div class="v">${avg4.toFixed(1)} km</div><div class="s">${prev.map(w=>w.km.toFixed(0)).join(' / ')}</div></div>
  <div class="card"><div class="k">目前 ACWR（EWMA）</div><div class="v ${z[1]}">${last.ew!=null?last.ew.toFixed(2):'--'}</div><div class="s ${z[1]}">${z[0]}</div></div>
  <div class="card"><div class="k">目前 ACWR（滾動平均 7/28）</div><div class="v ${zr[1]}">${last.ra!=null?last.ra.toFixed(2):'--'}</div><div class="s ${zr[1]}">${zr[0]}</div></div>
  <div class="card"><div class="k">已填 RPE</div><div class="v">${nr} / ${ALL.length}</div><div class="s">負荷模式：${{mixed:'sRPE（缺值用 TRIMP）',srpe:'只用 sRPE',trimp:'只用 TRIMP'}[settings.mode]}</div></div>`}
function renderCharts(ds,wk){
  const wkShow=wk.slice(-Math.ceil(settings.range/7));const cur=mondayOf(todayKey());
  const ma=wkShow.map((w,i)=>{const idx=wk.indexOf(w);const s=wk.slice(Math.max(0,idx-3),idx+1);return s.reduce((a,b)=>a+b.km,0)/s.length});
  const dW={labels:wkShow.map(w=>w.k.slice(5).replace('-','/')),datasets:[{type:'bar',label:'週跑量 (km)',data:wkShow.map(w=>+w.km.toFixed(1)),backgroundColor:wkShow.map(w=>w.k===cur?'#f08c00':'#1E78D7'),borderRadius:4},
    {type:'line',label:'4 週移動平均',data:ma.map(v=>+v.toFixed(1)),borderColor:'#e8eaed',borderWidth:1.5,pointRadius:0,tension:.3}]};
  const opt={responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#c9cdd2'}}},scales:{x:{ticks:{color:'#9aa0a6',maxRotation:0,autoSkip:true},grid:{color:'#232731'}},y:{ticks:{color:'#9aa0a6'},grid:{color:'#232731'}}}};
  if(chW){chW.data=dW;chW.update()}else chW=new Chart($('#cW'),{data:dW,options:opt});
  const dsS=ds.slice(-settings.range);
  const sets=[];if(settings.acwr!=='rolling')sets.push({label:'ACWR（EWMA）',data:dsS.map(d=>d.ew),borderColor:'#4dabf7',borderWidth:2,pointRadius:0,tension:.2,yAxisID:'y'});
  if(settings.acwr!=='ewma')sets.push({label:'ACWR（滾動 7/28 天）',data:dsS.map(d=>d.ra),borderColor:'#fcc419',borderWidth:1.5,borderDash:[5,3],pointRadius:0,tension:.2,yAxisID:'y'});
  sets.push({type:'bar',label:'每日負荷',data:dsS.map(d=>Math.round(d.load)),backgroundColor:'rgba(160,170,190,.28)',yAxisID:'y2'});
  const mx=Math.max(2,...dsS.map(d=>Math.max(d.ew||0,d.ra||0)))*1.05;
  const dA={labels:dsS.map(d=>d.k.slice(5).replace('-','/')),datasets:sets};
  const oA=JSON.parse(JSON.stringify(opt));oA.scales.y.min=0;oA.scales.y.max=+mx.toFixed(1);oA.scales.y.title={display:true,text:'ACWR',color:'#9aa0a6'};
  oA.scales.y2={position:'right',ticks:{color:'#6c727a'},grid:{display:false},title:{display:true,text:'每日負荷',color:'#6c727a'}};
  if(chA){chA.destroy()}chA=new Chart($('#cA'),{type:'line',data:dA,options:oA,plugins:[zonePlugin]});
}
/* 表格 */
let sortK='date',sortD=-1;
const COLS=[['date','日期','l'],['wo','課表結構','l'],['title','標題','l'],['cls','類型','l'],['dist','距離 km'],['sec','總時間'],['pace','平均配速'],['hr','平均心率'],['rpe','RPE'],['load','負荷'],['temp','氣溫 °C'],['hum','濕度 %'],['wx','天氣來源','l']];
function renderTable(){const q=$('#q').value.trim().toLowerCase(),ft=$('#ft').value,fm=$('#fm').value;
  let rows=ALL.filter(a=>(!q||a.title.toLowerCase().includes(q)||a.date.includes(q))&&(!ft||a.cls===ft)&&(!fm||a.date.startsWith(fm)));
  rows.sort((a,b)=>{let x=a[sortK],y=b[sortK];if(x==null)return 1;if(y==null)return -1;return(x<y?-1:x>y?1:0)*sortD});
  $('#thead').innerHTML='<tr>'+COLS.map(([k,n,c])=>`<th class="${c||''}" data-k="${k}">${n}${sortK===k?`<span class="ar">${sortD>0?' ▲':' ▼'}</span>`:''}</th>`).join('')+'</tr>';
  $('#tbody').innerHTML=rows.map(a=>`<tr data-id="${a.id}">
   <td class="l">${a.date.slice(0,16)}</td>
   <td class="l"><span class="thumb" data-open="1" title="點擊查看課表結構">${workoutSVG(a.structure,120,26,{minW:2.5,gap:1.5,r:2.5,bg:'#111',br:4,pad:2})}</span></td>
   <td class="l title" title="${esc(a.title)}"><a href="#" data-open="1" style="color:inherit">${esc(a.title)||'（無標題）'}</a></td>
   <td class="l"><span class="tag t-${a.cls}">${TYPES[a.cls]}</span>${a.atype!=='Running'?`<span class="lt">${a.atype==='Treadmill Running'?'跑步機':a.atype==='Track Running'?'田徑場':a.atype}</span>`:''}</td>
   <td>${a.dist.toFixed(2)}</td><td>${fmtSec(a.sec)}</td><td>${a.pace?fmtSec(a.pace):'--'}</td><td>${a.hr??'--'}</td>
   <td><input class="rpe" type="number" min="1" max="10" step="0.5" value="${a.rpe??''}" data-f="rpe" placeholder="–"></td>
   <td>${a.load?Math.round(a.load):'--'}<span class="lt">${a.loadType}</span></td>
   <td><input type="number" step="0.1" value="${a.temp??''}" data-f="temp" placeholder="–"></td>
   <td><input type="number" step="1" min="0" max="100" value="${a.hum??''}" data-f="hum" placeholder="–"></td>
   <td class="l"><span class="wx ${a.temp==null&&a.wx!=='室內'?'miss':''}">${a.wxEdited?'已手動編輯':a.wx}</span></td></tr>`).join('');
  $('#cnt').textContent=`共 ${rows.length} 筆`}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function renderAll(){rebuild();const ds=dailySeries(),wk=weekly();renderCards(ds,wk);renderCharts(ds,wk);renderTable();
  const months=[...new Set(ALL.map(a=>a.date.slice(0,7)))].reverse();const fm=$('#fm'),v=fm.value;fm.innerHTML='<option value="">全部月份</option>'+months.map(m=>`<option ${m===v?'selected':''}>${m}</option>`).join('')}

/* ---------- 單次課表詳細 ---------- */
let curId=null;
function stepHTML(s){const K=KIND[s.kind]||KIND.steady;return `<div class="step" style="border-left-color:${K.c}"><div class="n">${K.zh} <span style="color:#8e8e93;font-size:13px">${K.en}</span></div><div class="d">${esc(s.label||fmtSec(s.sec))}${s.assumed?'（預設）':''}</div></div>`}
function openDetail(id){curId=id;const a=ALL.find(x=>x.id===id);if(!a)return;const st=a.structure;const e=edits[id]||{};
  $('#dTitle').textContent=a.title||'（無標題）';
  const src=st.source==='laps'?'<span class="badge real">實際分圈資料</span>':st.source==='manual'?'<span class="badge">依手動描述推估</span>':'<span class="badge">依標題推估</span>';
  $('#dBody').innerHTML=`<div class="note">${a.date} · ${TYPES[a.cls]} · ${src}</div>
   <div style="background:#111;padding:26px 6px 4px;border-radius:10px;margin-top:8px">${workoutSVG(st,600,150,{gap:5,minW:10,r:7,width:'100%',height:150})}</div>
   <div class="stats"><div><b>${a.dist.toFixed(2)} km</b><span>距離</span></div><div><b>${fmtSec(a.sec)}</b><span>總時間</span></div><div><b>${a.pace?fmtSec(a.pace):'--'}/km</b><span>平均配速</span></div>
   <div><b>${a.hr??'--'}</b><span>平均心率 bpm</span></div><div><b>${a.rpe??'--'}</b><span>RPE</span></div><div><b>${a.load?Math.round(a.load):'--'}</b><span>負荷（${a.loadType}）</span></div>
   <div><b>${a.temp!=null?a.temp+'°C':'--'}</b><span>氣溫</span></div><div><b>${a.hum!=null?a.hum+'%':'--'}</b><span>濕度</span></div></div>
   <div class="steps"><h4>步驟 Steps</h4>${st.plan.map(p=>p.type==='repeat'?`<div class="rep"><div class="rh">${p.n} 次 <span style="color:#8e8e93;font-size:13px">${p.n} Times</span></div>${p.steps.map(stepHTML).join('')}${p.skipLast?'<div class="rf">略過最後一次恢復：開</div>':''}</div>`:stepHTML(p)).join('')}</div>
   <p class="note">${st.source==='laps'?'方塊高度＝各圈實際配速。':'方塊寬度＝推估時間，高度＝相對強度（以閾值配速 '+fmtSec(settings.thrPace)+'/km、LTHR '+settings.lthr+' 為基準）。熱身/緩和長度由總時間扣掉主課推算，未寫明的恢復預設 1:00。'}</p>
   <div class="row"><input type="text" id="dDesc" placeholder="手動描述課表，例如：1k*5 r1:30 4'30-4'35" value="${esc(e.desc||'')}"><button id="dDescSave">套用描述</button></div>
   <div class="row"><label class="btn">匯入分圈資料（TCX / Garmin 分段 CSV）<input type="file" id="dLaps" accept=".tcx,.csv,.fit" hidden></label>${e.laps?'<button id="dLapsClr">移除分圈資料</button>':''}</div>
   <p class="note">分圈資料：在 Garmin Connect 網頁版該活動頁 ⚙ → 「匯出為 TCX」，或「分段」頁籤匯出 CSV。FIT 為二進位格式，目前尚未支援。</p>`;
  $('#dlg').showModal()}
document.addEventListener('click',async ev=>{
  const o=ev.target.closest('[data-open]');if(o){ev.preventDefault();openDetail(o.closest('tr').dataset.id);return}
  const th=ev.target.closest('th[data-k]');if(th){const k=th.dataset.k==='wo'?'sec':th.dataset.k;if(sortK===k)sortD*=-1;else{sortK=k;sortD=k==='date'?-1:1}renderTable();return}
  if(ev.target.id==='dDescSave'){const v=$('#dDesc').value.trim();(edits[curId]=edits[curId]||{}).desc=v||undefined;save();renderAll();openDetail(curId);return}
  if(ev.target.id==='dLapsClr'){delete edits[curId].laps;save();renderAll();openDetail(curId);return}
});
document.addEventListener('change',async ev=>{const t=ev.target;
  if(t.dataset.f){const id=t.closest('tr').dataset.id;const e=edits[id]=edits[id]||{};const v=t.value===''?null:+t.value;
    if(t.dataset.f==='rpe'){if(v!=null&&(v<1||v>10)){toast('RPE 需介於 1–10');t.value=e.rpe??'';return}if(v==null)delete e.rpe;else e.rpe=v}else e[t.dataset.f]=v;
    save();renderAll();return}
  if(t.id==='dLaps'&&t.files[0]){const f=t.files[0],txt=await f.text();try{let laps;
      if(/\.fit$/i.test(f.name))throw new Error('FIT 為二進位格式，請改匯出 TCX 或分段 CSV');
      laps=/<TrainingCenterDatabase|<Lap/i.test(txt)?parseTCX(txt):parseSplitsCSV(txt);if(!laps.length)throw new Error('檔案中沒有分圈資料');
      (edits[curId]=edits[curId]||{}).laps=laps;save();renderAll();openDetail(curId);toast(`已匯入 ${laps.length} 圈`)}catch(e){toast('匯入失敗：'+e.message,4000)}}
});

/* ---------- 天氣（Open-Meteo） ---------- */
const ABROAD=/Fujiyoshida|Chiyoda|皇居|Minamiaso|博多|天神|Tokyo|Osaka|Kyoto|Fukuoka|日本|東京|大阪|京都|福岡|Seoul|首爾|Hong Kong|香港|Bangkok/i;
async function fetchWeather(rows){const todo=rows.filter(a=>a.wx==='待查詢');if(!todo.length)return;
  const ks=todo.map(a=>dkey(a.date)).sort();const p=`latitude=25.03&longitude=121.56&hourly=temperature_2m,relative_humidity_2m&timezone=Asia%2FTaipei`;
  const H={};const take=j=>{if(!j||!j.hourly)return;j.hourly.time.forEach((t,i)=>{const T=j.hourly.temperature_2m[i],R=j.hourly.relative_humidity_2m[i];if(T!=null&&!H[t])H[t]=[T,R]})};
  try{take(await (await fetch(`https://archive-api.open-meteo.com/v1/archive?${p}&start_date=${ks[0]}&end_date=${ks[ks.length-1]}`)).json())}catch(e){}
  const need=todo.some(a=>!H[a.date.slice(0,13).replace(' ','T')+':00']);
  if(need){try{take(await (await fetch(`https://api.open-meteo.com/v1/forecast?${p}&past_days=92&forecast_days=1`)).json())}catch(e){}}
  todo.forEach(a=>{const v=H[a.date.slice(0,13).replace(' ','T')+':00'];if(v){a.temp=v[0];a.hum=v[1];a.wx='台北估計'}else a.wx='查詢失敗（未填）'})}

/* ---------- 匯入新的 Garmin CSV ---------- */
const HMAP={atype:['Activity Type','活動類型'],date:['Date','日期'],title:['Title','標題','名稱'],dist:['Distance','距離'],time:['Time','時間'],hr:['Avg HR','平均心率'],maxhr:['Max HR','最大心率'],te:['Aerobic TE','有氧訓練效果','有氧 TE'],cad:['Avg Run Cadence','平均跑步步頻','平均步頻']};
async function importGarmin(text){const rows=parseCSV(text);const h=rows[0].map(x=>x.trim());const ix={};for(const k in HMAP)ix[k]=h.findIndex(c=>HMAP[k].includes(c));
  if(ix.date<0||ix.dist<0||ix.time<0)throw new Error('看不出這是 Garmin 活動 CSV（找不到 日期/距離/時間 欄位）');
  const have=new Set(ALL.map(a=>a.id));const add=[];let skipped=0,nonRun=0;
  rows.slice(1).forEach(r=>{const g=k=>ix[k]>=0?r[ix[k]]:null;const atype=(g('atype')||'Running').trim();
    if(!/run|跑/i.test(atype)){nonRun++;return}
    let date=(g('date')||'').trim().replace(/\//g,'-');if(date.length===16)date+=':00';if(!/^\d{4}-\d{2}-\d{2}/.test(date))return;
    if(have.has(date)){skipped++;return}
    let dist=num(g('dist'));const sec=parseDur(g('time'));if(dist==null||sec==null)return;
    if(/track|跑道|田徑/i.test(atype)&&dist>100)dist/=1000; // Garmin 田徑場跑步距離以公尺匯出
    const title=(g('title')||'').trim();const indoor=/treadmill|跑步機|室內/i.test(atype);
    add.push({id:date,date,title,atype,dist:+dist.toFixed(3),sec,hr:num(g('hr')),maxhr:num(g('maxhr')),te:num(g('te')),cad:num(g('cad')),temp:null,hum:null,
      wx:indoor?'室內':ABROAD.test(title)?'海外（未填）':'待查詢'});have.add(date)});
  if(add.length){toast(`新增 ${add.length} 筆，正在查詢天氣…`,5000);await fetchWeather(add);extra.push(...add);save();renderAll()}
  return{add:add.length,skipped,nonRun}}

/* ---------- 匯出 / 匯入 JSON ---------- */
function exportJSON(){const blob=new Blob([JSON.stringify({app:'running-tracker',version:1,exported:new Date().toISOString(),settings,edits,extra},null,1)],{type:'application/json'});
  const u=URL.createObjectURL(blob);const l=document.createElement('a');l.href=u;l.download=`跑步紀錄備份_${todayKey()}.json`;l.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function importJSON(t){const j=JSON.parse(t);if(!j.edits)throw new Error('格式不符');Object.assign(edits,j.edits);if(j.settings)Object.assign(settings,j.settings);
  const ids=new Set(extra.map(a=>a.id));(j.extra||[]).forEach(a=>{if(!ids.has(a.id))extra.push(a)});save();syncSettingsUI();renderAll()}

/* ---------- 設定 UI ---------- */
function syncSettingsUI(){$('#sRest').value=settings.restHR;$('#sMax').value=settings.maxHR;$('#sSex').value=settings.sex;$('#sThr').value=fmtSec(settings.thrPace);$('#sLthr').value=settings.lthr;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode===settings.mode));
  document.querySelectorAll('[data-acwr]').forEach(b=>b.classList.toggle('on',b.dataset.acwr===settings.acwr));
  document.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('on',+b.dataset.range===settings.range))}
function initUI(){
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{settings.mode=b.dataset.mode;save();syncSettingsUI();renderAll()});
  document.querySelectorAll('[data-acwr]').forEach(b=>b.onclick=()=>{settings.acwr=b.dataset.acwr;save();syncSettingsUI();renderAll()});
  document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{settings.range=+b.dataset.range;save();syncSettingsUI();renderAll()});
  $('#sRest').onchange=e=>{settings.restHR=+e.target.value||55;save();renderAll()};$('#sMax').onchange=e=>{settings.maxHR=+e.target.value||DATA_MAXHR;save();renderAll()};
  $('#sSex').onchange=e=>{settings.sex=e.target.value;save();renderAll()};$('#sLthr').onchange=e=>{settings.lthr=+e.target.value||177;save();renderAll()};
  $('#sThr').onchange=e=>{const p=parsePaceTok(e.target.value);if(p){settings.thrPace=p;save();renderAll()}else toast('配速格式：4:39')};
  ['#q','#ft','#fm'].forEach(s=>$(s).addEventListener('input',renderTable));
  $('#bExport').onclick=exportJSON;
  $('#fJSON').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{importJSON(await f.text());toast('已匯入備份')}catch(x){toast('匯入失敗：'+x.message,4000)}e.target.value=''};
  $('#fCSV').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const r=await importGarmin(await f.text());toast(`匯入完成：新增 ${r.add} 筆，重複略過 ${r.skipped} 筆${r.nonRun?`，非跑步 ${r.nonRun} 筆`:''}`,5000)}catch(x){toast('匯入失敗：'+x.message,5000)}e.target.value=''};
  $('#dClose').onclick=()=>$('#dlg').close();
  $('#ft').innerHTML='<option value="">全部類型</option>'+Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  syncSettingsUI();renderAll()}
Chart.defaults.font.family=getComputedStyle(document.body).fontFamily;
initUI();
