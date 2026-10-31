import asyncio, sys, subprocess, time
from playwright.async_api import async_playwright
import os
HERE=os.path.dirname(os.path.abspath(__file__)); WWW=os.path.join(HERE,os.pardir,"www")
MOCK=open(HERE+"/mock.js").read()
srv=subprocess.Popen([sys.executable,"-m","http.server","8772","-d",WWW],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
BAD=["supabase","postgres","PGRST","row-level","JWT","service_role","database","SQL","constraint","relation \"","null value"]
fails=[]
def check(n,c,i=""):
    print(("PASS " if c else "FAIL ")+n+("" if c else "  -> "+str(i)))
    if not c: fails.append(n)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
        pg=await b.new_page(viewport={"width":390,"height":844})
        await pg.route("**/vendor/supabase.js", lambda r: asyncio.ensure_future(r.fulfill(status=200,content_type="application/javascript",body=MOCK)))
        await pg.route("**/config.js", lambda r: asyncio.ensure_future(r.fulfill(status=200,content_type="application/javascript",body='window.HB_CONFIG={supabaseUrl:"https://x.supabase.co",supabaseAnonKey:"k"};')))
        await pg.goto("http://localhost:8772/index.html"); await pg.wait_for_timeout(700)
        # raw backend-style errors must never reach the user
        for raw in ['duplicate key value violates unique constraint "profiles_pkey"',
                    'JWT expired', 'PGRST116: no rows returned',
                    'relation "app_state" does not exist',
                    'new row violates row-level security policy']:
            out = await pg.evaluate("(m)=>msgOf({message:m})", raw)
            hit=[w for w in BAD if w.lower() in out.lower()]
            check("backend error hidden: "+raw[:34], not hit, out)
        # privacy policy wording
        await pg.goto("http://localhost:8772/privacypolicy.html"); await pg.wait_for_timeout(300)
        txt = (await pg.inner_text("body"))
        hit=[w for w in BAD if w.lower() in txt.lower()]
        check("privacy policy names no vendor or tech", not hit, hit)
        # whole-app visible text sweep
        await pg.goto("http://localhost:8772/index.html"); await pg.wait_for_timeout(700)
        await pg.click("[data-s=local]"); await pg.wait_for_timeout(200)
        await pg.click("[data-s=goals]"); await pg.click("[data-goal=sleep]"); await pg.click("[data-s=day]")
        await pg.fill("#su-wake","07:00"); await pg.fill("#su-bed","23:00")
        await pg.click("[data-s=devices]"); await pg.click("[data-s=finish]"); await pg.click("[data-s=done]")
        await pg.wait_for_timeout(600)
        seen=set()
        for v in ["today","log","trends","tasks","me"]:
            await pg.click(f".tb[data-view={v}]"); await pg.wait_for_timeout(250)
            seen.update([w for w in BAD if w.lower() in (await pg.inner_text("body")).lower()])
        await pg.evaluate("confirmDeleteAccount && confirmDeleteAccount()")
        await pg.wait_for_timeout(300)
        seen.update([w for w in BAD if w.lower() in (await pg.inner_text("body")).lower()])
        check("no tech terms visible anywhere in the app", not seen, seen)
        await b.close()
    srv.terminate(); print("FAILURES:", fails); sys.exit(1 if fails else 0)
asyncio.run(main())
