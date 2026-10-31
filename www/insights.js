/* Personal insight engine.
   Everything here compares you against YOUR OWN history rather than population averages,
   because "7 hours is normal" is far less useful than "that's 50 minutes less than your usual".
   Fixed arithmetic only: no AI, no inference, no diagnosis. */
"use strict";

/* ================= statistics toolkit ================= */
const isNum = v=>typeof v==="number" && isFinite(v);
const nums = a=>a.filter(isNum);
function mean(a){ a = nums(a); return a.length ? a.reduce((x,y)=>x+y,0)/a.length : null; }
function sd(a){ a = nums(a); if(a.length<2) return null; const m = mean(a); return Math.sqrt(a.reduce((s,v)=>s+(v-m)*(v-m),0)/(a.length-1)); }
function median(a){ a = nums(a).slice().sort((x,y)=>x-y); if(!a.length) return null; const i = a.length>>1; return a.length%2 ? a[i] : (a[i-1]+a[i])/2; }

/* Least-squares slope over position, plus R² so we can tell a real drift from noise. */
function regress(ys){
  let n=0, sx=0, sy=0, sxy=0, sxx=0;
  ys.forEach((y,i)=>{ if(!isNum(y)) return; n++; sx+=i; sy+=y; sxy+=i*y; sxx+=i*i; });
  if(n<5) return null;
  const den = n*sxx - sx*sx; if(!den) return null;
  const slope = (n*sxy - sx*sy)/den, inter = (sy - slope*sx)/n, m = sy/n;
  let ssr=0, sst=0;
  ys.forEach((y,i)=>{ if(!isNum(y)) return; const f = slope*i+inter; ssr += (y-f)*(y-f); sst += (y-m)*(y-m); });
  return {slope, r2: sst ? Math.max(0, 1-ssr/sst) : 0, n};
}

function pearson(xs, ys){
  const px=[], py=[];
  for(let i=0;i<xs.length;i++) if(isNum(xs[i]) && isNum(ys[i])){ px.push(xs[i]); py.push(ys[i]); }
  const n = px.length; if(n<10) return null;
  const mx = mean(px), my = mean(py); let num=0, dx=0, dy=0;
  for(let i=0;i<n;i++){ const a=px[i]-mx, b=py[i]-my; num+=a*b; dx+=a*a; dy+=b*b; }
  const den = Math.sqrt(dx*dy); if(!den) return null;
  return {r:num/den, n};
}

/* Pooled standardised difference between two groups (Cohen's d). */
function cohenD(a, b){
  const na = nums(a).length, nb = nums(b).length; if(na<2 || nb<2) return null;
  const sa = sd(a), sb = sd(b);
  const sp = Math.sqrt(((na-1)*sa*sa + (nb-1)*sb*sb)/(na+nb-2));
  if(!sp) return null;
  return (mean(a)-mean(b))/sp;
}

/* ================= data access ================= */
function valsOver(id, keys){ return keys.map(k=>{ const v = logVal(k,id); return isNum(v) ? v : null; }); }
function keysWith(id){ return Object.keys(S.hist).filter(k=>{ const d = S.hist[k]; return d && d.l && isNum(d.l[id]); }).sort(); }

/* The 120 days before the month, so "your usual" means something even early on. */
function baselineOf(id, monthStart){
  const ks = keysWith(id).filter(k=>k < monthStart).slice(-120);
  if(ks.length < 10) return null;
  const v = ks.map(k=>logVal(k,id));
  return {avg:mean(v), sd:sd(v), median:median(v), n:ks.length};
}

/* Smallest change worth mentioning for a tracker: a sensible floor per metric,
   never smaller than a third of that metric's own day-to-day spread. */
const FLOOR = {sleep:0.4, steps:700, rhr:2, hrv:4, weight:0.5, mood:0.6, stress:0.6, water:1};
function minDiff(t, spread){
  const base = FLOOR[t.id] != null ? FLOOR[t.id]
    : t.kind==="scale" ? 0.6
    : t.kind==="hours" ? 0.4
    : spread ? spread*0.35 : 0;
  return Math.max(base, (spread||0)*0.3);
}

const r1 = v=>v==null?null:Math.round(v*10)/10;
const fmtQ = (t,v)=>{ if(v==null) return "–";
  if(t.kind==="scale") return r1(v)+"/10";
  if(Math.abs(v) >= 1000) return Math.round(v).toLocaleString("en-IN")+(t.unit?" "+t.unit:"");
  return r1(v)+(t.unit?" "+t.unit:""); };

/* ================= conditions worth testing ================= */
/* Each returns a per-day true/false, so we can ask "what were your numbers like
   on the days you did this, versus the days you didn't?" */
/* `skip` lists tracker ids a condition must never be tested against, because the
   condition is derived from that tracker. "Water was higher on days you hit your
   water goal" is arithmetic, not an insight. */
function conditionsFor(keys){
  const out = [];
  for(const t of dailies()){
    const flags = keys.map(k=>isDue(t,k) ? isDone(t,k) : null);
    const yes = flags.filter(f=>f===true).length, no = flags.filter(f=>f===false).length;
    /* a daily that ticks itself from a tracker is that tracker's threshold wearing a hat */
    const skip = (t.auto||[]).map(a=>a.t);
    if(yes>=8 && no>=8) out.push({label:t.title, kind:"daily", flags, skip, yesLabel:"did", noLabel:"skipped"});
  }
  for(const t of habits()){
    if(t.kind==="bad") continue;
    const flags = keys.map(k=>habitCount(t,k,"u")>0);
    const yes = flags.filter(Boolean).length, no = flags.length-yes;
    if(yes>=8 && no>=8) out.push({label:t.title, kind:"habit", flags, skip:[], yesLabel:"did", noLabel:"didn't"});
  }
  for(const t of S.trackers){
    const goal = t.kind==="count" ? t.target : (t.better==="up" ? t.min : null);
    if(goal==null) continue;
    const flags = keys.map(k=>{ const v = logVal(k,t.id); return isNum(v) ? v>=goal : null; });
    const yes = flags.filter(f=>f===true).length, no = flags.filter(f=>f===false).length;
    if(yes>=8 && no>=8) out.push({label:`hit your ${t.name.toLowerCase()} goal`, kind:"goal", flags, skip:[t.id], yesLabel:"hit it", noLabel:"missed it"});
  }
  return out;
}

/* ================= the analyses ================= */

/* 1. How this month compares with your own normal, and how steady you were. */
function analyseMetric(t, keys, prevKeys, monthStart){
  const series = valsOver(t.id, keys);
  const v = nums(series); if(v.length < 3) return null;
  const avg = mean(v), spread = sd(v), base = baselineOf(t.id, monthStart);
  const prev = mean(valsOver(t.id, prevKeys));
  const reg = regress(series);
  const m = {
    id:t.id, name:t.name, unit:t.kind==="scale"?"/10":t.unit, kind:t.kind, color:t.color, better:t.better,
    n:v.length, days:keys.length, avg:r1(avg), min:r1(Math.min(...v)), max:r1(Math.max(...v)),
    median:r1(median(v)), sd:r1(spread), series:series.map(r1),
    prevAvg:prev==null?null:r1(prev), goalMin:t.min??null, goalMax:t.max??null, target:t.target??null,
    base: base ? {avg:r1(base.avg), sd:r1(base.sd), n:base.n} : null,
    trend: reg ? {slope:reg.slope, r2:reg.r2, perMonth:r1(reg.slope*keys.length)} : null,
    minDiff: minDiff(t, spread)
  };
  /* z against personal baseline: how unusual is this month for you? */
  if(base && base.sd) m.z = r1((avg - base.avg)/base.sd);
  /* steadiness: how much it bounces day to day, as a share of the average */
  if(spread!=null && avg) m.cv = r1(spread/Math.abs(avg)*100);
  /* first half vs second half of the month */
  const half = Math.floor(keys.length/2);
  const a = mean(series.slice(0,half)), b = mean(series.slice(half));
  if(a!=null && b!=null) m.shift = r1(b-a);
  /* best and worst day */
  let bi=-1, wi=-1; series.forEach((x,i)=>{ if(!isNum(x)) return;
    if(bi<0 || x>series[bi]) bi=i; if(wi<0 || x<series[wi]) wi=i; });
  const up = t.better==="up";
  if(bi>=0 && wi>=0 && bi!==wi){ m.bestDay = keys[up===false?wi:bi]; m.worstDay = keys[up===false?bi:wi]; }
  return m;
}

/* 2. Which day of the week is consistently your weak spot. */
function weekdayPattern(m, keys){
  if(m.n < 14) return null;
  const buckets = [[],[],[],[],[],[],[]];
  keys.forEach((k,i)=>{ const v = m.series[i]; if(isNum(v)) buckets[dowOf(k)].push(v); });
  const avgs = buckets.map(b=>b.length>=2 ? mean(b) : null);
  const have = avgs.filter(isNum); if(have.length < 5) return null;
  const overall = mean(have);
  let wi=-1; avgs.forEach((a,i)=>{ if(!isNum(a)) return;
    const worse = m.better==="down" ? a>overall : a<overall;
    if(!worse) return; if(wi<0 || (m.better==="down" ? a>avgs[wi] : a<avgs[wi])) wi=i; });
  if(wi<0) return null;
  const gap = Math.abs(avgs[wi]-overall);
  if(gap < m.minDiff || buckets[wi].length < 3) return null;
  return {dow:wi, avg:r1(avgs[wi]), overall:r1(overall), gap:r1(gap), n:buckets[wi].length};
}

/* 3. What your numbers looked like on days you did a thing, versus days you didn't.
      Descriptive only — this shows what went together, not what caused what. */
/* Readings taken after a night's sleep are the only ones where "the day after" is
   a sensible question. Testing every metric at both lags doubles the number of
   comparisons for no good reason, and more comparisons means more coincidences. */
const OVERNIGHT = {sleep:1, hrv:1, rhr:1, weight:1, mood:1};

function associations(metrics, keys){
  const conds = conditionsFor(keys), out = [];
  for(const c of conds){
    for(const m of metrics){
      if(m.n < 12) continue;
      if((c.skip||[]).includes(m.id)) continue;   /* never compare a tracker with itself */
      const lags = OVERNIGHT[m.id] ? [0,1] : [0];
      for(const lag of lags){
        const yes=[], no=[];
        for(let i=0;i<keys.length;i++){
          const f = c.flags[i], j = i+lag;
          if(f==null || j>=keys.length) continue;
          const v = m.series[j]; if(!isNum(v)) continue;
          (f?yes:no).push(v);
        }
        if(yes.length<8 || no.length<8) continue;
        const diff = mean(yes)-mean(no), d = cohenD(yes,no);
        if(d==null || Math.abs(d) < 0.5) continue;
        if(Math.abs(diff) < m.minDiff) continue;
        /* A medium effect on its own is not enough: across all the pairs we try,
           some would separate this well by chance. Scale the effect by how many days
           sit behind it and insist on a clear gap. */
        const t = Math.abs(d) * Math.sqrt(yes.length*no.length/(yes.length+no.length));
        if(t < 3.0) continue;
        out.push({cond:c.label, condKind:c.kind, yesLabel:c.yesLabel, noLabel:c.noLabel,
          metric:m.name, metricId:m.id, unit:m.unit, kind:m.kind, lag,
          yes:r1(mean(yes)), no:r1(mean(no)), diff:r1(diff), d:r1(d),
          nYes:yes.length, nNo:no.length,
          /* only "higher is better" or "lower is better" metrics have a good direction;
             for a target range, more is not automatically better */
          good: (m.better==="up" || m.better==="down") ? (diff>0)===(m.better==="up") : null});
      }
    }
  }
  out.sort((a,b)=>Math.abs(b.d)-Math.abs(a.d));
  /* Keep each metric's strongest finding only — never let a weaker pairing for the
     same metric take its place. */
  const best = {}; for(const a of out) if(!best[a.metricId]) best[a.metricId] = a;
  const top = Object.values(best).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d));

  /* If one habit is the common thread behind several measures, that is the finding.
     Report it once with everything it touches, rather than as near-identical bullets. */
  const byCond = {};
  for(const a of top){ (byCond[a.cond] = byCond[a.cond] || []).push(a); }
  let keystone = null;
  for(const c in byCond) if(byCond[c].length >= 3 && (!keystone || byCond[c].length > keystone.metrics.length))
    keystone = {cond:c, kind:byCond[c][0].condKind, yesLabel:byCond[c][0].yesLabel, noLabel:byCond[c][0].noLabel,
                nYes:byCond[c][0].nYes, nNo:byCond[c][0].nNo, metrics:byCond[c]};

  const rest = top.filter(a=>!keystone || a.cond !== keystone.cond).slice(0, keystone ? 2 : 5);
  rest.keystone = keystone;
  return rest;
}

/* 4. Two numbers that moved together all month. */
function pairings(metrics, keys){
  const out = [];
  for(let i=0;i<metrics.length;i++) for(let j=i+1;j<metrics.length;j++){
    const a = metrics[i], b = metrics[j];
    if(a.n<12 || b.n<12) continue;
    const p = pearson(a.series, b.series);
    if(!p || Math.abs(p.r) < 0.5) continue;
    out.push({a:a.name, b:b.name, r:r1(p.r), n:p.n, dir:p.r>0?"together":"opposite"});
  }
  return out.sort((x,y)=>Math.abs(y.r)-Math.abs(x.r)).slice(0,2);
}

/* 5. Sleep debt against your own goal. */
function sleepDebt(m, t){
  if(!m || m.id!=="sleep" || m.n<10) return null;
  const goal = (t && t.min) || 7;
  let debt = 0, short = 0;
  for(const v of m.series){ if(!isNum(v)) continue; const d = goal-v; if(d>0){ debt += d; short++; } }
  if(debt < 3) return null;
  return {hours:r1(debt), nights:short, goal};
}

/* ================= building the report ================= */
function buildInsights(R, keys, prevKeys, monthStart){
  const M = id=>R.metrics.find(x=>x.id===id);
  const head = [], watch = [], good = [], pattern = [];

  /* --- against your own baseline --- */
  for(const m of R.metrics){
    if(!m.base || m.z==null || m.n < 8) continue;
    const delta = m.avg - m.base.avg;
    if(Math.abs(delta) < m.minDiff || Math.abs(m.z) < 0.8) continue;
    const dir = delta>0 ? "higher" : "lower";
    const isGood = m.better==null ? null : (delta>0)===(m.better==="up");
    const line = `${m.name} averaged ${fmtQ(m,m.avg)} — ${fmtQ(m,Math.abs(delta))} ${dir} than your usual ${fmtQ(m,m.base.avg)} (from ${m.base.n} earlier days).`;
    (isGood===true ? good : isGood===false ? watch : pattern).push(line);
  }

  /* --- steadiness: for sleep especially, regularity matters as much as the total --- */
  const sl = M("sleep");
  if(sl && sl.n>=12 && sl.sd!=null){
    if(sl.sd >= 1.5) watch.push(`Sleep varied a lot: typically ${fmtQ(sl,sl.avg)} but swinging ±${sl.sd} h night to night (${fmtQ(sl,sl.min)} to ${fmtQ(sl,sl.max)}). A steadier schedule is often easier to feel than a longer one.`);
    else if(sl.sd <= 0.7) good.push(`Sleep was very consistent — ${fmtQ(sl,sl.avg)} a night, rarely off by more than ${sl.sd} h.`);
  }
  const db = sleepDebt(sl, trk("sleep"));
  if(db) watch.push(`You finished the month about ${db.hours} hours short of your own ${db.goal} h target, built up over ${db.nights} shorter nights.`);

  /* --- direction of travel --- */
  for(const m of R.metrics){
    if(!m.trend || m.trend.r2 < 0.3 || m.n < 12) continue;
    const change = Math.abs(m.trend.perMonth);
    if(change < m.minDiff*1.5) continue;
    const rising = m.trend.slope > 0;
    const isGood = m.better==null ? null : rising===(m.better==="up");
    const line = `${m.name} moved steadily ${rising?"up":"down"} across the month — about ${fmtQ(m,change)} end to end, not just day-to-day noise.`;
    (isGood===true ? good : isGood===false ? watch : pattern).push(line);
  }

  /* --- momentum: did you finish stronger than you started? --- */
  if(R.routine.firstHalf!=null && R.routine.secondHalf!=null){
    const d = R.routine.secondHalf - R.routine.firstHalf;
    if(d >= 12) good.push(`You finished stronger than you started: ${R.routine.firstHalf}% of dailies done in the first half of the month, ${R.routine.secondHalf}% in the second.`);
    else if(d <= -12) watch.push(`Your routine tailed off: ${R.routine.firstHalf}% of dailies done in the first half of the month, ${R.routine.secondHalf}% in the second.`);
  }

  /* --- weekday patterns --- */
  for(const m of R.metrics){
    const w = weekdayPattern(m, keys); if(!w) continue;
    m.weekday = w;
    pattern.push(`${DOW_LONG[w.dow]}s are your weak spot for ${m.name.toLowerCase()}: ${fmtQ(m,w.avg)} on average against ${fmtQ(m,w.overall)} the rest of the week.`);
    if(pattern.length >= 4) break;
  }

  /* --- associations ---
     Deliberately computed over a longer window than the rest of the report. Thirty days
     is too few to tell a real connection from a coincidence, and what helps you sleep
     isn't a fact that changes month to month. */
  const wideKeys = [];
  for(let d = 89; d >= 0; d--) wideKeys.push(addDays(keys[keys.length-1], -d));
  const wideMetrics = S.trackers.filter(t=>t.kind!=="bp")
    .map(t=>analyseMetric(t, wideKeys, [], wideKeys[0])).filter(Boolean);
  R.linkDays = wideKeys.filter(k=>hasActivity(k)).length;
  R.links = R.linkDays >= 45 ? associations(wideMetrics, wideKeys) : [];
  R.pairs = R.linkDays >= 45 ? pairings(wideMetrics, wideKeys) : [];

  /* --- headline: the single most notable thing --- */
  R.keystone = R.links.keystone || null;
  if(R.keystone){
    const names = R.keystone.metrics.map(a=>a.metric.toLowerCase());
    const list = names.length>2 ? names.slice(0,-1).join(", ")+" and "+names[names.length-1] : names.join(" and ");
    head.push(`“${R.keystone.cond}” is the habit that ties to the most: across ${R.keystone.nYes} days you ${R.keystone.yesLabel} it against ${R.keystone.nNo} you ${R.keystone.noLabel}, your ${list} all came out different.`);
  }
  else if(R.links[0]) head.push(linkSentence(R.links[0]));
  else if(good.length) head.push(good[0]);
  else if(watch.length) head.push(watch[0]);

  R.headline = head[0] || null;
  R.watch = watch.slice(0,6);
  R.good = good.slice(0,6);
  R.pattern = pattern.slice(0,4);
  return R;
}

/* Whole numbers for anything in the thousands; nobody wants "8421.9 steps". */
function linkVal(a, v){
  const unit = a.unit && a.unit!=="/10" ? " "+a.unit : (a.unit==="/10"?"/10":"");
  const n = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : r1(v);
  return n+unit;
}
/* The condition label already reads as a verb phrase for goals ("hit your water goal"),
   but not for a task title, so each kind needs its own wording. */
function condPhrase(a, yes){
  if(a.condKind==="goal") return yes ? `you ${a.cond}` : `you didn't`;
  return yes ? `you did “${a.cond}”` : `you didn't`;
}
function linkSentence(a){
  const when  = a.lag===1 ? `the day after ${condPhrase(a,true)}`  : `on days ${condPhrase(a,true)}`;
  const other = a.lag===1 ? `the day after ${condPhrase(a,false)}` : `on days ${condPhrase(a,false)}`;
  return `${a.metric} averaged ${linkVal(a,a.yes)} ${when}, against ${linkVal(a,a.no)} ${other}.`;
}
