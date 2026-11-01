"""If-then plans and the reward feedback: plans can be made in the editor, show on Today,
drive reminders, survive sharing; slip habits get a swap that earns XP while slips cost
nothing; "don't" swaps are refused; ticks float XP, closing a ring and a perfect day
celebrate."""
import asyncio, sys, os, subprocess, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, os.pardir, "www")
MOCK = open(os.path.join(HERE, "mock.js")).read()
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8776", "-d", WWW],
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
            r.fulfill(status=200, content_type="application/javascript", body='window.HB_CONFIG={supabaseUrl:"",supabaseAnonKey:""};')))
        await pg.goto("http://localhost:8776/index.html")
        await pg.wait_for_timeout(700)
        await pg.evaluate("""(()=>{ closeSheet(); S = migrate(seed()); S.onboarded = true; S.tasks = []; save(); go('tasks'); })()""")

        # ---- a daily with a plan, made in the editor ----
        await pg.evaluate("editTask(null,'daily')")
        await pg.fill("#f-title", "Drink water")
        await pg.click("[data-cue='After my morning coffee']")
        check("picking a cue fills it in", await pg.input_value("#f-cue") == "After my morning coffee")
        await pg.click("[data-s=save]"); await pg.wait_for_timeout(150)
        r = await pg.evaluate("(()=>{ const t = S.tasks[0]; go('today'); return {cue:t.cue, row:document.querySelector('.rs .cue')?.textContent, up:document.querySelector('.upnext .lbl')?.textContent}; })()")
        check("plan saved and shown on Today", r["cue"] == "After my morning coffee" and r["row"] == "After my morning coffee", r)
        check("Up next leads with the cue", r["up"] == "After my morning coffee", r)

        r = await pg.evaluate("""(async()=>{ S.tasks[0].remind = "23:59"; S.settings.reminders = true; await scheduleReminders(false);
            const n = window.__scheduled.find(x=>x.extra && x.extra.tid===S.tasks[0].id); return n && n.body; })()""")
        check("reminder says the cue", r == "After my morning coffee", r)

        # ---- a daily without a plan gets a gentle nudge ----
        await pg.evaluate("S.tasks.push(cleanTask({type:'daily', id:'noplan', title:'Stretch'})); save(); render()")
        check("'+ when' nudge on a daily with no plan", await pg.locator("[data-edit=noplan].addcue").count() == 1)
        await pg.evaluate("openDetail('noplan')")
        check("detail offers to make it stick", await pg.locator(".card.plan.nudge").count() == 1)
        await pg.evaluate("closeSheet()")

        # ---- a slip habit with a swap ----
        await pg.evaluate("editTask(null,'habit')")
        await pg.fill("#f-title", "Doomscrolling")
        await pg.click("[data-pick=kind][data-v=bad]")
        check("'Do less' asks for a trigger and a swap", await pg.locator("#f-cue").count() == 1 and await pg.locator("#f-swap").count() == 1)
        await pg.click("[data-cue=\"When I'm in bed with my phone\"]")
        await pg.fill("#f-swap", "Don't scroll")
        warn = await pg.locator(".hint.warn").count()
        await pg.click("[data-s=save]"); await pg.wait_for_timeout(100)
        still_open = await pg.locator("#f-swap").count()
        check("a 'don't' swap is flagged and refused", warn == 1 and still_open == 1, {"warn": warn, "open": still_open})
        await pg.fill("#f-swap", "Read one page")
        await pg.click("[data-s=save]"); await pg.wait_for_timeout(150)
        r = await pg.evaluate("""(()=>{ const t = S.tasks.find(x=>x.title==='Doomscrolling'); go('today');
            return {cue:t.cue, swap:t.swap, kind:t.kind, swapBtn:!!document.querySelector(`[data-habit="${t.id}"][data-dir=u]`), slipBtn:!!document.querySelector(`[data-habit="${t.id}"][data-dir=n]`), id:t.id}; })()""")
        check("slip habit saved with trigger and swap", r["cue"] == "When I'm in bed with my phone" and r["swap"] == "Read one page" and r["kind"] == "bad", r)
        check("row has Swapped and Slipped", r["swapBtn"] and r["slipBtn"], r)
        hid = r["id"]
        xp0 = await pg.evaluate("totals().xp")
        await pg.click(f"[data-habit='{hid}'][data-dir=u]"); await pg.wait_for_timeout(80)
        floated = await pg.locator(".floatxp").count()
        xp1 = await pg.evaluate("totals().xp")
        await pg.click(f"[data-habit='{hid}'][data-dir=n]"); await pg.wait_for_timeout(120)
        xp2 = await pg.evaluate("totals().xp")
        toast = await pg.evaluate("document.querySelector('.toast')?.textContent || ''")
        check("a swap earns XP and floats it", xp1 > xp0 and floated >= 1, {"xp0": xp0, "xp1": xp1, "float": floated})
        check("a slip costs nothing and reminds you of the swap", xp2 == xp1 and "Read one page" in toast, {"xp2": xp2, "toast": toast})

        # ---- sharing keeps plans ----
        r = await pg.evaluate("""(()=>{ const txt = rulesText(); const p = parseRules(txt);
            const d = p.daily.find(x=>x.title==='Drink water'), h = p.habit.find(x=>x.title==='Doomscrolling');
            const auto = parseRules("Dailies:\\n- 8 glasses (day, when water >= 8)").daily[0];
            return {txt, dcue:d&&d.cue, hcue:h&&h.cue, hswap:h&&h.swap, autoOk: !!(auto.auto && auto.auto.length) && !auto.cue}; })()""")
        check("shared rules carry the plan", r["dcue"] == "After my morning coffee" and r["hcue"] == "When I'm in bed with my phone" and r["hswap"] == "Read one page", r)
        check("auto-tick 'when water >= 8' isn't mistaken for a plan", r["autoOk"], r)

        # ---- celebrations ----
        await pg.evaluate("""(()=>{ S.tasks = [cleanTask({type:'daily', id:'m1', title:'Walk', cat:'move'}), cleanTask({type:'daily', id:'m2', title:'Stretch', cat:'move'}), cleanTask({type:'daily', id:'r1', title:'Sleep on time', cat:'rest'})]; save(); go('today'); })()""")
        await pg.click(".list [data-daily=m1]"); await pg.wait_for_timeout(100)
        closed1 = await pg.locator(".ar.closed").count()
        await pg.click(".list [data-daily=m2]"); await pg.wait_for_timeout(100)
        closed2 = await pg.evaluate("document.querySelector('.ar.closed')?.dataset.ring || null")
        check("closing a ring celebrates (and not before)", closed1 == 0 and closed2 == "move", {"before": closed1, "after": closed2})
        await pg.click(".list [data-daily=r1]"); await pg.wait_for_timeout(700)
        check("perfect day throws confetti", await pg.locator("canvas.confetti").count() == 1)
        check("tick pops the checkbox", await pg.locator(".cb.pop").count() >= 1)

        # ---- hostile plan text is cleaned ----
        r = await pg.evaluate("""(()=>{ const t = cleanTask({type:'habit', title:'x', kind:'bad', cue:'<img src=x onerror=window.__p=1>'+'a'.repeat(200), swap:{a:1}}); S.tasks.push(t); render(); return {cue:t.cue.length, swap:t.swap===undefined, p:window.__p||null}; })()""")
        check("plan text is capped and typed", r["cue"] <= 60 and r["swap"] and r["p"] is None, r)

        check("no page errors", not errs, errs[:3])
        await b.close()
    srv.terminate()
    print("FAILURES:", fails)
    sys.exit(1 if fails else 0)


asyncio.run(main())
