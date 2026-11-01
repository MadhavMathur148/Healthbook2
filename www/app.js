/* Healthbook — habits, logging and trends. Everything stays on this phone. */
"use strict";
window.HB_VERSION = "1.0 ";

/* ================= platform ================= */
const Cap = window.Capacitor;
const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
/* Diagnostics only in a desktop browser. The phone build writes nothing to the system log. */
const dlog = (...a)=>{ if(!NATIVE) try{ console.warn(...a); }catch(e){} };
function plugin(name){ if(!NATIVE) return null; try{ return Cap.registerPlugin ? Cap.registerPlugin(name) : (Cap.Plugins && Cap.Plugins[name]); }catch(e){ return (Cap.Plugins && Cap.Plugins[name]) || null; } }
const LN = plugin("LocalNotifications"), FS = plugin("Filesystem"), SHARE = plugin("Share"), HAPT = plugin("Haptics"), APP = plugin("App");
const SAVE_FILE = "healthbook.json";

/* ================= constants ================= */
const CATS = {
  move:{name:"Move", c:"var(--red)"},
  fuel:{name:"Nourish", c:"var(--green)"},
  rest:{name:"Rest", c:"var(--blue)"},
  care:{name:"Mind & Care", c:"var(--yellow)"}
};
const CAT_ORDER = ["move","fuel","rest","care"];
const COLORS = {red:"var(--red)", green:"var(--green)", blue:"var(--blue)", yellow:"var(--yellow)"};
const BLOCKS = [
  {id:"dawn", name:"Dawn", when:"Early morning", from:4, to:8},
  {id:"day", name:"Day", when:"Daytime", from:8, to:18},
  {id:"eve", name:"Evening", when:"After college", from:18, to:21.25},
  {id:"wind", name:"Wind-down", when:"Before bed", from:21.25, to:28},
  {id:"any", name:"Any time", when:"Whenever", from:0, to:0}
];
const DIFF = {1:"Easy", 2:"Medium", 3:"Hard"};
const XP_DAILY = {1:5, 2:10, 3:15}, XP_HABIT = {1:3, 2:5, 3:8}, XP_TODO = {1:8, 2:15, 3:25};
const XP_LOG = 2, XP_PERFECT = 20;
const DOW = ["M","T","W","T","F","S","S"];
const DOW_LONG = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

/* ================= helpers ================= */
const $ = s=>document.querySelector(s);
const p2 = n=>String(n).padStart(2,"0");
const dkey = d=>d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate());
const kdate = k=>new Date(k+"T12:00:00");
function addDays(k,n){ const d = kdate(k); d.setDate(d.getDate()+n); return dkey(d); }
const dowOf = k=>(kdate(k).getDay()+6)%7;
const esc = s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const uid = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fmtD = (k,o)=>kdate(k).toLocaleDateString("en-IN",o||{day:"numeric",month:"short"});
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
function TODAY(){ const ds = (S && S.settings && S.settings.dayStart) || 0; return dkey(new Date(Date.now()-ds*3600e3)); }
function nowHour(){ const n = new Date(); let h = n.getHours()+n.getMinutes()/60; const ds = S.settings.dayStart||0; if(h<ds) h+=24; return h; }
function weekStart(k){ return addDays(k, -dowOf(k)); }
const num = v=>v===""||v==null||Number.isNaN(Number(v)) ? null : Number(v);

/* ================= default data ================= */
function defaultTrackers(){
  return [
    {id:"mood", name:"Mood", unit:"/10", kind:"scale", color:"green", better:"up", lo:"Low", hi:"Great", quick:true},
    {id:"stress", name:"Stress", unit:"/10", kind:"scale", color:"red", better:"down", lo:"Calm", hi:"Overwhelmed", quick:true},
    {id:"sleep", name:"Sleep", unit:"hr", kind:"hours", color:"blue", step:0.5, min:7, max:9, better:"range", quick:true, note:"From your ring or watch, or your best guess."},
    {id:"water", name:"Water", unit:"glasses", kind:"count", color:"yellow", target:8, better:"up", note:"250 ml glasses", quick:true},
    {id:"steps", name:"Steps", unit:"steps", kind:"number", color:"red", min:7000, better:"up", decimals:0, quick:true},
    {id:"rhr", name:"Resting heart rate", unit:"bpm", kind:"number", color:"red", better:"down", decimals:0, quick:false, note:"From your ring or watch."},
    {id:"hrv", name:"HRV", unit:"ms", kind:"number", color:"blue", better:"up", decimals:0, quick:false, note:"From your ring or watch. Compare with your own average, not other people's."},
    {id:"weight", name:"Weight", unit:"kg", kind:"number", color:"green", decimals:1, better:null, quick:false}
  ];
}
/* The starter plan is written in the same plain-text rules format anyone can import. */
const STARTER_RULES = `# Healthy basics
Dailies:
- No phone for the first 30 minutes — Water, light, get moving first. (morning, rest)
- Move for 20 minutes or more — A walk counts. (morning, move, medium)
- Sunscreen (morning, care)
- Protein with breakfast (morning, nourish)
- 7,000+ steps (day, move, medium, when steps >= 7000)
- Stand up at least once an hour (day, move)
- Vegetables with lunch (day, nourish)
- 8 glasses of water (day, nourish, when water >= 8)
- No caffeine after 2 pm (day, rest)
- Log mood and stress (evening, care, when mood is logged, when stress is logged)
- Time with people — Phones away. (evening, care)
- Screens off an hour before bed (night, rest, medium)
- Brush and floss (night, care)
- Read for 10 minutes (night, rest)
- Lights out on time — Same wake time every day. (night, rest, medium)
- Weigh-in (morning, move, sun, when weight is logged)
- Look at the week in Trends (evening, care, sun)
Habits:
- Workout (move, hard, 3 a week)
- Cardio, 30 minutes (move, medium, 3 a week)
- Hobby time (care, medium, 2 a week)
- Junk food (nourish, slip)
To-dos:
- Book a yearly checkup (care, hard, important)
- Book a dental cleaning (care, medium)
- Export a backup of Healthbook from the Me tab (care)
Rewards:
- An episode of a show (40)
- An hour of gaming (60)
- Meal out with friends (150)
- Something you've been wanting (600)
`;
function seed(){
  const today = TODAY_RAW();
  return {v:2, profile:{name:""}, settings:{dayStart:3, sound:true, haptics:true, reminders:false, logReminder:"21:00", theme:"system"},
    tasks:[], trackers:defaultTrackers(), rewards:[], purchases:[], hist:{}, created:today, onboarded:false};
}
function TODAY_RAW(){ return dkey(new Date(Date.now()-3*3600e3)); }

/* ================= state & persistence ================= */
let S = null;
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const isHHMM = v=>typeof v==="string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function cleanTask(t){
  if(!t || typeof t!=="object" || !["daily","habit","todo"].includes(t.type)) return null;
  if(!SAFE_ID.test(String(t.id||""))) t.id = uid();
  t.title = String(t.title||"").slice(0,120).trim(); if(!t.title) return null;
  t.notes = String(t.notes||"").slice(0,400);
  if(!CATS[t.cat]) t.cat = "care";
  t.diff = [1,2,3].includes(Number(t.diff)) ? Number(t.diff) : 1;
  if(typeof t.created!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.created)) t.created = TODAY_RAW();
  if(t.type!=="habit"){ t.checklist = (Array.isArray(t.checklist)?t.checklist:[]).filter(c=>c && c.text).map(c=>({id:SAFE_ID.test(String(c.id||""))?c.id:uid(), text:String(c.text).slice(0,120), done:!!c.done})); }
  if(t.type==="daily"){
    const days = (Array.isArray(t.days)?t.days:[]).map(Number).filter(d=>Number.isInteger(d) && d>=0 && d<=6);
    t.days = days.length ? [...new Set(days)].sort() : [0,1,2,3,4,5,6];
    if(!BLOCKS.some(b=>b.id===t.block)) t.block = "any";
    t.remind = isHHMM(t.remind) ? t.remind : null;
    t.auto = Array.isArray(t.auto) ? t.auto.filter(c=>c && SAFE_ID.test(String(c.t||"")) && ["set","gte","lte"].includes(c.op)).map(c=>({t:c.t, op:c.op, v:c.op==="set"?null:Number(c.v)})).filter(c=>c.op==="set"||Number.isFinite(c.v)) : null;
    if(t.auto && !t.auto.length) t.auto = null;
  }
  if(t.type==="habit"){ if(!["good","bad","both"].includes(t.kind)) t.kind = "good"; t.period = t.period==="day" ? "day" : "week"; const n = Number(t.target); t.target = Number.isFinite(n) && n>0 ? Math.round(n) : null; }
  if(t.type==="todo"){ t.done = !!t.done; t.star = !!t.star; t.due = typeof t.due==="string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : null; }
  return t;
}
function cleanTracker(t){
  if(!t || typeof t!=="object" || !t.name) return null;
  if(!["number","count","hours","scale"].includes(t.kind)) return null;
  if(!SAFE_ID.test(String(t.id||""))) t.id = slug(String(t.name)) || uid();
  t.name = String(t.name).slice(0,40); t.unit = String(t.unit||"").slice(0,16);
  if(!COLORS[t.color]) t.color = "blue";
  if(!["up","down","range",null].includes(t.better??null)) t.better = null;
  for(const f of ["min","max","target","step","decimals"]){ if(t[f]!=null){ const n = Number(t[f]); t[f] = Number.isFinite(n) ? n : null; } }
  t.quick = !!t.quick;
  return t;
}
function migrate(s){
  s.settings = Object.assign({dayStart:3, sound:true, haptics:true, reminders:false, logReminder:"21:00", theme:"system"}, s.settings||{});
  s.profile = s.profile||{name:""};
  s.trackers = (s.trackers||[]).filter(t=>t.kind!=="bp"); if(s.onboarded===undefined) s.onboarded = (s.tasks||[]).length>0; s.tasks = s.tasks||[]; s.trackers = s.trackers||[]; s.rewards = s.rewards||[]; s.purchases = s.purchases||[]; s.hist = s.hist||{}; s.reports = s.reports||{};
  s.tasks = s.tasks.map(cleanTask).filter(Boolean);
  const seenT = new Set(); s.trackers = s.trackers.map(cleanTracker).filter(t=>t && !seenT.has(t.id) && seenT.add(t.id));
  s.rewards = s.rewards.filter(r=>r && r.title).map(r=>({id:SAFE_ID.test(String(r.id||""))?r.id:uid(), title:String(r.title).slice(0,80), cost:Math.max(1,Math.round(Number(r.cost)||50))}));
  s.removed = s.removed && typeof s.removed==="object" ? s.removed : {};
  if(s.settings.logReminder!=null && !isHHMM(s.settings.logReminder)) s.settings.logReminder = null;
  s.experiments = window.cleanExperiments ? cleanExperiments(s.experiments) : (Array.isArray(s.experiments) ? s.experiments : []);
  return s;
}
function loadLocal(){ try{ const raw = localStorage.getItem("healthbook-app"); return raw ? JSON.parse(raw) : null; }catch(e){ return null; } }
let fsTimer = null;
function save(){
  S.updatedAt = Date.now();
  if(window.cloudQueue) cloudQueue();
  try{ localStorage.setItem("healthbook-app", JSON.stringify(S)); }catch(e){}
  if(FS){ clearTimeout(fsTimer); fsTimer = setTimeout(()=>{ FS.writeFile({path:SAVE_FILE, data:JSON.stringify(S), directory:"DATA", encoding:"utf8"}).catch(()=>{}); }, 800); }
}
async function loadFile(){ if(!FS) return null; try{ const r = await FS.readFile({path:SAVE_FILE, directory:"DATA", encoding:"utf8"}); return JSON.parse(r.data); }catch(e){ return null; } }
const day = k=>{ const d = S.hist[k] || (S.hist[k] = {}); d._t = Date.now(); return d; };
const sub = (k,f)=>{ const d = day(k); return d[f] || (d[f] = {}); };
function tidy(k){ const d = S.hist[k]; if(!d) return; for(const f of Object.keys(d)) if(d[f] && typeof d[f]==="object" && !Object.keys(d[f]).length) delete d[f]; }
const hasActivity = k=>{ const d = S.hist[k]; return !!(d && (d.l || d.d || d.h)); };

/* ================= XP / levels ================= */
function totals(){
  let xp = 0, coins = 0;
  for(const k in S.hist){ const x = S.hist[k].x; if(!x) continue; for(const id in x){ xp += x[id]; coins += Math.ceil(x[id]/2); } }
  for(const p of S.purchases) coins -= p.cost;
  return {xp, coins};
}
function levelOf(xp){ let lvl = 1, need = 100, rem = xp; while(rem >= need){ rem -= need; lvl++; need = 100 + (lvl-1)*25; } return {lvl, into:rem, need}; }
function revoke(k, key){ const x = day(k).x; if(x){ delete x[key]; } tidy(k); }
let pendingLevel = null;
function afterXp(before, amount){
  const now = levelOf(totals().xp).lvl;
  if(amount) toast(`+${amount} XP  ·  +${Math.ceil(amount/2)} coins`);
  if(now > before) pendingLevel = now;
}

/* ================= task logic ================= */
const dailies = ()=>S.tasks.filter(t=>t.type==="daily" && !t.archived);
const habits = ()=>S.tasks.filter(t=>t.type==="habit" && !t.archived);
const todos = ()=>S.tasks.filter(t=>t.type==="todo" && !t.archived);
/* On an easy day only Easy dailies are due; the rest pause, so their streaks wait instead of breaking. */
const isDue = (t,k)=>t.days.includes(dowOf(k)) && k >= (t.created||"2000-01-01") && !((t.diff||1)>1 && S.hist[k] && S.hist[k].easy);
const isDone = (t,k)=>!!(S.hist[k] && S.hist[k].d && S.hist[k].d[t.id]);
function streakOf(t, k){
  k = k || TODAY(); let s = 0, cur = isDone(t,k) ? k : addDays(k,-1);
  for(let i=0;i<500;i++){ if(cur < (t.created||"2000-01-01")) break; if(isDue(t,cur)){ if(isDone(t,cur)) s++; else break; } cur = addDays(cur,-1); }
  return s;
}
function bestStreak(t){
  let best = 0, run = 0, k = t.created && t.created > addDays(TODAY(),-500) ? t.created : addDays(TODAY(),-500);
  const end = TODAY();
  while(k <= end){ if(isDue(t,k)){ if(isDone(t,k)){ run++; best = Math.max(best,run); } else if(k!==end) run = 0; } k = addDays(k,1); }
  return best;
}
function rateOf(t, n){ let due = 0, done = 0; for(let i=0;i<n;i++){ const k = addDays(TODAY(),-i); if(k===TODAY() && !isDone(t,k)) continue; if(isDue(t,k)){ due++; if(isDone(t,k)) done++; } } return due ? done/due : null; }
function setDaily(t, k, on, auto){
  const d = sub(k,"d"), was = !!d[t.id];
  if(on === was) return;
  const before = levelOf(totals().xp).lvl;
  if(on){ d[t.id] = true; if(auto) sub(k,"a")[t.id] = true; else if(S.hist[k].m) delete S.hist[k].m[t.id];
    const st = streakOf(t,k), amt = XP_DAILY[t.diff||1] + Math.min(5, Math.floor(st/7));
    sub(k,"x")["d:"+t.id] = amt; afterXp(before, amt);
  } else { delete d[t.id]; if(S.hist[k].a && S.hist[k].a[t.id]){ delete S.hist[k].a[t.id]; if(!auto) sub(k,"m")[t.id] = true; } revoke(k,"d:"+t.id); }
  checkPerfect(k); tidy(k); save();
  if(t.remind && k===TODAY()) queueReminders();
}
function dueToday(k){ return dailies().filter(t=>isDue(t,k)); }
function checkPerfect(k){
  const due = dueToday(k); if(!due.length) return;
  const all = due.every(t=>isDone(t,k)), has = !!(S.hist[k] && S.hist[k].x && S.hist[k].x.perfect);
  if(all && !has){ const before = levelOf(totals().xp).lvl; sub(k,"x").perfect = XP_PERFECT; afterXp(before, 0); toast(`Perfect day · +${XP_PERFECT} XP`); }
  if(!all && has){ revoke(k,"perfect"); }
}
function habitCount(t, k, dir){ const h = S.hist[k] && S.hist[k].h && S.hist[k].h[t.id]; return h ? (h[dir]||0) : 0; }
function habitPeriodCount(t, k){
  if(t.period==="week"){ const ws = weekStart(k); let n = 0; for(let i=0;i<7;i++){ const kk = addDays(ws,i); if(kk>k) break; n += habitCount(t,kk,"u"); } return n; }
  return habitCount(t,k,"u");
}
function tapHabit(t, k, dir, delta){
  const h = sub(k,"h"), rec = h[t.id] || (h[t.id] = {u:0,n:0});
  const before = levelOf(totals().xp).lvl;
  rec[dir] = Math.max(0,(rec[dir]||0)+delta);
  if(dir==="u"){ const x = sub(k,"x"), key = "h:"+t.id, per = XP_HABIT[t.diff||1];
    if(delta>0){ x[key] = (x[key]||0)+per; afterXp(before, per); }
    else { x[key] = Math.max(0,(x[key]||0)-per); if(!x[key]) delete x[key]; } }
  if(!rec.u && !rec.n) delete h[t.id];
  tidy(k); save();
}
function setTodo(t, on){
  const before = levelOf(totals().xp).lvl;
  if(on){ t.done = true; t.doneDay = TODAY(); const amt = XP_TODO[t.diff||1]; sub(t.doneDay,"x")["t:"+t.id] = amt; afterXp(before, amt); }
  else { if(t.doneDay) revoke(t.doneDay,"t:"+t.id); t.done = false; t.doneDay = null; }
  save();
}
function clDone(k, tid, cid){ return !!(S.hist[k] && S.hist[k].c && S.hist[k].c[tid] && S.hist[k].c[tid][cid]); }

/* ================= trackers ================= */
const trk = id=>S.trackers.find(t=>t.id===id);
const logVal = (k,id)=>S.hist[k] && S.hist[k].l ? S.hist[k].l[id] : undefined;
function setLogVal(k, id, v, src){
  const l = sub(k,"l"), had = l[id]!==undefined && l[id]!==null;
  if(src==="hc") sub(k,"src")[id] = "hc"; else if(S.hist[k].src) delete S.hist[k].src[id];
  if(v===null || v===undefined || v==="" || (typeof v==="number" && Number.isNaN(v))) delete l[id]; else l[id] = v;
  const has = l[id]!==undefined;
  const before = levelOf(totals().xp).lvl;
  if(has && !had && src!=="hc"){ sub(k,"x")["l:"+id] = XP_LOG; afterXp(before, 0); }
  if(!has && had) revoke(k,"l:"+id);
  evalAuto(k); tidy(k); save();
  if(k===TODAY() && (id==="mood" || id==="stress")) queueReminders();
}
function condOK(k, c){ const v = logVal(k,c.t); if(c.op==="set") return v!==undefined && v!==null; if(v==null || typeof v==="object") return false; return c.op==="gte" ? v>=c.v : c.op==="lte" ? v<=c.v : false; }
function evalAuto(k){
  for(const t of dailies()){ if(!t.auto || !t.auto.length || !isDue(t,k)) continue;
    if(S.hist[k] && S.hist[k].m && S.hist[k].m[t.id]) continue;
    const ok = t.auto.every(c=>condOK(k,c)), done = isDone(t,k), wasAuto = !!(S.hist[k] && S.hist[k].a && S.hist[k].a[t.id]);
    if(ok && !done) setDaily(t,k,true,true); else if(!ok && done && wasAuto) setDaily(t,k,false); }
}
function fmtVal(t, v){
  if(v==null) return "–";
  if(t.kind==="number") return Number(v).toLocaleString("en-IN",{maximumFractionDigits:t.decimals==null?1:t.decimals});
  return String(Math.round(v*10)/10);
}

/* ================= feedback ================= */
let actx = null;
function tone(f, dur, vol){ if(!S.settings.sound) return; try{ actx = actx || new (window.AudioContext||window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0,actx.currentTime); g.gain.linearRampToValueAtTime(vol,actx.currentTime+.015); g.gain.exponentialRampToValueAtTime(.0001,actx.currentTime+dur); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime+dur+.05); }catch(e){} }
const ding = ()=>{ tone(880,.25,.06); setTimeout(()=>tone(1320,.3,.05),70); };
const chime = ()=>{ tone(659,1.4,.1); setTimeout(()=>tone(988,1.6,.07),180); };
function tick(){ if(!S.settings.haptics) return; try{ HAPT ? HAPT.impact({style:"LIGHT"}) : (navigator.vibrate && navigator.vibrate(10)); }catch(e){} }
function buzz(){ if(!S.settings.haptics) return; try{ HAPT ? HAPT.notification({type:"SUCCESS"}) : (navigator.vibrate && navigator.vibrate([40,60,40])); }catch(e){} }
let toastEl = null;
function toast(msg){ if(toastEl) toastEl.remove(); toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.textContent = msg; document.body.appendChild(toastEl); const me = toastEl; setTimeout(()=>{ if(me===toastEl){ me.remove(); toastEl = null; } }, 2300); }
function showLevelUp(){
  if(!pendingLevel) return; const lvl = pendingLevel; pendingLevel = null; buzz(); chime();
  const el = document.createElement("div"); el.className = "lvlup";
  el.innerHTML = `<canvas></canvas><div class="lvlcard"><span class="plvl">Level up</span><span class="n">${lvl}</span><p>Consistency is paying off. Keep showing up.</p><button class="btn" style="margin-top:8px">Nice</button></div>`;
  document.body.appendChild(el);
  const cv = el.querySelector("canvas"), g = cv.getContext("2d"), dpr = Math.min(2,devicePixelRatio||1);
  cv.width = innerWidth*dpr; cv.height = innerHeight*dpr; g.scale(dpr,dpr);
  const cs = getComputedStyle(document.documentElement), cols = ["--blue","--red","--yellow","--green"].map(v=>cs.getPropertyValue(v).trim());
  const P = Array.from({length:140},()=>({x:innerWidth/2, y:innerHeight/2, vx:(Math.random()-.5)*14, vy:-Math.random()*14-4, r:Math.random()*6+3, c:cols[Math.floor(Math.random()*4)], a:Math.random()*6, s:(Math.random()-.5)*.3}));
  let alive = true, t0 = performance.now();
  const loop = ()=>{ if(!alive) return; g.clearRect(0,0,innerWidth,innerHeight); for(const p of P){ p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.s; g.save(); g.translate(p.x,p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r/2,-p.r/4,p.r,p.r/2); g.restore(); } if(performance.now()-t0 < 3500) requestAnimationFrame(loop); };
  if(!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(loop);
  const close = ()=>{ alive = false; el.remove(); };
  el.addEventListener("click", e=>{ if(e.target===el || e.target.closest("button")) close(); });
}

/* ================= icons ================= */
const ICON = {
  move:`<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10h3l2-5 4 9 2-4h3"/></svg>`,
  fuel:`<svg viewBox="0 0 18 18" fill="#fff"><path d="M14.5 3C9 3 4 6 4 11.5c0 1 .2 1.8.5 2.5l-1.5 1.5 1 1L5.5 15c.8.4 1.7.5 2.5.5C13.5 15.5 15 9 14.5 3z"/></svg>`,
  rest:`<svg viewBox="0 0 18 18" fill="#fff"><path d="M14.5 11.5A6.5 6.5 0 0 1 6.5 3.5a6.5 6.5 0 1 0 8 8z"/></svg>`,
  care:`<svg viewBox="0 0 18 18" fill="#fff"><path d="M9 15.5S2.5 11.5 2.5 7A3.3 3.3 0 0 1 9 5.2 3.3 3.3 0 0 1 15.5 7c0 4.5-6.5 8.5-6.5 8.5z"/></svg>`,
  done:`<svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5l3 3 7-7"/></svg>`,
  flame:`<svg viewBox="0 0 12 12" fill="currentColor"><path d="M6 .5C6.5 3 9.5 4 9.5 7.5a3.5 3.5 0 0 1-7 0C2.5 6 3.3 5 4 4.5c0 1.2.6 2 1.3 2C5 4.5 5.2 2.3 6 .5z"/></svg>`,
  plus:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`
};

/* ================= view: Today ================= */
let view = "today", logDay = null, trendRange = 30, taskSeg = "daily";
function header(title, sub, right){
  return `<div class="title"><span class="date">${esc(sub)}</span><div class="title-row"><h1>${esc(title)}</h1>${right||""}</div></div>`;
}
function ringsSVG(k){
  const R = {move:61,fuel:46,rest:31,care:16}; let s = `<svg class="rings" viewBox="0 0 150 150" role="img" aria-label="Today's dailies by category">`;
  const due = dueToday(k);
  for(const c of CAT_ORDER){ const r = R[c], C = 2*Math.PI*r, list = due.filter(t=>t.cat===c), p = list.length ? list.filter(t=>isDone(t,k)).length/list.length : 0;
    s += `<circle class="tr" cx="75" cy="75" r="${r}" stroke="${CATS[c].c}"/><circle class="ar" cx="75" cy="75" r="${r}" stroke="${CATS[c].c}" style="color:${CATS[c].c}" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-p)}" transform="rotate(-90 75 75)" stroke-opacity="${p?1:0}"/>`; }
  return s+`</svg>`;
}
function liveBlock(){ const h = nowHour(); return BLOCKS.find(b=>b.id!=="any" && h>=b.from && h<b.to) || BLOCKS[0]; }
function nextUp(k){
  const due = dueToday(k).filter(t=>!isDone(t,k)); if(!due.length) return null;
  const order = BLOCKS.filter(b=>b.id!=="any"), L = order.indexOf(liveBlock());
  for(const b of order.slice(L).concat(order.slice(0,L)).concat([BLOCKS[4]])){ const t = due.find(x=>x.block===b.id); if(t) return t; }
  return due[0];
}
function dailyRow(t, k){
  const done = isDone(t,k), st = streakOf(t,k), cl = t.checklist||[], cld = cl.filter(c=>clDone(k,t.id,c.id)).length;
  const meta = [];
  if(st>=2) meta.push(`<span class="st">${ICON.flame}${st}</span>`);
  if(cl.length) meta.push(`${cld}/${cl.length}`);
  if(t.remind) meta.push(`⏰ ${t.remind}`);
  if(t.auto && t.auto.length) meta.push("auto");
  return `<li class="row${done?" done":""}" style="--c:${CATS[t.cat].c}"><input type="checkbox" class="cb" data-daily="${t.id}" ${done?"checked":""} aria-label="${esc(t.title)}"><div data-open="${t.id}" style="cursor:pointer;min-width:0"><span class="rt">${esc(t.title)}</span>${meta.length?`<div class="rs">${meta.join("")}</div>`:""}</div><span class="xpgain">${done?"":"+"+XP_DAILY[t.diff||1]}</span></li>`;
}
function habitRow(t, k){
  const c = habitPeriodCount(t,k), neg = habitCount(t,k,"n"), tgt = t.target, p = tgt ? Math.min(1,c/tgt) : 0;
  const right = [];
  if(t.kind!=="bad") right.push(`<span class="hcount">${c}${tgt?`<small>/${tgt}</small>`:""}</span>`);
  if(t.kind==="bad") right.push(`<span class="hcount">${neg}</span>`);
  if(t.kind!=="good") right.push(`<button class="hb neg" data-habit="${t.id}" data-dir="n" aria-label="Log a slip: ${esc(t.title)}">−</button>`);
  if(t.kind!=="bad") right.push(`<button class="hb" data-habit="${t.id}" data-dir="u" aria-label="Add one: ${esc(t.title)}">+</button>`);
  return `<li class="row" style="--c:${CATS[t.cat].c};grid-template-columns:10px minmax(0,1fr) auto"><span class="dot"></span><div data-open="${t.id}" style="cursor:pointer;min-width:0"><span class="rt">${esc(t.title)}</span><div class="rs">${t.kind==="bad"?"Today":t.period==="week"?"This week":"Today"}${tgt?` · goal ${tgt}`:""}</div></div><div class="hbtns">${right.join("")}</div>${tgt&&t.kind!=="bad"?`<div class="mini"><i style="width:${p*100}%"></i></div>`:""}</li>`;
}
function todoRow(t){
  const over = t.due && t.due < TODAY() && !t.done;
  return `<li class="row${t.done?" done":""}" style="--c:${CATS[t.cat].c}"><input type="checkbox" class="cb sq" data-todo="${t.id}" ${t.done?"checked":""} aria-label="${esc(t.title)}"><div data-open="${t.id}" style="cursor:pointer;min-width:0"><span class="rt">${esc(t.title)}</span>${t.star||t.due||(t.checklist||[]).length?`<div class="rs">${t.star?`<span class="pill">Start here</span>`:""}${t.due?`<span class="${over?"bad":""}">${over?"Overdue · ":"Due "}${fmtD(t.due)}</span>`:""}</div>`:""}</div><span class="xpgain">${t.done?"":"+"+XP_TODO[t.diff||1]}</span></li>`;
}
function quickChips(k){
  return `<div class="chips">${S.trackers.filter(t=>t.quick).map(t=>{ const v = logVal(k,t.id); return `<button class="chip${v==null?" empty":""}" style="--c:${COLORS[t.color]}" data-quick="${t.id}"><b>${esc(t.name)}</b><span>${fmtVal(t,v)}${v!=null&&t.kind!=="bp"?`<small> ${esc(t.kind==="scale"?"/10":t.kind==="count"&&t.target?"/"+t.target:t.unit)}</small>`:""}</span></button>`; }).join("")}</div>`;
}
function vToday(){
  const k = TODAY(), tot = totals(), L = levelOf(tot.xp), due = dueToday(k), done = due.filter(t=>isDone(t,k)).length, nu = nextUp(k);
  let h = header("Today", kdate(k).toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"}));
  h += `<div class="card prof"><div class="ava"><span>${L.lvl}</span></div><div style="min-width:0"><div class="pname">${esc(S.profile.name||"You")}</div><div class="plvl">Level ${L.lvl} · ${L.into} / ${L.need} XP</div><div class="xpbar"><i style="width:${L.into/L.need*100}%"></i></div></div><button class="coins" data-go="me" style="border:0;background:none;cursor:pointer" aria-label="${tot.coins} coins, open rewards"><i></i>${tot.coins}</button></div>`;
  if(window.todayLabHTML) h += todayLabHTML(k);
  h += `<div class="card"><div class="summary">${ringsSVG(k)}<div class="rlist">`;
  for(const c of CAT_ORDER){ const list = due.filter(t=>t.cat===c); h += `<div class="rrow"><span class="nm"><i style="background:${CATS[c].c};--c:${CATS[c].c}"></i>${CATS[c].name}</span><span class="v" style="color:${CATS[c].c}">${list.filter(t=>isDone(t,k)).length}<small>/${list.length}</small></span></div>`; }
  h += `</div></div><div class="upnext">${nu?`<span class="ic" style="background:${CATS[nu.cat].c};--c:${CATS[nu.cat].c}">${ICON[nu.cat]}</span><div style="flex:1;min-width:0"><div class="lbl">Up next</div><div class="tx">${esc(nu.title)}</div></div><input type="checkbox" class="cb" style="--c:${CATS[nu.cat].c}" data-daily="${nu.id}" aria-label="Done: ${esc(nu.title)}">`:`<span class="ic" style="background:var(--green);--c:var(--green)">${ICON.done}</span><div><div class="lbl">Today</div><div class="tx">${due.length?"Every daily done. Rest.":"Nothing scheduled today."}</div></div>`}</div></div>`;
  if(due.length && done===due.length) h += `<div class="perfect">${ICON.done.replace('stroke="#fff"','stroke="var(--green)"').replace("<svg ",'<svg width="22" height="22" ')}Perfect day. Every daily done.</div>`;
  h += `<div class="group"><div class="gh"><h2>Log</h2><button class="meta" data-go="log">All</button></div>${quickChips(k)}</div>`;
  const live = liveBlock();
  for(const b of BLOCKS){ const list = due.filter(t=>t.block===b.id); if(!list.length) continue;
    const dn = list.filter(t=>isDone(t,k)).length;
    h += `<div class="group"><div class="cap">${b.name} · ${dn}/${list.length}${b===live?`<span class="now">Now</span>`:""}</div><ul class="list">${list.map(t=>dailyRow(t,k)).join("")}</ul></div>`; }
  const hs = habits();
  if(hs.length) h += `<div class="group"><div class="cap">Habits</div><ul class="list">${hs.map(t=>habitRow(t,k)).join("")}</ul></div>`;
  const td = todos().filter(t=>!t.done || t.doneDay===k).sort((a,b)=>(b.star-a.star)||((a.due||"9")<(b.due||"9")?-1:1));
  if(td.length) h += `<div class="group"><div class="cap">To-dos</div><ul class="list">${td.slice(0,8).map(todoRow).join("")}</ul>${td.length>8?`<p class="foot">${td.length-8} more in Tasks.</p>`:""}</div>`;
  if(!due.length && !hs.length && !td.length && !dailies().length) h += `<div class="card empty">No tasks yet. Add your first in the Tasks tab.</div>`;
  if(window.easyFootHTML) h += easyFootHTML(k);
  return h;
}

/* ================= view: Log ================= */
function scaleHTML(t, v){
  let s = `<div class="scale" style="--c:${COLORS[t.color]}">`;
  for(let i=1;i<=10;i++) s += `<button class="${v===i?"on":""}" data-scale="${t.id}" data-v="${i}" aria-pressed="${v===i}">${i}</button>`;
  return s+`</div><div class="scale-ends"><span>${esc(t.lo||"Low")}</span><span>${esc(t.hi||"High")}</span></div>`;
}
function dropSVG(on, c){ return `<svg viewBox="0 0 18 24"><path d="M9 1.5C9 1.5 2 9.5 2 15a7 7 0 0 0 14 0C16 9.5 9 1.5 9 1.5z" fill="${on?c:"var(--fill)"}" stroke="${on?c:"var(--grey)"}" stroke-width="1.2"/></svg>`; }
function goalNote(t, v){
  if(v==null || typeof v==="object") return "";
  if(t.kind==="hours" || t.better==="range"){ const rng = t.min!=null && t.max!=null ? `${t.min}–${t.max}` : t.min!=null ? `${t.min}+` : t.max!=null ? `up to ${t.max}` : null;
    if(t.min!=null && v<t.min) return `<span class="warn">Under ${t.min}.</span> Your range is ${rng}.`; if(t.max!=null && v>t.max) return `Over ${t.max}.`; if(rng) return `<span class="ok">In your ${rng} range.</span>`; }
  if(t.target && v>=t.target) return `<span class="ok">Target hit.</span>`;
  if(t.min!=null && t.kind==="number" && t.better==="up") return v>=t.min ? `<span class="ok">Goal hit.</span>` : `${(Math.round((t.min-v)*10)/10).toLocaleString("en-IN")} to go.`;
  if(t.max!=null && (t.kind==="number" || t.kind==="count") && v>t.max) return `<span class="warn">Over your limit of ${t.max}.</span>`;
  return "";
}
function trackerCard(t, k){
  const v = logVal(k,t.id), c = COLORS[t.color];
  let h = `<div class="card field" style="--c:${c}" id="tr-${t.id}"><div class="fl"><b><i></i>${esc(t.name)}</b><span>${fmtVal(t,v)}${v!=null&&t.kind!=="bp"?`<small> ${esc(t.kind==="scale"?"/10":t.kind==="count"&&t.target?"/ "+t.target:t.unit)}</small>`:""}</span></div>`;
  if(t.kind==="scale") h += scaleHTML(t,v);
  else if(t.kind==="hours") h += `<div class="stepper"><button data-step="${t.id}" data-d="-1" aria-label="Less">−</button><span class="sv">${v!=null?v:"–"}<small> ${esc(t.unit)}</small></span><button data-step="${t.id}" data-d="1" aria-label="More">+</button></div>`;
  else if(t.kind==="count"){ const n = v||0, tgt = t.target||8;
    h += tgt<=16 ? `<div class="drops">${Array.from({length:tgt},(_,i)=>`<button data-drop="${t.id}" data-n="${i+1}" aria-label="${i+1}">${dropSVG(i<n,c)}</button>`).join("")}</div>`
                 : `<div class="stepper"><button data-step="${t.id}" data-d="-1">−</button><span class="sv">${n}</span><button data-step="${t.id}" data-d="1">+</button></div>`; }
  else if(t.kind==="number") h += `<label class="inp"><input type="number" inputmode="decimal" step="any" data-num="${t.id}" value="${v??""}" placeholder="${esc(lastValue(t.id,k)??"Enter")}"><span>${esc(t.unit)}</span></label>`;
  if(v!=null && S.hist[k] && S.hist[k].src && S.hist[k].src[t.id]==="hc") h += `<p class="hint">Synced · edit to change</p>`;
  const note = goalNote(t,v); if(note && t.kind!=="bp") h += `<p class="hint">${note}</p>`; else if(t.note && t.kind!=="bp") h += `<p class="hint">${esc(t.note)}</p>`;
  if(v!=null && t.kind!=="bp" && t.kind!=="number") h += `<button class="del" style="align-self:flex-start;padding:0" data-clear="${t.id}">Clear</button>`;
  return h+`</div>`;
}
function lastValue(id, before){ const ks = Object.keys(S.hist).filter(k=>k<before && S.hist[k].l && S.hist[k].l[id]!=null).sort(); return ks.length ? S.hist[ks[ks.length-1]].l[id] : null; }
function vLog(){
  const k = logDay || TODAY(), isT = k===TODAY(), minK = addDays(TODAY(),-90);
  const label = isT ? "Today" : k===addDays(TODAY(),-1) ? "Yesterday" : fmtD(k,{weekday:"short",day:"numeric",month:"short"});
  let h = header("Log", "Quick entries · +2 XP each");
  h += `<div class="daynav"><button data-day="-1" ${k<=minK?"disabled":""} aria-label="Previous day">‹</button><span>${label}</span><button data-day="1" ${isT?"disabled":""} aria-label="Next day">›</button></div>`;
  for(const t of S.trackers) h += trackerCard(t,k);
  h += `<p class="foot" style="text-align:center">Edit trackers in Tasks → Trackers.</p>`;
  return h;
}

/* ================= view: Trends ================= */
function rangeKeys(n){ const out = []; for(let i=n-1;i>=0;i--) out.push(addDays(TODAY(),-i)); return out; }
function avgOf(keys, id){ const v = keys.map(k=>logVal(k,id)).filter(x=>x!=null && typeof x!=="object"); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; }
function lineChart(keys, series, o){
  const W = 330, H = 158, L = 32, R = 8, T = 10, B = 26, n = keys.length, xs = i=>L+(n===1?(W-L-R)/2:(W-L-R)*i/(n-1));
  const lo = o.min, hi = o.max, ys = v=>T+(H-T-B)*(1-(clamp(v,lo,hi)-lo)/(hi-lo||1));
  const bw = Math.max(2,(W-L-R)/Math.max(n,1)*.62);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label||"chart")}">`;
  /* weekends shaded, so a Saturday dip is visible at a glance */
  if(n<=45) keys.forEach((k,i)=>{ const d = dowOf(k); if(d!==0 && d!==6) return;
    s += `<rect class="wknd" x="${(xs(i)-bw*.9).toFixed(1)}" y="${T}" width="${(bw*1.8).toFixed(1)}" height="${H-T-B}"/>`; });
  /* Labels are collected and drawn last, so bars and lines never cover them. */
  let labels = "";
  if(o.band){ s += `<rect class="band" fill="${o.bandC}" x="${L}" y="${ys(o.band[1])}" width="${W-L-R}" height="${Math.max(0,ys(o.band[0])-ys(o.band[1]))}"/>`;
    labels += `<text class="bandl" x="${W-R-2}" y="${ys(o.band[1])-3}" text-anchor="end">goal</text>`; }
  for(const v of o.ticks){ s += `<line class="gl" x1="${L}" x2="${W-R}" y1="${ys(v)}" y2="${ys(v)}"/>`;
    labels += `<text class="yl" x="${L-6}" y="${ys(v)+3}" text-anchor="end">${o.tickFmt?o.tickFmt(v):v}</text>`; }
  if(o.goal!=null){ s += `<line class="tl" x1="${L}" x2="${W-R}" y1="${ys(o.goal)}" y2="${ys(o.goal)}"/>`;
    labels += `<text class="bandl bg" x="${W-R-2}" y="${ys(o.goal)-3}" text-anchor="end">goal ${o.tickFmt?o.tickFmt(o.goal):o.goal}</text>`; }
  /* your own usual, as a soft dashed reference */
  if(o.ref!=null && o.ref>lo && o.ref<hi){ s += `<line class="refl" x1="${L}" x2="${W-R}" y1="${ys(o.ref)}" y2="${ys(o.ref)}"/>`;
    labels += `<text class="bandl bg" x="${L+2}" y="${ys(o.ref)-3}">usual</text>`; }
  const idx = n<=1 ? [0] : [0, Math.floor((n-1)/2), n-1];
  for(const i of idx) labels += `<text class="xl" x="${xs(i)}" y="${H-10}" text-anchor="${i===0&&n>1?"start":i===n-1&&n>1?"end":"middle"}">${fmtD(keys[i])}</text>`;
  for(const se of series){
    s += `<g class="gl-svg" style="color:${se.c}">`;
    if(o.bars){
      keys.forEach((k,i)=>{ const v = se.get(k); if(v==null) return; const y = ys(v);
        const met = o.goal!=null ? v>=o.goal : o.band ? (v>=o.band[0] && v<=o.band[1]) : true;
        s += `<rect x="${xs(i)-bw/2}" y="${y}" width="${bw}" height="${Math.max(1,ys(lo)-y)}" rx="${Math.min(3,bw/2)}" fill="${se.c}" opacity="${met?1:.42}"><title>${fmtD(keys[i])}: ${o.tickFmt?o.tickFmt(v):v}</title></rect>`; });
      s += `</g>`; continue; }
    let d = "", pen = false;
    keys.forEach((k,i)=>{ const v = se.get(k); if(v==null){ if(!o.connect) pen = false; return; } d += (pen?"L":"M")+xs(i).toFixed(1)+","+ys(v).toFixed(1); pen = true; });
    s += `<path d="${d}" fill="none" stroke="${se.c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    if(n<=45) keys.forEach((k,i)=>{ const v = se.get(k); if(v!=null) s += `<circle cx="${xs(i)}" cy="${ys(v)}" r="${n<=8?3.5:2.3}" fill="${se.c}"><title>${fmtD(keys[i])}: ${o.tickFmt?o.tickFmt(v):v}</title></circle>`; });
    /* last point called out, since "where am I now" is the usual question */
    let li = -1; keys.forEach((k,i)=>{ if(se.get(k)!=null) li = i; });
    if(li>=0 && !o.bars){ const v = se.get(keys[li]);
      s += `<circle cx="${xs(li)}" cy="${ys(v)}" r="${n<=8?5:4}" fill="${se.c}" stroke="var(--card)" stroke-width="2"/>`; }
    s += `</g>`;
  }
  /* today's tick on the x-axis */
  const ti = keys.indexOf(TODAY());
  if(ti>=0 && n>1) labels += `<text class="xl td" x="${xs(ti)}" y="${H-1}" text-anchor="${ti===n-1?"end":"middle"}">today</text>`;
  return s+labels+`</svg>`;
}
/* One line of plain English under a chart, so the picture doesn't have to be decoded. */
function chartCaption(t, keys){
  const vals = keys.map(k=>logVal(k,t.id)).filter(v=>typeof v==="number");
  if(vals.length < 3) return "";
  const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
  const goal = t.kind==="count" ? t.target : (t.better==="up" ? t.min : null);
  const unit = t.kind==="scale" ? "/10" : t.unit ? " "+t.unit : "";
  const show = v=>(Math.abs(v)>=1000?Math.round(v).toLocaleString("en-IN"):Math.round(v*10)/10)+unit;
  if(goal!=null){ const hit = vals.filter(v=>v>=goal).length;
    return `Hit ${show(goal)} on ${hit} of ${vals.length} days.`; }
  if(t.min!=null && t.max!=null){ const inb = vals.filter(v=>v>=t.min && v<=t.max).length;
    return `In range ${inb} of ${vals.length} days.`; }
  const half = Math.floor(vals.length/2), a = vals.slice(0,half), b = vals.slice(half);
  if(a.length>=2 && b.length>=2){ const d = b.reduce((x,y)=>x+y,0)/b.length - a.reduce((x,y)=>x+y,0)/a.length;
    const unitAbs = Math.abs(d);
    if(unitAbs > Math.abs(avg)*0.08) return `Going ${d>0?"up":"down"} lately, by about ${show(unitAbs)}.`; }
  /* Nothing notable in the shape, so say something the big number doesn't already. */
  const lo = Math.min(...vals), hi = Math.max(...vals);
  let li = -1, hiI = -1;
  keys.forEach((k,i)=>{ const v = logVal(k,t.id); if(typeof v!=="number") return;
    if(li<0 || v<logVal(keys[li],t.id)) li=i; if(hiI<0 || v>logVal(keys[hiI],t.id)) hiI=i; });
  const best = t.better==="down" ? li : hiI;
  return `Usually ${show(lo)}–${show(hi)}. Best: ${fmtD(keys[best])}.`;
}
function niceRange(vals, pad){ let mn = Math.min(...vals), mx = Math.max(...vals); if(mn===mx){ mn -= pad; mx += pad; } const r = mx-mn; mn = Math.floor(mn - r*.15); mx = Math.ceil(mx + r*.15); return [mn, mx, [mn, Math.round((mn+mx)/2), mx]]; }
function dayRate(k){ const due = dueToday(k); return due.length ? due.filter(t=>isDone(t,k)).length/due.length : null; }
function heatmap(){
  const weeks = 17, end = TODAY(), start = addDays(weekStart(end), -(weeks-1)*7); let s = `<div class="heat" role="img" aria-label="Daily completion over ${weeks} weeks">`;
  for(let i=0;i<weeks*7;i++){ const k = addDays(start,i); if(k>end){ s += `<i class="fut"></i>`; continue; } const r = dayRate(k), lv = r==null||r===0 ? "" : r<.25?"l1":r<.5?"l2":r<.8?"l3":"l4"; s += `<i class="${lv}${k===end?" td":""}" title="${k}"></i>`; }
  return s+`</div>`;
}
function deltaTxt(cur, prev, unit, goodUp){
  if(cur==null || prev==null) return "";
  const d = cur-prev;
  /* A change smaller than 3% of the value isn't a trend, it's noise — don't
     dress it up with an arrow. */
  if(Math.abs(d) < Math.max(0.05, Math.abs(prev)*0.03)) return `<span class="delta">Same as the last ${trendRange} days</span>`;
  const good = goodUp==null ? null : (d>0)===goodUp;
  return `<span class="delta ${good==null?"":good?"ok":"bad"}">${d>0?"▲":"▼"} ${Math.abs(d).toLocaleString("en-IN",{maximumFractionDigits:1})}${unit} vs last ${trendRange} days</span>`;
}
function trackerTrend(t, keys, prev){
  const c = COLORS[t.color], has = keys.some(k=>logVal(k,t.id)!=null);
  let h = `<div class="card field" style="--c:${c}"><div class="cap" style="padding:0">${esc(t.name)}</div>`;
  if(!has) return h + `<div class="empty">Nothing logged in this range.</div></div>`;
  const a = avgOf(keys,t.id), pa = avgOf(prev,t.id), logged = keys.filter(k=>logVal(k,t.id)!=null).length;
  const up = t.better==="up" ? true : t.better==="down" ? false : null;
  const unit = t.kind==="scale" ? "" : t.kind==="count" ? "" : " "+t.unit;
  let big = a.toLocaleString("en-IN",{maximumFractionDigits:t.kind==="number"&&t.decimals===0?0:1});
  if(t.kind==="number" && t.better==null){ const ks = keys.filter(k=>logVal(k,t.id)!=null), f = logVal(ks[0],t.id), l = logVal(ks[ks.length-1],t.id); big = fmtVal(t,l); h += `<div class="tstat"><span class="big" style="color:${c}">${big}<small> ${esc(t.unit)} latest</small></span>${ks.length>1?`<span class="delta">${l-f>=0?"+":""}${(l-f).toFixed(1)} ${esc(t.unit)} since ${fmtD(ks[0])}</span>`:""}</div>`; }
  else h += `<div class="tstat"><span class="big" style="color:${c}">${big}<small>${t.kind==="scale"?" / 10":" "+esc(t.unit)} avg</small></span><span class="delta">${logged} day${logged>1?"s":""} logged</span></div>${deltaTxt(a,pa,unit,up)}`;
  const vals = keys.map(k=>logVal(k,t.id)).filter(v=>v!=null);
  let o;
  if(t.kind==="scale") o = {min:0,max:10,ticks:[0,5,10]};
  else if(t.kind==="hours") o = {min:0,max:Math.max(12,Math.ceil(Math.max(...vals))),ticks:[0,6,12],band:t.min!=null&&t.max!=null?[t.min,t.max]:null,bandC:c,bars:true};
  else if(t.kind==="count") o = {min:0,max:Math.max(t.target||0,...vals),ticks:[0,t.target||Math.max(...vals)],goal:t.target,bars:true};
  else { const [mn,mx,tk] = t.min!=null && t.better==="up" ? [0, Math.max(t.min*1.4,...vals), null] : niceRange(vals, 1); const big = mx>=2000, rnd = v=>big?Math.round(v/1000)*1000:Math.round(v), top = big?Math.ceil(mx/1000)*1000:mx; o = {min:mn,max:top,ticks:tk||[0,rnd(top/2),top],goal:t.min,bars:t.better==="up",connect:true,tickFmt:v=>v>=1000?(v/1000).toLocaleString("en-IN",{maximumFractionDigits:1})+"k":v}; }
  o.label = t.name;
  h += lineChart(keys,[{c,get:k=>{const v = logVal(k,t.id); return typeof v==="number"?v:null;}}],o);
  const cap = chartCaption(t, keys);
  if(cap) h += `<p class="ccap">${esc(cap)}</p>`;
  return h+`</div>`;
}
function vTrends(){
  const keys = rangeKeys(trendRange), prev = rangeKeys(trendRange*2).slice(0,trendRange);
  let h = header("Trends", "Patterns over time");
  h += `<div class="seg" role="group" aria-label="Range">${[7,30,90].map(r=>`<button data-range="${r}" aria-pressed="${trendRange===r}">${r===7?"Week":r===30?"Month":"3 Months"}</button>`).join("")}</div>`;
  const rates = keys.map(k=>k===TODAY()?null:dayRate(k)).filter(v=>v!=null), avg = rates.length ? Math.round(rates.reduce((a,b)=>a+b,0)/rates.length*100) : null;
  const prates = prev.map(dayRate).filter(v=>v!=null), pavg = prates.length ? Math.round(prates.reduce((a,b)=>a+b,0)/prates.length*100) : null;
  h += `<div class="card field" style="--c:var(--green)"><div class="cap" style="padding:0">Dailies done</div><div class="tstat"><span class="big" style="color:var(--green)">${avg==null?"–":avg+"%"}<small> average</small></span>${deltaTxt(avg,pavg,"%",true)}</div>`;
  h += lineChart(keys,[{c:"var(--green)",get:k=>{const r = dayRate(k); return r==null?null:Math.round(r*100);}}],{min:0,max:100,ticks:[0,50,100],goal:80,bars:true,label:"Share of dailies done each day",tickFmt:v=>v+"%"});
  const full = keys.filter(k=>k!==TODAY() && dayRate(k)===1).length;
  h += `<p class="ccap">${full} perfect day${full===1?"":"s"}. Faded bars = under 80%.</p>`;
  h += `<div class="cap" style="padding:0;margin-top:10px">Last 17 weeks</div>${heatmap()}<p class="ccap">Darker = more done. Today is bottom right.</p></div>`;
  const xpk = keys.map(k=>{ const x = S.hist[k] && S.hist[k].x; return x ? Object.values(x).reduce((a,b)=>a+b,0) : 0; }), xps = xpk.reduce((a,b)=>a+b,0);
  h += `<div class="tiles"><div class="tile" style="--c:var(--blue)"><span class="tn">XP earned</span><span class="tv">${xps.toLocaleString("en-IN")}</span><span class="ts">In this range.</span></div><div class="tile" style="--c:var(--red)"><span class="tn">Best streak now</span><span class="tv">${Math.max(0,...dailies().map(t=>streakOf(t)))}<small> days</small></span><span class="ts">${esc((dailies().slice().sort((a,b)=>streakOf(b)-streakOf(a))[0]||{}).title||"")}</span></div></div>`;
  for(const t of S.trackers) h += trackerTrend(t, keys, prev);
  const ds = dailies();
  if(ds.length){ h += `<div class="group"><div class="cap">Dailies</div><div class="card"><table class="stats"><thead><tr><th>Daily</th><th>Streak</th><th>Best</th><th>${trendRange}d</th></tr></thead><tbody>`;
    for(const t of ds.slice().sort((a,b)=>(rateOf(b,trendRange)||0)-(rateOf(a,trendRange)||0))){ const r = rateOf(t,trendRange); h += `<tr><td><span class="dot" style="--c:${CATS[t.cat].c};display:inline-block;margin-right:8px;vertical-align:0"></span>${esc(t.title)}</td><td>${streakOf(t)}</td><td>${bestStreak(t)}</td><td>${r==null?"–":Math.round(r*100)+"%"}</td></tr>`; }
    h += `</tbody></table></div></div>`; }
  const hs = habits();
  if(hs.length){ h += `<div class="group"><div class="cap">Habits · totals in range</div><div class="card"><table class="stats"><thead><tr><th>Habit</th><th>Done</th><th>Slips</th></tr></thead><tbody>`;
    for(const t of hs){ let u = 0, n = 0; for(const k of keys){ u += habitCount(t,k,"u"); n += habitCount(t,k,"n"); } h += `<tr><td><span class="dot" style="--c:${CATS[t.cat].c};display:inline-block;margin-right:8px;vertical-align:0"></span>${esc(t.title)}</td><td>${t.kind==="bad"?"–":u}</td><td>${t.kind==="good"?"–":n}</td></tr>`; }
    h += `</tbody></table></div></div>`; }
  if(window.experimentsHTML) h += experimentsHTML();
  if(window.reportsHTML) h += reportsHTML();
  return h;
}
/* ================= view: Tasks (editor) ================= */
const SEGS = [["daily","Dailies"],["habit","Habits"],["todo","To-dos"],["reward","Rewards"],["tracker","Trackers"]];
function vTasks(){
  let h = header("Tasks", "Tap anything to edit · + to add");
  h += `<div class="btns"><button class="btn sec" data-rules="import">Import rules</button><button class="btn sec" data-rules="share">Share my rules</button></div>`;
  h += `<div class="seg" role="group" aria-label="Type">${SEGS.map(([id,n])=>`<button data-seg="${id}" aria-pressed="${taskSeg===id}">${n}</button>`).join("")}</div>`;
  if(taskSeg==="daily"){
    for(const b of BLOCKS){ const list = S.tasks.filter(t=>t.type==="daily" && t.block===b.id && !t.archived); if(!list.length) continue;
      h += `<div class="group"><div class="cap">${b.name}</div><ul class="list">${list.map(t=>`<li class="row plain tap" data-edit="${t.id}" style="--c:${CATS[t.cat].c};grid-template-columns:10px minmax(0,1fr) auto"><span class="dot"></span><div style="min-width:0"><span class="rt">${esc(t.title)}</span><div class="rs">${t.days.length===7?"Every day":t.days.map(d=>DOW_LONG[d].slice(0,3)).join(", ")} · ${DIFF[t.diff||1]}${t.remind?` · ⏰ ${t.remind}`:""}${t.auto&&t.auto.length?" · auto":""}</div></div><span class="chev">›</span></li>`).join("")}</ul></div>`; }
  } else if(taskSeg==="habit"){
    const list = S.tasks.filter(t=>t.type==="habit" && !t.archived);
    h += list.length ? `<ul class="list">${list.map(t=>`<li class="row plain tap" data-edit="${t.id}" style="--c:${CATS[t.cat].c};grid-template-columns:10px minmax(0,1fr) auto"><span class="dot"></span><div style="min-width:0"><span class="rt">${esc(t.title)}</span><div class="rs">${t.kind==="good"?"Good":t.kind==="bad"?"Slip tracker":"Both"}${t.target?` · ${t.target} a ${t.period}`:""} · ${DIFF[t.diff||1]}</div></div><span class="chev">›</span></li>`).join("")}</ul>` : `<div class="card empty">No habits yet.</div>`;
  } else if(taskSeg==="todo"){
    const open = S.tasks.filter(t=>t.type==="todo" && !t.done && !t.archived), done = S.tasks.filter(t=>t.type==="todo" && t.done && !t.archived);
    h += open.length ? `<ul class="list">${open.map(todoRow).join("")}</ul>` : `<div class="card empty">Nothing on your list.</div>`;
    if(done.length) h += `<div class="group"><div class="gh"><span class="cap" style="padding:0">Done · ${done.length}</span><button class="meta" data-cleartodos="1">Clear done</button></div><ul class="list">${done.slice(0,30).map(todoRow).join("")}</ul></div>`;
  } else if(taskSeg==="reward"){
    h += S.rewards.length ? `<ul class="list">${S.rewards.map(r=>`<li class="row plain tap" data-editreward="${r.id}"><div style="min-width:0"><span class="rt">${esc(r.title)}</span><div class="rs">${r.cost} coins</div></div><span class="chev">›</span></li>`).join("")}</ul>` : `<div class="card empty">No rewards yet. Add things you'd like to earn.</div>`;
    h += `<p class="foot">Spend coins on these in the Me tab.</p>`;
  } else {
    h += `<ul class="list">${S.trackers.map((t,i)=>`<li class="row plain tap" data-edittracker="${t.id}" style="--c:${COLORS[t.color]};grid-template-columns:10px minmax(0,1fr) auto"><span class="dot"></span><div style="min-width:0"><span class="rt">${esc(t.name)}</span><div class="rs">${{scale:"1–10 scale",hours:"Hours",count:"Counter",number:"Number",bp:"Blood pressure"}[t.kind]}${t.kind!=="bp"&&t.kind!=="scale"?" · "+esc(t.unit):""}${t.quick?" · on Today":""}</div></div><span class="chev">›</span></li>`).join("")}</ul><p class="foot">Trackers show up in Log and Trends.</p>`;
  }
  return h;
}

/* ================= view: Me ================= */
function vMe(){
  const tot = totals(), L = levelOf(tot.xp);
  let doneCount = 0, logDays = 0; for(const k in S.hist){ if(S.hist[k].d) doneCount += Object.keys(S.hist[k].d).length; if(S.hist[k].l) logDays++; }
  let h = header("Me", "Level, rewards and settings");
  h += `<div class="card" style="display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center"><div class="ava" style="width:84px;height:84px;font-size:32px"><span>${L.lvl}</span></div><div class="pname" style="font-size:22px">${esc(S.profile.name||"You")}</div><div class="plvl">Level ${L.lvl} · ${tot.xp.toLocaleString("en-IN")} XP total</div><div class="xpbar" style="width:100%"><i style="width:${L.into/L.need*100}%"></i></div><div class="plvl">${L.need-L.into} XP to level ${L.lvl+1}</div></div>`;
  h += `<div class="tiles"><div class="tile" style="--c:var(--yellow)"><span class="tn">Coins</span><span class="tv">${tot.coins}</span></div><div class="tile" style="--c:var(--green)"><span class="tn">Dailies done</span><span class="tv">${doneCount}</span></div><div class="tile" style="--c:var(--blue)"><span class="tn">Days logged</span><span class="tv">${logDays}</span></div><div class="tile" style="--c:var(--red)"><span class="tn">Rewards claimed</span><span class="tv">${S.purchases.length}</span></div></div>`;
  h += `<div class="group"><div class="gh"><h2>Rewards</h2><button class="meta" data-addreward="1">Add</button></div>`;
  h += S.rewards.length ? `<ul class="list">${S.rewards.map(r=>`<li class="row plain"><div style="min-width:0"><span class="rt">${esc(r.title)}</span></div><button class="buy" data-buy="${r.id}" ${tot.coins<r.cost?"disabled":""}><i></i>${r.cost}</button></li>`).join("")}</ul>` : `<div class="card empty">Add rewards you'd like to earn.</div>`;
  if(S.purchases.length) h += `<p class="foot">Last claimed: ${esc(S.purchases[S.purchases.length-1].title)} · ${fmtD(S.purchases[S.purchases.length-1].day)}</p>`;
  h += `</div>`;
  const s = S.settings;
  if(window.meProfileHTML) h += meProfileHTML();
  if(window.meAccountHTML) h += meAccountHTML();
  if(window.meDevicesHTML) h += meDevicesHTML();
  h += `<div class="group"><div class="cap">Appearance</div><div class="card">${themePicker()}</div></div>`;
  h += `<div class="group"><div class="cap">Settings</div><div class="card form">
    <div class="fld"><label for="set-ds">New day starts</label><select class="tin" id="set-ds" data-setting="dayStart">${[0,1,2,3,4,5].map(x=>`<option value="${x}" ${s.dayStart===x?"selected":""}>${x===0?"Midnight":x+":00 am"}</option>`).join("")}</select></div>
    <label class="switch"><span>Reminders</span><input type="checkbox" id="set-rem" data-setting="reminders" ${s.reminders?"checked":""}></label>
    <div class="fld"><label for="set-logrem">Evening log reminder</label><input class="tin" id="set-logrem" type="time" value="${s.logReminder||""}" data-setting="logReminder"></div>
    <label class="switch"><span>Sounds</span><input type="checkbox" id="set-snd" data-setting="sound" ${s.sound?"checked":""}></label>
    <label class="switch"><span>Haptics</span><input type="checkbox" id="set-hap" data-setting="haptics" ${s.haptics?"checked":""}></label>
    <p class="hint">Uses each daily's reminder time, plus one on the 1st for your summary.</p>
  </div></div>`;
  h += `<div class="group"><div class="cap">Backup</div><div class="card form"><div class="btns"><button class="btn" data-backup="export">Export backup</button><button class="btn sec" data-backup="import">Import</button></div><p class="hint">Export now and then. Uninstalling deletes your data.</p><input type="file" id="importfile" accept="application/json,.json" hidden></div></div>`;
  h += `<div class="group"><div class="card form"><button class="btn danger" data-reset="1">Reset everything</button></div><p class="foot" style="text-align:center">Healthbook ${esc(window.HB_VERSION||"")}· ${typeof cloudUser!=="undefined" && cloudUser ? "synced to your account" : "your data stays on this phone"} · <button class="linkbtn" data-privacy="1" style="font-size:13px;padding:0">Privacy policy</button></p></div>`;
  return h;
}

/* ================= render ================= */
function render(keep){
  const y = scrollY;
  document.querySelectorAll(".tb").forEach(t=>t.setAttribute("aria-selected", String(t.dataset.view===view)));
  const V = $("#view");
  V.innerHTML = view==="log"?vLog():view==="trends"?vTrends():view==="tasks"?vTasks():view==="me"?vMe():vToday();
  let fab = $("#fab");
  if(view==="tasks"){ if(!fab){ fab = document.createElement("button"); fab.id = "fab"; fab.className = "fab"; fab.setAttribute("aria-label","Add"); fab.innerHTML = ICON.plus; document.body.appendChild(fab); fab.addEventListener("click", ()=>{ if(taskSeg==="reward") editReward(null); else if(taskSeg==="tracker") editTracker(null); else editTask(null, taskSeg); }); } }
  else if(fab) fab.remove();
  if(keep) scrollTo(0,y);
  if(pendingLevel) showLevelUp();
}
function go(v){ view = v; if(v==="log" && !logDay) logDay = TODAY(); render(); scrollTo(0,0); }

/* ================= sheets ================= */
let sheet = null, raf = null, wake = null;
function closeSheet(){ cancelAnimationFrame(raf); raf = null; lockOff(); if(sheet){ sheet.remove(); sheet = null; } }
function openSheet(html, onClick, onChange, locked){
  closeSheet(); sheet = document.createElement("div"); sheet.className = "scrim"; sheet.locked = !!locked;
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  sheet.addEventListener("click", e=>{ if(e.target===sheet){ if(!sheet.locked) closeSheet(); return; } const b = e.target.closest("button"); if(b && onClick) onClick(b, e); });
  if(onChange) sheet.addEventListener("change", onChange);
  document.body.appendChild(sheet);
}
function shead(title, left, right, rightDisabled){ return `<span class="grab"></span><div class="shead"><button data-s="cancel">${left||"Cancel"}</button><h3>${esc(title)}</h3><button class="r" data-s="save" ${rightDisabled?"disabled":""}>${right||"Save"}</button></div>`; }
const val = id=>{ const el = sheet && sheet.querySelector("#"+id); return el ? el.value : ""; };
function segHTML(name, opts, cur, cls){ return `<div class="seg ${cls||""}" data-group="${name}">${opts.map(([v,l,c])=>`<button type="button" data-pick="${name}" data-v="${v}" aria-pressed="${String(cur)===String(v)}" ${c?`style="--c:${c}"`:""}>${l}</button>`).join("")}</div>`; }
function pickIn(b){ const g = b.dataset.pick; sheet.querySelectorAll(`[data-pick="${g}"]`).forEach(x=>x.setAttribute("aria-pressed", String(x===b))); }
const picked = g=>{ const b = sheet.querySelector(`[data-pick="${g}"][aria-pressed="true"]`); return b ? b.dataset.v : null; };

/* ---- task detail ---- */
function openDetail(id){
  const t = S.tasks.find(x=>x.id===id); if(!t) return; const k = TODAY();
  let h = `<span class="grab"></span><div class="shead"><button data-s="cancel">Close</button><h3>${t.type==="daily"?"Daily":t.type==="habit"?"Habit":"To-do"}</h3><button class="r" data-s="edit">Edit</button></div>`;
  h += `<div class="card" style="width:100%;--c:${CATS[t.cat].c}"><div style="display:flex;gap:10px;align-items:center"><span class="dot"></span><b style="font-size:19px">${esc(t.title)}</b></div>${t.notes?`<p class="hint" style="margin-top:8px;font-size:15px">${esc(t.notes)}</p>`:""}</div>`;
  if((t.checklist||[]).length){ h += `<ul class="list" style="width:100%">${t.checklist.map(c=>{ const on = t.type==="todo" ? !!c.done : clDone(k,t.id,c.id); return `<li class="row" style="--c:${CATS[t.cat].c}"><input type="checkbox" class="cb" data-cl="${c.id}" ${on?"checked":""} aria-label="${esc(c.text)}"><span class="rt">${esc(c.text)}</span><span></span></li>`; }).join("")}</ul>`; }
  if(t.type==="daily"){ h += `<div class="tiles" style="width:100%"><div class="tile" style="--c:var(--red)"><span class="tn">Streak</span><span class="tv">${streakOf(t)}<small> days</small></span><span class="ts">Best ${bestStreak(t)}</span></div><div class="tile" style="--c:var(--green)"><span class="tn">Last 30 days</span><span class="tv">${(()=>{const r = rateOf(t,30); return r==null?"–":Math.round(r*100)+"%";})()}</span><span class="ts">${t.days.length===7?"Every day":t.days.map(d=>DOW_LONG[d].slice(0,3)).join(", ")}</span></div></div>`;
    if(!isDone(t,k)) h += `<button class="btn" data-complete="1">Mark done · +${XP_DAILY[t.diff||1]} XP</button>`; else h += `<button class="btn sec" data-uncomplete="1">Mark not done</button>`; }
  if(t.type==="habit"){ const u = habitCount(t,k,"u"), n = habitCount(t,k,"n"); h += `<div class="tiles" style="width:100%"><div class="tile" style="--c:var(--green)"><span class="tn">Today</span><span class="tv">${t.kind==="bad"?n:u}</span></div><div class="tile" style="--c:var(--blue)"><span class="tn">This week</span><span class="tv">${t.kind==="bad"?Array.from({length:7},(_,i)=>addDays(weekStart(k),i)).reduce((a,kk)=>a+habitCount(t,kk,"n"),0):habitPeriodCount(Object.assign({},t,{period:"week"}),k)}${t.target&&t.period==="week"?`<small> / ${t.target}</small>`:""}</span></div></div>`;
    if(u && t.kind!=="bad") h += `<button class="btn sec" data-hundo="u">Remove one from today</button>`; if(n && t.kind!=="good") h += `<button class="btn sec" data-hundo="n">Remove one slip from today</button>`; }
  if(t.type==="todo") h += t.done ? `<button class="btn sec" data-tundo="1">Mark not done</button>` : `<button class="btn" data-tdone="1">Complete · +${XP_TODO[t.diff||1]} XP</button>`;
  openSheet(h, b=>{
    const d = b.dataset;
    if(d.s==="cancel") closeSheet();
    else if(d.s==="edit") editTask(t.id);
    else if(d.complete){ setDaily(t,k,true); ding(); tick(); closeSheet(); render(true); }
    else if(d.uncomplete){ setDaily(t,k,false); closeSheet(); render(true); }
    else if(d.hundo){ tapHabit(t,k,d.hundo,-1); closeSheet(); render(true); }
    else if(d.tdone){ setTodo(t,true); ding(); tick(); closeSheet(); render(true); }
    else if(d.tundo){ setTodo(t,false); closeSheet(); render(true); }
  }, e=>{ const c = e.target.dataset.cl; if(!c) return; tick();
    if(t.type==="todo"){ const it = t.checklist.find(x=>x.id===c); it.done = e.target.checked; }
    else { const m = sub(k,"c"), r = m[t.id] || (m[t.id] = {}); if(e.target.checked) r[c] = true; else delete r[c]; if(!Object.keys(r).length) delete m[t.id]; tidy(k); }
    save(); render(true); });
}

/* ---- task editor ---- */
function editTask(id, type){
  const t = id ? S.tasks.find(x=>x.id===id) : null; type = t ? t.type : type;
  const f = t ? JSON.parse(JSON.stringify(t)) : {type, title:"", notes:"", cat:"care", diff:1, days:[0,1,2,3,4,5,6], block:liveBlock().id, remind:null, checklist:[], auto:null, kind:"good", target:null, period:"week", due:null, star:false};
  const nm = {daily:"Daily",habit:"Habit",todo:"To-do"}[type];
  const EX = {daily:["Drink water","Walk 20 minutes","Read before bed","Stretch","Take vitamins"],
              habit:["Glass of water","Push-ups","Snack","Cigarette","Flight of stairs"],
              todo:["Book dentist","Buy groceries","Call mum","Renew gym pass"]};
  const draw = ()=>{
    let h = shead(t?`Edit ${nm}`:`New ${nm}`, "Cancel", t?"Done":"Add") + `<div class="form">`;
    /* --- the only thing you must fill in --- */
    h += `<div class="fld big"><label for="f-title">What is it?</label><input class="tin xl" id="f-title" value="${esc(f.title)}" placeholder="${type==="habit"?"Glass of water":type==="todo"?"Book dentist":"Drink water"}" maxlength="120" autocomplete="off"></div>`;
    if(!t && !f.title) h += `<div class="chips">${EX[type].map(x=>`<button type="button" class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join("")}</div>`;
    h += `<div class="fld"><span class="lab">What kind of thing?</span>${segHTML("cat", CAT_ORDER.map(c=>[c,CATS[c].name.replace(" & Care",""),CATS[c].c]), f.cat, "cats")}</div>`;

    if(type==="daily"){
      h += `<div class="fld"><span class="lab">When in the day?</span>${segHTML("block", BLOCKS.map(b=>[b.id,b.name.replace("Wind-down","Wind")]), f.block)}</div>`;
      const everyDay = f.days.length===7;
      h += `<div class="fld"><span class="lab">Which days?</span><div class="seg" data-group="freq"><button type="button" data-freq="all" aria-pressed="${everyDay}">Every day</button><button type="button" data-freq="some" aria-pressed="${!everyDay}">Only some days</button></div>`;
      h += `<div class="days" ${everyDay?"hidden":""}>${DOW.map((d,i)=>`<button type="button" data-dow="${i}" aria-pressed="${f.days.includes(i)}" aria-label="${DOW_LONG[i]}">${d}</button>`).join("")}</div></div>`;
      h += `<div class="fld"><span class="lab">Remind me</span><div class="two"><input class="tin" type="time" id="f-remind" value="${f.remind||""}"><button type="button" class="btn sec" data-clearrem="1">${f.remind?"Turn off":"No reminder"}</button></div></div>`;
    }
    if(type==="habit"){
      h += `<div class="fld"><span class="lab">Is this a good thing or a slip?</span>${segHTML("kind", [["good","Good"],["bad","Slip"],["both","Both"]], f.kind)}</div>`;
      h += `<p class="hint">Slips never cost XP.</p>`;
    }
    if(type==="todo"){
      h += `<div class="fld"><label for="f-due">Finish it by</label><input class="tin" type="date" id="f-due" value="${f.due||""}"></div>`;
    }

    /* --- everything else is tucked away --- */
    h += `<button type="button" class="more" data-more="1" aria-expanded="${more}">${more?"Fewer options":"More options"}</button>`;
    if(more){
      h += `<div class="adv">`;
      h += `<div class="fld"><span class="lab">How much effort?</span>${segHTML("diff", [1,2,3].map(d=>[d, `${DIFF[d]} · ${(type==="daily"?XP_DAILY:type==="habit"?XP_HABIT:XP_TODO)[d]} XP`]), f.diff)}</div>`;
      h += `<div class="fld"><label for="f-notes">Note to self</label><textarea class="tin" id="f-notes" placeholder="Optional">${esc(f.notes)}</textarea></div>`;
      if(type==="habit")
        h += `<div class="two"><div class="fld"><label for="f-target">Aim for</label><input class="tin" id="f-target" type="number" inputmode="numeric" min="1" value="${f.target||""}" placeholder="e.g. 3"></div><div class="fld"><span class="lab">Per</span>${segHTML("period", [["day","Day"],["week","Week"]], f.period)}</div></div>`;
      if(type==="todo")
        h += `<label class="switch"><span>Pin to the top of Today</span><input type="checkbox" id="f-star" ${f.star?"checked":""}></label>`;
      if(type==="daily"){
        const a = (f.auto&&f.auto[0])||null;
        h += `<div class="fld"><span class="lab">Tick itself when…</span><div class="two"><select class="tin" id="f-auto"><option value="">Never — I'll tick it</option>${S.trackers.filter(x=>x.kind!=="bp").map(x=>`<option value="${x.id}" ${a&&a.t===x.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select><select class="tin" id="f-autoop"><option value="set" ${a&&a.op==="set"?"selected":""}>is logged</option><option value="gte" ${a&&a.op==="gte"?"selected":""}>reaches</option><option value="lte" ${a&&a.op==="lte"?"selected":""}>stays under</option></select></div><input class="tin" id="f-autov" type="number" inputmode="decimal" placeholder="Number" value="${a&&a.v!=null?a.v:""}" ${a&&a.op!=="set"?"":"hidden"}><p class="hint">Example: tick "Drink water" when water hits 8.</p>${f.auto&&f.auto.length>1?`<p class="hint">Plus ${f.auto.length-1} more condition${f.auto.length>2?"s":""} (kept).</p>`:""}</div>`;
      }
      if(type!=="habit")
        h += `<div class="fld"><span class="lab">Steps (optional)</span><div class="cl">${f.checklist.map((c,i)=>`<div class="clrow"><input class="tin" data-clt="${i}" value="${esc(c.text)}" placeholder="Step ${i+1}"><button type="button" class="del" data-cldel="${i}" aria-label="Remove step">✕</button></div>`).join("")}<button type="button" class="btn sec" data-cladd="1">Add a step</button></div></div>`;
      if(t) h += `<div class="btns"><button type="button" class="btn sec" data-move="-1">Move up</button><button type="button" class="btn sec" data-move="1">Move down</button></div>`;
      h += `</div>`;
    }
    if(t) h += `<button type="button" class="btn danger" data-delete="1">${confirmDel?"Tap again to delete":"Delete"}</button>`;
    h += `</div>`;
    return h;
  };
  let confirmDel = false, more = false;
  const has = id=>!!sheet.querySelector("#"+id);
  const grab = ()=>{ f.title = val("f-title").trim(); if(has("f-notes")) f.notes = val("f-notes").trim();
    if(type==="daily"){ if(has("f-remind")) f.remind = val("f-remind")||null;
      if(has("f-auto")){ const at = val("f-auto"), op = val("f-autoop"), v = num(val("f-autov")); const rest = (f.auto||[]).slice(1); f.auto = at ? [{t:at, op, v:op==="set"?null:v}].concat(rest) : (rest.length?rest:null); } }
    if(type==="habit" && has("f-target")){ f.target = num(val("f-target")); }
    if(type==="todo"){ if(has("f-due")) f.due = val("f-due")||null; if(has("f-star")) f.star = sheet.querySelector("#f-star").checked; }
    sheet.querySelectorAll("[data-clt]").forEach(el=>{ f.checklist[Number(el.dataset.clt)].text = el.value; });
    const c = picked("cat"); if(c) f.cat = c; const d = picked("diff"); if(d) f.diff = Number(d); const b = picked("block"); if(b) f.block = b; const k = picked("kind"); if(k) f.kind = k; const p = picked("period"); if(p) f.period = p; };
  const redraw = ()=>{ grab(); const st = sheet.querySelector(".sheet").scrollTop; sheet.querySelector(".sheet").innerHTML = draw(); sheet.querySelector(".sheet").scrollTop = st; };
  openSheet(draw(), b=>{
    const d = b.dataset;
    if(d.pick){ pickIn(b); return; }
    if(d.ex){ grab(); f.title = d.ex; redraw(); return; }
    if(d.more){ grab(); more = !more; redraw(); return; }
    if(d.freq){ grab(); f.days = d.freq==="all" ? [0,1,2,3,4,5,6] : (f.days.length===7 ? [1,2,3,4,5] : f.days); redraw(); return; }
    if(d.dow!=null){ const i = Number(d.dow); grab(); f.days = f.days.includes(i) ? f.days.filter(x=>x!==i) : f.days.concat(i).sort(); b.setAttribute("aria-pressed", String(f.days.includes(i))); return; }
    if(d.clearrem){ grab(); f.remind = null; redraw(); return; }
    if(d.cladd){ grab(); f.checklist.push({id:uid(), text:""}); redraw(); const els = sheet.querySelectorAll("[data-clt]"); els[els.length-1].focus(); return; }
    if(d.cldel!=null){ grab(); f.checklist.splice(Number(d.cldel),1); redraw(); return; }
    if(d.s==="cancel"){ closeSheet(); return; }
    if(d.delete){ if(!confirmDel){ confirmDel = true; grab(); redraw(); return; } S.tasks = S.tasks.filter(x=>x.id!==t.id); S.removed[t.id] = Date.now(); save(); scheduleReminders(); closeSheet(); render(true); toast("Deleted"); return; }
    if(d.move){ const i = S.tasks.indexOf(t), dir = Number(d.move); let j = i+dir; while(j>=0 && j<S.tasks.length && (S.tasks[j].type!==t.type || (t.type==="daily" && S.tasks[j].block!==t.block))) j += dir; if(j<0||j>=S.tasks.length) { toast(dir<0?"Already first":"Already last"); return; } S.tasks.splice(i,1); S.tasks.splice(j,0,t); save(); render(true); toast(dir<0?"Moved up":"Moved down"); return; }
    if(d.s==="save"){ grab(); if(!f.title){ sheet.querySelector("#f-title").focus(); toast("Add a title"); return; } if(type==="daily" && !f.days.length){ toast("Pick at least one day"); return; }
      f.checklist = f.checklist.filter(c=>c.text.trim());
      if(t) Object.assign(t, f); else { f.id = uid(); f.created = TODAY(); if(type==="todo"){ f.done = false; f.doneDay = null; } S.tasks.push(f); }
      if(type==="daily"){ evalAuto(TODAY()); }
      save(); scheduleReminders(); closeSheet(); render(true); toast(t?"Saved":"Added"); }
  }, e=>{ if(e.target.id==="f-autoop"){ sheet.querySelector("#f-autov").hidden = e.target.value==="set"; } });
}

/* ---- reward editor ---- */
function editReward(id){
  const r = id ? S.rewards.find(x=>x.id===id) : null; let confirmDel = false;
  const draw = ()=>shead(r?"Edit Reward":"New Reward","Cancel",r?"Done":"Add") + `<div class="form"><div class="fld"><label for="r-title">Reward</label><input class="tin" id="r-title" value="${esc(r?r.title:"")}" placeholder="e.g. Movie night"></div><div class="fld"><label for="r-cost">Cost in coins</label><input class="tin" id="r-cost" type="number" inputmode="numeric" min="1" value="${r?r.cost:50}"></div><p class="hint">A medium daily earns 5 coins.</p>${r?`<button class="btn danger" data-delete="1">${confirmDel?"Tap again to delete":"Delete"}</button>`:""}</div>`;
  openSheet(draw(), b=>{ const d = b.dataset;
    if(d.s==="cancel") closeSheet();
    else if(d.delete){ if(!confirmDel){ confirmDel = true; b.textContent = "Tap again to delete"; return; } S.rewards = S.rewards.filter(x=>x.id!==r.id); S.removed[r.id] = Date.now(); save(); closeSheet(); render(true); }
    else if(d.s==="save"){ const title = val("r-title").trim(), cost = Math.max(1,Math.round(num(val("r-cost"))||0)); if(!title){ toast("Name the reward"); return; } if(r) Object.assign(r,{title,cost}); else S.rewards.push({id:uid(), title, cost}); save(); closeSheet(); render(true); } });
}
function buyReward(id){
  const r = S.rewards.find(x=>x.id===id); if(!r) return; const tot = totals();
  if(tot.coins < r.cost){ toast(`${r.cost-tot.coins} more coins needed`); return; }
  openSheet(`<span class="grab"></span><h3 class="big3">${esc(r.title)}</h3><p class="sub">Spend ${r.cost} of your ${tot.coins} coins?</p><div class="btns"><button class="btn sec" data-s="cancel">Not yet</button><button class="btn" data-s="buy">Claim it</button></div>`, b=>{
    if(b.dataset.s==="buy"){ S.purchases.push({t:Date.now(), day:TODAY(), id:r.id, title:r.title, cost:r.cost}); save(); chime(); buzz(); closeSheet(); render(true); toast("Enjoy it. You earned it."); } else closeSheet(); });
}

/* ---- tracker editor ---- */
function editTracker(id){
  const t = id ? trk(id) : null; let confirmDel = false;
  const f = t ? JSON.parse(JSON.stringify(t)) : {name:"", unit:"", kind:"number", color:"blue", better:"up", quick:false, decimals:1};
  const draw = ()=>{
    let h = shead(t?"Edit Tracker":"New Tracker","Cancel",t?"Done":"Add") + `<div class="form">`;
    h += `<div class="fld"><label for="k-name">Name</label><input class="tin" id="k-name" value="${esc(f.name)}" placeholder="e.g. Caffeine"></div>`;
    h += `<div class="fld"><span class="lab">Type</span>${segHTML("kind", [["number","Number"],["count","Counter"],["hours","Hours"],["scale","1–10"]], f.kind)}</div>`;
    h += `<div class="fld"><span class="lab">Colour</span>${segHTML("color", [["red","Red",COLORS.red],["green","Green",COLORS.green],["blue","Blue",COLORS.blue],["yellow","Yellow",COLORS.yellow]], f.color, "cats")}</div>`;
    if(f.kind!=="scale") h += `<div class="fld"><label for="k-unit">Unit</label><input class="tin" id="k-unit" value="${esc(f.unit)}" placeholder="e.g. cups, km, kg"></div>`;
    if(f.kind==="count") h += `<div class="fld"><label for="k-target">Daily target</label><input class="tin" id="k-target" type="number" inputmode="numeric" value="${f.target||""}" placeholder="e.g. 8"></div>`;
    if(f.kind==="number" || f.kind==="hours") h += `<div class="two"><div class="fld"><label for="k-min">${f.kind==="hours"?"Range from":"Goal (min)"}</label><input class="tin" id="k-min" type="number" inputmode="decimal" value="${f.min??""}"></div><div class="fld"><label for="k-max">${f.kind==="hours"?"Range to":"Limit (max)"}</label><input class="tin" id="k-max" type="number" inputmode="decimal" value="${f.max??""}"></div></div>`;
    if(f.kind==="hours") h += `<div class="fld"><label for="k-step">Step</label><input class="tin" id="k-step" type="number" inputmode="decimal" value="${f.step||0.5}"></div>`;
    if(f.kind==="scale") h += `<div class="two"><div class="fld"><label for="k-lo">1 means</label><input class="tin" id="k-lo" value="${esc(f.lo||"Low")}"></div><div class="fld"><label for="k-hi">10 means</label><input class="tin" id="k-hi" value="${esc(f.hi||"High")}"></div></div>`;
    h += `<div class="fld"><span class="lab">Better when</span>${segHTML("better", [["up","Higher"],["down","Lower"],["","Neither"]], f.better==null?"":f.better==="range"?"":f.better)}</div>`;
    h += `<label class="switch"><span>Show on Today</span><input type="checkbox" id="k-quick" ${f.quick?"checked":""}></label>`;
    if(t) h += `<button class="btn danger" data-delete="1">${confirmDel?"Tap again to delete":"Delete tracker"}</button><p class="hint">Deleting hides it. Your logs stay in backups.</p>`;
    return h + `</div>`;
  };
  const grab = ()=>{ f.name = val("k-name").trim(); if(sheet.querySelector("#k-unit")) f.unit = val("k-unit").trim(); if(sheet.querySelector("#k-target")) f.target = num(val("k-target")); if(sheet.querySelector("#k-min")){ f.min = num(val("k-min")); f.max = num(val("k-max")); } if(sheet.querySelector("#k-step")) f.step = num(val("k-step"))||0.5; if(sheet.querySelector("#k-lo")){ f.lo = val("k-lo"); f.hi = val("k-hi"); } f.quick = sheet.querySelector("#k-quick").checked;
    const k = picked("kind"); if(k) f.kind = k; const c = picked("color"); if(c) f.color = c; const b = picked("better"); if(b!==null) f.better = b===""?(f.kind==="hours"&&f.min!=null?"range":null):b; };
  openSheet(draw(), b=>{ const d = b.dataset;
    if(d.pick){ pickIn(b); if(d.pick==="kind"){ grab(); const st = sheet.querySelector(".sheet").scrollTop; sheet.querySelector(".sheet").innerHTML = draw(); sheet.querySelector(".sheet").scrollTop = st; } return; }
    if(d.s==="cancel") closeSheet();
    else if(d.delete){ if(!confirmDel){ confirmDel = true; b.textContent = "Tap again to delete"; return; } S.trackers = S.trackers.filter(x=>x.id!==t.id); S.removed["trk:"+t.id] = Date.now(); save(); closeSheet(); render(true); }
    else if(d.s==="save"){ grab(); if(!f.name){ toast("Name the tracker"); return; }
      if(f.kind==="scale") f.unit = "/10"; if(f.kind==="hours" && !f.unit) f.unit = "hr"; if(f.kind==="count" && !f.target) f.target = 8; if(f.kind==="number" && f.decimals==null) f.decimals = 1;
      if(t) Object.assign(t,f); else { f.id = uid(); S.trackers.push(f); } save(); closeSheet(); render(true); toast(t?"Saved":"Added"); } });
}

/* ================= screen wake helpers ================= */
function lockOff(){ wake = null; }

/* ================= reminders ================= */
function hashId(s){ let h = 0; for(const ch of s) h = (h*31 + ch.charCodeAt(0))|0; return (Math.abs(h) % 1000000)*100; }
let remTimer = null;
function queueReminders(){ clearTimeout(remTimer); remTimer = setTimeout(()=>scheduleReminders(false), 1500); }
/* One notification per reminder per day for the next 14 days. Today's is skipped once the daily is done
   (or, for the log reminder, once mood and stress are logged). Re-run whenever the app opens or something relevant changes. */
async function scheduleReminders(ask){
  if(!LN) return;
  try{
    const pend = await LN.getPending(); if(pend && pend.notifications && pend.notifications.length) await LN.cancel({notifications:pend.notifications.map(n=>({id:n.id}))});
    if(!S.settings.reminders) return;
    let perm = await LN.checkPermissions();
    if(perm.display!=="granted" && ask) perm = await LN.requestPermissions();
    if(perm.display!=="granted"){ if(ask){ S.settings.reminders = false; save(); render(true); toast("Notifications are off for Healthbook in Android settings"); } return; }
    /* Private channel: the lock screen shows that a reminder arrived, not what it says. */
    try{ await LN.createChannel({id:"reminders", name:"Reminders", importance:4, visibility:0}); }catch(e){}
    const now = Date.now(), list = [], today = TODAY();
    const at = (k, hhmm)=>{ const [hh,mm] = hhmm.split(":").map(Number); const d = new Date(k+"T00:00:00"); d.setHours(hh, mm, 0, 0); if(hh < (S.settings.dayStart||0)) d.setDate(d.getDate()+1); return d; };
    for(let i=0;i<14;i++){ const k = addDays(today, i);
      for(const t of dailies()){ if(!t.remind || !t.days.includes(dowOf(k))) continue; if(isDone(t,k)) continue;
        const when = at(k, t.remind); if(when.getTime() <= now+30e3) continue;
        list.push({id:hashId(t.id)+i, title:t.title, body:t.notes||"Open Healthbook to tick it off.", smallIcon:"ic_stat_healthbook", channelId:"reminders", schedule:{at:when.toISOString(), allowWhileIdle:true}, extra:{tid:t.id}}); }
      if(S.settings.logReminder){ const logged = logVal(k,"mood")!=null && logVal(k,"stress")!=null, when = at(k, S.settings.logReminder);
        if(!logged && when.getTime() > now+30e3) list.push({id:150000000+i, title:"Log your day", body:"Mood, stress, water, steps. Ten seconds.", smallIcon:"ic_stat_healthbook", channelId:"reminders", schedule:{at:when.toISOString(), allowWhileIdle:true}, extra:{go:"log"}}); }
    }
    list.push({id:160000000, title:"Your monthly summary is ready", body:"See last month's patterns in Trends, ready to share with a doctor.", smallIcon:"ic_stat_healthbook", channelId:"reminders", schedule:{on:{day:1, hour:9, minute:0}, allowWhileIdle:true}, extra:{go:"trends"}});
    await LN.schedule({notifications:list});
  }catch(e){ dlog("reminders", e); }
}

/* ================= backup ================= */
/* Shared files are written to the private cache only for the moment it takes to hand them over,
   then removed. Anything left behind by a crash is swept at the next start. */
async function dropShared(path){ if(!FS) return; try{ await FS.deleteFile({path, directory:"CACHE"}); }catch(e){} }
async function sweepShared(){ if(!FS) return; try{ const r = await FS.readdir({path:"", directory:"CACHE"}); for(const f of (r.files||[])){ const n = typeof f==="string" ? f : f.name; if(/^(healthbook-|health-summary-).*\.(json|pdf)$/i.test(n||"")) await dropShared(n); } }catch(e){} }
async function exportBackup(){
  const data = JSON.stringify(Object.assign({app:"healthbook", exported:new Date().toISOString()}, S), null, 1), name = `healthbook-backup-${TODAY()}.json`;
  if(FS && SHARE){ try{ const w = await FS.writeFile({path:name, data, directory:"CACHE", encoding:"utf8"}); try{ await SHARE.share({title:"Healthbook backup", files:[w.uri]}); } finally { setTimeout(()=>dropShared(name), 60e3); } return; }catch(e){ if(String(e&&e.message||e).toLowerCase().includes("cancel")) return; toast("Couldn't share the backup"); return; } }
  try{ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data],{type:"application/json"})); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }catch(e){ toast("Couldn't save the backup"); }
}
function importBackup(file){
  const r = new FileReader();
  r.onload = ()=>{ let d; try{ d = JSON.parse(r.result); }catch(e){ toast("That file isn't a Healthbook backup"); return; }
    if(!d || !Array.isArray(d.tasks) || !d.hist){ toast("That file isn't a Healthbook backup"); return; }
    openSheet(`<span class="grab"></span><h3 class="big3">Restore backup?</h3><p class="sub">Replaces everything on this phone with the backup from ${esc(d.exported?new Date(d.exported).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}):"the file")}.</p><div class="btns"><button class="btn sec" data-s="cancel">Cancel</button><button class="btn" data-s="ok">Restore</button></div>`, b=>{
      if(b.dataset.s==="ok"){ delete d.app; delete d.exported; S = migrate(d); if(window.applySchedule) applySchedule(); applyTheme(); save(); scheduleReminders(); closeSheet(); go("today"); toast("Backup restored"); } else closeSheet(); }); };
  r.readAsText(file);
}

/* ================= theme ================= */
const SB = plugin("SystemBars");
function applyTheme(){
  const t = (S && S.settings.theme) || "system", root = document.documentElement;
  if(t==="system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  const dark = t==="dark" || t==="amoled" || (t==="system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const m = document.querySelector('meta[name="theme-color"]'); if(m) m.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim());
  if(SB){ try{ SB.setStyle({style: dark ? "DARK" : "LIGHT"}).catch(()=>{}); }catch(e){} }
}
try{ matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); }catch(e){}
const THEMES = [["system","System","linear-gradient(135deg,#F2F2F7 50%,#1C1C1E 50%)"],["light","Light","#F2F2F7"],["dark","Dark","#1C1C1E"],["amoled","AMOLED","#000"]];
function themePicker(){ const cur = S.settings.theme||"system"; return `<div class="theme-pick" role="group" aria-label="Appearance">${THEMES.map(([id,n,bg])=>`<button type="button" data-themepick="${id}" aria-pressed="${cur===id}"><i style="background:${bg}"></i>${n}</button>`).join("")}</div>`; }
function setTheme(id){ S.settings.theme = id; save(); applyTheme(); document.querySelectorAll("[data-themepick]").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.themepick===id))); }

/* ================= rules: plain-text format ================= */
const FORMAT_GUIDE = `Write one item per line under a heading.
Put options in brackets at the end, separated by commas.

Dailies:
- Drink a glass of water (morning, nourish)
- Stretch 10 minutes — Notes go after a long dash (evening, move, medium, mon wed fri, 18:30)
- 8 glasses of water (day, nourish, when water >= 8)
Habits:
- Workout (move, hard, 3 a week)
- Junk food (nourish, slip)
To-dos:
- Book a dental cleaning (care, important, 2026-12-01)
Rewards:
- Movie night (100)
Trackers:
- Caffeine (counter, target 3, cups, yellow, on today)
- Energy (scale, green, higher is better)

Time of day: morning, day, evening, night, any time
Category: move, nourish, rest, mind
Difficulty: easy, medium, hard (more XP)
Days: mon tue wed thu fri sat sun, weekdays, weekends (default every day)
Reminder: a time like 07:30 or 7:30 pm
Auto-tick: when <tracker> >= / <= <number>, or when <tracker> is logged
Habits: 3 a week, 2 a day, slip (tracked, never penalised), both
To-dos: important, a due date like 2026-12-01
Trackers: scale, hours, counter, number; target N, goal N, range 7-9; a unit; red, green, blue, yellow; higher/lower is better; on today`;
const BLOCK_WORDS = {morning:"dawn",dawn:"dawn",early:"dawn",wake:"dawn","wake up":"dawn",day:"day",daytime:"day",afternoon:"day",midday:"day",noon:"day",lunch:"day",work:"day",evening:"eve",eve:"eve",dinner:"eve",night:"wind",bedtime:"wind",bed:"wind","before bed":"wind","wind-down":"wind","wind down":"wind",winddown:"wind",any:"any",anytime:"any","any time":"any",whenever:"any"};
const CAT_WORDS = {move:"move",movement:"move",exercise:"move",fitness:"move",body:"move",activity:"move",training:"move",nourish:"fuel",nutrition:"fuel",food:"fuel",diet:"fuel",eat:"fuel",eating:"fuel",hydration:"fuel",fuel:"fuel",rest:"rest",sleep:"rest",recovery:"rest",screens:"rest",screen:"rest",mind:"care",care:"care","mind & care":"care","mind and care":"care",mental:"care",selfcare:"care","self-care":"care","self care":"care",social:"care",mindfulness:"care",hygiene:"care",health:"care"};
const DAY_WORDS = {mon:0,monday:0,tue:1,tues:1,tuesday:1,wed:2,weds:2,wednesday:2,thu:3,thur:3,thurs:3,thursday:3,fri:4,friday:4,sat:5,saturday:5,sun:6,sunday:6};
const COLOR_WORDS = {red:"red",green:"green",blue:"blue",yellow:"yellow",orange:"yellow",gold:"yellow",purple:"blue",pink:"red"};
const BLOCK_OUT = {dawn:"morning",day:"day",eve:"evening",wind:"night",any:"any time"};
const CAT_OUT = {move:"move",fuel:"nourish",rest:"rest",care:"mind"};
function parseTime(tok){ const m = tok.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i); if(!m || (!m[2] && !m[3])) return null; let h = Number(m[1]); const mi = Number(m[2]||0); if(m[3]){ const pm = m[3].toLowerCase()==="pm"; if(h===12) h = pm?12:0; else if(pm) h += 12; } if(h>23 || mi>59) return null; return p2(h)+":"+p2(mi); }
function sectionOf(line){
  const m = line.trim().replace(/^#+\s*/,"").replace(/^\*\*|\*\*$/g,"").replace(/[:：]\s*$/,"").trim().toLowerCase();
  if(/^(daily|dailies|daily habits|every ?day|routine)$/.test(m)) return "daily";
  if(/^(habits?|habit trackers?)$/.test(m)) return "habit";
  if(/^(to-?\s?dos?|todos?|one-?(time|offs?)|tasks|one-time tasks)$/.test(m)) return "todo";
  if(/^rewards?$/.test(m)) return "reward";
  if(/^(trackers?|logs?|metrics)$/.test(m)) return "tracker";
  return null;
}
function splitItem(line){
  let t = line.replace(/^\s*(?:[-*•–·]|\d+[.)]|\[\s?[xX ]?\])\s*/,"").trim(), tags = [];
  const m = t.match(/\(([^()]*)\)\s*$/); if(m){ tags = m[1].split(/[,;]/).map(x=>x.trim()).filter(Boolean); t = t.slice(0,m.index).trim(); }
  let notes = ""; const parts = t.split(/\s+[—–]\s+|\s+--\s+/); if(parts.length>1){ t = parts[0].trim(); notes = parts.slice(1).join(" — ").trim(); }
  return {title:t.replace(/\s+/g," ").slice(0,120), notes:notes.slice(0,400), tags};
}
const slug = s=>s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,30) || "tracker";
function parseRules(text){
  const out = {daily:[], habit:[], todo:[], reward:[], tracker:[], warnings:[]};
  const rows = []; let sec = null;
  const BULLET = /^\s*(?:[-*•–·]|\d+[.)]|\[\s?[xX ]?\])\s+/;
  const lines = String(text||"").replace(/\r/g,"").split("\n");
  const usesBullets = lines.some(l=>BULLET.test(l));
  for(const raw of lines){
    const line = raw.trim().replace(/\*\*|__|`/g,""); if(!line) continue;
    const s2 = sectionOf(line); if(s2){ sec = s2; continue; }
    if(/^#/.test(line) || /^\/\//.test(line)) continue;
    const bullet = BULLET.test(raw);
    if(!sec && !bullet) continue;
    if(usesBullets && !bullet) continue;
    if(!bullet && (/[:：]$/.test(line) || line.length > 140)) continue;
    rows.push({sec: sec || "daily", item: splitItem(line)});
  }
  const today = TODAY();
  const known = ()=>S.trackers.concat(out.tracker);
  const findTracker = name=>{ const n = name.toLowerCase().trim(); return known().find(t=>t.name.toLowerCase()===n || t.id===n) || known().find(t=>t.name.toLowerCase().startsWith(n) || n.startsWith(t.name.toLowerCase())); };
  const used = new Set(S.trackers.map(t=>t.id)), colorCycle = ["blue","green","yellow","red"];
  for(const r of rows.filter(r=>r.sec==="tracker")){
    const {title, tags} = r.item; if(!title) continue;
    const existing = S.trackers.find(t=>t.name.toLowerCase()===title.toLowerCase()) || out.tracker.find(t=>t.name.toLowerCase()===title.toLowerCase());
    const t = {name:title, kind:"number", unit:"", color:colorCycle[out.tracker.length%4], better:"up", quick:false, decimals:1};
    for(const tag of tags){ const w = tag.toLowerCase(); let m;
      if(/^(scale|1-10|1 to 10|rating|score)$/.test(w)) t.kind = "scale";
      else if(/^(hours?|hrs?|duration)$/.test(w)) t.kind = "hours";
      else if(/^(counter|count|tally)$/.test(w)) t.kind = "count";
      else if(/^(glasses|cups)$/.test(w)){ if(t.kind==="number") t.kind = "count"; t.unit = w; }
      else if(/^(number|numeric|value)$/.test(w)) t.kind = "number";
      else if(COLOR_WORDS[w]) t.color = COLOR_WORDS[w];
      else if(/^(higher|higher is better|higher better|up|more is better)$/.test(w)) t.better = "up";
      else if(/^(lower|lower is better|lower better|down|less is better)$/.test(w)) t.better = "down";
      else if(/^(neither|neutral)$/.test(w)) t.better = null;
      else if(/^(on today|today|quick|pinned|pin)$/.test(w)) t.quick = true;
      else if((m = w.match(/^target\s*([\d.]+)$/))) t.target = Number(m[1]);
      else if((m = w.match(/^(?:goal|min|at least)\s*([\d.]+)$/))) t.min = Number(m[1]);
      else if((m = w.match(/^(?:max|limit|at most)\s*([\d.]+)$/))) t.max = Number(m[1]);
      else if((m = w.match(/^range\s*([\d.]+)\s*[-–to]+\s*([\d.]+)$/))){ t.min = Number(m[1]); t.max = Number(m[2]); }
      else if(/^[\d.]+$/.test(w)) t.target = Number(w);
      else if((m = w.match(/^unit\s+(.+)$/))) t.unit = m[1];
      else if(w.length<=14) t.unit = tag;
    }
    if(t.kind==="scale"){ t.unit = "/10"; t.lo = "Low"; t.hi = "High"; }
    if(t.kind==="hours"){ t.unit = t.unit||"hr"; t.step = 0.5; if(t.min!=null && t.max!=null) t.better = "range"; }
    if(t.kind==="count"){ t.target = t.target||8; t.decimals = 0; }
    if(existing){ if(existing.kind!==t.kind && S.trackers.includes(existing)){ out.warnings.push(`Tracker "${title}" already exists as a different type, so it was left as is`); continue; } t.id = existing.id; t._update = true; out.tracker.push(t); continue; }
    let id = slug(title); while(used.has(id)) id += "-2"; used.add(id); t.id = id;
    out.tracker.push(t);
  }
  for(const r of rows.filter(r=>r.sec!=="tracker")){
    const {title, notes, tags} = r.item; if(!title) continue;
    if(r.sec==="reward"){ let cost = 50; for(const tag of tags){ const m = tag.match(/^(\d+)\s*(coins?)?$/i); if(m) cost = Number(m[1]); } out.reward.push({id:uid(), title, cost:Math.max(1,cost)}); continue; }
    const base = {id:uid(), type:r.sec, title, notes, cat:"care", diff:1, created:today};
    const daysSet = new Set();
    let explicitCat = false;
    if(r.sec==="daily") Object.assign(base, {block:"any", days:null, remind:null, checklist:[], auto:null});
    if(r.sec==="habit") Object.assign(base, {kind:"good", target:null, period:"week"});
    if(r.sec==="todo") Object.assign(base, {due:null, done:false, doneDay:null, star:false, checklist:[]});
    for(const tag of tags){ const w = tag.toLowerCase().replace(/\s+/g," ").trim(); let m;
      if(CAT_WORDS[w]){ base.cat = CAT_WORDS[w]; explicitCat = true; continue; }
      if(w==="easy"){ base.diff = 1; continue; } if(w==="medium"){ base.diff = 2; continue; } if(w==="hard"){ base.diff = 3; continue; }
      if(r.sec==="daily"){
        if(BLOCK_WORDS[w]){ base.block = BLOCK_WORDS[w]; continue; }
        if(/^(daily|every ?day|all days)$/.test(w)){ [0,1,2,3,4,5,6].forEach(d=>daysSet.add(d)); continue; }
        if(w==="weekdays"){ [0,1,2,3,4].forEach(d=>daysSet.add(d)); continue; }
        if(w==="weekends"||w==="weekend"){ [5,6].forEach(d=>daysSet.add(d)); continue; }
        const toks = w.split(/[\s/&]+|\band\b/).filter(Boolean); if(toks.length && toks.every(x=>DAY_WORDS[x]!=null)){ toks.forEach(x=>daysSet.add(DAY_WORDS[x])); continue; }
        const tm = parseTime(w.replace(/^(at|@|remind(?:er)?(?: at)?)\s*/,"")); if(tm){ base.remind = tm; continue; }
        if((m = w.match(/^when\s+(.+?)\s*(>=|=>|≥|at least|<=|=<|≤|at most|is logged|logged|is set)\s*([\d.,]*)$/))){
          const tr = findTracker(m[1]); if(!tr){ out.warnings.push(`"${title}": no tracker called "${m[1]}"`); continue; }
          const op = /is logged|logged|is set/.test(m[2]) ? "set" : /<=|=<|≤|at most/.test(m[2]) ? "lte" : "gte";
          const v = op==="set" ? null : Number(String(m[3]).replace(/,/g,"")); if(op!=="set" && !(v>=0)){ out.warnings.push(`"${title}": missing number after ${m[2]}`); continue; }
          (base.auto = base.auto || []).push({t:tr.id, op, v}); continue; }
      }
      if(r.sec==="habit"){
        if(/^(slip|slips|bad|avoid|negative|minus)$/.test(w)){ base.kind = "bad"; continue; }
        if(w==="both"){ base.kind = "both"; continue; } if(/^(good|positive|plus)$/.test(w)){ base.kind = "good"; continue; }
        if((m = w.match(/^(\d+)\s*(?:x|times)?\s*(?:a|per|\/|each|every)?\s*(day|week|daily|weekly)$/))){ base.target = Number(m[1]); base.period = /day|daily/.test(m[2]) ? "day" : "week"; continue; }
      }
      if(r.sec==="todo"){
        if(/^(important|star|starred|priority|start here|first)$/.test(w)){ base.star = true; continue; }
        if((m = w.match(/^(?:due\s*)?(\d{4}-\d{2}-\d{2})$/))){ base.due = m[1]; continue; }
      }
      out.warnings.push(`"${title}": didn't understand "${tag}"`);
    }
    if(r.sec==="daily"){ base.days = daysSet.size ? [...daysSet].sort() : [0,1,2,3,4,5,6]; if(base.block==="any" && base.remind){ const h = Number(base.remind.slice(0,2)); base.block = h<8&&h>=4?"dawn":h<18&&h>=8?"day":h<21?"eve":"wind"; } }
    if(!explicitCat){ const s3 = (title+" "+notes).toLowerCase(); base.cat = /walk|run|steps|gym|workout|train|stretch|yoga|move|exercise|cardio|sport|swim|cycl|climb|skate|lift/.test(s3) ? "move" : /water|eat|food|meal|protein|veg|fruit|breakfast|lunch|dinner|snack|sugar|drink|cook|diet/.test(s3) ? "fuel" : /sleep|bed|screen|phone|caffeine|nap|read|rest|lights/.test(s3) ? "rest" : "care"; }
    out[r.sec].push(base);
  }
  return out;
}
function parsePackJSON(text){
  let d; try{ d = JSON.parse(text); }catch(e){ return null; }
  if(!d || !Array.isArray(d.tasks)) return null;
  const out = {daily:[], habit:[], todo:[], reward:[], tracker:[], warnings:[]}, today = TODAY();
  for(const raw of d.tasks){ let c; try{ c = cleanTask(JSON.parse(JSON.stringify(raw))); }catch(e){ c = null; } if(!c) continue; c.id = uid(); c.created = today; if(c.type==="todo"){ c.done = false; c.doneDay = null; } if(c.checklist) c.checklist = c.checklist.map(x=>({id:uid(), text:x.text})); out[c.type].push(c); }
  for(const r of (Array.isArray(d.rewards)?d.rewards:[])) if(r && r.title) out.reward.push({id:uid(), title:String(r.title).slice(0,80), cost:Math.max(1,Math.round(Number(r.cost)||50))});
  for(const raw of (Array.isArray(d.trackers)?d.trackers:[])){ let t; try{ t = cleanTracker(JSON.parse(JSON.stringify(raw))); }catch(e){ t = null; } if(!t) continue; const ex = S.trackers.find(x=>x.id===t.id || x.name.toLowerCase()===t.name.toLowerCase()); if(ex){ if(ex.kind===t.kind){ t.id = ex.id; t._update = true; out.tracker.push(t); } continue; } out.tracker.push(t); }
  return out;
}
function packCounts(p){ return {daily:p.daily.length, habit:p.habit.length, todo:p.todo.length, reward:p.reward.length, tracker:p.tracker.length}; }
function applyPack(p, mode){
  if(mode==="replace"){ const now = Date.now(); for(const t of S.tasks) if(!(t.type==="todo" && t.done)) S.removed[t.id] = now; for(const r of S.rewards) S.removed[r.id] = now; S.tasks = S.tasks.filter(t=>t.type==="todo" && t.done); S.rewards = []; }
  const have = new Set(S.tasks.map(t=>t.type+"|"+t.title.toLowerCase())), haveR = new Set(S.rewards.map(r=>r.title.toLowerCase()));
  let n = 0;
  for(const t of p.tracker){ const ex = S.trackers.find(x=>x.id===t.id); if(t._update && ex){ const c = Object.assign({}, t); delete c._update; delete c.id; if(ex.lo) { delete c.lo; delete c.hi; } Object.assign(ex, c); } else { const c = Object.assign({}, t); delete c._update; delete S.removed["trk:"+c.id]; S.trackers.push(c); } n++; }
  for(const type of ["daily","habit","todo"]) for(const t of p[type]){ if(have.has(type+"|"+t.title.toLowerCase())) continue; S.tasks.push(t); n++; }
  for(const r of p.reward){ if(haveR.has(r.title.toLowerCase())) continue; S.rewards.push(r); n++; }
  evalAuto(TODAY()); save(); scheduleReminders(false);
  return n;
}
function rulesText(){
  const L = [`# ${S.profile.name ? S.profile.name+"'s" : "My"} Healthbook rules`, ""];
  const tname = id=>{ const t = trk(id); return t ? t.name.toLowerCase() : id; };
  const ds = S.tasks.filter(t=>t.type==="daily" && !t.archived);
  if(ds.length){ L.push("Dailies:"); for(const t of ds){ const tg = [BLOCK_OUT[t.block]||"any time", CAT_OUT[t.cat]]; if(t.diff>1) tg.push(DIFF[t.diff].toLowerCase()); if(t.days.length<7) tg.push(t.days.map(d=>DOW_LONG[d].slice(0,3).toLowerCase()).join(" ")); if(t.remind) tg.push(t.remind); for(const c of (t.auto||[])) tg.push(c.op==="set" ? `when ${tname(c.t)} is logged` : `when ${tname(c.t)} ${c.op==="gte"?">=":"<="} ${c.v}`); L.push(`- ${t.title}${t.notes?` — ${t.notes}`:""} (${tg.join(", ")})`); } L.push(""); }
  const hs = S.tasks.filter(t=>t.type==="habit" && !t.archived);
  if(hs.length){ L.push("Habits:"); for(const t of hs){ const tg = [CAT_OUT[t.cat]]; if(t.diff>1) tg.push(DIFF[t.diff].toLowerCase()); if(t.kind==="bad") tg.push("slip"); if(t.kind==="both") tg.push("both"); if(t.target) tg.push(`${t.target} a ${t.period}`); L.push(`- ${t.title}${t.notes?` — ${t.notes}`:""} (${tg.join(", ")})`); } L.push(""); }
  const td = S.tasks.filter(t=>t.type==="todo" && !t.done && !t.archived);
  if(td.length){ L.push("To-dos:"); for(const t of td){ const tg = [CAT_OUT[t.cat]]; if(t.diff>1) tg.push(DIFF[t.diff].toLowerCase()); if(t.star) tg.push("important"); if(t.due) tg.push(t.due); L.push(`- ${t.title}${t.notes?` — ${t.notes}`:""} (${tg.join(", ")})`); } L.push(""); }
  if(S.rewards.length){ L.push("Rewards:"); for(const r of S.rewards) L.push(`- ${r.title} (${r.cost})`); L.push(""); }
  const defs = Object.fromEntries(defaultTrackers().map(t=>[t.id,t])), keyOf = t=>JSON.stringify([t.kind,t.unit,t.color,t.target??null,t.min??null,t.max??null,t.better??null,!!t.quick]);
  const custom = S.trackers.filter(t=>!defs[t.id] || keyOf(defs[t.id])!==keyOf(t));
  if(custom.length){ L.push("Trackers:"); for(const t of custom){ const tg = [{scale:"scale",hours:"hours",count:"counter",number:"number"}[t.kind]]; if(t.kind==="count" && t.target) tg.push(`target ${t.target}`); if(t.kind!=="scale" && t.unit) tg.push(t.unit); if(t.min!=null && t.max!=null) tg.push(`range ${t.min}-${t.max}`); else if(t.min!=null) tg.push(`goal ${t.min}`); tg.push(t.color); if(t.better==="up") tg.push("higher is better"); if(t.better==="down") tg.push("lower is better"); if(t.quick) tg.push("on today"); L.push(`- ${t.name} (${tg.join(", ")})`); } }
  return L.join("\n").trim()+"\n";
}
async function shareRules(){
  const txt = rulesText();
  if(SHARE){ try{ await SHARE.share({title:"My Healthbook rules", text:txt, dialogTitle:"Share your rules"}); return; }catch(e){ if(String(e&&e.message||e).toLowerCase().includes("cancel")) return; } }
  openSheet(`<span class="grab"></span><h3 class="big3">Your rules</h3><p class="sub">Friends can paste this into Tasks → Import rules.</p><pre class="fmt" style="width:100%">${esc(txt)}</pre><div class="btns"><button class="btn sec" data-s="x">Close</button><button class="btn" data-s="copy">Copy</button></div>`, async b=>{ if(b.dataset.s==="copy"){ try{ await navigator.clipboard.writeText(txt); toast("Copied"); }catch(e){ toast("Select the text and copy it"); } } else closeSheet(); });
}
function openImport(after){
  let mode = "add", parsed = null;
  const html = `<span class="grab"></span><div class="shead"><button data-s="cancel">Cancel</button><h3>Import rules</h3><button class="r" data-s="go" disabled>Import</button></div>
    <p class="hint" style="width:100%">Paste rules or pick a .txt or .json file. Any AI chatbot can write them using the guide below.</p>
    <textarea class="tin" id="rules-text" style="min-height:190px;width:100%;font:14px/1.45 ui-monospace,Menlo,monospace" placeholder="Dailies:\n- Drink a glass of water (morning, nourish)\nHabits:\n- Workout (move, hard, 3 a week)"></textarea>
    <div class="btns"><button class="btn sec" data-s="file">Choose file</button><button class="btn sec" data-s="starter">Use starter plan</button></div>
    <input type="file" id="rules-file" accept=".txt,.md,.json,text/plain,application/json" hidden>
    <div id="found" class="found" style="width:100%"></div>
    <div style="width:100%">${segHTML("mode", [["add","Add to my plan"],["replace","Replace my plan"]], mode)}</div>
    <p class="hint" style="width:100%">Replace swaps your tasks and rewards. Logs and XP stay.</p>
    <div class="fld" style="width:100%"><span class="lab">Format guide</span><pre class="fmt">${esc(FORMAT_GUIDE)}</pre><button class="btn sec" data-s="copyguide">Copy guide</button></div>`;
  openSheet(html, async b=>{ const d = b.dataset;
    if(d.pick){ pickIn(b); mode = d.v; return; }
    if(d.s==="cancel"){ closeSheet(); if(after) after(false); }
    else if(d.s==="file") sheet.querySelector("#rules-file").click();
    else if(d.s==="starter"){ sheet.querySelector("#rules-text").value = STARTER_RULES; update(); }
    else if(d.s==="copyguide"){ try{ await navigator.clipboard.writeText(FORMAT_GUIDE); toast("Guide copied"); }catch(e){ toast("Select the guide text and copy it"); } }
    else if(d.s==="go" && parsed){ const n = applyPack(parsed, mode); closeSheet(); toast(`Imported ${n} item${n===1?"":"s"}`); if(after) after(true); else render(true); }
  });
  const ta = sheet.querySelector("#rules-text"), found = sheet.querySelector("#found"), go = sheet.querySelector('[data-s="go"]');
  const update = ()=>{ const txt = ta.value.trim(); parsed = txt ? (txt.startsWith("{") ? parsePackJSON(txt) : parseRules(txt)) : null;
    if(!parsed){ found.innerHTML = txt ? `<span style="--c:var(--red)">That file isn't a Healthbook rules file</span>` : ""; go.disabled = true; return; }
    const c = packCounts(parsed), total = Object.values(c).reduce((a,b)=>a+b,0);
    found.innerHTML = [["daily","dailies","var(--green)"],["habit","habits","var(--blue)"],["todo","to-dos","var(--red)"],["reward","rewards","var(--yellow)"],["tracker","trackers","var(--blue)"]].filter(([k])=>c[k]).map(([k,n,col])=>`<span style="--c:${col}">${c[k]} ${c[k]===1?n.replace(/ies$/,"y").replace(/s$/,""):n}</span>`).join("") + (parsed.warnings.length ? `<p class="hint" style="width:100%;margin-top:4px">${parsed.warnings.length} note${parsed.warnings.length>1?"s":""}: ${esc(parsed.warnings.slice(0,3).join("; "))}${parsed.warnings.length>3?"…":""}</p>` : "") + (total ? "" : `<p class="hint">Nothing found yet. Start lines with "- " under a heading like Dailies:</p>`);
    go.disabled = !total; };
  ta.addEventListener("input", update);
  sheet.querySelector("#rules-file").addEventListener("change", e=>{ const f = e.target.files && e.target.files[0]; if(!f) return; const r = new FileReader(); r.onload = ()=>{ ta.value = String(r.result||""); update(); }; r.readAsText(f); });
}

/* ================= onboarding ================= */
function onboarding(start){
  let step = start||1;
  const dots = n=>`<div class="steps-dots">${[1,2,3].map(i=>`<i class="${i<=n?"on":""}"></i>`).join("")}</div>`;
  const ic = (svg,c)=>`<span class="ci" style="--c:${c}">${svg}</span>`;
  const draw = ()=>{
    if(step===1) return `<span class="grab"></span>${dots(1)}<h3 class="big3">Welcome to Healthbook</h3><p class="sub">Build habits, log how you feel, see patterns. Stays on this phone.</p>
      <div class="form"><div class="fld"><label for="ob-name">Your name</label><input class="tin" id="ob-name" value="${esc(S.profile.name||"")}" placeholder="What should we call you?" maxlength="40"></div>
      <div class="fld"><span class="lab">Appearance</span>${themePicker()}</div></div><button class="btn" data-s="next">Continue</button>`;
    if(step===2) return `<span class="grab"></span>${dots(2)}<h3 class="big3">How do you want to start?</h3><p class="sub">You can change everything later in Tasks.</p>
      <button class="choice" data-s="starter">${ic(ICON.done,"var(--green)")}<b>Healthy basics</b><span class="d">17 dailies, 4 habits, 3 to-dos and rewards to get you going.</span></button>
      <button class="choice" data-s="import">${ic(`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 20h14"/></svg>`,"var(--blue)")}<b>Import my own rules</b><span class="d">Paste or load a rules file, yours or a friend's.</span></button>
      <button class="choice" data-s="empty">${ic(ICON.plus.replace('stroke="currentColor"','stroke="#fff"'),"var(--yellow)")}<b>Start empty</b><span class="d">Add your own dailies and habits one by one.</span></button>`;
    return `<span class="grab"></span>${dots(3)}<h3 class="big3">Reminders</h3><p class="sub">Nudges at your daily times, plus an evening log reminder.</p><button class="btn" data-s="rem">Turn on reminders</button><button class="btn sec" data-s="done">Not now</button>`;
  };
  const finish = ()=>{ S.onboarded = true; save(); closeSheet(); render(); };
  openSheet(draw(), b=>{ const d = b.dataset;
    if(d.themepick){ setTheme(d.themepick); return; }
    if(d.s==="next"){ S.profile.name = val("ob-name").trim(); save(); step = 2; sheet.querySelector(".sheet").innerHTML = draw(); }
    else if(d.s==="starter"){ applyPack(parseRules(STARTER_RULES),"add"); step = 3; sheet.querySelector(".sheet").innerHTML = draw(); }
    else if(d.s==="empty"){ step = 3; sheet.querySelector(".sheet").innerHTML = draw(); }
    else if(d.s==="import"){ closeSheet(); openImport(ok=>{ if(!ok){ onboarding(2); return; } S.onboarded = true; save(); render(); onboardingReminders(); }); }
    else if(d.s==="rem"){ S.settings.reminders = true; save(); scheduleReminders(true); finish(); }
    else if(d.s==="done") finish();
  }, null, true);
}
function onboardingReminders(){
  openSheet(`<span class="grab"></span><h3 class="big3">Reminders</h3><p class="sub">Nudges at your daily times, plus an evening log reminder.</p><button class="btn" data-s="rem">Turn on reminders</button><button class="btn sec" data-s="done">Not now</button>`, b=>{ if(b.dataset.s==="rem"){ S.settings.reminders = true; save(); scheduleReminders(true); } closeSheet(); render(); }, null, true);
}

/* ================= events ================= */
const V = $("#view");
V.addEventListener("change", e=>{
  const el = e.target, d = el.dataset, k = TODAY();
  if(d.daily){ const t = S.tasks.find(x=>x.id===d.daily); setDaily(t,k,el.checked); if(el.checked){ ding(); tick(); } render(true); return; }
  if(d.todo){ const t = S.tasks.find(x=>x.id===d.todo); setTodo(t,el.checked); if(el.checked){ ding(); tick(); } render(true); return; }
  if(d.num){ const t = trk(d.num), v = num(el.value); setLogVal(logDay||k, d.num, v==null?null:Math.round(v*Math.pow(10,t.decimals==null?1:t.decimals))/Math.pow(10,t.decimals==null?1:t.decimals)); render(true); return; }
  if(d.setting){ const s = S.settings, f = d.setting;
    if(f==="name") S.profile.name = el.value.trim();
    else if(f==="dayStart") s.dayStart = Number(el.value);
    else if(f==="logReminder") s.logReminder = el.value||null;
    else s[f] = el.checked;
    save(); if(f==="reminders"||f==="logReminder") scheduleReminders(f==="reminders" && el.checked); return; }
  if(el.id==="importfile" && el.files && el.files[0]) importBackup(el.files[0]);
});
V.addEventListener("click", e=>{
  const b = e.target.closest("button,[data-open],[data-edit],[data-editreward],[data-edittracker]"); if(!b) return; const d = b.dataset, k = TODAY();
  if(d.go){ go(d.go); return; }
  if(d.open){ openDetail(d.open); return; }
  if(d.edit){ editTask(d.edit); return; }
  if(d.editreward){ editReward(d.editreward); return; }
  if(d.edittracker){ editTracker(d.edittracker); return; }
  if(d.habit){ const t = S.tasks.find(x=>x.id===d.habit); tapHabit(t,k,d.dir,1); tick(); if(d.dir==="u") tone(1047,.15,.04); render(true); return; }
  if(d.quick){ logDay = k; go("log"); setTimeout(()=>{ const el = document.getElementById("tr-"+d.quick); if(el) el.scrollIntoView({block:"center"}); }, 30); return; }
  const lk = logDay || k;
  if(d.scale){ const v = Number(d.v); setLogVal(lk, d.scale, logVal(lk,d.scale)===v?null:v); tick(); render(true); return; }
  if(d.step){ const t = trk(d.step), cur = logVal(lk,t.id), st = t.kind==="hours" ? (t.step||.5) : 1; let v = cur==null ? (t.kind==="hours" ? (t.min||7) : 1) : cur + Number(d.d)*st; v = Math.max(0, Math.round(v*100)/100); setLogVal(lk, t.id, v); tick(); render(true); return; }
  if(d.drop){ const n = Number(d.n), cur = logVal(lk,d.drop)||0; setLogVal(lk, d.drop, n===cur ? (n-1||null) : n); tick(); render(true); return; }
  if(d.clear){ setLogVal(lk, d.clear, null); render(true); return; }
  if(d.day){ const nk = addDays(lk, Number(d.day)); if(nk<=k && nk>=addDays(k,-90)){ logDay = nk; render(true); } return; }
  if(d.range){ trendRange = Number(d.range); render(true); return; }
  if(d.seg){ taskSeg = d.seg; render(true); return; }
  if(d.rules==="import"){ openImport(null); return; }
  if(d.rules==="share"){ shareRules(); return; }
  if(d.themepick){ setTheme(d.themepick); return; }
  if(d.cleartodos){ for(const t of S.tasks) if(t.type==="todo" && t.done) S.removed[t.id] = Date.now(); S.tasks = S.tasks.filter(t=>!(t.type==="todo" && t.done)); save(); render(true); return; }
  if(d.privacy){ fetch("privacypolicy.html").then(r=>r.text()).then(t=>{ const body = (t.match(/<body[^>]*>([\s\S]*)<\/body>/i)||[0,t])[1]; openSheet(`<span class="grab"></span><div class="card" style="width:100%;font-size:15px;line-height:1.5">${body}</div><button class="btn" data-s="x">Close</button>`, ()=>closeSheet()); }).catch(()=>toast("Couldn't open the privacy policy")); return; }
  if(d.addreward){ editReward(null); return; }
  if(d.buy){ buyReward(d.buy); return; }
  if(d.backup==="export"){ exportBackup(); return; }
  if(d.backup==="import"){ $("#importfile").click(); return; }
  if(d.reset){ openSheet(`<span class="grab"></span><h3 class="big3">Reset everything?</h3><p class="sub">Deletes everything on this phone and restarts setup. Export a backup first.${typeof cloudUser!=="undefined" && cloudUser ? " You'll be signed out; the copy in your account isn't touched." : ""}</p><div class="btns"><button class="btn sec" data-s="cancel">Cancel</button><button class="btn danger" data-s="ok">Reset</button></div>`, async bb=>{ if(bb.dataset.s==="ok"){ if(typeof cloudUser!=="undefined" && cloudUser) await cloudSignOut(); const th = S.settings.theme; S = seed(); S.settings.theme = th; save(); scheduleReminders(); closeSheet(); go("today"); setTimeout(window.signupFlow || onboarding, 250); } else closeSheet(); }); return; }
});
document.querySelectorAll(".tb").forEach(t=>t.addEventListener("click", ()=>{ if(t.dataset.view==="log") logDay = TODAY(); closeSheet(); go(t.dataset.view); }));
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && sheet && !sheet.locked) closeSheet(); });

/* ================= boot ================= */
let lastDay = null;
async function boot(){
  let s = loadLocal();
  if(!s) s = await loadFile();
  S = migrate(s || seed());
  if(window.applySchedule) applySchedule();
  save(); lastDay = TODAY();
  applyTheme();
  render();
  sweepShared();
  if(window.cloudInit) await cloudInit();
  if(!S.onboarded) setTimeout(window.signupFlow || onboarding, 250);
  else { scheduleReminders(false); if(window.reportsCheck) reportsCheck(); if(window.healthAutoSync) healthAutoSync(); }
  if(APP){
    APP.addListener("backButton", ()=>{ if($(".lvlup")){ $(".lvlup").remove(); return; } if(sheet){ if(!sheet.locked){ closeSheet(); render(true); } return; } if(view!=="today"){ go("today"); return; } APP.minimizeApp ? APP.minimizeApp() : APP.exitApp(); });
    APP.addListener("appStateChange", st=>{ if(st.isActive){ if(TODAY()!==lastDay){ lastDay = TODAY(); logDay = null; } if(!sheet) render(true); if(S.onboarded){ if(window.healthAutoSync) healthAutoSync(); if(window.reportsCheck) reportsCheck(); if(window.cloudPull) cloudPull(); queueReminders(); } } });
  }
  if(LN){ try{ LN.addListener("localNotificationActionPerformed", ev=>{ const x = ev && ev.notification && ev.notification.extra; if(x && x.go) go(x.go); else go("today"); }); }catch(e){} }
  setInterval(()=>{ if(TODAY()!==lastDay){ lastDay = TODAY(); logDay = null; if(!sheet) render(true); if(S.onboarded) queueReminders(); } }, 60000);
}
document.addEventListener("DOMContentLoaded", boot);
