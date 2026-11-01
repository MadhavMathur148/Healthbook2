"""Renders the app at phone size with seeded data and writes PNGs to docs/."""
import asyncio, sys, os, subprocess, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, os.pardir)
WWW = os.path.join(ROOT, "www")
OUT = os.path.join(ROOT, "docs")
os.makedirs(OUT, exist_ok=True)
MOCK = open(os.path.join(HERE, "mock.js")).read()
SEED = open(os.path.join(HERE, "seed.js")).read()

srv = subprocess.Popen([sys.executable, "-m", "http.server", "8771", "-d", WWW],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)


async def shot(pg, name, clip_sheet=False):
    await pg.wait_for_timeout(450)
    # drop any lingering toast so it doesn't sit on top of the content
    await pg.evaluate("document.querySelectorAll('.toast').forEach(t=>t.remove())")
    path = os.path.join(OUT, name + ".png")
    target = pg.locator(".sheet") if clip_sheet else pg
    await target.screenshot(path=path)
    print("wrote", path)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for theme, suffix in (("light", ""), ("dark", "-dark")):
            pg = await b.new_page(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, color_scheme=theme)
            pg.on("pageerror", lambda e: print("ERR", e))
            await pg.route("**/vendor/supabase.js", lambda r: asyncio.ensure_future(
                r.fulfill(status=200, content_type="application/javascript", body=MOCK)))
            await pg.route("**/config.js", lambda r: asyncio.ensure_future(
                r.fulfill(status=200, content_type="application/javascript",
                          body='window.HB_CONFIG={supabaseUrl:"https://demo.supabase.co",supabaseAnonKey:"demo"};')))
            await pg.goto("http://localhost:8771/index.html")
            await pg.wait_for_timeout(700)

            if suffix == "":
                await shot(pg, "01-welcome", clip_sheet=True)
                # the redesigned sign-in sheet, shown on its own
                await pg.evaluate("closeSheet(); openAuth('signup')")
                await shot(pg, "02-signin", clip_sheet=True)
                await pg.evaluate("closeSheet(); (window.signupFlow||onboarding)()")
                await pg.wait_for_timeout(350)

            # onboarding
            if await pg.query_selector("[data-s=local]"):
                await pg.click("[data-s=local]")
            await pg.wait_for_timeout(250)
            await pg.click("[data-s=goals]")
            for g in ("sleep", "move", "water"):
                el = await pg.query_selector(f"[data-goal={g}]")
                if el:
                    await el.click()
            if suffix == "":
                await shot(pg, "03-goals", clip_sheet=True)
            await pg.click("[data-s=day]")
            await pg.fill("#su-wake", "07:00")
            await pg.fill("#su-bed", "23:00")
            await pg.click("[data-s=devices]")
            await pg.click("[data-s=finish]")
            await pg.click("[data-s=done]")
            await pg.wait_for_timeout(600)

            await pg.route("**/__seed.js", lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type="application/javascript", body=SEED)))
            await pg.add_script_tag(url="/__seed.js")
            await pg.evaluate("seedDemo(5)")
            await pg.evaluate("render()")
            await pg.wait_for_timeout(300)

            await pg.click(".tb[data-view=today]"); await shot(pg, "04-today" + suffix)
            await pg.click(".tb[data-view=log]"); await shot(pg, "05-log" + suffix)
            await pg.click(".tb[data-view=trends]"); await shot(pg, "06-trends" + suffix)
            await pg.evaluate("window.scrollTo(0, 620)"); await shot(pg, "07-charts" + suffix)
            await pg.click(".tb[data-view=tasks]"); await shot(pg, "08-tasks" + suffix)

            if suffix == "":
                # the simplified editor
                await pg.evaluate("editTask(null,'daily')")
                await shot(pg, "09-editor", clip_sheet=True)
                await pg.click("[data-more]")
                await shot(pg, "10-editor-more", clip_sheet=True)
                await pg.click("[data-s=cancel]")
                # the monthly summary
                await pg.evaluate("openReport('now')")
                await shot(pg, "11-summary", clip_sheet=True)
                await pg.evaluate("document.querySelector('.sheet').scrollTop=900")
                await shot(pg, "12-summary-detail", clip_sheet=True)
                await pg.evaluate("closeSheet()")
            await pg.click(".tb[data-view=me]"); await shot(pg, "13-me" + suffix)
            await pg.close()
        await b.close()
    srv.terminate()


asyncio.run(main())
