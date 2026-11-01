/* Two things most habit apps can't do, because they never look at your body and never
   test anything:

   1. Easy days. When last night's sleep, HRV or resting heart rate is clearly worse than
      YOUR usual, Today offers an easy day: only Easy dailies count, and the streaks on
      everything else pause instead of breaking. You can also take one by hand.

   2. Experiments. Try one change for 7, 14 or 21 days and get an honest before-and-during
      comparison on the numbers you picked. Then keep it or drop it.

   Same rules as the rest of the insight engine: your own baseline, fixed arithmetic,
   no AI, and no claims about cause. Needs insights.js loaded first. */
"use strict";

/* ================= easy days ================= */
const BODY_SIGNALS = ["sleep","hrv","rhr"];
const isEasy = k=>!!(S.hist[k] && S.hist[k].easy);

/* How today's overnight readings compare with the 30 days before.
   Low = one signal far off your usual, or two clearly off. */
function bodyCheck(k){
  const signals = [];
  for(const id of BODY_SIGNALS){
    const t = trk(id); if(!t) continue;
    const v = logVal(k,id); if(!isNum(v)) continue;
    const prior = [];
    for(let i=1;i<=30;i++){ const x = logVal(addDays(k,-i),id); if(isNum(x)) prior.push(x); }
    if(prior.length < 10) continue;
    const m = mean(prior), s = sd(prior); if(!s) continue;
    const worse = id==="rhr" ? v-m : m-v;
    if(worse <= 0) continue;
    const z = worse/s;
    if(z >= 1 && worse >= minDiff(t, s)) signals.push({t, v, usual:m, z});
  }
  return {low: signals.some(x=>x.z>=1.5) || signals.length>=2, signals};
}

function setEasy(k, on){
  if(on) day(k).easy = true; else if(S.hist[k]){ delete S.hist[k].easy; S.hist[k]._t = Date.now(); }
  checkPerfect(k); tidy(k); save();
  if(k===TODAY()) queueReminders();
}

const shortName = t=>/^[A-Z]{2,}$/.test(t.name) ? t.name : t.id==="rhr" ? "Resting HR" : t.name;
function easyCardHTML(k){
  const paused = dailies().filter(t=>t.days.includes(dowOf(k)) && (t.diff||1)>1).length;
  if(isEasy(k)){
    const kept = dueToday(k).length;
    return `<div class="card lab" style="--c:var(--blue)"><div class="lab-h"><span class="lab-tag">Easy day</span><button class="linkbtn" data-easy="off">Undo</button></div><p class="lab-p">${kept ? `${kept} easy task${kept===1?"":"s"} today.` : "Nothing due today."}</p>${paused?`<p class="hint">Harder ones are paused. Streaks are safe.</p>`:""}</div>`;
  }
  if(S.hist[k] && S.hist[k].easyNo) return "";
  const b = bodyCheck(k);
  if(!b.low || !paused) return "";
  const chips = b.signals.map(x=>`<span class="bstat"><b>${esc(shortName(x.t))} ${fmtQ(x.t,x.v)}</b><small>${x.t.id==="rhr"?"↑":"↓"} usually ${fmtQ(x.t,x.usual)}</small></span>`).join("");
  return `<div class="card lab" style="--c:var(--yellow)"><div class="lab-h"><span class="lab-tag">Rough night</span></div><p class="lab-p">Take it easy today?</p><div class="bstats">${chips}</div><p class="hint">Only Easy tasks count. Streaks stay safe.</p><div class="btns" style="margin-top:10px"><button class="btn" data-easy="on">Easy day</button><button class="btn sec" data-easy="skip">I'm fine</button></div></div>`;
}

/* ================= experiments ================= */
const EXP_LENS = [7,14,21];
const EXP_EX = ["No phone after 11 pm","Walk after lunch","No caffeine after 2 pm","Lights out by 11","10 minutes of sun before 9"];

function cleanExperiments(list){
  return (Array.isArray(list)?list:[]).filter(e=>e && typeof e==="object").map(e=>({
    id: SAFE_ID.test(String(e.id||"")) ? e.id : uid(),
    title: String(e.title||"").slice(0,80).trim(),
    link: SAFE_ID.test(String(e.link||"")) ? e.link : null,
    watch: (Array.isArray(e.watch)?e.watch:[]).filter(w=>SAFE_ID.test(String(w))).slice(0,4),
    start: typeof e.start==="string" && /^\d{4}-\d{2}-\d{2}$/.test(e.start) ? e.start : null,
    len: EXP_LENS.includes(Number(e.len)) ? Number(e.len) : 14,
    stopped: !!e.stopped,
    verdict: ["keep","drop"].includes(e.verdict) ? e.verdict : null
  })).filter(e=>e.title && e.start && e.watch.length);
}

const expEnd = e=>addDays(e.start, e.len-1);
const expDay = (e,k)=>Math.round((kdate(k)-kdate(e.start))/864e5)+1;
const expRunning = e=>!e.stopped && TODAY() <= expEnd(e);
const expFinished = e=>!e.stopped && TODAY() > expEnd(e);
const activeExp = ()=>(S.experiments||[]).find(expRunning);
const unreadExp = ()=>(S.experiments||[]).find(e=>expFinished(e) && !e.verdict);

function expWindows(e){
  const during = [], before = [];
  for(let i=0;i<e.len;i++){ during.push(addDays(e.start,i)); before.unshift(addDays(e.start,-1-i)); }
  return {before, during: during.filter(k=>k<=TODAY())};
}

/* How often you actually stuck to it, if it's tied to a daily or habit. */
function expAdherence(e, keys){
  const t = e.link && S.tasks.find(x=>x.id===e.link); if(!t) return null;
  if(t.type==="daily"){ let due = 0, done = 0; for(const k of keys){ if(k===TODAY() && !isDone(t,k)) continue; if(t.days.includes(dowOf(k))){ due++; if(isDone(t,k)) done++; } } return due ? {done, of:due} : null; }
  if(t.type==="habit"){ const ks = keys.filter(k=>k<TODAY() || habitCount(t,k,"u")>0); return ks.length ? {done:ks.filter(k=>habitCount(t,k,"u")>0).length, of:ks.length} : null; }
  return null;
}

/* Before vs during, per number you chose to watch. */
function expResult(e){
  const W = expWindows(e), rows = [];
  for(const id of e.watch){
    const t = trk(id); if(!t) continue;
    const a = W.before.map(k=>logVal(k,id)).filter(isNum), b = W.during.map(k=>logVal(k,id)).filter(isNum);
    const row = {t, nBefore:a.length, nDuring:b.length, before:mean(a), during:mean(b)};
    if(a.length < 5 || b.length < 5){ row.call = "few"; rows.push(row); continue; }
    const diff = row.during - row.before, d = cohenD(b, a), spread = sd(a.concat(b));
    row.diff = diff;
    if(d==null || Math.abs(d) < 0.5 || Math.abs(diff) < minDiff(t, spread)) row.call = "same";
    else {
      const strength = Math.abs(d) * Math.sqrt(a.length*b.length/(a.length+b.length));
      row.call = strength >= 2 ? "clear" : "slight";
      row.good = (t.better==="up" || t.better==="down") ? (diff>0)===(t.better==="up") : rangeGood(t, row.before, row.during);
    }
    rows.push(row);
  }
  const clearGood = rows.filter(r=>r.call==="clear" && r.good===true).length, clearBad = rows.filter(r=>r.call==="clear" && r.good===false).length;
  const tested = rows.filter(r=>r.call!=="few").length;
  const names = list=>{ const n = list.map(r=>shortName(r.t).toLowerCase()); return n.length>1 ? n.slice(0,-1).join(", ")+" and "+n[n.length-1] : n[0]; };
  const better = rows.filter(r=>r.call==="clear" && r.good===true), worse = rows.filter(r=>r.call==="clear" && r.good===false);
  let line;
  if(!tested) line = "Not enough data yet. Log these numbers most days.";
  else if(better.length && !worse.length) line = `It helped your ${names(better)}.`;
  else if(worse.length && !better.length) line = `Your ${names(worse)} got worse.`;
  else if(better.length && worse.length) line = `Mixed: better ${names(better)}, worse ${names(worse)}.`;
  else if(rows.some(r=>r.call==="slight")) line = "Small changes. Too early to tell.";
  else line = "No real change.";
  return {rows, line, adherence: expAdherence(e, W.during), during:W.during.length};
}

/* For a target range, only crossing into or out of it, or moving toward it from one side, has a direction. */
function rangeGood(t, before, during){
  if(t.better!=="range" || t.min==null) return null;
  const inR = v=>v>=t.min && (t.max==null || v<=t.max);
  if(inR(during) && !inR(before)) return true;
  if(!inR(during) && inR(before)) return false;
  if(before<t.min && during<t.min) return during>before;
  if(t.max!=null && before>t.max && during>t.max) return during<before;
  return null;
}
/* A quiet way in for days that are rough for reasons a ring can't see. */
function easyFootHTML(k){
  if(isEasy(k)) return "";
  const paused = dailies().filter(t=>t.days.includes(dowOf(k)) && (t.diff||1)>1).length;
  if(!paused) return "";
  return `<p class="foot" style="text-align:center"><button class="linkbtn" data-easy="manual">Rough day? Take it easy</button></p>`;
}

function callText(r){
  if(r.call==="few") return "Not enough data";
  if(r.call==="same") return "No change";
  if(r.call==="slight") return r.diff>0 ? "Up a little" : "Down a little";
  return r.good===true ? "Better" : r.good===false ? "Worse" : r.diff>0 ? "Higher" : "Lower";
}

function expResultHTML(e){
  const R = expResult(e), done = !expRunning(e);
  let h = `<p class="lab-p" style="font-size:19px;font-weight:700;margin-bottom:10px">${esc(R.line)}</p>`;
  h += `<table class="stats"><thead><tr><th></th><th>Before</th><th>${done?"During":"So far"}</th></tr></thead><tbody>`;
  for(const r of R.rows){
    const col = r.call==="clear" ? (r.good===true?"var(--green)":r.good===false?"var(--red)":"var(--ink)") : "var(--muted)";
    h += `<tr><td>${esc(shortName(r.t))}<div class="hint" style="color:${col};font-weight:600">${esc(callText(r))}</div></td><td>${fmtQ(r.t,r.before)}</td><td><b>${fmtQ(r.t,r.during)}</b></td></tr>`;
  }
  h += `</tbody></table>`;
  if(R.adherence) h += `<p class="hint" style="margin-top:8px">Stuck to it ${R.adherence.done}/${R.adherence.of} days.</p>`;
  h += `<p class="hint" style="margin-top:4px">${e.len} days before vs ${done?e.len:R.during} during. Shows what changed, not why.</p>`;
  return h;
}

function todayExpHTML(k){
  const fin = unreadExp();
  if(fin) return `<div class="card lab tap" style="--c:var(--green)" data-exp="${fin.id}"><div class="lab-h"><span class="lab-tag">Experiment done</span><span class="chev">›</span></div><p class="lab-p">${esc(fin.title)}</p><p class="hint">Tap to see how it went.</p></div>`;
  const e = activeExp(); if(!e) return "";
  const n = Math.max(1,expDay(e,k)), a = expAdherence(e, expWindows(e).during);
  return `<div class="card lab tap" style="--c:var(--blue)" data-exp="${e.id}"><div class="lab-h"><span class="lab-tag">Experiment · day ${n}/${e.len}</span><span class="chev">›</span></div><p class="lab-p">${esc(e.title)}</p><div class="mini" style="margin-top:8px"><i style="width:${Math.min(1,n/e.len)*100}%;background:var(--blue)"></i></div>${a?`<p class="hint" style="margin-top:6px">Stuck to it ${a.done}/${a.of} days</p>`:""}</div>`;
}

function todayLabHTML(k){ return easyCardHTML(k) + todayExpHTML(k); }

function experimentsHTML(){
  const list = (S.experiments||[]).slice().sort((a,b)=>a.start<b.start?1:-1);
  let h = `<div class="group"><div class="gh"><h2>Experiments</h2>${activeExp()?"":`<button class="meta" data-expnew="1">Start one</button>`}</div>`;
  if(!list.length) return h + `<div class="card"><p class="lab-p">Try one change. See if it helps.</p><p class="hint">Compares your numbers before and during.</p><button class="btn sec" data-expnew="1" style="margin-top:10px">Start an experiment</button></div></div>`;
  h += `<ul class="list">${list.map(e=>{
    const st = expRunning(e) ? `Day ${Math.max(1,expDay(e,TODAY()))} of ${e.len}` : e.stopped ? "Stopped early" : e.verdict==="keep" ? "Kept" : e.verdict==="drop" ? "Dropped" : "Result ready";
    return `<li class="row plain tap" data-exp="${e.id}"><div style="min-width:0"><span class="rt">${esc(e.title)}</span><div class="rs">${esc(st)} · from ${fmtD(e.start)}</div></div><span class="chev">›</span></li>`; }).join("")}</ul></div>`;
  return h;
}

function openExperiment(id){
  const e = (S.experiments||[]).find(x=>x.id===id); if(!e) return;
  const running = expRunning(e), linked = e.link && S.tasks.find(x=>x.id===e.link);
  let h = `<span class="grab"></span><div class="shead"><button data-s="cancel">Close</button><h3>Experiment</h3><span></span></div>`;
  h += `<div class="card" style="width:100%"><b style="font-size:19px">${esc(e.title)}</b><p class="hint" style="margin-top:4px">${fmtD(e.start)} – ${fmtD(expEnd(e))} · ${e.len} days${linked?` · linked to “${esc(linked.title)}”`:""}</p></div>`;
  h += `<div class="card" style="width:100%">${expResultHTML(e)}</div>`;
  if(running) h += `<button class="btn danger" data-s="stop">Stop early</button>`;
  else if(!e.stopped){
    h += `<div class="btns"><button class="btn" data-s="keep">${linked?"Keep it":"Keep it as a daily"}</button><button class="btn sec" data-s="drop">Drop it</button></div>`;
    if(e.verdict) h += `<p class="hint" style="text-align:center">You chose to ${e.verdict==="keep"?"keep":"drop"} this one.</p>`;
  }
  h += `<button class="btn sec" data-s="del">Delete experiment</button>`;
  openSheet(h, b=>{
    const s = b.dataset.s;
    if(s==="cancel"){ closeSheet(); render(true); }
    else if(s==="stop"){ e.stopped = true; save(); closeSheet(); render(true); toast("Experiment stopped"); }
    else if(s==="keep"){
      e.verdict = "keep";
      if(!linked){ const t = cleanTask({type:"daily", id:uid(), title:e.title, cat:"care", diff:1, days:[0,1,2,3,4,5,6], block:"any", checklist:[], created:TODAY()}); if(t){ S.tasks.push(t); e.link = t.id; } toast("Added to your dailies"); }
      else toast("Kept");
      save(); closeSheet(); render(true);
    }
    else if(s==="drop"){ e.verdict = "drop"; save(); closeSheet(); render(true); toast("Dropped. Good to know."); }
    else if(s==="del"){ S.experiments = S.experiments.filter(x=>x.id!==e.id); S.removed["exp:"+e.id] = Date.now(); save(); closeSheet(); render(true); }
  });
}

function newExperiment(){
  const f = {title:"", link:"", watch:["sleep","mood"].filter(id=>trk(id)), len:14};
  const links = S.tasks.filter(t=>(t.type==="daily" || (t.type==="habit" && t.kind!=="bad")) && !t.archived);
  const choices = S.trackers.filter(t=>t.kind!=="bp");
  const draw = ()=>{
    let h = shead("New experiment", "Cancel", "Start", !f.title || !f.watch.length) + `<div class="form">`;
    h += `<div class="fld big"><label for="x-title">What will you try?</label><input class="tin xl" id="x-title" value="${esc(f.title)}" placeholder="No phone after 11 pm" maxlength="80" autocomplete="off"></div>`;
    if(!f.title) h += `<div class="chips">${EXP_EX.map(x=>`<button type="button" class="chip" data-xex="${esc(x)}">${esc(x)}</button>`).join("")}</div>`;
    h += `<div class="fld"><span class="lab">What should it improve? Up to 4.</span><div class="multi">${choices.map(t=>`<button type="button" data-xw="${t.id}" aria-pressed="${f.watch.includes(t.id)}" style="--c:${COLORS[t.color]}">${esc(t.name)}</button>`).join("")}</div></div>`;
    h += `<div class="fld"><span class="lab">For how long?</span>${segHTML("xlen", EXP_LENS.map(n=>[n, n+" days"]), f.len)}</div>`;
    if(links.length) h += `<div class="fld"><label for="x-link">Link a task (optional)</label><select class="tin" id="x-link"><option value="">None</option>${links.map(t=>`<option value="${t.id}" ${f.link===t.id?"selected":""}>${esc(t.title)}</option>`).join("")}</select></div>`;
    h += `<p class="hint">Starts today. Compared with the ${f.len} days before.</p></div>`;
    return h;
  };
  const grab = ()=>{ f.title = val("x-title").trim(); if(sheet.querySelector("#x-link")) f.link = val("x-link"); };
  const redraw = ()=>{ sheet.querySelector(".sheet").innerHTML = draw(); };
  openSheet(draw(), b=>{
    const d = b.dataset;
    if(d.s==="cancel"){ closeSheet(); return; }
    if(d.xex){ grab(); f.title = d.xex; redraw(); return; }
    if(d.xw){ grab(); const i = f.watch.indexOf(d.xw); if(i>=0) f.watch.splice(i,1); else if(f.watch.length<4) f.watch.push(d.xw); else toast("Up to 4 at a time"); redraw(); return; }
    if(d.pick==="xlen"){ grab(); f.len = Number(d.v); redraw(); return; }
    if(d.s==="save"){
      grab(); if(!f.title || !f.watch.length) return;
      if(activeExp()){ toast("Finish the running experiment first"); return; }
      S.experiments = cleanExperiments((S.experiments||[]).concat([{id:uid(), title:f.title, link:f.link||null, watch:f.watch, start:TODAY(), len:f.len}]));
      save(); closeSheet(); render(true); toast("Experiment started");
    }
  });
  sheet.addEventListener("input", e=>{ if(e.target.id!=="x-title") return; const has = !!e.target.value.trim(); const btn = sheet.querySelector("[data-s=save]"); if(btn) btn.disabled = !has || !f.watch.length; });
}

V.addEventListener("click", e=>{
  const b = e.target.closest("[data-easy],[data-exp],[data-expnew]"); if(!b) return;
  const d = b.dataset, k = TODAY();
  if(d.easy==="on"){ setEasy(k,true); tick(); render(true); toast("Easy day. Go gently."); }
  else if(d.easy==="off"){ setEasy(k,false); render(true); }
  else if(d.easy==="skip"){ day(k).easyNo = true; save(); render(true); }
  else if(d.easy==="manual"){ setEasy(k,true); tick(); render(true); toast("Easy day. Go gently."); }
  else if(d.exp) openExperiment(d.exp);
  else if(d.expnew) newExperiment();
});
