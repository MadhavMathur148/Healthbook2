"""Hostile data can't run code or corrupt the app, and real data survives the cleaner.

Feeds a backup / synced copy with attack strings in every field (markup, script, prototype
pollution, wrong types, huge numbers, fake reports) through the same path an import or a
sync uses, then opens every screen and sheet. Fails if any script runs, any injected element
appears, the prototype is polluted, or the page errors. Then round-trips five months of real
data through the cleaner and fails if anything changed."""
import asyncio, sys, os, subprocess, time, json
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, os.pardir, "www")
MOCK = open(os.path.join(HERE, "mock.js")).read()
SEED = open(os.path.join(HERE, "seed.js")).read()
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8774", "-d", WWW],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []


def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(info)))
    if not cond:
        fails.append(name)


P = '"><img src=x onerror="window.__pwn=1"><script>window.__pwn=2</script><a href="javascript:window.__pwn=3">'
ID = 'x" onclick="window.__pwn=4'
D = "2026-10-01"
HOSTILE = {
    "v": 2, "onboarded": True, "created": P, "updatedAt": P, "owner": P, "pendingEmail": P, "evil": P,
    "__proto__": {"polluted": 1},
    "profile": {"name": P, "birthYear": P, "sex": P, "heightCm": "1e999", "weightKg": {"a": 1}, "goals": [P, ID], "devices": [P], "wake": P, "bed": P, "__proto__": {"polluted": 2}},
    "settings": {"theme": P, "dayStart": P, "logReminder": P, "sound": P, "hc": {"connected": P, "granted": [P], "last": P}},
    "tasks": [{"type": "daily", "id": ID, "title": P, "notes": P, "cat": P, "days": [P, 1], "block": P, "remind": P, "diff": P,
               "checklist": [{"id": ID, "text": P}], "auto": [{"t": P, "op": P, "v": P}]},
              {"type": "habit", "id": "h1", "title": P, "kind": P, "period": P, "target": P},
              {"type": "todo", "id": "t1", "title": P, "due": P, "star": P}, P, None, 7],
    "trackers": [{"id": ID, "name": P, "unit": P, "kind": "scale", "color": P, "lo": P, "hi": P, "note": P, "better": P, "min": P}],
    "rewards": [{"id": ID, "title": P, "cost": P}],
    "purchases": [{"t": P, "day": P, "id": ID, "title": P, "cost": P}],
    "removed": {P: P},
    "experiments": [{"id": ID, "title": P, "watch": [P, "mood"], "start": D, "len": P, "link": ID}],
    "hist": {P: {"l": {"mood": 5}},
             D: {"l": {"mood": P, ID: 3, "sleep": 1e300, "steps": "9000"}, "d": {ID: P, "h1": True}, "h": {"h1": {"u": P, "n": -5}},
                 "x": {P: 5, "d:h1": 1e9}, "c": {ID: {P: True}}, "src": {"sleep": P}, "easy": P, "_t": P, "evil": P},
             "__proto__": {"polluted": 3}},
    "reports": {"2026-09": {"label": P, "month": "2026-09", "good": [P], "watch": [], "doctor": [], "pattern": [], "links": [], "pairs": [],
                            "notes": [], "metrics": [{"name": "Sleep", "avg": P, "color": P}], "routine": {}, "profile": {}},
                P: {"label": "x"}}
}


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
        await pg.route("**/__seed.js", lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type="application/javascript", body=SEED)))
        await pg.goto("http://localhost:8774/index.html")
        await pg.wait_for_timeout(700)

        # the raw text is parsed exactly as a backup file or a synced copy would be
        raw = json.dumps(HOSTILE).replace('"__proto__"', '"__proto__"')
        r = await pg.evaluate("""(raw)=>{ closeSheet();
            S = migrate(JSON.parse(raw)); save(); render();
            const t = S.tasks[0], tr = S.trackers[0], d = S.hist["2026-10-01"] || {};
            return {keys:Object.keys(S).sort(), name:S.profile.name.length, theme:S.settings.theme, dayStart:S.settings.dayStart,
              histKeys:Object.keys(S.hist), dayKeys:Object.keys(d).sort(), mood:(d.l||{}).mood, sleep:(d.l||{}).sleep, steps:(d.l||{}).steps,
              done:d.d, xp:d.x, easy:d.easy, reports:Object.keys(S.reports), created:S.created, owner:S.owner||null, email:S.pendingEmail,
              taskId:t && t.id, tasks:S.tasks.length, trackerId:tr && tr.id, color:tr && tr.color, exps:S.experiments.length,
              removed:Object.keys(S.removed), polluted:({}).polluted || Object.prototype.polluted || null}; }""", raw)
        check("prototype not polluted", r["polluted"] is None, r["polluted"])
        check("unknown top-level fields dropped", "evil" not in r["keys"], r["keys"])
        check("non-date history keys dropped", r["histKeys"] == [D], r["histKeys"])
        check("day keeps only known fields, right types", r["dayKeys"] == ["_t", "c", "d", "h", "l", "src", "x"] and r["mood"] is None and r["sleep"] is None and r["steps"] == 9000, r)
        check("done flags must be true, xp capped", r["done"] == {"h1": True} and r["xp"] == {}, r)
        check("tampered summaries are dropped", r["reports"] == [], r["reports"])
        check("settings and profile forced to valid values", r["theme"] == "system" and r["dayStart"] == 3 and r["name"] <= 60, r)
        check("ids can't carry markup", '"' not in (r["taskId"] or "") and '"' not in (r["trackerId"] or "") and r["color"] == "blue", r)
        check("junk dates, owner, email, removed list rejected", r["created"] != json.loads(json.dumps(P)) and r["owner"] is None and r["email"] is None and r["removed"] == [], r)

        # open every screen and sheet with the hostile data loaded
        for v in ["today", "log", "trends", "tasks", "me"]:
            await pg.click(f".tb[data-view={v}]"); await pg.wait_for_timeout(150)
            if v == "tasks":
                for seg in ["daily", "habit", "todo", "reward", "tracker"]:
                    await pg.click(f"[data-seg={seg}]"); await pg.wait_for_timeout(80)
        for js in ["openDetail(S.tasks[0].id)", "editTask(S.tasks[0].id)", "editTracker(S.trackers[0].id)",
                   "S.rewards[0] && editReward(S.rewards[0].id)", "S.experiments[0] && openExperiment(S.experiments[0].id)",
                   "openReport('now')", "shareRules && 0"]:
            await pg.evaluate(f"closeSheet(); {js}"); await pg.wait_for_timeout(120)
            if await pg.evaluate("document.querySelectorAll('img[src=x], script:not([src]), a[href^=javascript]').length"):
                check("no injected elements: " + js, False)
        await pg.evaluate("closeSheet(); go('today')")
        pwn = await pg.evaluate("window.__pwn || null")
        check("no script ran from hostile data", pwn is None, pwn)
        check("no injected elements anywhere", "no injected elements" not in " ".join(fails))

        # real data must pass through untouched
        await pg.add_script_tag(url="/__seed.js")
        r = await pg.evaluate("""(()=>{ S = migrate(seed()); S.onboarded = true; seedDemo(5);
            S.experiments = cleanExperiments([{id:"e1", title:"Walk after lunch", watch:["sleep"], start:addDays(TODAY(),-20), len:14, verdict:"keep"}]);
            S.purchases.push({t:Date.now(), day:TODAY(), id:"r1", title:"Movie night", cost:120});
            S.removed["trk:old"] = Date.now(); S.pendingEmail = "me@example.com";
            sub(TODAY(),"src").sleep = "hc"; day(TODAY()).easy = true;
            S.reports = {}; reportsCheck(); save();
            /* compare values, not the order fields happen to be written in */
            const canon = v=>Array.isArray(v) ? "["+v.map(canon).join(",")+"]" : v && typeof v==="object" ? "{"+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+":"+canon(v[k])).join(",")+"}" : JSON.stringify(v);
            const a = JSON.parse(JSON.stringify(S)), z = JSON.parse(JSON.stringify(migrate(JSON.parse(JSON.stringify(S))))), diff = [];
            for(const k of Object.keys(a)) if(canon(a[k]) !== canon(z[k])) diff.push(k);
            const before = canon(a), after = canon(z);
            return {same: before===after, diff, reports:Object.keys(a.reports||{}).length, days:Object.keys(a.hist).length}; })()""")
        check("five months of real data survive the cleaner unchanged", r["same"], r)
        check("(real data had summaries and history to test)", r["reports"] >= 3 and r["days"] > 140, r)

        check("no page errors", not errs, errs[:3])
        await b.close()
    srv.terminate()
    print("FAILURES:", fails)
    sys.exit(1 if fails else 0)


asyncio.run(main())
