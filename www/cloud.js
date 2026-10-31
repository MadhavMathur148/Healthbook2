/* Healthbook accounts and sync (Supabase). Inactive when config.js has no URL or key. */
"use strict";
const CLOUD = (()=>{
  const c = window.HB_CONFIG || {};
  if(!c.supabaseUrl || !c.supabaseAnonKey || !window.supabase || !window.supabase.createClient) return null;
  try{ return window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storage:window.localStorage}}); }catch(e){ console.warn("cloud", e); return null; }
})();
let cloudUser = null, cloudTimer = null, cloudLast = 0, cloudErr = null, cloudPushing = false, cloudPending = false;

async function cloudInit(){
  if(!CLOUD) return;
  try{ const {data} = await CLOUD.auth.getSession(); cloudUser = data && data.session ? data.session.user : null; }catch(e){ cloudErr = msgOf(e); }
  CLOUD.auth.onAuthStateChange((ev, session)=>{ cloudUser = session ? session.user : null; });
  if(cloudUser) await cloudPull(true);
}
function msgOf(e){ const m = String((e && (e.message || e.error_description)) || e || "Something went wrong"); if(/failed to fetch|network/i.test(m)) return "No internet connection. Your changes are saved on this phone and will sync later."; if(/invalid login/i.test(m)) return "That email and password don't match an account."; if(/already registered|already been registered/i.test(m)) return "There's already an account with that email. Sign in instead."; if(/password should be at least/i.test(m)) return "Use a password of at least 8 characters."; if(/rate limit/i.test(m)) return "Too many attempts. Wait a minute and try again."; return m; }

async function cloudSignUp(email, password){
  const {data, error} = await CLOUD.auth.signUp({email, password});
  if(error) throw new Error(msgOf(error));
  cloudUser = data.session ? data.session.user : null;
  if(cloudUser){ S.owner = cloudUser.id; await cloudSaveProfile(); await cloudPushNow(); }
  return {needsConfirm: !data.session};
}
async function cloudSignIn(email, password){
  const {data, error} = await CLOUD.auth.signInWithPassword({email, password});
  if(error) throw new Error(msgOf(error));
  cloudUser = data.user; S.pendingEmail = null;
  if(S.owner && S.owner!==cloudUser.id){
    /* this phone holds another account's data: start from a clean slate, then load this account */
    const th = S.settings.theme; S = seed(); S.settings.theme = th;
    try{ localStorage.setItem("healthbook-app", JSON.stringify(S)); }catch(e){}
  }
  S.owner = cloudUser.id;
  await cloudPull(true);
  if(S.onboarded) await cloudSaveProfile();
  return cloudUser;
}
async function cloudSignOut(){ try{ await cloudPushNow(); }catch(e){} try{ await CLOUD.auth.signOut(); }catch(e){} cloudUser = null; }

/* ---------- merge ----------
   Each day in the history carries _t, the time it was last changed; the newer copy of a day wins whole,
   so unticking on one phone isn't undone by an older copy from another. Tasks, rewards and trackers are
   merged by id, with the newer state's version winning and deleted ids (S.removed) staying deleted. */
function mergeById(a, b, preferB, removed, prefix){
  const out = new Map();
  for(const x of (preferB ? a : b) || []) out.set(x.id, x);
  for(const x of (preferB ? b : a) || []) out.set(x.id, x);
  return [...out.values()].filter(x=>!removed[(prefix||"")+x.id]);
}
function mergeStates(local, remote){
  const localEmpty = !local.onboarded || (!local.tasks.length && !Object.keys(local.hist).some(k=>local.hist[k].l || local.hist[k].d));
  const remoteNewer = localEmpty || (remote.updatedAt||0) > (local.updatedAt||0);
  const base = JSON.parse(JSON.stringify(remoteNewer ? remote : local)), other = remoteNewer ? local : remote;
  const removed = Object.assign({}, other.removed||{}, base.removed||{});
  base.removed = removed;
  const hist = {};
  for(const k of new Set(Object.keys(local.hist||{}).concat(Object.keys(remote.hist||{})))){
    const x = (base.hist||{})[k], y = (other.hist||{})[k];
    hist[k] = !x ? y : !y ? x : ((y._t||0) > (x._t||0) ? y : x);
  }
  base.hist = JSON.parse(JSON.stringify(hist));
  if(!localEmpty){
    base.tasks = mergeById(other.tasks, base.tasks, true, removed);
    base.rewards = mergeById(other.rewards, base.rewards, true, removed);
    base.trackers = mergeById(other.trackers, base.trackers, true, removed, "trk:");
  }
  const pt = new Set((base.purchases||[]).map(p=>p.t)); for(const p of (other.purchases||[])) if(!pt.has(p.t)) base.purchases.push(p);
  base.reports = Object.assign({}, other.reports||{}, base.reports||{});
  if(!localEmpty) base.settings.theme = local.settings.theme;
  base.onboarded = !!(local.onboarded || remote.onboarded);
  return migrate(base);
}

async function cloudPull(initial){
  if(!CLOUD || !cloudUser) return;
  try{
    const {data, error} = await CLOUD.from("app_state").select("data,updated_at").eq("user_id", cloudUser.id).maybeSingle();
    if(error) throw error;
    if(!data || !data.data){ if(S.onboarded) await cloudPushNow(); return; }
    const remote = migrate(data.data);
    if(!initial && (remote.updatedAt||0) <= (S.updatedAt||0)) return;
    S = mergeStates(S, remote); S.owner = cloudUser.id;
    try{ localStorage.setItem("healthbook-app", JSON.stringify(S)); }catch(e){}
    cloudLast = Date.now(); cloudErr = null;
    if(typeof applySchedule==="function") applySchedule();
    applyTheme(); if(!sheet) render(true);
    cloudQueue();
  }catch(e){ cloudErr = msgOf(e); }
}
function cloudQueue(){ if(!CLOUD || !cloudUser) return; clearTimeout(cloudTimer); cloudTimer = setTimeout(cloudPushNow, 4000); }
async function cloudPushNow(){
  if(!CLOUD || !cloudUser) return;
  if(cloudPushing){ cloudPending = true; return; }
  cloudPushing = true; clearTimeout(cloudTimer);
  try{
    const {error} = await CLOUD.from("app_state").upsert({user_id:cloudUser.id, data:S, updated_at:new Date().toISOString()});
    if(error) throw error;
    cloudLast = Date.now(); cloudErr = null;
  }catch(e){ cloudErr = msgOf(e); }
  cloudPushing = false;
  if(cloudPending){ cloudPending = false; cloudQueue(); }
}
async function cloudSaveProfile(){
  if(!CLOUD || !cloudUser) return;
  const p = S.profile || {};
  const row = {id:cloudUser.id, name:p.name||null, birth_year:p.birthYear||null, sex:p.sex||null, height_cm:p.heightCm||null, weight_kg:p.weightKg||null, units:p.units||"metric", goals:p.goals||[], wake_time:p.wake||null, bed_time:p.bed||null, devices:p.devices||[], updated_at:new Date().toISOString()};
  try{ const {error} = await CLOUD.from("profiles").upsert(row); if(error) throw error; }catch(e){ cloudErr = msgOf(e); }
}
async function cloudSaveReport(month, data){
  if(!CLOUD || !cloudUser) return;
  try{ await CLOUD.from("reports").upsert({user_id:cloudUser.id, month, data}, {onConflict:"user_id,month"}); }catch(e){}
}

/* ---------- UI ---------- */
function ago(t){ if(!t) return "not yet"; const s = Math.round((Date.now()-t)/1000); if(s<60) return "just now"; if(s<3600) return Math.round(s/60)+" min ago"; if(s<86400) return Math.round(s/3600)+" h ago"; return Math.round(s/86400)+" d ago"; }
function meAccountHTML(){
  if(!CLOUD) return "";
  if(!cloudUser) return `<div class="group"><div class="cap">Account</div><div class="card form"><p class="hint" style="font-size:15px;color:var(--ink)">${S.pendingEmail?`Confirm the email we sent to <b>${esc(S.pendingEmail)}</b>, then sign in to start syncing.`:"Sign in to back up your data and use Healthbook on more than one phone."}</p><div class="btns"><button class="btn" data-acct="signin">Sign in</button><button class="btn sec" data-acct="signup">Create account</button></div></div></div>`;
  return `<div class="group"><div class="cap">Account</div><ul class="list">
    <li class="row plain"><div style="min-width:0"><span class="rt">${esc(cloudUser.email||"Signed in")}</span><div class="rs">${cloudErr?`<span class="bad">${esc(cloudErr)}</span>`:`Synced ${ago(cloudLast)}`}</div></div><button class="act" style="--c:var(--blue)" data-acct="sync">Sync now</button></li>
    <li class="row plain tap" data-acct="signout"><span class="rt" style="color:var(--blue)">Sign out</span><span></span></li>
    <li class="row plain tap" data-acct="delete"><span class="rt" style="color:var(--red)">Delete account</span><span></span></li>
  </ul></div>`;
}
/* Concentric rings in the four brand colours, echoing the app icon. */
function ringLogo(){
  const r = [[34,"var(--blue)"],[26,"var(--red)"],[18,"var(--yellow)"],[10,"var(--green)"]];
  return `<svg viewBox="0 0 80 80" width="76" height="76" aria-hidden="true">${
    r.map(([rad,c])=>`<circle cx="40" cy="40" r="${rad}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${2*Math.PI*rad*0.78} ${2*Math.PI*rad}" transform="rotate(-90 40 40)"/>`).join("")}</svg>`;
}
const AUTH_PERKS = [["☁️","Your plan is backed up","Lose your phone, keep everything."],
                    ["📱","Use it on any phone","Pick up exactly where you left off."],
                    ["🔒","Only you can see it","Your data is yours alone."]];
function openAuth(mode, after){
  let busy = false, show = false;
  const draw = ()=>`<span class="grab"></span>
    <div class="auth">
      <div class="auth-hero"><div class="auth-rings">${ringLogo()}</div>
        <h3>${mode==="signin"?"Welcome back":"Create your account"}</h3>
        <p>${mode==="signin"?"Sign in and your plan, logs and summaries come right back.":"It takes ten seconds and keeps everything safe."}</p></div>
      ${mode==="signup"?`<ul class="perks">${AUTH_PERKS.map(([i,t,s])=>`<li><span class="pi">${i}</span><span><b>${t}</b><small>${s}</small></span></li>`).join("")}</ul>`:""}
      <div class="form">
        <div class="fld"><label for="au-email">Email</label><input class="tin xl" id="au-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="you@example.com" value="${esc(S.pendingEmail||"")}"></div>
        <div class="fld"><label for="au-pass">Password</label><div class="pwrap"><input class="tin xl" id="au-pass" type="${show?"text":"password"}" autocomplete="${mode==="signin"?"current-password":"new-password"}" placeholder="${mode==="signin"?"Your password":"At least 8 characters"}"><button type="button" class="peye" data-s="eye" aria-label="${show?"Hide password":"Show password"}">${show?"🙈":"👁️"}</button></div></div>
        <p class="hint bad" id="au-err" hidden></p>
        <button class="btn" data-s="go">${mode==="signin"?"Sign in":"Create my account"}</button>
        <button class="btn ghost" data-s="switch">${mode==="signin"?"New here? Create an account":"Already have an account? Sign in"}</button>
        <p class="hint" style="text-align:center">You can skip this and use Healthbook offline — everything works without an account.</p>
      </div>
    </div>`;
  openSheet(draw(), async b=>{
    const d = b.dataset;
    if(d.s==="eye"){ const el = sheet.querySelector("#au-pass"), v = el.value; show = !show;
      const em = val("au-email"); sheet.querySelector(".sheet").innerHTML = draw();
      sheet.querySelector("#au-email").value = em; const p = sheet.querySelector("#au-pass"); p.value = v; p.focus(); return; }
    if(d.s==="switch"){ mode = mode==="signin"?"signup":"signin"; const em = val("au-email"); sheet.querySelector(".sheet").innerHTML = draw(); sheet.querySelector("#au-email").value = em; return; }
    if(d.s!=="go" || busy) return;
    const email = val("au-email").trim(), pass = val("au-pass"), err = sheet.querySelector("#au-err");
    const fail = m=>{ err.textContent = m; err.hidden = false; busy = false; b.disabled = false; b.textContent = mode==="signin"?"Sign in":"Create my account"; };
    if(!/^\S+@\S+\.\S+$/.test(email)) return fail("That email doesn't look right. Check for a typo.");
    if(pass.length < 8) return fail("Passwords need at least 8 characters.");
    busy = true; b.disabled = true; b.textContent = "Please wait…";
    try{
      if(mode==="signin"){ await cloudSignIn(email, pass); closeSheet(); toast("Signed in"); if(window.applySchedule) applySchedule(); applyTheme(); if(after) after("signin"); else { render(true); if(!S.onboarded) setTimeout(window.signupFlow || onboarding, 250); else { scheduleReminders(false); if(window.reportsCheck) reportsCheck(); } } }
      else { const r = await cloudSignUp(email, pass); if(r.needsConfirm){ S.pendingEmail = email; save(); closeSheet(); toast("Check your email to confirm"); if(after) after("confirm"); else render(true); } else { closeSheet(); toast("Account created"); if(after) after("signup"); else render(true); } }
    }catch(e){ fail(msgOf(e)); }
  });
}
function confirmDeleteAccount(){
  openSheet(`<span class="grab"></span><h3 class="big3">Delete your account?</h3><p class="sub">This permanently deletes your profile, synced data and monthly summaries from Healthbook's database. It can't be undone.</p>
    <button class="btn danger" data-s="keep">Delete account, keep data on this phone</button><button class="btn danger" data-s="wipe">Delete account and all data</button><button class="btn sec" data-s="cancel">Cancel</button>`, async b=>{
    const s2 = b.dataset.s; if(s2==="cancel"){ closeSheet(); return; }
    b.disabled = true; b.textContent = "Deleting…";
    try{ const {error} = await CLOUD.rpc("delete_my_account"); if(error) throw error; await CLOUD.auth.signOut().catch(()=>{}); cloudUser = null;
      if(s2==="wipe"){ const th = S.settings.theme; S = seed(); S.settings.theme = th; save(); closeSheet(); go("today"); setTimeout(window.signupFlow||onboarding, 250); }
      else { closeSheet(); render(true); }
      toast("Account deleted");
    }catch(e){ b.disabled = false; b.textContent = "Try again"; toast(msgOf(e)); }
  });
}
V.addEventListener("click", async e=>{
  const b = e.target.closest("[data-acct]"); if(!b) return; const a = b.dataset.acct;
  if(a==="signin"||a==="signup") openAuth(a);
  else if(a==="sync"){ b.textContent = "Syncing…"; await cloudPushNow(); await cloudPull(false); render(true); toast(cloudErr ? cloudErr : "Synced"); }
  else if(a==="signout"){ await cloudSignOut(); render(true); toast("Signed out. Your data stays on this phone."); }
  else if(a==="delete") confirmDeleteAccount();
});
