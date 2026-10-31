/* Health Connect sync (Android). Read-only: steps, sleep, resting heart rate, HRV, weight. */
"use strict";
const HC = plugin("Health");
const HC_MAP = [["steps","steps"],["sleep","sleep"],["restingHeartRate","rhr"],["heartRateVariability","hrv"],["weight","weight"]];
const HC_STORE = "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata";
function hcState(){ return S.settings.hc || (S.settings.hc = {connected:false, last:0, granted:[]}); }
async function healthAvailable(){ if(!HC) return {available:false, reason:"web"}; try{ return await HC.isAvailable(); }catch(e){ return {available:false, reason:String(e && e.message || e)}; } }
let hcBusy = false;

async function healthConnect(){
  const av = await healthAvailable();
  if(!av.available){
    if(!HC){ toast("Health Connect works in the Android app"); return false; }
    openSheet(`<span class="grab"></span><h3 class="big3">Get Health Connect</h3><p class="sub">Health Connect is Android's health hub. It's built into Android 14 and later; on older phones, install it from the Play Store, then come back and tap Connect again.</p><button class="btn" data-s="store">Open Play Store</button><button class="btn sec" data-s="x">Not now</button>`, b=>{ if(b.dataset.s==="store"){ try{ window.open(HC_STORE, "_blank"); }catch(e){ location.href = HC_STORE; } } closeSheet(); });
    return false;
  }
  try{
    const st = await HC.requestAuthorization({read:HC_MAP.map(m=>m[0])});
    const ok = (st && st.readAuthorized) || [];
    const h = hcState(); h.granted = ok; h.connected = ok.length>0; save();
    if(!ok.length){ toast("No data shared. You can allow it in Health Connect settings."); return false; }
    await healthSync(30, true); return true;
  }catch(e){ toast("Couldn't connect to Health Connect"); console.warn(e); return false; }
}
function localKey(iso){ return dkey(new Date(iso)); }
async function healthSync(days, loud){
  const h = hcState(); if(!HC || !h.connected || hcBusy) return 0; hcBusy = true;
  const end = new Date(), start = new Date(); start.setDate(start.getDate()-days); start.setHours(0,0,0,0);
  const range = {startDate:start.toISOString(), endDate:end.toISOString()};
  const vals = {}; const put = (id,k,v)=>{ (vals[id] = vals[id] || {})[k] = v; };
  try{ const st = await HC.checkAuthorization({read:HC_MAP.map(m=>m[0])}); if(st && Array.isArray(st.readAuthorized)) h.granted = st.readAuthorized; }catch(e){}
  const has = t=>(h.granted||[]).includes(t);
  try{
    if(has("steps")){ const r = await HC.queryAggregated(Object.assign({dataType:"steps", bucket:"day", aggregation:"sum"}, range)); for(const s of (r.samples||[])) if(s.value>0) put("steps", localKey(s.startDate), Math.round(s.value)); }
    if(has("restingHeartRate")){ const r = await HC.queryAggregated(Object.assign({dataType:"restingHeartRate", bucket:"day", aggregation:"average"}, range)); for(const s of (r.samples||[])) if(s.value>0) put("rhr", localKey(s.startDate), Math.round(s.value)); }
    if(has("weight")){ const r = await HC.queryAggregated(Object.assign({dataType:"weight", bucket:"day", aggregation:"average"}, range)); for(const s of (r.samples||[])) if(s.value>0) put("weight", localKey(s.startDate), Math.round(s.value*10)/10); }
    if(has("sleep")){ const r = await HC.readSamples(Object.assign({dataType:"sleep", limit:1000, ascending:true}, range)); const bySrc = {};
      /* Sum each source's sessions per night (naps add up), then take the largest source,
         so a ring and a phone recording the same night aren't counted twice. */
      /* Only real sleep stages count. "awake" and "inBed" are time in bed, not sleep, and
         some providers emit an "inBed" segment spanning the whole session alongside the
         light/deep/rem segments, which would otherwise roughly double the night. */
      const ASLEEP = {asleep:1, rem:1, deep:1, light:1};
      for(const s of (r.samples||[])){ let m = 0;
        const st = (s.stages||[]).filter(x=>ASLEEP[x.stage]);
        if(st.length) m = st.reduce((a,x)=>a+(x.durationMinutes||0),0);
        else m = s.value || (new Date(s.endDate)-new Date(s.startDate))/60000;
        const k = localKey(s.endDate), src = s.sourceId || s.sourceName || "x";
        (bySrc[k] = bySrc[k] || {}); bySrc[k][src] = (bySrc[k][src]||0) + m; }
      for(const k in bySrc){ const best = Math.max(...Object.values(bySrc[k])); if(best>=60 && best<=20*60) put("sleep", k, Math.round(best/6)/10); } }
    if(has("heartRateVariability")){ const r = await HC.readSamples(Object.assign({dataType:"heartRateVariability", limit:2000, ascending:true}, range)); const acc = {};
      for(const s of (r.samples||[])){ if(!(s.value>0)) continue; const k = localKey(s.startDate); (acc[k] = acc[k] || []).push(s.value); }
      for(const k in acc) put("hrv", k, Math.round(acc[k].reduce((a,b)=>a+b,0)/acc[k].length)); }
  }catch(e){ console.warn("health sync", e); if(loud) toast("Some Health Connect data couldn't be read"); }
  let n = 0; const touched = new Set();
  for(const id in vals){ if(!trk(id)) continue;
    for(const k in vals[id]){ const v = vals[id][k], d = S.hist[k], cur = d && d.l ? d.l[id] : undefined, src = d && d.src ? d.src[id] : undefined;
      if(cur!=null && src!=="hc") continue; if(cur===v) continue;
      sub(k,"l")[id] = v; sub(k,"src")[id] = "hc"; touched.add(k); n++; } }
  for(const k of touched){ evalAuto(k); tidy(k); }
  h.last = Date.now(); hcBusy = false; save();
  if(!sheet) render(true);
  if(loud) toast(n ? `Synced ${n} reading${n===1?"":"s"} from Health Connect` : "Health Connect is up to date");
  if(n && window.reportsCheck) reportsCheck();
  return n;
}
function healthAutoSync(){ const h = hcState(); if(!h.connected) return; const gap = Date.now()-(h.last||0); if(gap < 15*60e3) return; const days = Math.min(30, Math.max(3, Math.ceil(gap/864e5)+2)); healthSync(days, false); }

function meDevicesHTML(){
  const h = hcState(), on = h.connected;
  const types = HC_MAP.filter(m=>(h.granted||[]).includes(m[0])).map(m=>(trk(m[1])||{name:m[1]}).name);
  return `<div class="group"><div class="cap">Connected apps</div><div class="card form">
    <div style="display:flex;gap:12px;align-items:center"><span class="ci" style="--c:var(--green);width:40px;height:40px;border-radius:12px;display:grid;place-content:center;background:var(--green);box-shadow:0 0 calc(14px*var(--ga)) color-mix(in srgb,var(--green) 55%,transparent);flex:none">${ICON.care}</span><div style="min-width:0"><b>Health Connect</b><div class="hint">${on?`Connected · synced ${typeof ago==="function"?ago(h.last):""}${types.length?` · ${esc(types.join(", "))}`:""}`:"Steps, sleep, heart rate, HRV and weight from Samsung Health, Fitbit, Garmin, Google Fit and most rings and watches."}</div></div></div>
    ${HC ? (on ? `<div class="btns"><button class="btn" data-hc="sync">Sync now</button><button class="btn sec" data-hc="manage">Manage</button></div>` : `<button class="btn" data-hc="connect">Connect</button>`) : `<p class="hint">Available in the Android app.</p>`}
    <p class="hint">Read-only. Values you type in yourself are never overwritten. If your ring or watch app isn't listed in Health Connect, turn on its Health Connect sync in that app first.</p>
  </div></div>`;
}
V.addEventListener("click", async e=>{
  const b = e.target.closest("[data-hc]"); if(!b) return; const a = b.dataset.hc;
  if(a==="connect"){ b.disabled = true; b.textContent = "Connecting…"; await healthConnect(); render(true); }
  else if(a==="sync"){ b.disabled = true; b.textContent = "Syncing…"; await healthSync(30, true); render(true); }
  else if(a==="manage"){ try{ await HC.openHealthConnectSettings(); }catch(err){ toast("Open Health Connect from your phone's settings"); } }
});
