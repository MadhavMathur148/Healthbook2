/* Test doubles: a fake Capacitor native shell with Health Connect, and a fake Supabase. */
(function(){
  const now = new Date();
  const dayISO = (i)=>{ const d = new Date(now); d.setDate(d.getDate()-i); d.setHours(0,0,0,0); return d; };
  const Health = {
    isAvailable: async()=>({available:true, platform:"android"}),
    requestAuthorization: async(o)=>({readAuthorized:o.read, readDenied:[]}),
    checkAuthorization: async(o)=>({readAuthorized:o.read, readDenied:[]}),
    openHealthConnectSettings: async()=>({}),
    queryAggregated: async(o)=>{ const out = []; for(let i=40;i>=0;i--){ const d = dayISO(i), e = new Date(d); e.setDate(e.getDate()+1);
        const v = o.dataType==="steps" ? 5000+((i*1373)%6000) : o.dataType==="restingHeartRate" ? 62+(i%5) + (i<15?6:0) : o.dataType==="weight" ? (i%7===0 ? 70.5 - i*0.05 : 0) : 0;
        if(v) out.push({startDate:d.toISOString(), endDate:e.toISOString(), value:v, values:{}}); } return {samples:out}; },
    readSamples: async(o)=>{ const out = []; for(let i=40;i>=0;i--){ const d = dayISO(i);
        if(o.dataType==="sleep"){ const s = new Date(d); s.setHours(-1,30); const e = new Date(d); e.setHours(6, (i*17)%60); out.push({startDate:s.toISOString(), endDate:e.toISOString(), value:(e-s)/60000 - 20, sourceId:"ring", stages:[{stage:"light",durationMinutes:(e-s)/60000-60},{stage:"awake",durationMinutes:20},{stage:"deep",durationMinutes:40}]});
          out.push({startDate:s.toISOString(), endDate:e.toISOString(), value:(e-s)/60000 - 30, sourceId:"phone"}); }
        if(o.dataType==="heartRateVariability"){ const s = new Date(d); s.setHours(3); out.push({startDate:s.toISOString(), endDate:s.toISOString(), value:55-(i<15?12:0)+(i%4)}); } } return {samples:out}; }
  };
  const generic = ()=>new Proxy({}, {get:(t,k)=>k==="then"?undefined:(async()=>({}))});
  window.__scheduled = [];
  const LN = {getPending:async()=>({notifications:window.__scheduled.map(n=>({id:n.id}))}), cancel:async(o)=>{ const ids = new Set(o.notifications.map(n=>n.id)); window.__scheduled = window.__scheduled.filter(n=>!ids.has(n.id)); },
    checkPermissions:async()=>({display:"granted"}), requestPermissions:async()=>({display:"granted"}), schedule:async(o)=>{ window.__scheduled.push(...o.notifications); return {notifications:o.notifications.map(n=>({id:n.id}))}; }, addListener:async()=>({remove(){}})};
  window.Capacitor = { isNativePlatform:()=>true, registerPlugin:(name)=>name==="LocalNotifications"?LN:name==="Health"?Health:(name==="Filesystem"?{readFile:async()=>{throw new Error("none")}, writeFile:async()=>({uri:"file://x"})}:generic()) };
  /* fake supabase */
  const db = {profiles:{}, app_state:{}, reports:{}}, users = {};
  let session = null; window.__fakeDB = db;
  window.supabase = { createClient:()=>({
    auth:{
      getSession: async()=>({data:{session}}),
      onAuthStateChange: ()=>({data:{subscription:{unsubscribe(){}}}}),
      signUp: async({email,password})=>{ if(users[email]) return {data:{}, error:{message:"User already registered"}}; users[email] = {id:"u_"+Object.keys(users).length, email, password}; session = {user:users[email]}; return {data:{session, user:users[email]}, error:null}; },
      signInWithPassword: async({email,password})=>{ const u = users[email]; if(!u || u.password!==password) return {data:{}, error:{message:"Invalid login credentials"}}; session = {user:u}; return {data:{session, user:u}, error:null}; },
      signOut: async()=>{ session = null; return {error:null}; }
    },
    from:(tbl)=>({
      select:()=>({ eq:(col,v)=>({ maybeSingle: async()=>({data: db[tbl][v] ? {data:db[tbl][v].data, updated_at:"x"} : null, error:null}) }) }),
      upsert: async(row)=>{ const key = row.user_id || row.id; if(tbl==="reports") db[tbl][row.user_id+row.month] = row; else db[tbl][key] = JSON.parse(JSON.stringify(row)); return {error:null}; }
    }),
    rpc: async()=>({error:null})
  }) };
  window.HB_TEST = true;
})();
