/* Monthly health summaries: fixed rules, no AI. Generated on the phone, shareable as a PDF. */
"use strict";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const monthName = m=>MONTHS[Number(m.slice(5,7))-1]+" "+m.slice(0,4);
const monthOf = k=>k.slice(0,7);
function prevMonth(m){ let y = Number(m.slice(0,4)), mo = Number(m.slice(5,7))-1; if(mo===0){ mo = 12; y--; } return y+"-"+p2(mo); }
function nextMonth(m){ let y = Number(m.slice(0,4)), mo = Number(m.slice(5,7))+1; if(mo===13){ mo = 1; y++; } return y+"-"+p2(mo); }
function monthDays(m, upTo){ const out = []; let k = m+"-01"; while(monthOf(k)===m && (!upTo || k<=upTo)){ out.push(k); k = addDays(k,1); } return out; }
const r1 = v=>v==null?null:Math.round(v*10)/10;
function statsFor(id, keys){
  const v = keys.map(k=>{ const x = logVal(k,id); return typeof x==="number" ? x : null; });
  const vals = v.filter(x=>x!=null); if(!vals.length) return null;
  const n = vals.length, avg = vals.reduce((a,b)=>a+b,0)/n, sorted = vals.slice().sort((a,b)=>a-b);
  let sx = 0, sy = 0, sxy = 0, sxx = 0, c = 0; v.forEach((y,i)=>{ if(y==null) return; sx += i; sy += y; sxy += i*y; sxx += i*i; c++; });
  const slope = c>2 ? (c*sxy - sx*sy)/((c*sxx - sx*sx)||1) : 0;
  const firstK = keys.find(k=>typeof logVal(k,id)==="number"), lastK = keys.slice().reverse().find(k=>typeof logVal(k,id)==="number");
  return {n, days:keys.length, avg, min:sorted[0], max:sorted[n-1], median:sorted[Math.floor(n/2)], slope, first:logVal(firstK,id), last:logVal(lastK,id), series:v};
}
function ageOf(p){ return p && p.birthYear ? new Date().getFullYear()-p.birthYear : null; }
function bmiOf(p, w){ const h = p && p.heightCm; if(!h || !w) return null; const b = w/Math.pow(h/100,2); return {v:r1(b), cat:b<18.5?"underweight":b<25?"healthy weight":b<30?"overweight":"obese"}; }

function buildReport(m, partial){
  const end = partial ? TODAY() : null, keys = monthDays(m, end), prevKeys = monthDays(prevMonth(m));
  const R = {month:m, label:monthName(m), partial:!!partial, generated:new Date().toISOString(), days:keys.length, profile:{}, metrics:[], notes:[], highlights:[], routine:{}};
  const p = S.profile || {};
  R.profile = {name:p.name||"", age:ageOf(p), sex:p.sex&&p.sex!=="unspecified"?p.sex:null, heightCm:p.heightCm||null};
  for(const t of S.trackers){ if(t.kind==="bp") continue;
    const s = statsFor(t.id, keys); if(!s) continue; const ps = statsFor(t.id, prevKeys);
    R.metrics.push({id:t.id, name:t.name, unit:t.kind==="scale"?"/10":t.unit, kind:t.kind, color:t.color, better:t.better, n:s.n, days:s.days, avg:r1(s.avg), min:r1(s.min), max:r1(s.max), first:r1(s.first), last:r1(s.last), slope:s.slope, prevAvg:ps?r1(ps.avg):null, series:s.series.map(r1), goalMin:t.min??null, goalMax:t.max??null, target:t.target??null}); }
  const M = id=>R.metrics.find(x=>x.id===id);
  const weight = M("weight"); R.profile.weightKg = weight ? weight.last : (p.weightKg||null); R.profile.bmi = bmiOf(p, R.profile.weightKg);
  /* routine */
  const done = keys.filter(k=>k<TODAY()).map(dayRate).filter(v=>v!=null), pd = prevKeys.map(dayRate).filter(v=>v!=null);
  R.routine.rate = done.length ? Math.round(done.reduce((a,b)=>a+b,0)/done.length*100) : null;
  R.routine.prevRate = pd.length ? Math.round(pd.reduce((a,b)=>a+b,0)/pd.length*100) : null;
  R.routine.perfect = keys.filter(k=>{ const r = dayRate(k); return r===1; }).length;
  R.routine.streaks = dailies().map(t=>({title:t.title, s:streakOf(t, keys[keys.length-1])})).filter(x=>x.s>=3).sort((a,b)=>b.s-a.s).slice(0,3);
  R.routine.habits = habits().map(t=>{ let u = 0, n = 0; for(const k of keys){ u += habitCount(t,k,"u"); n += habitCount(t,k,"n"); } return {title:t.title, kind:t.kind, done:u, slips:n}; }).filter(h=>h.done||h.slips);
  let xp = 0; for(const k of keys){ const x = S.hist[k] && S.hist[k].x; if(x) xp += Object.values(x).reduce((a,b)=>a+b,0); } R.routine.xp = xp;
  /* observations: fixed thresholds, phrased as observations, never diagnoses */
  const N = (t)=>R.notes.push(t), H = (t)=>R.highlights.push(t);
  for(const x of R.metrics) if(x.id!=="weight" && x.n < Math.max(3, Math.round(keys.length*0.4))) N(`Limited ${x.name.toLowerCase()} data: logged on ${x.n} of ${keys.length} days, so averages may not be representative.`);
  const sl = M("sleep");
  if(sl && sl.n>=5){ const short = sl.series.filter(v=>v!=null && v<6).length, inRange = sl.series.filter(v=>v!=null && v>=7 && v<=9).length;
    if(sl.avg < 7) N(`Average sleep was ${sl.avg} hours, below the 7–9 hours generally recommended for adults.`);
    if(short >= 5) N(`Under 6 hours of sleep on ${short} nights.`);
    if(sl.avg > 9.5) N(`Average sleep was ${sl.avg} hours, longer than the usual adult range.`);
    if(inRange/sl.n >= .7) H(`Sleep was in the 7–9 hour range on ${inRange} of ${sl.n} logged nights.`); }
  const rhr = M("rhr");
  if(rhr && rhr.n>=5){ if(rhr.avg > 100) N(`Average resting heart rate was ${rhr.avg} bpm, above the usual adult resting range of 60–100 bpm.`);
    if(rhr.avg < 50) N(`Average resting heart rate was ${rhr.avg} bpm. Below 50 can be normal for very fit people; worth mentioning if you feel dizzy or tired.`);
    if(rhr.prevAvg!=null && rhr.avg - rhr.prevAvg >= 5) N(`Resting heart rate rose by ${r1(rhr.avg-rhr.prevAvg)} bpm compared with last month (${rhr.prevAvg} to ${rhr.avg}).`);
    if(rhr.prevAvg!=null && rhr.prevAvg - rhr.avg >= 3) H(`Resting heart rate dropped by ${r1(rhr.prevAvg-rhr.avg)} bpm compared with last month.`); }
  const hrv = M("hrv");
  if(hrv && hrv.n>=5 && hrv.prevAvg && (hrv.prevAvg-hrv.avg)/hrv.prevAvg >= .15) N(`Average HRV fell ${Math.round((hrv.prevAvg-hrv.avg)/hrv.prevAvg*100)}% compared with last month (${hrv.prevAvg} to ${hrv.avg} ms). HRV often drops with stress, illness or poor sleep.`);
  const st = M("steps");
  if(st && st.n>=5){ const goal = (trk("steps")||{}).min || 7000, hit = st.series.filter(v=>v!=null && v>=goal).length;
    if(st.avg < 5000) N(`Average of ${Math.round(st.avg).toLocaleString("en-IN")} steps a day, which counts as low daily activity.`);
    if(st.avg >= goal) H(`Averaged ${Math.round(st.avg).toLocaleString("en-IN")} steps a day; ${hit} days at or above ${goal.toLocaleString("en-IN")}.`); }
  if(weight && weight.n>=2 && weight.first){ const ch = r1(weight.last-weight.first), pct = Math.abs(ch)/weight.first*100;
    if(Math.abs(ch) >= 2 || pct >= 3) N(`Weight changed by ${ch>0?"+":""}${ch} kg over the month (${weight.first} to ${weight.last} kg).`); }
  const mood = M("mood");
  if(mood && mood.n>=5){ const low = mood.series.filter(v=>v!=null && v<=3).length;
    if(low >= 7 || mood.avg <= 4) N(`Low mood (3 or below out of 10) was logged on ${low} day${low===1?"":"s"}; average mood ${mood.avg}/10. Worth raising with a doctor or counsellor, especially if it has lasted two weeks or more.`);
    if(mood.prevAvg!=null && mood.prevAvg - mood.avg >= 1.5) N(`Average mood fell from ${mood.prevAvg} to ${mood.avg} out of 10 compared with last month.`);
    if(mood.prevAvg!=null && mood.avg - mood.prevAvg >= 1) H(`Average mood improved from ${mood.prevAvg} to ${mood.avg} out of 10.`); }
  const stress = M("stress");
  if(stress && stress.n>=5){ const high = stress.series.filter(v=>v!=null && v>=8).length; if(high >= 7) N(`High stress (8 or above out of 10) was logged on ${high} days.`); }
  if(R.routine.rate!=null && R.routine.prevRate!=null && R.routine.rate - R.routine.prevRate >= 10) H(`Routine consistency rose from ${R.routine.prevRate}% to ${R.routine.rate}%.`);
  if(R.routine.streaks.length) H(`Longest current streak: ${R.routine.streaks[0].title} (${R.routine.streaks[0].s} days).`);
  if(R.routine.perfect >= 3) H(`${R.routine.perfect} perfect days with every daily done.`);
  return R;
}
function reportsCheck(){
  if(!S.onboarded) return;
  S.reports = S.reports || {};
  const logged = Object.keys(S.hist).filter(k=>S.hist[k].l).sort(), cur = monthOf(TODAY());
  const first = [monthOf(S.created || TODAY()), logged.length ? monthOf(logged[0]) : cur].sort()[0];
  let m = prevMonth(cur), made = null, count = 0;
  while(m >= first && count < 3){ if(!S.reports[m] && monthDays(m).some(hasActivity)){ S.reports[m] = buildReport(m,false); made = m; if(window.cloudSaveReport) cloudSaveReport(m, S.reports[m]); } m = prevMonth(m); count++; }
  if(made){ save(); toast(`Your ${monthName(made)} summary is ready in Trends`); }
}
function reportsHTML(){
  const list = Object.keys(S.reports||{}).sort().reverse();
  let h = `<div class="group"><div class="gh"><h2>Monthly summaries</h2></div>`;
  h += list.length ? `<ul class="list">${list.map(m=>{ const r = S.reports[m]; return `<li class="row plain tap" data-report="${m}"><div style="min-width:0"><span class="rt">${esc(r.label)}</span><div class="rs">${r.notes.length?`${r.notes.length} thing${r.notes.length===1?"":"s"} to watch`:"Nothing flagged"}${r.highlights.length?` · ${r.highlights.length} highlight${r.highlights.length===1?"":"s"}`:""}</div></div><span class="chev">›</span></li>`; }).join("")}</ul>`
    : `<div class="card"><p class="hint" style="font-size:15px">Your first summary arrives on the 1st of ${MONTHS[Number(nextMonth(monthOf(TODAY())).slice(5,7))-1]}. It's calculated on your phone from your logs, ready to keep or share with a doctor.</p></div>`;
  h += `<button class="btn sec" data-report="now">Summary of this month so far</button></div>`;
  return h;
}
const fmtN = (x, unit)=>x==null?"–":(Math.abs(x)>=1000?Math.round(x).toLocaleString("en-IN"):x)+(unit&&unit!=="/10"?" "+unit:unit==="/10"?"/10":"");
function deltaStr(x){ if(x.prevAvg==null) return "–"; const d = r1(x.avg-x.prevAvg); if(Math.abs(d) < 0.05) return "same"; return (d>0?"+":"")+(Math.abs(d)>=1000?Math.round(d).toLocaleString("en-IN"):d); }
function openReport(m){
  const R = m==="now" ? buildReport(monthOf(TODAY()), true) : S.reports[m]; if(!R) return;
  const pr = R.profile, who = [pr.name, pr.age?pr.age+" yrs":null, pr.sex?pr.sex[0].toUpperCase()+pr.sex.slice(1):null, pr.heightCm?pr.heightCm+" cm":null, pr.weightKg?pr.weightKg+" kg":null, pr.bmi?`BMI ${pr.bmi.v}`:null].filter(Boolean).join(" · ");
  let h = `<span class="grab"></span><div class="shead"><button data-s="x">Close</button><h3>${esc(R.label)}${R.partial?" so far":""}</h3><button class="r" data-s="pdf">Share PDF</button></div>`;
  h += `<div class="card" style="width:100%"><div class="date">Health summary</div><div style="font:700 22px var(--sys);margin-top:2px">${esc(R.label)}${R.partial?` (to ${fmtD(TODAY())})`:""}</div>${who?`<p class="hint" style="margin-top:4px">${esc(who)}</p>`:""}</div>`;
  if(R.notes.length) h += `<div class="group" style="width:100%"><div class="cap">To mention to a doctor</div><ul class="list">${R.notes.map(n=>`<li class="row plain" style="--c:var(--red);grid-template-columns:10px minmax(0,1fr)"><span class="dot"></span><span style="font-size:15px">${esc(n)}</span></li>`).join("")}</ul></div>`;
  if(R.highlights.length) h += `<div class="group" style="width:100%"><div class="cap">Highlights</div><ul class="list">${R.highlights.map(n=>`<li class="row plain" style="--c:var(--green);grid-template-columns:10px minmax(0,1fr)"><span class="dot"></span><span style="font-size:15px">${esc(n)}</span></li>`).join("")}</ul></div>`;
  if(R.metrics.length){ h += `<div class="group" style="width:100%"><div class="cap">Measurements</div><div class="card"><table class="stats"><thead><tr><th>Measure</th><th>Avg</th><th>Range</th><th>Days</th><th>vs last</th></tr></thead><tbody>${R.metrics.map(x=>`<tr><td><span class="dot" style="--c:${COLORS[x.color]};display:inline-block;margin-right:8px;vertical-align:0"></span>${esc(x.name)}</td><td>${fmtN(x.avg)}</td><td>${fmtN(x.min)}–${fmtN(x.max)}</td><td>${x.n}</td><td>${deltaStr(x)}</td></tr>`).join("")}</tbody></table></div></div>`;
    const ks = monthDays(R.month).slice(0, R.days);
    for(const x of R.metrics){ if(x.n<2) continue; const vals = x.series.filter(v=>v!=null), mn = Math.min(...vals), mx = Math.max(...vals), pad = (mx-mn)*.15 || Math.max(1,mx*.05);
      const o = x.kind==="scale" ? {min:0,max:10,ticks:[0,5,10]} : {min:Math.max(0,Math.floor(mn-pad)), max:Math.ceil(mx+pad), ticks:[Math.max(0,Math.floor(mn-pad)), Math.ceil(mx+pad)], connect:true, tickFmt:v=>v>=1000?(v/1000).toLocaleString("en-IN",{maximumFractionDigits:1})+"k":v};
      o.label = x.name; if(x.goalMin!=null && x.goalMax!=null){ o.band = [x.goalMin, x.goalMax]; o.bandC = COLORS[x.color]; }
      h += `<div class="card field" style="width:100%;--c:${COLORS[x.color]}"><div class="cap" style="padding:0">${esc(x.name)} · avg ${fmtN(x.avg, x.unit)}</div>${lineChart(ks, [{c:COLORS[x.color], get:k=>{ const i = ks.indexOf(k); return x.series[i]; }}], o)}</div>`; } }
  const rt = R.routine;
  h += `<div class="group" style="width:100%"><div class="cap">Routine</div><div class="tiles"><div class="tile" style="--c:var(--green)"><span class="tn">Dailies done</span><span class="tv">${rt.rate==null?"–":rt.rate+"%"}</span><span class="ts">${rt.prevRate!=null?`Last month ${rt.prevRate}%`:""}</span></div><div class="tile" style="--c:var(--blue)"><span class="tn">Perfect days</span><span class="tv">${rt.perfect}</span><span class="ts">${rt.xp.toLocaleString("en-IN")} XP earned</span></div></div>`;
  if(rt.habits.length) h += `<div class="card" style="margin-top:12px"><table class="stats"><thead><tr><th>Habit</th><th>Done</th><th>Slips</th></tr></thead><tbody>${rt.habits.map(x=>`<tr><td>${esc(x.title)}</td><td>${x.kind==="bad"?"–":x.done}</td><td>${x.kind==="good"?"–":x.slips}</td></tr>`).join("")}</tbody></table></div>`;
  h += `</div><p class="hint" style="text-align:center">Calculated on your phone from self-logged and device data using fixed rules. Not a diagnosis.</p>`;
  openSheet(h, b=>{ if(b.dataset.s==="x") closeSheet(); else if(b.dataset.s==="pdf") sharePDF(R); });
}

/* ---------- PDF ---------- */
const PDF_COL = {red:[234,67,53], green:[52,168,83], blue:[66,133,244], yellow:[230,162,0]};
const pdfSafe = s=>String(s).replace(/≥/g,">=").replace(/≤/g,"<=").replace(/[^\x00-\xFF–—‘’“”•…]/g,"");
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
  doc.text(pdfSafe(`Period: ${fmtD(R.month+"-01",{day:"numeric",month:"short",year:"numeric"})} – ${fmtD(monthDays(R.month)[R.days-1],{day:"numeric",month:"short",year:"numeric"})}  ·  Generated ${new Date(R.generated).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`), M, y); y += 9;
  const section = (title, rgb)=>{ ensure(14); doc.setFillColor(...(rgb||[66,133,244])); doc.rect(M, y-3.6, 1.6, 4.6, "F"); doc.setFont("helvetica","bold"); doc.setFontSize(12.5); ink(); doc.text(pdfSafe(title), M+4, y); y += 6; doc.setFont("helvetica","normal"); doc.setFontSize(10); };
  const bullets = (list, rgb)=>{ for(const n of list){ const lines = wrap(n, W-2*M-6); ensure(lines.length*4.6+2); doc.setFillColor(...rgb); doc.circle(M+1.5, y-1.2, .9, "F"); ink(); doc.text(lines, M+5, y); y += lines.length*4.6+1.6; } y += 3; };
  if(R.notes.length){ section("Observations to discuss", PDF_COL.red); bullets(R.notes, PDF_COL.red); }
  if(R.highlights.length){ section("Highlights", PDF_COL.green); bullets(R.highlights, PDF_COL.green); }
  if(R.metrics.length){
    section("Measurements", PDF_COL.blue);
    const cols = [["Measure",M],["Average",M+62],["Range",M+92],["Days logged",M+128],["vs last month",M+158]];
    doc.setFontSize(8.5); mute(); for(const [t,x] of cols) doc.text(t, x, y); y += 2; doc.setDrawColor(220,220,225); doc.line(M, y, W-M, y); y += 4.5; doc.setFontSize(10);
    for(const x of R.metrics){ ensure(7); ink(); doc.setFillColor(...PDF_COL[x.color]); doc.circle(M+1.2, y-1.2, 1, "F"); doc.text(pdfSafe(x.name), M+4, y);
      doc.text(pdfSafe(fmtN(x.avg, x.unit)), M+62, y); doc.text(pdfSafe(`${fmtN(x.min)}–${fmtN(x.max)}`), M+92, y); doc.text(`${x.n} of ${x.days}`, M+128, y); doc.text(pdfSafe(x.prevAvg==null?"–":`${deltaStr(x)} (was ${fmtN(x.prevAvg)})`), M+158, y);
      y += 2.4; doc.setDrawColor(238,238,242); doc.line(M, y, W-M, y); y += 4.4; }
    y += 4;
    const charts = R.metrics.filter(x=>x.n>=2), cw = (W-2*M-8)/2, ch = 34;
    if(charts.length){ section("Daily values", PDF_COL.yellow);
      charts.forEach((x,i)=>{ const col = i%2, cx = M + col*(cw+8); if(col===0) ensure(ch+12); const top = y;
        doc.setFontSize(9); ink(); doc.setFont("helvetica","bold"); doc.text(pdfSafe(x.name), cx, top); doc.setFont("helvetica","normal"); mute(); doc.text(pdfSafe(`avg ${fmtN(x.avg, x.unit)}`), cx+cw, top, {align:"right"});
        const gx = cx, gy = top+3, gw = cw, gh = ch-6, vals = x.series.filter(v=>v!=null);
        let lo = x.kind==="scale" ? 0 : Math.min(...vals), hi = x.kind==="scale" ? 10 : Math.max(...vals); if(lo===hi){ lo -= 1; hi += 1; } const pad = x.kind==="scale"?0:(hi-lo)*.15; lo = Math.max(0, lo-pad); hi += pad;
        const X = j=>gx + (x.series.length<=1 ? gw/2 : gw*j/(x.series.length-1)), Y = v=>gy+gh - gh*(v-lo)/(hi-lo);
        doc.setFillColor(247,247,250); doc.rect(gx, gy, gw, gh, "F");
        if(x.goalMin!=null && x.goalMax!=null){ const c = PDF_COL[x.color]; doc.setFillColor(c[0]+(255-c[0])*.85, c[1]+(255-c[1])*.85, c[2]+(255-c[2])*.85); const a = Y(Math.min(hi,x.goalMax)), b = Y(Math.max(lo,x.goalMin)); if(b>a) doc.rect(gx, a, gw, b-a, "F"); }
        doc.setFontSize(7); mute(); doc.text(String(Math.round(hi)), gx-1, gy+2, {align:"right"}); doc.text(String(Math.round(lo)), gx-1, gy+gh, {align:"right"});
        const c = PDF_COL[x.color]; doc.setDrawColor(...c); doc.setFillColor(...c); doc.setLineWidth(.6);
        let prev = null; x.series.forEach((v,j)=>{ if(v==null) return; const pt = [X(j), Y(v)]; if(prev) doc.line(prev[0], prev[1], pt[0], pt[1]); doc.circle(pt[0], pt[1], .55, "F"); prev = pt; });
        doc.setLineWidth(.2);
        if(col===1 || i===charts.length-1) y = top + ch + 4; });
      y += 2; }
  }
  const rt = R.routine; section("Routine and habits", PDF_COL.green);
  const lines = [`Daily habits completed: ${rt.rate==null?"no data":rt.rate+"%"}${rt.prevRate!=null?` (last month ${rt.prevRate}%)`:""}`, `Perfect days (every daily done): ${rt.perfect}`];
  if(rt.streaks.length) lines.push(`Current streaks: ${rt.streaks.map(s=>`${s.title} ${s.s} days`).join("; ")}`);
  for(const h2 of rt.habits) lines.push(`${h2.title}: ${h2.kind==="bad"?`${h2.slips} logged`:`${h2.done} done${h2.slips?`, ${h2.slips} slips`:""}`}`);
  for(const l of lines){ const w2 = wrap(l, W-2*M); ensure(w2.length*4.6); ink(); doc.text(w2, M, y); y += w2.length*4.6+.8; }
  y += 3; ensure(9); doc.setFontSize(8); mute();
  doc.text(wrap("Self-logged data and data from connected devices (via Health Connect), summarised on the user's phone with fixed rules. Consumer wearables are not medical devices. This summary is not a diagnosis; please interpret it alongside clinical assessment.", W-2*M), M, y);
  const pages = doc.getNumberOfPages(); for(let i=1;i<=pages;i++){ doc.setPage(i); doc.setFontSize(8); mute(); doc.text(`Healthbook · ${pdfSafe(R.label)} · page ${i} of ${pages}`, W/2, 297-8, {align:"center"}); }
  return doc;
}
async function sharePDF(R){
  let doc; try{ doc = buildPDF(R); }catch(e){ console.warn(e); toast("Couldn't create the PDF"); return; }
  const name = `health-summary-${R.month}${R.partial?"-so-far":""}.pdf`;
  if(FS && SHARE){ try{ const b64 = doc.output("datauristring").split(",")[1]; const w = await FS.writeFile({path:name, data:b64, directory:"CACHE"}); await SHARE.share({title:`Health summary: ${R.label}`, files:[w.uri], dialogTitle:"Share summary"}); return; }catch(e){ if(String(e && e.message || e).toLowerCase().includes("cancel")) return; toast("Couldn't share the PDF"); return; } }
  try{ doc.save(name); }catch(e){ toast("Couldn't save the PDF"); }
}
V.addEventListener("click", e=>{ const b = e.target.closest("[data-report]"); if(!b) return; openReport(b.dataset.report); });
