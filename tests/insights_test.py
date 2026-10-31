"""Checks the insight engine finds the signal that was deliberately seeded,
and does not invent findings when the data is pure noise."""
import asyncio, sys, os, re, subprocess, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, os.pardir, "www")
MOCK = open(os.path.join(HERE, "mock.js")).read()
SEED = open(os.path.join(HERE, "seed.js")).read()

srv = subprocess.Popen([sys.executable, "-m", "http.server", "8768", "-d", WWW],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
fails = []


def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(info)))
    if not cond:
        fails.append(name)


async def onboard(pg):
    await pg.click("[data-s=local]")
    await pg.wait_for_timeout(200)
    await pg.click("[data-s=goals]"); await pg.click("[data-goal=sleep]"); await pg.click("[data-goal=move]")
    await pg.click("[data-s=day]"); await pg.fill("#su-wake", "07:00"); await pg.fill("#su-bed", "23:00")
    await pg.click("[data-s=devices]"); await pg.click("[data-s=finish]"); await pg.click("[data-s=done]")
    await pg.wait_for_timeout(600)


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
                      body='window.HB_CONFIG={supabaseUrl:"",supabaseAnonKey:""};')))
        await pg.goto("http://localhost:8768/index.html")
        await pg.wait_for_timeout(700)
        await onboard(pg)

        await pg.add_script_tag(content=SEED)
        n = await pg.evaluate("seedDemo(5)")
        check("seeded history", n > 140, n)

        R = await pg.evaluate("""(()=>{ const m = monthOf(addDays(TODAY(),-32)).slice(0,7);
            const r = buildReport(monthOf(addDays(TODAY(),-32)), false);
            return {month:r.month, headline:r.headline, links:r.links, watch:r.watch, good:r.good,
                    pattern:r.pattern, doctor:r.doctor, pairs:r.pairs, keystone:r.keystone, linkDays:r.linkDays,
                    metrics:r.metrics.map(x=>({id:x.id,n:x.n,avg:x.avg,sd:x.sd,cv:x.cv,z:x.z,base:x.base,trend:x.trend})),
                    routine:r.routine}; })()""")

        check("a report was produced", bool(R["month"]), R["month"])
        check("headline exists", bool(R["headline"]), R)

        # the seed makes sleep genuinely better on days the walk happened
        links = R["links"]
        ks = R.get("keystone")
        allfind = links + (ks["metrics"] if ks else [])
        sleep_link = [l for l in allfind if l["metricId"] == "sleep"]
        check("found the seeded sleep/activity link", len(sleep_link) > 0,
              [l["cond"] + "->" + l["metric"] for l in allfind])
        if sleep_link:
            l = sleep_link[0]
            check("sleep link points the right way (more on active days)", l["diff"] > 0, l)
            check("sleep link has enough days behind it", l["nYes"] >= 8 and l["nNo"] >= 8, l)

        self_cmp = [l for l in links if l["metricId"] and l["metricId"].lower() in l["cond"].lower()]
        check("no tracker compared against its own goal", not self_cmp, self_cmp)
        check("links are capped and deduped", len(links) <= 5 and
              len({l["metricId"] for l in links}) == len(links), links)

        # personal baseline should exist for the second month onwards
        with_base = [m for m in R["metrics"] if m["base"]]
        check("dominant habit reported once as a keystone", ks is not None and len(ks["metrics"]) >= 3, ks)
        conds = [l["cond"] for l in links]
        check("no single habit dominates the findings",
              all(conds.count(c) <= 2 for c in set(conds)), conds)
        rng = [l for l in allfind if l["metricId"] == "sleep"]
        check("range-type metric is not labelled good or bad",
              all(l["good"] is None for l in allfind if l["metricId"] == "sleep"), rng)
        check("personal baselines computed", len(with_base) >= 3,
              [(m["id"], bool(m["base"])) for m in R["metrics"]])

        check("steadiness computed", all(m["cv"] is not None for m in R["metrics"] if m["n"] >= 3), R["metrics"])
        check("routine split into halves",
              R["routine"]["firstHalf"] is not None and R["routine"]["secondHalf"] is not None, R["routine"])
        check("per-daily kept-rate computed", len(R["routine"]["perTask"]) >= 2, R["routine"].get("perTask"))

        # Friday is seeded as the worst sleep night
        wk = [p for p in R["pattern"] if "weak spot for sleep" in p]
        check("weekday pattern found for sleep", len(wk) > 0, R["pattern"])
        check("weekday pattern names Friday or Saturday (the seeded dips)",
              any(("Friday" in p or "Saturday" in p) for p in wk), wk)

        # no sentence should ever claim causation
        allsent = " ".join(links and [l["metric"] for l in links] or []) + " " + \
                  " ".join(R["watch"] + R["good"] + R["pattern"] + R["doctor"] + [R["headline"] or ""])
        bad = [w for w in ["causes", "caused", "because of", "due to", "proves", "diagnos"] if w in allsent.lower()]
        sents = [l["metric"] for l in allfind]
        texts = await pg.evaluate("(ls)=>ls.map(linkSentence)", allfind)
        check("link sentences read as English", all(
            " it hit " not in t and "you didn't." in t or "you did" in t or "you " in t for t in texts), texts)
        check("no duplicated condition label in sentences",
              not any("hit it hit" in t or "did did" in t for t in texts), texts)
        check("large numbers are rounded and grouped",
              not any(re.search(r"\\d{4,}\\.\\d", t) for t in texts), texts)
        check("no causal or diagnostic language", not bad, bad)

        # --- noise control: 20 trials of genuine random data, measuring how often
        # the engine claims a connection that cannot exist ---
        noise = await pg.evaluate("""(async()=>{ let total=0, worst=0, trials=20;
            for(let tr=0; tr<trials; tr++){
              for(const k in S.hist) delete S.hist[k];
              for(let i=70;i>=0;i--){ const k=addDays(TODAY(),-i); const L=sub(k,"l");
                L.water=Math.round(Math.random()*10); L.sleep=Math.round((5+Math.random()*4)*10)/10;
                L.mood=1+Math.round(Math.random()*9); L.stress=1+Math.round(Math.random()*9);
                L.steps=Math.round(3000+Math.random()*8000); L.rhr=Math.round(50+Math.random()*25);
                L.hrv=Math.round(25+Math.random()*50);
                const D=sub(k,"d"); for(const t of dailies()){ if(isDue(t,k) && Math.random()<0.5) D[t.id]=true; }
                day(k)._t=Date.now()-i*86400000; }
              const r = buildReport(monthOf(addDays(TODAY(),-32)), false);
              total += r.links.length; worst = Math.max(worst, r.links[0]?Math.abs(r.links[0].d):0);
            }
            return {perReport: total/trials, total, trials, worst:Math.round(worst*100)/100}; })()""")
        check("false connections stay rare on pure noise (<0.5 per report)",
              noise["perReport"] < 0.5, noise)

        check("no page errors", not errs, errs[:3])
        await b.close()
    srv.terminate()
    print("FAILURES:", fails)
    sys.exit(1 if fails else 0)


asyncio.run(main())
