/* Builds a believable 5 months of history so screenshots and the insight engine
   have something real to chew on. Deterministic: same data every run. */
function seedDemo(months){
  let s = 20260401;
  const rnd = ()=>{ s = (s*1103515245 + 12345) & 0x7fffffff; return s/0x7fffffff; };
  const gauss = ()=>{ let u=0,v=0; while(!u) u=rnd(); while(!v) v=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
  const days = Math.round(months*30);
  /* backdate creation, otherwise isDue() correctly refuses to count historical days */
  const start = addDays(TODAY(), -days);
  for(const t of S.tasks) t.created = start;
  const water = trk("water"), steps = trk("steps");
  const walk = dailies().find(t=>/walk/i.test(t.title)) || dailies()[0];
  const read = dailies().find(t=>/read|wind|stretch/i.test(t.title)) || dailies()[1];

  for(let i=days;i>=0;i--){
    const k = addDays(TODAY(), -i), dow = dowOf(k), weekend = dow>=5;   /* dowOf: Monday 0 … Sunday 6 */
    const d = day(k);
    /* a real-ish behavioural driver: more water and steps on weekdays */
    const effort = (weekend ? 0.55 : 0.85) - (i/days)*0.12 + gauss()*0.12;
    const didWalk = rnd() < effort;
    const w = Math.max(0, Math.round(5 + (didWalk?2.5:0) + gauss()*1.6));
    const st = Math.round(5200 + (didWalk?3400:0) + (weekend?-900:0) + gauss()*1300);
    /* sleep genuinely follows walking + weekday, which the engine should find */
    const sleepH = 6.5 + (didWalk?0.75:0) + (weekend?0.5:0) - (dow===4?0.6:0) + gauss()*0.55;
    const stress = Math.round(Math.min(10, Math.max(1, 6 - (didWalk?1.4:0) + (dow===0?1.2:0) + gauss()*1.3)));
    const mood = Math.round(Math.min(10, Math.max(1, 6.2 + (didWalk?1.1:0) - (stress-6)*0.4 + gauss()*1.1)));
    const rhr = Math.round(56 + (i<25?2.5:0) - (didWalk?1.2:0) + gauss()*2.4);
    const hrv = Math.round(48 + (didWalk?4:0) - (stress-6)*1.5 + gauss()*6);
    const wt = Math.round((72.5 - (days-i)*0.012 + gauss()*0.35)*10)/10;

    const L = sub(k,"l");
    if(water) L.water = w;
    if(steps) L.steps = st;
    if(trk("sleep")) L.sleep = Math.round(Math.max(3.5, Math.min(10.5, sleepH))*10)/10;
    if(trk("mood")) L.mood = mood;
    if(trk("stress")) L.stress = stress;
    if(trk("rhr")) L.rhr = rhr;
    if(trk("hrv")) L.hrv = Math.max(12, hrv);
    if(trk("weight") && i%3===0) L.weight = wt;

    const D = sub(k,"d");
    for(const t of dailies()){
      if(!isDue(t,k)) continue;
      const p = t===walk ? (didWalk?1:0) : t===read ? effort*0.9 : effort;
      if(rnd() < p){ D[t.id] = true; sub(k,"x")["d:"+t.id] = XP_DAILY[t.diff||1]; }
    }
    for(const t of habits()){
      const n = Math.round(Math.max(0, gauss()*1.2 + (t.kind==="bad"?0.6:1.8)));
      if(n>0) sub(k,"h")[t.id] = t.kind==="bad" ? {n} : {u:n};
    }
    d._t = Date.now() - i*86400000;
  }
  save();
  return days;
}
