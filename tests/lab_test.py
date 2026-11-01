"""Checks easy days and experiments: an easy day pauses harder dailies without breaking
streaks, a rough night offers one, and an experiment finds a change that was seeded
while calling pure noise "no real change"."""
import asyncio, sys, os, subprocess, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, os.pardir, "www")
MOCK = open(os.path.join(HERE, "mock.js")).read()

srv = subprocess.Popen([sys.executable, "-m", "http.server", "8769", "-d", WWW],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []


def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(info)))
    if not cond:
        fails.append(name)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 390, "height": 844})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.route("**/vendor/supabase.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="application/javascript", body=MOCK)))
        await pg.route("**/config.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="application/javascript",
                      body='window.HB_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k"};')))
        await pg.goto("http://localhost:8769/index.html")
        await pg.wait_for_timeout(700)
        await pg.evaluate("""(()=>{ closeSheet(); S = migrate(seed()); S.onboarded = true;
          const start = addDays(TODAY(),-60);
          S.tasks = [
            cleanTask({type:"daily", id:"easy1", title:"Drink water", diff:1, days:[0,1,2,3,4,5,6], created:start}),
            cleanTask({type:"daily", id:"hard1", title:"Gym", diff:3, days:[0,1,2,3,4,5,6], created:start})];
          save(); render(); })()""")

        # ---------- easy days ----------
        r = await pg.evaluate("""(()=>{ const k = TODAY(), y = addDays(k,-1), g = S.tasks.find(t=>t.id==="hard1");
          for(let i=1;i<=5;i++) sub(addDays(k,-i-1),"d").hard1 = true;           /* streak of 5 ending two days ago */
          setEasy(y, true);                                                        /* yesterday was an easy day, gym skipped */
          const streak = streakOf(g, k);
          const dueEasy = dueToday(y).map(t=>t.id);
          setEasy(y, false); const after = streakOf(g, k);
          return {streak, dueEasy, after}; })()""")
        check("easy day keeps the streak on a paused daily", r["streak"] == 5, r)
        check("only Easy dailies are due on an easy day", r["dueEasy"] == ["easy1"], r)
        check("undoing the easy day brings the miss back", r["after"] == 0, r)

        r = await pg.evaluate("""(()=>{ const k = TODAY();
          for(let i=1;i<=30;i++){ sub(addDays(k,-i),"l").sleep = 7.2 + (i%3)*0.2; sub(addDays(k,-i),"l").hrv = 50 + (i%5); }
          sub(k,"l").sleep = 7.3; sub(k,"l").hrv = 52;
          const fine = bodyCheck(k).low;
          sub(k,"l").sleep = 5.2; sub(k,"l").hrv = 38;
          const rough = bodyCheck(k);
          render(); const card = !!document.querySelector("[data-easy=on]");
          return {fine, low:rough.low, n:rough.signals.length, card}; })()""")
        check("a normal night doesn't trigger an easy day", r["fine"] is False, r)
        check("a rough night against your own usual does", r["low"] is True and r["n"] == 2, r)
        check("Today offers the easy day", r["card"], r)
        await pg.click("[data-easy=skip]")
        r = await pg.evaluate("!!document.querySelector('[data-easy=on]')")
        check("'I'm fine' dismisses it for the day", r is False, r)

        # ---------- experiments ----------
        r = await pg.evaluate("""(()=>{ let s = 7; const rnd = ()=>{ s = (s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; };
          const g = ()=>{ let u=0,v=0; while(!u) u=rnd(); while(!v) v=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
          const start = addDays(TODAY(),-14);
          for(let i=-14;i<14;i++){ const k = addDays(start,i); const l = sub(k,"l");
            l.sleep = Math.round((6.6 + (i>=0?0.8:0) + g()*0.35)*10)/10;     /* seeded: +0.8 h during */
            l.mood = Math.min(10,Math.max(1,Math.round(6 + g()*1.2))); }     /* pure noise */
          S.experiments = cleanExperiments([{id:"x1", title:"No phone after 11 pm", watch:["sleep","mood"], start, len:14}]);
          const e = S.experiments[0], R = expResult(e);
          const sl = R.rows.find(x=>x.t.id==="sleep"), md = R.rows.find(x=>x.t.id==="mood");
          return {fin:expFinished(e), sleep:sl.call, good:sl.good, mood:md.call, line:R.line}; })()""")
        check("finished experiment is detected", r["fin"], r)
        check("seeded sleep change is called clearly, and as better", r["sleep"] == "clear" and r["good"] is True, r)
        check("noise is not called a clear change", r["mood"] != "clear", r)

        await pg.evaluate("render()")
        check("Today shows the finished experiment", await pg.locator(".lab[data-exp=x1]").count() == 1)
        await pg.click(".lab[data-exp=x1]")
        await pg.click("[data-s=keep]")
        r = await pg.evaluate("""(()=>{ const e = S.experiments[0], t = S.tasks.find(x=>x.id===e.link);
          return {verdict:e.verdict, task:t?t.title:null, card:!!document.querySelector(".lab[data-exp=x1]")}; })()""")
        check("keep turns it into a daily", r["verdict"] == "keep" and r["task"] == "No phone after 11 pm", r)
        check("finished card clears once you decide", r["card"] is False, r)

        # hostile experiment data from a synced or restored state is cleaned
        r = await pg.evaluate("""(()=>{ const x = cleanExperiments([{id:'"><img src=x onerror=window.__pwn=1>', title:"<b>t</b>", watch:['x" onclick="1',"sleep"], start:"2026-01-01", len:999},
                                                    {title:"no start", watch:["sleep"]}, null, "junk"]);
          S.experiments = x; go("trends"); return {n:x.length, id:x[0].id, watch:x[0].watch, len:x[0].len, pwn:window.__pwn||null}; })()""")
        check("hostile experiment data is cleaned", r["n"] == 1 and '"' not in r["id"] and r["watch"] == ["sleep"] and r["len"] == 14 and r["pwn"] is None, r)

        # starting one through the sheet
        await pg.evaluate("S.experiments = []; go('trends')")
        await pg.click("[data-expnew]")
        await pg.click("[data-xex='Walk after lunch']")
        await pg.click("[data-pick=xlen][data-v='7']")
        await pg.click("[data-s=save]")
        r = await pg.evaluate("(()=>{ const e = S.experiments[0]; return e ? {t:e.title, len:e.len, start:e.start===TODAY(), w:e.watch} : null; })()")
        check("starting an experiment from the sheet works", r and r["t"] == "Walk after lunch" and r["len"] == 7 and r["start"], r)

        check("no page errors", not errs, errs[:3])
        await b.close()
    srv.terminate()
    print("FAILURES:", fails)
    sys.exit(1 if fails else 0)


asyncio.run(main())
