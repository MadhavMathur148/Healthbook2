/* Sign-up: account, a few quick questions, and a plan built from the answers with fixed rules. */
"use strict";
const GOALS = [["sleep","Sleep better","rest"],["move","Move more","move"],["eat","Eat better","fuel"],["stress","Stress less","care"],["strength","Get stronger","move"],["water","Drink more water","fuel"],["screens","Less screen time","rest"],["routine","Build a routine","care"]];
const DEVICES = [["phone","Just my phone"],["watch","Smartwatch"],["ring","Smart ring"],["band","Fitness band"],["scale","Smart scale"]];
const SEXES = [["female","Female"],["male","Male"],["other","Other"],["unspecified","Prefer not to say"]];
const tmin = t=>{ const [h,m] = String(t||"00:00").split(":").map(Number); return (h||0)*60+(m||0); };
const tfmt = m=>{ m = ((Math.round(m)%1440)+1440)%1440; return p2(Math.floor(m/60))+":"+p2(m%60); };
const t12 = t=>{ const m = tmin(t), h = Math.floor(m/60), mi = m%60; return `${h%12||12}${mi?":"+p2(mi):""} ${h<12?"am":"pm"}`; };

function applySchedule(){
  const p = S.profile || {}; if(!p.wake || !p.bed) return;
  const w = tmin(p.wake)/60; let b = tmin(p.bed)/60; if(b <= w) b += 24;
  const B = id=>BLOCKS.find(x=>x.id===id);
  B("dawn").from = w-1; B("dawn").to = w+3;
  B("day").from = w+3; B("day").to = Math.max(w+4, Math.min(18, b-4));
  B("eve").from = B("day").to; B("eve").to = b-1;
  B("wind").from = b-1; B("wind").to = w-1+24;
  BLOCKS.forEach(x=>{ if(x.id!=="any") x.when = `${t12(tfmt(x.from*60))} – ${t12(tfmt(x.to*60))}`; });
}

function planFromAnswers(p){
  const g = new Set(p.goals||[]), wake = p.wake||"07:00", bed = p.bed||"23:00", off = tfmt(tmin(bed)-60), dev = (p.devices||[]).filter(d=>d!=="phone");
  const D = [], Hb = [], T = [], seen = new Set();
  const d = l=>{ const t = l.split(" (")[0].split(" — ")[0].toLowerCase(); if(!seen.has(t)){ seen.add(t); D.push(l); } };
  const hb = l=>{ if(!Hb.includes(l)) Hb.push(l); };
  if(g.has("sleep") || !g.size){ d(`Up at ${t12(wake)} — Same time every day, weekends too. (morning, rest, medium)`); d(`No caffeine after 2 pm (day, rest)`); d(`Screens off by ${t12(off)} (night, rest, medium, ${off})`); d(`Lights out by ${t12(bed)} (night, rest, medium)`); }
  if(g.has("screens")){ d(`No phone for the first 30 minutes (morning, rest)`); d(`Screens off by ${t12(off)} (night, rest, medium, ${off})`); hb(`Doomscrolling (rest, slip)`); }
  if(g.has("water")) d(`Glass of water on waking (morning, nourish)`);
  if(g.has("eat")){ d(`Protein with breakfast (morning, nourish)`); d(`Vegetables with lunch (day, nourish)`); d(`A piece of fruit (day, nourish)`); hb(`Junk food (nourish, slip)`); }
  if(g.has("strength")){ d(`Protein with every meal (day, nourish, medium)`); hb(`Strength session (move, hard, 3 a week)`); }
  if(g.has("move")){ d(`7,000+ steps (day, move, medium, when steps >= 7000)`); d(`Move for 20 minutes — A walk counts. (day, move, medium)`); d(`Stand up at least once an hour (day, move)`); hb(`Cardio, 30 minutes (move, medium, 3 a week)`); }
  d(`8 glasses of water (day, nourish, when water >= 8)`);
  if(g.has("stress")){ d(`10 quiet minutes, no phone — Walk, stretch or just sit. (evening, mind, medium)`); d(`Time with people — Phones away. (evening, mind)`); hb(`Time outdoors (mind, medium, 3 a week)`); }
  if(g.has("routine")){ d(`Make your bed (morning, mind)`); d(`Plan tomorrow in 5 minutes (evening, mind)`); d(`Read for 10 minutes (night, rest)`); }
  d(`Log mood and stress (evening, mind, when mood is logged, when stress is logged)`);
  d(`Brush and floss (night, mind)`);
  if(p.weightKg || (p.devices||[]).includes("scale") || g.has("strength")) d(`Weigh-in (morning, move, sun, when weight is logged)`);
  d(`Look at the week in Trends (evening, mind, sun)`);
  hb(`Hobby time (mind, medium, 2 a week)`);
  T.push(`Book a yearly checkup (mind, hard, important)`);
  if(dev.length) T.push(`Connect your ${dev.includes("ring")?"ring":dev.includes("watch")?"watch":"device"} in Me → Connected apps (mind, important)`);
  if(!(typeof cloudUser!=="undefined" && cloudUser)) T.push(`Export a backup from the Me tab (mind)`);
  return `Dailies:\n${D.map(x=>"- "+x).join("\n")}\nHabits:\n${Hb.map(x=>"- "+x).join("\n")}\nTo-dos:\n${T.map(x=>"- "+x).join("\n")}\nRewards:\n- An episode of a show (40)\n- An hour of gaming (60)\n- Meal out with friends (150)\n- Something you've been wanting (600)\n`;
}

function goalIcon(cat){ return ICON[cat]; }
function signupFlow(){
  const hasCloud = typeof CLOUD!=="undefined" && !!CLOUD;
  const a = Object.assign({name:"", birthYear:null, sex:null, units:"metric", heightCm:null, weightKg:null, goals:[], wake:"07:00", bed:"23:00", devices:[]}, S.profile||{});
  let step = "welcome", acctMode = "signup", choice = "plan", reminders = true, busy = false;
  const order = ["about","goals","day","devices","finish"];
  const bar = ()=>{ const i = order.indexOf(step); return i<0 ? "" : `<div class="pbar" aria-label="Step ${i+1} of ${order.length}"><i style="width:${(i+1)/order.length*100}%"></i></div>`; };
  const nav = (next, label)=>`<div class="btns"><button class="btn sec" data-s="back" style="flex:0 0 auto;width:auto;padding:13px 18px">Back</button><button class="btn" data-s="${next}">${label||"Continue"}</button></div>`;
  const ft = cm=>{ if(!cm) return ["",""]; const inch = cm/2.54; return [Math.floor(inch/12), Math.round(inch%12)]; };
  const draw = ()=>{
    if(step==="welcome") return `<span class="grab"></span><img src="icon.png" alt="" class="hero-ic"><h3 class="big3">Healthbook</h3><p class="sub">Build habits, log how you feel, and see your patterns. Setup takes about a minute.</p>
      ${hasCloud?`<button class="btn" data-s="create">Create an account</button><button class="btn sec" data-s="signin">I already have an account</button><button class="linkbtn" data-s="local">Continue without an account</button>`:`<button class="btn" data-s="local">Get started</button>`}`;
    if(step==="account") return `<span class="grab"></span><h3 class="big3">${acctMode==="signin"?"Welcome back":"Create your account"}</h3><p class="sub">${acctMode==="signin"?"Sign in and your plan and logs come with you.":"Your data is backed up and private to your account."}</p>
      <div class="form"><div class="fld"><label for="su-email">Email</label><input class="tin" id="su-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" value="${esc(S.pendingEmail||"")}"></div>
      <div class="fld"><label for="su-pass">Password</label><input class="tin" id="su-pass" type="password" autocomplete="${acctMode==="signin"?"current-password":"new-password"}" placeholder="${acctMode==="signin"?"":"At least 8 characters"}"></div>
      <p class="hint bad" id="su-err" hidden></p></div>
      <div class="btns"><button class="btn sec" data-s="toWelcome" style="flex:0 0 auto;width:auto;padding:13px 18px">Back</button><button class="btn" data-s="auth">${acctMode==="signin"?"Sign in":"Create account"}</button></div>`;
    if(step==="about"){ const [f,i] = ft(a.heightCm); const imp = a.units==="imperial";
      return `<span class="grab"></span>${bar()}<h3 class="big3">About you</h3><p class="sub">Used for your monthly summary. Skip anything you like.</p>
      <div class="form"><div class="fld"><label for="su-name">Name</label><input class="tin" id="su-name" value="${esc(a.name||"")}" maxlength="40" autocomplete="given-name"></div>
      <div class="two"><div class="fld"><label for="su-by">Birth year</label><input class="tin" id="su-by" type="number" inputmode="numeric" placeholder="e.g. 2001" value="${a.birthYear||""}"></div><div class="fld"><span class="lab">Units</span>${segHTML("units",[["metric","Metric"],["imperial","Imperial"]],a.units)}</div></div>
      <div class="fld"><span class="lab">Sex</span>${segHTML("sex",SEXES,a.sex||"")}</div>
      ${imp?`<div class="fld"><span class="lab">Height</span><div class="two"><label class="inp"><input id="su-ft" type="number" inputmode="numeric" value="${f}"><span>ft</span></label><label class="inp"><input id="su-in" type="number" inputmode="numeric" value="${i}"><span>in</span></label></div></div>`
           :`<div class="fld"><label for="su-cm">Height</label><label class="inp"><input id="su-cm" type="number" inputmode="decimal" value="${a.heightCm||""}"><span>cm</span></label></div>`}
      <div class="fld"><label for="su-w">Weight</label><label class="inp"><input id="su-w" type="number" inputmode="decimal" value="${a.weightKg?(imp?Math.round(a.weightKg/0.453592):a.weightKg):""}"><span>${imp?"lb":"kg"}</span></label></div></div>${nav("goals")}`; }
    if(step==="goals") return `<span class="grab"></span>${bar()}<h3 class="big3">What matters most?</h3><p class="sub">Pick up to three. Your plan is built around them.</p>
      <div class="goalgrid">${GOALS.map(([id,n,c])=>`<button class="gchip" data-goal="${id}" aria-pressed="${a.goals.includes(id)}" style="--c:${CATS[c].c}"><i>${goalIcon(c)}</i>${n}</button>`).join("")}</div>${nav("day")}`;
    if(step==="day") return `<span class="grab"></span>${bar()}<h3 class="big3">Your usual day</h3><p class="sub">Healthbook groups your habits around these times and sets reminders to match.</p>
      <div class="form"><div class="two"><div class="fld"><label for="su-wake">Wake up</label><input class="tin" id="su-wake" type="time" value="${a.wake}"></div><div class="fld"><label for="su-bed">Go to bed</label><input class="tin" id="su-bed" type="time" value="${a.bed}"></div></div></div>${nav("devices")}`;
    if(step==="devices"){ const other = a.devices.some(x=>x!=="phone"), hc = typeof hcState==="function" ? hcState() : {};
      return `<span class="grab"></span>${bar()}<h3 class="big3">What do you track with?</h3><p class="sub">Pick all that apply.</p>
      <div class="goalgrid">${DEVICES.map(([id,n])=>`<button class="gchip" data-dev="${id}" aria-pressed="${a.devices.includes(id)}" style="--c:var(--blue)">${n}</button>`).join("")}</div>
      ${other?`<div class="card form" style="width:100%"><b>Connect Health Connect</b><p class="hint">Pulls steps, sleep, heart rate, HRV and weight from Samsung Health, Fitbit, Garmin, Google Fit and most rings and watches. Read-only.</p>${typeof HC!=="undefined" && HC ? (hc.connected?`<p class="hint ok">Connected</p>`:`<button class="btn" data-s="hc">Connect</button>`) : `<p class="hint">You can connect from Me → Connected apps in the Android app.</p>`}</div>`:""}
      ${nav("finish")}`; }
    const plan = parseRules(planFromAnswers(a)), c = packCounts(plan);
    return `<span class="grab"></span>${bar()}<h3 class="big3">Your plan is ready</h3><p class="sub">${c.daily} dailies, ${c.habit} habits and ${c.todo} to-dos built from your answers. Everything can be edited later.</p>
      <div style="width:100%">${segHTML("plan",[["plan","Use my plan"],["import","Import rules"],["empty","Start empty"]],choice)}</div>
      <div class="fld" style="width:100%"><span class="lab">Appearance</span>${themePicker()}</div>
      <label class="switch" style="width:100%"><span>Reminders</span><input type="checkbox" id="su-rem" ${reminders?"checked":""}></label>
      ${nav("done","Start")}`;
  };
  const redraw = ()=>{ const sh = sheet && sheet.querySelector(".sheet"); if(sh){ sh.innerHTML = draw(); sh.scrollTop = 0; } };
  const grab = ()=>{
    if(step==="about"){ a.name = val("su-name").trim(); const by = num(val("su-by")); a.birthYear = by && by>1900 && by<=new Date().getFullYear() ? Math.round(by) : null;
      const imp = a.units==="imperial";
      if(imp){ const f = num(val("su-ft")), i = num(val("su-in")); a.heightCm = f||i ? Math.round(((f||0)*30.48+(i||0)*2.54)*10)/10 : null; }
      else { const cm = num(val("su-cm")); a.heightCm = cm && cm>50 && cm<260 ? cm : null; }
      const w = num(val("su-w")); a.weightKg = w ? Math.round((imp ? w*0.453592 : w)*10)/10 : null; if(a.weightKg && (a.weightKg<20 || a.weightKg>400)) a.weightKg = null;
      const sx = picked("sex"); a.sex = sx || null; }
    if(step==="day"){ a.wake = val("su-wake") || "07:00"; a.bed = val("su-bed") || "23:00"; }
    if(step==="finish"){ reminders = sheet.querySelector("#su-rem").checked; }
  };
  const finish = async ()=>{
    S.profile = Object.assign({}, S.profile, a);
    const w = tmin(a.wake)/60; S.settings.dayStart = clamp(Math.floor(w-3), 0, 5);
    applySchedule();
    if(a.weightKg && logVal(TODAY(),"weight")==null) setLogVal(TODAY(),"weight",a.weightKg);
    if(choice==="plan") applyPack(parseRules(planFromAnswers(a)), "add");
    S.onboarded = true; S.settings.reminders = reminders; save();
    closeSheet(); render();
    if(typeof cloudSaveProfile==="function") cloudSaveProfile();
    if(reminders) scheduleReminders(true);
    if(choice==="import") openImport(()=>render(true));
    else toast(`Welcome${a.name?", "+a.name:""}`);
  };
  const back = ()=>{ const i = order.indexOf(step); if(i>0){ grab(); step = order[i-1]; } else step = hasCloud && typeof cloudUser!=="undefined" && cloudUser ? "about" : "welcome"; redraw(); };
  openSheet(draw(), async (b)=>{
    const d = b.dataset;
    if(d.themepick){ setTheme(d.themepick); return; }
    if(d.pick){ pickIn(b); if(d.pick==="units"){ grab(); a.units = d.v; redraw(); } else if(d.pick==="plan") choice = d.v; return; }
    if(d.goal){ const has = a.goals.includes(d.goal); if(!has && a.goals.length>=3){ toast("Pick up to three"); return; } a.goals = has ? a.goals.filter(x=>x!==d.goal) : a.goals.concat(d.goal); b.setAttribute("aria-pressed", String(!has)); tick(); return; }
    if(d.dev){ const has = a.devices.includes(d.dev); if(d.dev==="phone") a.devices = has ? [] : ["phone"]; else a.devices = (has ? a.devices.filter(x=>x!==d.dev) : a.devices.filter(x=>x!=="phone").concat(d.dev)); tick(); redraw(); return; }
    const s2 = d.s; if(!s2) return;
    if(s2==="create"){ acctMode = "signup"; step = "account"; redraw(); return; }
    if(s2==="signin"){ acctMode = "signin"; step = "account"; redraw(); return; }
    if(s2==="toWelcome"){ step = "welcome"; redraw(); return; }
    if(s2==="local"){ step = "about"; redraw(); return; }
    if(s2==="back"){ back(); return; }
    if(s2==="hc"){ b.disabled = true; b.textContent = "Connecting…"; await healthConnect(); redraw(); return; }
    if(s2==="auth"){ if(busy) return;
      const email = val("su-email").trim(), pass = val("su-pass"), err = sheet.querySelector("#su-err");
      const fail = m=>{ err.textContent = m; err.hidden = false; busy = false; b.disabled = false; b.textContent = acctMode==="signin"?"Sign in":"Create account"; };
      if(!/^\S+@\S+\.\S+$/.test(email)) return fail("That email doesn't look right. Check for a typo.");
      if(pass.length < 8) return fail("Passwords need at least 8 characters.");
      busy = true; b.disabled = true; b.textContent = "Please wait…";
      try{
        if(acctMode==="signin"){ await cloudSignIn(email, pass); busy = false; if(S.onboarded){ applySchedule(); closeSheet(); render(); toast(`Welcome back${S.profile.name?", "+S.profile.name:""}`); scheduleReminders(false); if(window.reportsCheck) reportsCheck(); if(window.healthAutoSync) healthAutoSync(); return; } Object.assign(a, S.profile||{}); step = "about"; redraw(); }
        else { const r = await cloudSignUp(email, pass); busy = false; if(r.needsConfirm){ S.pendingEmail = email; save(); toast("Check your email to confirm your account"); } step = "about"; redraw(); }
      }catch(e){ fail(msgOf(e)); }
      return; }
    if(s2==="goals"||s2==="day"||s2==="devices"||s2==="finish"){ grab(); if(s2==="day" && !a.goals.length){ toast("Pick at least one goal"); return; } step = s2; redraw(); return; }
    if(s2==="done"){ grab(); finish(); }
  }, null, true);
}

/* ---------- profile in Me ---------- */
function meProfileHTML(){
  const p = S.profile || {}, imp = p.units==="imperial";
  const bits = [p.birthYear?(new Date().getFullYear()-p.birthYear)+" yrs":null, p.heightCm?(imp?(()=>{ const i = p.heightCm/2.54; return Math.floor(i/12)+"′"+Math.round(i%12)+"″"; })():p.heightCm+" cm"):null, p.wake&&p.bed?`${t12(p.wake)} – ${t12(p.bed)}`:null, (p.goals||[]).length?(p.goals.map(g=>(GOALS.find(x=>x[0]===g)||[0,g])[1]).join(", ")):null].filter(Boolean);
  return `<div class="group"><div class="cap">Profile</div><ul class="list"><li class="row plain tap" data-profile="edit"><div style="min-width:0"><span class="rt">${esc(p.name||"Add your details")}</span><div class="rs">${esc(bits.join(" · ")||"Used for your plan and monthly summary")}</div></div><span class="chev">›</span></li><li class="row plain tap" data-profile="plan"><div style="min-width:0"><span class="rt" style="color:var(--blue)">Add tasks for my goals</span><div class="rs">Adds anything from your goals that isn't already in your plan</div></div><span class="chev">›</span></li></ul></div>`;
}
function openProfileEdit(){
  const a = Object.assign({name:"", birthYear:null, sex:null, units:"metric", heightCm:null, weightKg:null, goals:[], wake:"07:00", bed:"23:00", devices:[]}, S.profile||{});
  const draw = ()=>{ const imp = a.units==="imperial", i = a.heightCm ? a.heightCm/2.54 : 0;
    return shead("Profile","Cancel","Save") + `<div class="form">
    <div class="fld"><label for="pe-name">Name</label><input class="tin" id="pe-name" value="${esc(a.name||"")}"></div>
    <div class="two"><div class="fld"><label for="pe-by">Birth year</label><input class="tin" id="pe-by" type="number" inputmode="numeric" value="${a.birthYear||""}"></div><div class="fld"><span class="lab">Units</span>${segHTML("units",[["metric","Metric"],["imperial","Imperial"]],a.units)}</div></div>
    <div class="fld"><span class="lab">Sex</span>${segHTML("sex",SEXES,a.sex||"")}</div>
    ${imp?`<div class="fld"><span class="lab">Height</span><div class="two"><label class="inp"><input id="pe-ft" type="number" value="${a.heightCm?Math.floor(i/12):""}"><span>ft</span></label><label class="inp"><input id="pe-in" type="number" value="${a.heightCm?Math.round(i%12):""}"><span>in</span></label></div></div>`:`<div class="fld"><label for="pe-cm">Height</label><label class="inp"><input id="pe-cm" type="number" inputmode="decimal" value="${a.heightCm||""}"><span>cm</span></label></div>`}
    <div class="two"><div class="fld"><label for="pe-wake">Wake up</label><input class="tin" id="pe-wake" type="time" value="${a.wake||""}"></div><div class="fld"><label for="pe-bed">Bedtime</label><input class="tin" id="pe-bed" type="time" value="${a.bed||""}"></div></div>
    <div class="fld"><span class="lab">Goals · up to three</span><div class="goalgrid">${GOALS.map(([id,n,c])=>`<button type="button" class="gchip" data-goal="${id}" aria-pressed="${a.goals.includes(id)}" style="--c:${CATS[c].c}"><i>${goalIcon(c)}</i>${n}</button>`).join("")}</div></div></div>`; };
  const grab = ()=>{ a.name = val("pe-name").trim(); const by = num(val("pe-by")); a.birthYear = by && by>1900 && by<=new Date().getFullYear() ? Math.round(by) : null;
    if(a.units==="imperial"){ const f = num(val("pe-ft")), ii = num(val("pe-in")); a.heightCm = f||ii ? Math.round(((f||0)*30.48+(ii||0)*2.54)*10)/10 : null; } else { const cm = num(val("pe-cm")); a.heightCm = cm && cm>50 && cm<260 ? cm : null; }
    a.wake = val("pe-wake") || a.wake; a.bed = val("pe-bed") || a.bed; const sx = picked("sex"); a.sex = sx || null; };
  openSheet(draw(), b=>{ const d = b.dataset;
    if(d.pick){ pickIn(b); if(d.pick==="units"){ grab(); a.units = d.v; const sh = sheet.querySelector(".sheet"), st = sh.scrollTop; sh.innerHTML = draw(); sh.scrollTop = st; } return; }
    if(d.goal){ const has = a.goals.includes(d.goal); if(!has && a.goals.length>=3){ toast("Pick up to three"); return; } a.goals = has ? a.goals.filter(x=>x!==d.goal) : a.goals.concat(d.goal); b.setAttribute("aria-pressed", String(!has)); return; }
    if(d.s==="cancel") closeSheet();
    else if(d.s==="save"){ grab(); S.profile = Object.assign({}, S.profile, a); applySchedule(); save(); if(typeof cloudSaveProfile==="function") cloudSaveProfile(); closeSheet(); render(true); toast("Saved"); }
  });
}
V.addEventListener("click", e=>{
  const b = e.target.closest("[data-profile]"); if(!b) return;
  if(b.dataset.profile==="edit") openProfileEdit();
  else { const n = applyPack(parseRules(planFromAnswers(S.profile||{})), "add"); render(true); toast(n ? `Added ${n} new item${n===1?"":"s"}` : "Your plan already covers your goals"); }
});
