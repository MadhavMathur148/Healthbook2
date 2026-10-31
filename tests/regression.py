import asyncio, sys, json, subprocess, time
from playwright.async_api import async_playwright
S=sys.argv[1]
srv = subprocess.Popen([sys.executable,"-m","http.server","8767","-d","/home/claude/healthbook-app/www"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
MOCK=open(S+"/mock.js").read()
fails=[]
def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ")+name+("" if cond else "  -> "+str(info)))
    if not cond: fails.append(name)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width":390,"height":844})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        async def r1(route): await route.fulfill(status=200, content_type="application/javascript", body=MOCK)
        async def r2(route): await route.fulfill(status=200, content_type="application/javascript", body='window.HB_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"anon"};')
        await pg.route("**/vendor/supabase.js", r1); await pg.route("**/config.js", r2)
        await pg.goto("http://localhost:8767/index.html"); await pg.wait_for_timeout(700)
        await pg.click("[data-s=create]"); await pg.fill("#su-email","a@b.co"); await pg.fill("#su-pass","password123"); await pg.click("[data-s=auth]"); await pg.wait_for_timeout(300)
        await pg.click("[data-s=goals]"); await pg.click("[data-goal=sleep]"); await pg.click("[data-goal=water]"); await pg.click("[data-s=day]"); await pg.fill("#su-wake","07:00"); await pg.fill("#su-bed","23:00")
        await pg.click("[data-s=devices]"); await pg.click("[data-dev=ring]"); await pg.click("[data-s=hc]"); await pg.wait_for_timeout(1500); await pg.click("[data-s=finish]"); await pg.click("[data-s=done]"); await pg.wait_for_timeout(800)

        # 1. sanitising a hostile shared JSON rules file
        r = await pg.evaluate("""(()=>{ const pack = {tasks:[{type:"daily", title:"Evil", remind:"<img src=x onerror=window.__pwn=1>", days:[9,"x",2], block:"nope", diff:7, cat:"zzz", checklist:[{id:'"><img src=x onerror=window.__pwn=2>', text:"ok"}], auto:[{t:"<b>", op:"gte", v:1}]}],
            trackers:[{id:'x" onclick="window.__pwn=3', name:"Evil tracker", kind:"count", color:"<red>", target:"5"}]};
          const p = parsePackJSON(JSON.stringify(pack)); applyPack(p,"add"); render();
          const t = S.tasks.find(x=>x.title==="Evil"), tr = S.trackers.find(x=>x.name==="Evil tracker");
          return {remind:t.remind, days:t.days, block:t.block, diff:t.diff, cat:t.cat, auto:t.auto, clid:t.checklist[0].id, trid:tr.id, color:tr.color, target:tr.target}; })()""")
        await pg.click(".tb[data-view=log]"); await pg.wait_for_timeout(200); await pg.click(".tb[data-view=tasks]"); await pg.wait_for_timeout(200); await pg.click(".tb[data-view=today]"); await pg.wait_for_timeout(200)
        pwn = await pg.evaluate("window.__pwn||null")
        check("hostile JSON is cleaned", r["remind"] is None and r["days"]==[2] and r["block"]=="any" and r["diff"]==1 and r["cat"]=="care" and r["auto"] is None and '"' not in r["clid"] and '"' not in r["trid"] and r["color"]=="blue" and r["target"]==5, r)
        check("no script ran from imported data", pwn is None, pwn)

        # 2. parser
        r = await pg.evaluate("""(()=>{ const p = parseRules(`Sure! Here are your rules:\\n\\nDailies:\\n- **Drink water** (morning, nourish)\\nThis plan focuses on sleep and hydration.\\n- Walk (day)\\nTrackers:\\n- Coffee (cups, counter, target 3)\\n- Tea (counter, glasses)\\nI hope this helps!`);
          return {d:p.daily.map(x=>x.title), tr:p.tracker.map(x=>x.name+":"+x.kind+":"+x.unit+":"+x.target)}; })()""")
        check("parser ignores chatbot prose and strips markdown", r["d"]==["Drink water","Walk"], r)
        check("counter/glasses units parse in any order", r["tr"]==["Coffee:count:cups:3","Tea:count:glasses:8"], r)

        # 3. manual untick of an auto-ticked daily sticks
        r = await pg.evaluate("""(()=>{ const k=TODAY(); const w=dailies().find(t=>t.auto&&t.auto[0].t==='water'); setLogVal(k,'water',8); const on=isDone(w,k); setDaily(w,k,false); setLogVal(k,'water',9); return [on, isDone(w,k)]; })()""")
        check("manual untick of auto daily is respected", r==[True, False], r)

        # 4. sync merge
        r = await pg.evaluate("""(()=>{ const k=TODAY(); const base=JSON.parse(JSON.stringify(S)); const t=dailies()[0];
          const A=JSON.parse(JSON.stringify(base)); A.hist[k]=A.hist[k]||{}; A.hist[k].d=A.hist[k].d||{}; A.hist[k].d[t.id]=true; A.hist[k]._t=1000; A.updatedAt=1000;
          const B=JSON.parse(JSON.stringify(A)); delete B.hist[k].d[t.id]; B.hist[k]._t=2000; B.updatedAt=1500; B.tasks.push({id:'fromB',type:'todo',title:'From B',cat:'care',diff:1,done:false,checklist:[],created:k});
          A.tasks=A.tasks.filter(x=>x.id!==dailies()[1].id); A.removed[dailies()[1].id]=1200; A.updatedAt=2500;
          const m=mergeStates(migrate(A), migrate(B));
          return {untickKept: !(m.hist[k].d||{})[t.id], addedKept: m.tasks.some(x=>x.id==='fromB'), deletedStays: !m.tasks.some(x=>x.id===dailies()[1].id)}; })()""")
        check("untick on newer device wins", r["untickKept"], r); check("task added on other device kept", r["addedKept"], r); check("deleted task stays deleted", r["deletedStays"], r)

        # 5. reminders
        r = await pg.evaluate("""(async()=>{ S.settings.reminders=true; const t=dailies().find(x=>x.remind); await scheduleReminders(false); const before=window.__scheduled.filter(n=>n.extra&&n.extra.tid===t.id).length;
          const k=TODAY(); setDaily(t,k,true); await scheduleReminders(false); const after=window.__scheduled.filter(n=>n.extra&&n.extra.tid===t.id);
          const ids=window.__scheduled.map(n=>n.id); return {before, after:after.length, todaySkipped: !after.some(n=>new Date(n.schedule.at).toDateString()===new Date().toDateString()), unique: new Set(ids).size===ids.length, maxId: Math.max(...ids), fmt: (window.__scheduled.find(n=>n.schedule.at)||{schedule:{}}).schedule.at, monthly: window.__scheduled.some(n=>n.schedule.on&&n.schedule.on.day===1)}; })()""")
        check("reminder ids unique and fit in an int", r["unique"] and r["maxId"] < 2**31, r)
        check("reminder dates in the plugin's ISO format", bool(r["fmt"]) and r["fmt"].endswith("Z") and "." in r["fmt"], r)
        check("done daily skips today's reminder", r["todaySkipped"] and r["after"] <= r["before"], r)
        check("monthly summary reminder scheduled", r["monthly"], r)

        # 6. sleep from two sources isn't double counted
        r = await pg.evaluate("logVal(addDays(TODAY(),-1),'sleep')")
        check("sleep not double-counted across sources", r is not None and r < 10, r)

        # 7. goal note with only a minimum
        r = await pg.evaluate("goalNote({kind:'hours',min:7,max:null},8)")
        check("hours goal without max reads sensibly", "null" not in r and "7+" in r, r)

        # 8. shared rules carry a changed default tracker
        r = await pg.evaluate("""(()=>{ trk('water').target=12; const txt=rulesText(); trk('water').target=8; const p=parseRules(txt); applyPack(p,'add'); return [txt.includes('- Water ('), trk('water').target]; })()""")
        check("changed default tracker shared and applied", r==[True,12], r)

        # 9. switching accounts on one phone doesn't mix data
        r = await pg.evaluate("""(async()=>{ await cloudPushNow(); const mine=S.tasks.length; await cloudSignOut();
          await CLOUD.auth.signUp({email:'other@x.co', password:'password123'}); await CLOUD.auth.signOut();
          await cloudSignIn('other@x.co','password123'); return {mine, nowTasks:S.tasks.length, owner:S.owner, onboarded:S.onboarded}; })()""")
        check("other account starts clean on a shared phone", r["nowTasks"]==0 and r["owner"]=="u_1" and r["onboarded"]==False, r)
        r = await pg.evaluate("""(async()=>{ await cloudSignOut(); await cloudSignIn('a@b.co','password123'); return {tasks:S.tasks.length, owner:S.owner}; })()""")
        check("signing back in restores the first account", r["tasks"]>10 and r["owner"]=="u_0", r)

        # 10. reset while signed in signs out and runs sign-up again
        await pg.evaluate("render()"); await pg.click(".tb[data-view=me]"); await pg.wait_for_timeout(200)
        await pg.click("[data-reset]"); await pg.click("[data-s=ok]"); await pg.wait_for_timeout(900)
        r = await pg.evaluate("({signedIn: !!cloudUser, flow: !!document.querySelector('[data-s=create]'), tasks:S.tasks.length})")
        check("reset signs out and opens sign-up", (not r["signedIn"]) and r["flow"] and r["tasks"]==0, r)
        check("no page errors", not errs, errs)
        await b.close()
    srv.terminate()
    print("FAILURES:", fails)
asyncio.run(main())
