/* Monthly health summaries. Fixed arithmetic, no AI, no diagnosis.
   Built on the phone from your own logs and shareable as a PDF. */
"use strict";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthName = m=>MONTHS[Number(m.slice(5,7))-1]+" "+m.slice(0,4);
const monthOf = k=>k.slice(0,7);
function prevMonth(m){ let y = Number(m.slice(0,4)), mo = Number(m.slice(5,7))-1; if(mo===0){ mo = 12; y--; } return y+"-"+p2(mo); }
function nextMonth(m){ let y = Number(m.slice(0,4)), mo = Number(m.slice(5,7))+1; if(mo===13){ mo = 1; y++; } return y+"-"+p2(mo); }
function monthDays(m, upTo){ const out = []; let k = m+"-01"; while(monthOf(k)===m && (!upTo || k<=upTo)){ out.push(k); k = addDays(k,1); } return out; }
function ageOf(p){ return p && p.birthYear ? new Date().getFullYear()-p.birthYear : null; }
function bmiOf(p, w){ const h = p && p.heightCm; if(!h || !w) return null; const b = w/Math.pow(h/100,2); return {v:Math.round(b*10)/10, cat:b<18.5?"underweight":b<25?"healthy weight":b<30?"overweight":"obese"}; }

function buildReport(m, partial){
  const end = partial ? TODAY() : null, keys = monthDays(m, end), prevKeys = monthDays(prevMonth(m));
  const monthStart = m+"-01";
  const R = {month:m, label:monthName(m), partial:!!partial, generated:new Date().toISOString(), days:keys.length,
             profile:{}, metrics:[], doctor:[], watch:[], good:[], pattern:[], links:[], pairs:[], notes:[], routine:{}};
  const p = S.profile || {};
  R.profile = {name:p.name||"", age:ageOf(p), sex:p.sex&&p.sex!=="unspecified"?p.sex:null, heightCm:p.heightCm||null};

  for(const t of S.trackers){
    if(t.kind==="bp") continue;
    const mm = analyseMetric(t, keys, prevKeys, monthStart);
    if(mm) R.metrics.push(mm);
  }
  const M = id=>R.metrics.find(x=>x.id===id);
  const weight = M("weight");
  R.profile.weightKg = weight ? weight.series.filter(v=>v!=null).pop() : (p.weightKg||null);
  R.profile.bmi = bmiOf(p, R.profile.weightKg);

  /* ---------- routine ---------- */
  const rates = keys.filter(k=>k<TODAY()).map(dayRate).filter(v=>v!=null);
  const pd = prevKeys.map(dayRate).filter(v=>v!=null);
  const pct = a=>a.length ? Math.round(a.reduce((x,y)=>x+y,0)/a.length*100) : null;
  R.routine.rate = pct(rates);
  R.routine.prevRate = pct(pd);
  const half = Math.floor(keys.length/2);
  R.routine.firstHalf = pct(keys.slice(0,half).filter(k=>k<TODAY()).map(dayRate).filter(v=>v!=null));
  R.routine.secondHalf = pct(keys.slice(half).filter(k=>k<TODAY()).map(dayRate).filter(v=>v!=null));
  R.routine.perfect = keys.filter(k=>dayRate(k)===1).length;
  R.routine.streaks = dailies().map(t=>({title:t.title, s:streakOf(t, keys[keys.length-1])})).filter(x=>x.s>=3).sort((a,b)=>b.s-a.s).slice(0,3);
  R.routine.habits = habits().map(t=>{ let u=0, n=0; for(const k of keys){ u += habitCount(t,k,"u"); n += habitCount(t,k,"n"); }
    return {title:t.title, kind:t.kind, done:u, slips:n}; }).filter(h=>h.done||h.slips);
  /* which dailies you actually kept up, and which quietly slipped */
  R.routine.perTask = dailies().map(t=>{
    let due=0, done=0; for(const k of keys){ if(k>=TODAY()) continue; if(!isDue(t,k)) continue; due++; if(isDone(t,k)) done++; }
    return due>=4 ? {title:t.title, due, done, rate:Math.round(done/due*100)} : null;
  }).filter(Boolean).sort((a,b)=>b.rate-a.rate);
  let xp = 0; for(const k of keys){ const x = S.hist[k] && S.hist[k].x; if(x) xp += Object.values(x).reduce((a,b)=>a+b,0); }
  R.routine.xp = xp;

  /* ---------- clinical red flags: fixed thresholds, only genuine escalation ---------- */
  const D = t=>R.doctor.push(t);
  const sl = M("sleep"), rhr = M("rhr"), hrv = M("hrv"), mood = M("mood"), stress = M("stress"), steps = M("steps");
  if(rhr && rhr.n>=7){
    if(rhr.avg > 100) D(`Resting heart rate averaged ${rhr.avg} bpm, above the usual adult resting range of 60–100 bpm.`);
    if(rhr.avg < 50) D(`Resting heart rate averaged ${rhr.avg} bpm. Below 50 can be normal for very fit people, but worth mentioning alongside any dizziness or fatigue.`);
    if(rhr.base && rhr.avg - rhr.base.avg >= 7) D(`Resting heart rate is running ${Math.round(rhr.avg-rhr.base.avg)} bpm above your own usual ${rhr.base.avg} bpm — a sustained rise worth a mention.`);
  }
  if(sl && sl.n>=10 && sl.avg < 6) D(`Sleep averaged ${sl.avg} hours a night across ${sl.n} nights, well under the 7–9 hours generally recommended for adults.`);
  if(weight && weight.n>=4){
    const v = weight.series.filter(x=>x!=null), first = v[0], last = v[v.length-1], ch = Math.round((last-first)*10)/10;
    if(Math.abs(ch)/first*100 >= 5) D(`Weight changed by ${ch>0?"+":""}${ch} kg this month (${first} to ${last} kg), around ${Math.round(Math.abs(ch)/first*100)}% of body weight.`);
  }
  if(mood && mood.n>=10){
    const low = mood.series.filter(v=>v!=null && v<=3).length;
    if(low >= 7 || mood.avg <= 4) D(`Mood was logged at 3 or below on ${low} day${low===1?"":"s"}, averaging ${mood.avg}/10. If low mood has lasted two weeks or more, it is worth raising with a doctor or counsellor.`);
  }
  if(stress && stress.n>=10 && stress.series.filter(v=>v!=null && v>=8).length >= 10)
    D(`Stress was logged at 8 or above on ${stress.series.filter(v=>v!=null && v>=8).length} days this month.`);
  if(hrv && hrv.n>=10 && hrv.base && hrv.base.avg && (hrv.base.avg-hrv.avg)/hrv.base.avg >= 0.2)
    D(`HRV is averaging ${Math.round((hrv.base.avg-hrv.avg)/hrv.base.avg*100)}% below your own usual (${hrv.base.avg} to ${hrv.avg} ms). HRV commonly falls with stress, illness or short sleep.`);

  /* ---------- personal insights ---------- */
  buildInsights(R, keys, prevKeys, monthStart);

  /* ---------- data-quality caveats ---------- */
  for(const x of R.metrics)
    if(x.id!=="weight" && x.n < Math.max(3, Math.round(keys.length*0.4)))
      R.notes.push(`${x.name} was logged on only ${x.n} of ${keys.length} days, so its averages are indicative rather than reliable.`);

  R.notes.push("Findings describe what occurred together in your own data. They do not establish cause.");
  return R;
}

function reportsCheck(){
  if(!S.onboarded) return;
  S.reports = S.reports || {};
  const logged = Object.keys(S.hist).filter(k=>S.hist[k].l).sort(), cur = monthOf(TODAY());
  const first = [monthOf(S.created || TODAY()), logged.length ? monthOf(logged[0]) : cur].sort()[0];
  let m = prevMonth(cur), made = null, count = 0;
  while(m >= first && count < 3){
    if(!S.reports[m] && monthDays(m).some(hasActivity)){ S.reports[m] = buildReport(m,false); made = m; if(window.cloudSaveReport) cloudSaveReport(m, S.reports[m]); }
    m = prevMonth(m); count++;
  }
  if(made){ save(); toast(`Your ${monthName(made)} summary is ready in Trends`); }
}

function reportsHTML(){
  const list = Object.keys(S.reports||{}).sort().reverse();
  let h = `<div class="group"><div class="gh"><h2>Monthly summaries</h2></div>`;
  h += list.length ? `<ul class="list">${list.map(m=>{ const r = S.reports[m];
      const bits = [r.good.length?`${r.good.length} going well`:null, r.doctor.length?`${r.doctor.length} to discuss`:null, r.links.length?`${r.links.length} connection${r.links.length===1?"":"s"}`:null].filter(Boolean);
      return `<li class="row plain tap" data-report="${m}"><div style="min-width:0"><span class="rt">${esc(r.label)}</span><div class="rs">${bits.length?esc(bits.join(" · ")):"Summary ready"}</div></div><span class="chev">›</span></li>`; }).join("")}</ul>`
    : `<div class="card"><p class="hint" style="font-size:15px">Your first summary arrives on the 1st of ${MONTHS[Number(nextMonth(monthOf(TODAY())).slice(5,7))-1]}.</p></div>`;
  h += `<button class="btn sec" data-report="now">Summary of this month so far</button></div>`;
  return h;
}

/* ================= display ================= */
const fmtN = (x, unit)=>x==null?"–":(Math.abs(x)>=1000?Math.round(x).toLocaleString("en-IN"):x)+(unit&&unit!=="/10"?" "+unit:unit==="/10"?"/10":"");
function deltaStr(x){ if(x.prevAvg==null) return "–"; const d = Math.round((x.avg-x.prevAvg)*10)/10;
  if(Math.abs(d) < 0.05) return "same"; return (d>0?"+":"")+(Math.abs(d)>=1000?Math.round(d).toLocaleString("en-IN"):d); }

function bulletList(items, color){
  return `<ul class="list">${items.map(n=>`<li class="row plain" style="--c:var(--${color});grid-template-columns:10px minmax(0,1fr)"><span class="dot"></span><span style="font-size:15px;line-height:1.45">${esc(n)}</span></li>`).join("")}</ul>`;
}

function openReport(m){
  const R = m==="now" ? buildReport(monthOf(TODAY()), true) : S.reports[m]; if(!R) return;
  const pr = R.profile, who = [pr.name, pr.age?pr.age+" yrs":null, pr.sex?pr.sex[0].toUpperCase()+pr.sex.slice(1):null, pr.heightCm?pr.heightCm+" cm":null, pr.weightKg?pr.weightKg+" kg":null, pr.bmi?`BMI ${pr.bmi.v}`:null].filter(Boolean).join(" · ");
  let h = `<span class="grab"></span><div class="shead"><button data-s="x">Close</button><h3>${esc(R.label)}</h3><button class="r" data-s="pdf">Share PDF</button></div>`;
  h += `<div class="card" style="width:100%"><div class="date">Health summary</div><div style="font:700 22px var(--sys);margin-top:2px">${esc(R.label)}${R.partial?` (to ${fmtD(TODAY())})`:""}</div>${who?`<p class="hint" style="margin-top:4px">${esc(who)}</p>`:""}</div>`;

  if(R.headline) h += `<div class="card headline" style="width:100%"><div class="cap" style="padding:0">The standout</div><p>${esc(R.headline)}</p></div>`;

  if(R.keystone){
    const K = R.keystone;
    h += `<div class="group" style="width:100%"><div class="cap">Your keystone habit</div><div class="card keystone"><div class="kh">${esc(K.cond)}</div><div class="ks">${K.nYes} days you ${esc(K.yesLabel)} it · ${K.nNo} days you ${esc(K.noLabel)}</div><table class="stats ktab"><thead><tr><th>Measure</th><th>Did</th><th>Didn't</th></tr></thead><tbody>${K.metrics.map(a=>`<tr><td>${esc(a.metric)}${a.lag===1?' <small class="hint">next day</small>':""}</td><td><b>${esc(linkVal(a,a.yes))}</b></td><td>${esc(linkVal(a,a.no))}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  if(R.links.length){
    h += `<div class="group" style="width:100%"><div class="cap">${R.keystone?"Other connections":"What moved together"}</div><ul class="list">${R.links.map(a=>`<li class="row plain" style="--c:var(--${a.good===true?"green":a.good===false?"red":"blue"});grid-template-columns:10px minmax(0,1fr)"><span class="dot"></span><span style="font-size:15px;line-height:1.45">${esc(linkSentence(a))}<br><small class="hint">${a.nYes} vs ${a.nNo} days${a.lag===1?" · measured the next day":""}</small></span></li>`).join("")}</ul></div>`;
  }
  if((R.keystone || R.links.length) && R.linkDays)
    h += `<div class="group" style="width:100%"><div class="cap">How these were found</div>${bulletList([`Drawn from your last ${R.linkDays} logged days, not just this month.`, "A month alone is too short to tell a pattern from a coincidence."].concat(R.pairs.map(p=>`${p.a} and ${p.b} moved ${p.dir} most days.`)),"grey")}</div>`;
  if(R.doctor.length) h += `<div class="group" style="width:100%"><div class="cap">To mention to a doctor</div>${bulletList(R.doctor,"red")}</div>`;
  if(R.watch.length) h += `<div class="group" style="width:100%"><div class="cap">Worth your attention</div>${bulletList(R.watch,"yellow")}</div>`;
  if(R.good.length) h += `<div class="group" style="width:100%"><div class="cap">Going well</div>${bulletList(R.good,"green")}</div>`;
  if(R.pattern.length) h += `<div class="group" style="width:100%"><div class="cap">Patterns</div>${bulletList(R.pattern,"blue")}</div>`;

  if(R.metrics.length){
    h += `<div class="group" style="width:100%"><div class="cap">Measurements</div><div class="card"><table class="stats"><thead><tr><th>Measure</th><th>Avg</th><th>Range</th><th>Steady</th><th>vs you</th></tr></thead><tbody>${R.metrics.map(x=>`<tr><td><span class="dot" style="--c:${COLORS[x.color]};display:inline-block;margin-right:8px;vertical-align:0"></span>${esc(x.name)}</td><td>${fmtN(x.avg)}</td><td>${fmtN(x.min)}–${fmtN(x.max)}</td><td>${x.cv==null?"–":x.cv<15?"steady":x.cv<30?"varies":"swings"}</td><td>${x.base==null?"–":(x.avg-x.base.avg>0?"+":"")+Math.round((x.avg-x.base.avg)*10)/10}</td></tr>`).join("")}</tbody></table><p class="hint" style="margin:10px 2px 0">• "vs you" = this month against your own earlier average.<br>• Not compared with other people.</p></div></div>`;
    const ks = monthDays(R.month).slice(0, R.days);
    for(const x of R.metrics){
      if(x.n<2) continue;
      const vals = x.series.filter(v=>v!=null), mn = Math.min(...vals), mx = Math.max(...vals), pad = (mx-mn)*.15 || Math.max(1,mx*.05);
      const o = x.kind==="scale" ? {min:0,max:10,ticks:[0,5,10]}
        : {min:Math.max(0,Math.floor(mn-pad)), max:Math.ceil(mx+pad), ticks:[Math.max(0,Math.floor(mn-pad)), Math.ceil(mx+pad)], connect:true, tickFmt:v=>v>=1000?(v/1000).toLocaleString("en-IN",{maximumFractionDigits:1})+"k":v};
      o.label = x.name;
      if(x.goalMin!=null && x.goalMax!=null){ o.band = [x.goalMin, x.goalMax]; o.bandC = COLORS[x.color]; }
      if(x.base) o.ref = x.base.avg;
      h += `<div class="card field" style="width:100%;--c:${COLORS[x.color]}"><div class="cap" style="padding:0">${esc(x.name)} · avg ${fmtN(x.avg, x.unit)}</div>${lineChart(ks, [{c:COLORS[x.color], get:k=>x.series[ks.indexOf(k)]}], o)}${x.base?`<p class="hint">Dashed line is your usual ${fmtN(x.base.avg, x.unit)}.</p>`:""}</div>`;
    }
  }

  const rt = R.routine;
  h += `<div class="group" style="width:100%"><div class="cap">Routine</div><div class="tiles"><div class="tile" style="--c:var(--green)"><span class="tn">Dailies done</span><span class="tv">${rt.rate==null?"–":rt.rate+"%"}</span><span class="ts">${rt.prevRate!=null?`Last month ${rt.prevRate}%`:""}</span></div><div class="tile" style="--c:var(--blue)"><span class="tn">Perfect days</span><span class="tv">${rt.perfect}</span><span class="ts">${rt.xp.toLocaleString("en-IN")} XP earned</span></div></div>`;
  if(rt.perTask && rt.perTask.length){
    const top = rt.perTask.slice(0,3), low = rt.perTask.slice(-3).filter(x=>!top.includes(x));
    h += `<div class="card" style="margin-top:12px"><table class="stats"><thead><tr><th>Daily</th><th>Kept</th></tr></thead><tbody>${top.concat(low).map(x=>`<tr><td>${esc(x.title)}</td><td>${x.rate}% <small class="hint">(${x.done}/${x.due})</small></td></tr>`).join("")}</tbody></table></div>`;
  }
  if(rt.habits.length) h += `<div class="card" style="margin-top:12px"><table class="stats"><thead><tr><th>Habit</th><th>Done</th><th>Slips</th></tr></thead><tbody>${rt.habits.map(x=>`<tr><td>${esc(x.title)}</td><td>${x.kind==="bad"?"–":x.done}</td><td>${x.kind==="good"?"–":x.slips}</td></tr>`).join("")}</tbody></table></div>`;
  h += `</div>`;
  if(R.notes.length) h += `<div class="group" style="width:100%"><div class="cap">Notes</div>${bulletList(R.notes,"grey")}</div>`;
  h += `<p class="hint" style="text-align:center">Calculated on your phone from your own logs and device data. Not a diagnosis.</p>`;
  openSheet(h, b=>{ if(b.dataset.s==="x") closeSheet(); else if(b.dataset.s==="pdf") sharePDF(R); });
}

/* ================= PDF ================= */
const PDF_COL = {red:[234,67,53], green:[52,168,83], blue:[66,133,244], yellow:[230,162,0]};
const pdfSafe = s=>String(s).replace(/≥/g,">=").replace(/≤/g,"<=").replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x00-\xFF–—•…]/g,"");
function buildPDF(R){
  const {jsPDF} = window.jspdf; const doc = new jsPDF({unit:"mm", format:"a4"}); const W = 210, M = 16; let y = M;
  const ink = ()=>doc.setTextColor(20,20,20), mute = ()=>doc.setTextColor(110,110,115);
  const ensure = h=>{ if(y + h > 297-M-8){ doc.addPage(); y = M; } };
  const wrap = (txt, w)=>doc.splitTextToSize(pdfSafe(txt), w);
  doc.setFillColor(66,133,244); doc.rect(0,0,W*.25,3,"F"); doc.setFillColor(234,67,53); doc.rect(W*.25,0,W*.25,3,"F"); doc.setFillColor(251,188,5); doc.rect(W*.5,0,W*.25,3,"F"); doc.setFillColor(52,168,83); doc.rect(W*.75,0,W*.25,3,"F");
  y = 14; doc.setFont("helvetica","bold"); doc.setFontSize(20); ink(); doc.text(pdfSafe(`Health summary: ${R.label}${R.partial?" (so far)":""}`), M, y);
  y += 7; doc.setFont("helvetica","normal"); doc.setFontSize(10); mute();
  const pr = R.profile, who = [pr.name, pr.age?`Age ${pr.age}`:null, pr.sex?pr.sex[0].toUpperCase()+pr.sex.slice(1):null, pr.heightCm?`Height ${pr.heightCm} cm`:null, pr.weightKg?`Weight ${pr.weightKg} kg`:null, pr.bmi?`BMI ${pr.bmi.v} (${pr.bmi.cat}, WHO adult category)`:null].filter(Boolean).join("  ·  ");
  if(who){ doc.text(wrap(who, W-2*M), M, y); y += 5; }
  doc.text(pdfSafe(`Period: ${fmtD(R.month+"-01",{day:"numeric",month:"short",year:"numeric"})} - ${fmtD(monthDays(R.month)[R.days-1],{day:"numeric",month:"short",year:"numeric"})}  ·  Generated ${new Date(R.generated).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`), M, y); y += 9;

  const section = (title, rgb)=>{ ensure(14); doc.setFillColor(...(rgb||[66,133,244])); doc.rect(M, y-3.6, 1.6, 4.6, "F"); doc.setFont("helvetica","bold"); doc.setFontSize(12.5); ink(); doc.text(pdfSafe(title), M+4, y); y += 6; doc.setFont("helvetica","normal"); doc.setFontSize(10); };
  const bullets = (list, rgb)=>{ for(const n of list){ const lines = wrap(n, W-2*M-6); ensure(lines.length*4.6+2); doc.setFillColor(...rgb); doc.circle(M+1.5, y-1.2, .9, "F"); ink(); doc.text(lines, M+5, y); y += lines.length*4.6+1.6; } y += 3; };

  if(R.headline){ ensure(16); doc.setFillColor(246,248,252); const lines = wrap(R.headline, W-2*M-8);
    doc.rect(M, y-4.5, W-2*M, lines.length*4.8+7, "F"); doc.setFillColor(66,133,244); doc.rect(M, y-4.5, 1.6, lines.length*4.8+7, "F");
    doc.setFont("helvetica","bold"); ink(); doc.text(lines, M+5, y); doc.setFont("helvetica","normal"); y += lines.length*4.8+9; }

  if(R.keystone){ const K = R.keystone; section("Keystone habit", PDF_COL.green);
    doc.setFont("helvetica","bold"); ink(); ensure(10); doc.text(pdfSafe(K.cond), M, y); doc.setFont("helvetica","normal"); y += 5;
    mute(); doc.setFontSize(9); doc.text(pdfSafe(`${K.nYes} days you ${K.yesLabel} it · ${K.nNo} days you ${K.noLabel}`), M, y); y += 5.5; doc.setFontSize(10);
    mute(); doc.text("Measure", M+2, y); doc.text("Did", M+70, y); doc.text("Didn't", M+100, y); y += 1.6;
    doc.setDrawColor(224,224,230); doc.line(M, y, W-M, y); y += 4.4; ink();
    for(const a of K.metrics){ ensure(6);
      doc.text(pdfSafe(a.metric + (a.lag===1?" (next day)":"")), M+2, y);
      doc.setFont("helvetica","bold"); doc.text(pdfSafe(linkVal(a,a.yes)), M+70, y); doc.setFont("helvetica","normal");
      doc.text(pdfSafe(linkVal(a,a.no)), M+100, y); y += 5.2; }
    y += 3; }
  if(R.links.length){ section(R.keystone?"Other connections":"What moved together", PDF_COL.blue);
    bullets(R.links.map(a=>linkSentence(a)+` (${a.nYes} vs ${a.nNo} days${a.lag===1?", measured the next day":""})`), PDF_COL.blue); }
  if((R.keystone || R.links.length) && R.linkDays){ mute(); doc.setFontSize(8.5);
    const l = wrap(`Connections are drawn from the last ${R.linkDays} logged days rather than this month alone, since one month is too short to separate a pattern from a coincidence.` + (R.pairs.length?" "+R.pairs.map(p=>`${p.a} and ${p.b} moved ${p.dir} most days.`).join(" "):""), W-2*M);
    ensure(l.length*4.2+3); doc.text(l, M, y); y += l.length*4.2+4; doc.setFontSize(10); ink(); }
  if(R.doctor.length){ section("To discuss with a doctor", PDF_COL.red); bullets(R.doctor, PDF_COL.red); }
  if(R.watch.length){ section("Worth attention", PDF_COL.yellow); bullets(R.watch, PDF_COL.yellow); }
  if(R.good.length){ section("Going well", PDF_COL.green); bullets(R.good, PDF_COL.green); }
  if(R.pattern.length){ section("Patterns", PDF_COL.blue); bullets(R.pattern, PDF_COL.blue); }

  if(R.metrics.length){
    section("Measurements", PDF_COL.blue);
    const cols = [["Measure",M],["Average",M+52],["Range",M+80],["Days",M+114],["Steadiness",M+134],["vs your usual",M+162]];
    doc.setFontSize(8.5); mute(); for(const [t,x] of cols) doc.text(t, x, y); y += 2; doc.setDrawColor(220,220,225); doc.line(M, y, W-M, y); y += 4.5; doc.setFontSize(10);
    for(const x of R.metrics){ ensure(7); ink(); doc.setFillColor(...PDF_COL[x.color]); doc.circle(M+1.2, y-1.2, 1, "F"); doc.text(pdfSafe(x.name), M+4, y);
      doc.text(pdfSafe(fmtN(x.avg, x.unit)), M+52, y); doc.text(pdfSafe(`${fmtN(x.min)}-${fmtN(x.max)}`), M+80, y); doc.text(`${x.n}/${x.days}`, M+114, y);
      doc.text(pdfSafe(x.cv==null?"-":x.cv<15?"steady":x.cv<30?"varies":"swings"), M+134, y);
      doc.text(pdfSafe(x.base==null?"-":`${x.avg-x.base.avg>0?"+":""}${Math.round((x.avg-x.base.avg)*10)/10} (usual ${fmtN(x.base.avg)})`), M+162, y);
      y += 2.4; doc.setDrawColor(238,238,242); doc.line(M, y, W-M, y); y += 4.4; }
    y += 2; doc.setFontSize(8); mute();
    doc.text(wrap('"vs your usual" compares this month against this person\'s own earlier average, not a population reference range.', W-2*M), M, y); y += 7; doc.setFontSize(10);

    const charts = R.metrics.filter(x=>x.n>=2), cw = (W-2*M-8)/2, ch = 34;
    if(charts.length){ section("Daily values", PDF_COL.yellow);
      charts.forEach((x,i)=>{ const col = i%2, cx = M + col*(cw+8); if(col===0) ensure(ch+12); const top = y;
        doc.setFontSize(9); ink(); doc.setFont("helvetica","bold"); doc.text(pdfSafe(x.name), cx, top); doc.setFont("helvetica","normal"); mute(); doc.text(pdfSafe(`avg ${fmtN(x.avg, x.unit)}`), cx+cw, top, {align:"right"});
        const gx = cx, gy = top+3, gw = cw, gh = ch-6, vals = x.series.filter(v=>v!=null);
        let lo = x.kind==="scale" ? 0 : Math.min(...vals), hi = x.kind==="scale" ? 10 : Math.max(...vals); if(lo===hi){ lo -= 1; hi += 1; }
        const pad = x.kind==="scale"?0:(hi-lo)*.15; lo = Math.max(0, lo-pad); hi += pad;
        const X = j=>gx + (x.series.length<=1 ? gw/2 : gw*j/(x.series.length-1)), Y = v=>gy+gh - gh*(v-lo)/(hi-lo);
        doc.setFillColor(247,247,250); doc.rect(gx, gy, gw, gh, "F");
        if(x.goalMin!=null && x.goalMax!=null){ const c = PDF_COL[x.color]; doc.setFillColor(c[0]+(255-c[0])*.85, c[1]+(255-c[1])*.85, c[2]+(255-c[2])*.85); const a = Y(Math.min(hi,x.goalMax)), b = Y(Math.max(lo,x.goalMin)); if(b>a) doc.rect(gx, a, gw, b-a, "F"); }
        if(x.base && x.base.avg>lo && x.base.avg<hi){ doc.setDrawColor(150,150,158); doc.setLineWidth(.25); const yb = Y(x.base.avg); for(let px=gx; px<gx+gw; px+=3) doc.line(px, yb, Math.min(px+1.6, gx+gw), yb); }
        doc.setFontSize(7); mute(); doc.text(String(Math.round(hi)), gx-1, gy+2, {align:"right"}); doc.text(String(Math.round(lo)), gx-1, gy+gh, {align:"right"});
        const c = PDF_COL[x.color]; doc.setDrawColor(...c); doc.setFillColor(...c); doc.setLineWidth(.6);
        let prev = null; x.series.forEach((v,j)=>{ if(v==null) return; const pt = [X(j), Y(v)]; if(prev) doc.line(prev[0], prev[1], pt[0], pt[1]); doc.circle(pt[0], pt[1], .55, "F"); prev = pt; });
        doc.setLineWidth(.2);
        if(col===1 || i===charts.length-1) y = top + ch + 4; });
      y += 2; }
  }

  const rt = R.routine; section("Routine and habits", PDF_COL.green);
  const lines = [`Daily habits completed: ${rt.rate==null?"no data":rt.rate+"%"}${rt.prevRate!=null?` (last month ${rt.prevRate}%)`:""}`,
                 `Perfect days (every daily done): ${rt.perfect}`];
  if(rt.firstHalf!=null && rt.secondHalf!=null) lines.push(`First half of month ${rt.firstHalf}%, second half ${rt.secondHalf}%`);
  if(rt.streaks.length) lines.push(`Current streaks: ${rt.streaks.map(s=>`${s.title} ${s.s} days`).join("; ")}`);
  for(const x of (rt.perTask||[]).slice(0,6)) lines.push(`${x.title}: kept ${x.rate}% (${x.done} of ${x.due})`);
  for(const h2 of rt.habits) lines.push(`${h2.title}: ${h2.kind==="bad"?`${h2.slips} logged`:`${h2.done} done${h2.slips?`, ${h2.slips} slips`:""}`}`);
  for(const l of lines){ const w2 = wrap(l, W-2*M); ensure(w2.length*4.6); ink(); doc.text(w2, M, y); y += w2.length*4.6+.8; }

  y += 3; ensure(14); doc.setFontSize(8); mute();
  doc.text(wrap("Self-logged data and data from connected devices (via Health Connect), summarised on the user's phone using fixed arithmetic. Comparisons are against this person's own history rather than population reference ranges. Associations describe what occurred together and do not establish cause. Consumer wearables are not medical devices. This summary is not a diagnosis; please interpret it alongside clinical assessment.", W-2*M), M, y);
  const pages = doc.getNumberOfPages();
  for(let i=1;i<=pages;i++){ doc.setPage(i); doc.setFontSize(8); mute(); doc.text(`Healthbook · ${pdfSafe(R.label)} · page ${i} of ${pages}`, W/2, 297-8, {align:"center"}); }
  return doc;
}
async function sharePDF(R){
  let doc; try{ doc = buildPDF(R); }catch(e){ dlog(e); toast("Couldn't create the PDF"); return; }
  const name = `health-summary-${R.month}${R.partial?"-so-far":""}.pdf`;
  if(FS && SHARE){ try{ const b64 = doc.output("datauristring").split(",")[1]; const w = await FS.writeFile({path:name, data:b64, directory:"CACHE"}); try{ await SHARE.share({title:`Health summary: ${R.label}`, files:[w.uri], dialogTitle:"Share summary"}); } finally { setTimeout(()=>dropShared(name), 60e3); } return; }catch(e){ if(String(e && e.message || e).toLowerCase().includes("cancel")) return; toast("Couldn't share the PDF"); return; } }
  try{ doc.save(name); }catch(e){ toast("Couldn't save the PDF"); }
}
V.addEventListener("click", e=>{ const b = e.target.closest("[data-report]"); if(!b) return; openReport(b.dataset.report); });
