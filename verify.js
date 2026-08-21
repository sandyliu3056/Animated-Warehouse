const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');

const ROOT = __dirname;   /* 這支就放在佈署資料夾裡，直接驗這一份 */
const MIME = {'.html':'text/html','.js':'text/javascript','.png':'image/png','.pdf':'application/pdf','.webmanifest':'application/manifest+json','.md':'text/markdown'};
const hits = [];
const srv = http.createServer((req,res)=>{
  const p = decodeURIComponent(url.parse(req.url).pathname);
  const f = path.join(ROOT, p === '/' ? '/index.html' : p);
  hits.push({p, ok: fs.existsSync(f)});
  if(!fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});

const THEMES = ['goldie','barney','poppy','doodle'];
const CARRIERS = ['ups','fedex','usps'];
const fails = [], notes = [];
function chk(name, cond, extra){ (cond?notes:fails).push((cond?'PASS ':'FAIL ')+name+(extra?'  '+extra:'')); }

function lum(hex){
  const m = hex.match(/\d+/g).map(Number);
  const f = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
  return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]);
}
function cr(a,b){ const la=lum(a),lb=lum(b),hi=Math.max(la,lb),lo=Math.min(la,lb); return (hi+0.05)/(lo+0.05); }

(async()=>{
  await new Promise(r=>srv.listen(8099,r));
  const br = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const ctx = await br.newContext({viewport:{width:900,height:760}});
  await ctx.addInitScript(() => { try{ localStorage.setItem('3pl.tourdone','1'); }catch(e){} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if(m.type()==='error') errs.push('console: '+m.text()); });

  await page.goto('http://localhost:8099/index.html', {waitUntil:'networkidle'});
  // dismiss the cover
  await page.click('#coverSkip');
  await page.waitForTimeout(1200);
  chk('cover dismissed (tour suppressed)', await page.locator('#cover').count() === 0);

  chk('button exists in #bar', await page.locator('#bar #awManualBtn').count() === 1);
  chk('button visible', await page.locator('#awManualBtn').isVisible());

  // --- i18n via the language <select> ---
  const want = {zh:'使用說明', en:'Manual', es:'Manual'};
  for(const [l,txt] of Object.entries(want)){
    await page.selectOption('#lang', l);
    await page.waitForTimeout(450);
    const got = (await page.locator('#awManualTxt').textContent()).trim();
    const tip = await page.getAttribute('#awManualBtn','title');
    chk(`i18n ${l} label`, got === txt, `got="${got}"`);
    chk(`i18n ${l} tooltip non-empty & lang-correct`,
        !!tip && (l==='zh' ? /使用說明/.test(tip) : l==='es' ? /Manual de usuario/.test(tip) : /User manual/.test(tip)), `tip="${tip}"`);
  }
  await page.selectOption('#lang','en'); await page.waitForTimeout(350);

  // --- contrast across all 12 theme x carrier combos ---
  for(const th of THEMES){
    await page.selectOption('#thsel', th);
    await page.waitForTimeout(500);
    for(const c of CARRIERS){
      await page.evaluate(k => { if(typeof applyCarrier==='function') applyCarrier(k); }, c);
      await page.waitForTimeout(450);
      const m = await page.evaluate(()=>{
        const b=document.getElementById('awManualBtn'), bar=document.getElementById('bar');
        const cb=getComputedStyle(b), cbar=getComputedStyle(bar);
        const r=b.getBoundingClientRect();
        return {fg:cb.color, bd:cb.borderTopColor, bw:cb.borderTopWidth,
                barbg:cbar.backgroundColor, barimg:cbar.backgroundImage.slice(0,40),
                w:r.width, h:r.height, top:r.top};
      });
      // bar can be a gradient; sample the actual painted pixel behind the button instead
      const px = await page.evaluate(()=>{
        const b=document.getElementById('awManualBtn').getBoundingClientRect();
        return {x:Math.round(b.left-6), y:Math.round(b.top+b.height/2)};
      });
      const shot = await page.screenshot({clip:{x:px.x-1,y:px.y-1,width:3,height:3}});
      fs.writeFileSync('/tmp/px.png', shot);
      const { execSync } = require('child_process');
      const rgb = execSync(`python3 -c "from PIL import Image;im=Image.open('/tmp/px.png').convert('RGB');print('rgb(%d,%d,%d)'%im.getpixel((1,1)))"`).toString().trim();
      const ratio = cr(m.fg, rgb);
      chk(`contrast ${th}/${c}`, ratio >= 4.5, `${ratio.toFixed(2)}:1  fg=${m.fg} barpx=${rgb}`);
      chk(`border painted ${th}/${c}`, m.bd === m.fg && parseFloat(m.bw) >= 1, `bd=${m.bd} bw=${m.bw}`);
      chk(`sized ${th}/${c}`, m.w > 40 && m.h >= 26, `${m.w.toFixed(0)}x${m.h.toFixed(0)}`);
    }
    await page.screenshot({path:`${ROOT}/_verify_bar_${th}.png`, clip:{x:0,y:0,width:900,height:70}});
  }

  // --- narrow screen: label hides, nothing overflows ---
  await page.selectOption('#thsel','poppy'); await page.waitForTimeout(400);
  await page.setViewportSize({width:390,height:760});
  await page.waitForTimeout(500);
  const narrow = await page.evaluate(()=>{
    const t=document.getElementById('awManualTxt'), b=document.getElementById('awManualBtn');
    const bar=document.getElementById('bar');
    return {txtHidden:getComputedStyle(t).display==='none',
            btnVisible:b.getBoundingClientRect().width>20,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            btnRight: b.getBoundingClientRect().right, vw: innerWidth};
  });
  chk('narrow: label hidden', narrow.txtHidden);
  chk('narrow: icon button still visible', narrow.btnVisible, `w=${narrow.btnVisible}`);
  chk('narrow: no horizontal overflow', narrow.overflow <= 0, `overflow=${narrow.overflow}`);
  chk('narrow: button inside viewport', narrow.btnRight <= narrow.vw+1, `right=${narrow.btnRight} vw=${narrow.vw}`);
  await page.screenshot({path:`${ROOT}/_verify_bar_narrow.png`, clip:{x:0,y:0,width:390,height:110}});
  await page.setViewportSize({width:900,height:760});
  await page.waitForTimeout(400);

  // --- the click actually opens the PDF in a NEW tab ---
  const [pop] = await Promise.all([
    ctx.waitForEvent('page', {timeout:8000}).catch(()=>null),
    page.click('#awManualBtn')
  ]);
  chk('click opens a new tab', !!pop);
  if(pop){
    await pop.waitForLoadState('domcontentloaded').catch(()=>{});
    chk('new tab URL is the manual PDF', /Animated_Warehouse_Manual\.pdf$/.test(pop.url()), pop.url());
    chk('app tab did NOT navigate away', /index\.html$/.test(page.url()), page.url());
    await pop.close();
  }
  const pdfHit = hits.find(h => h.p.endsWith('.pdf'));
  chk('server actually served the PDF', !!pdfHit && pdfHit.ok, JSON.stringify(pdfHit));

  // /favicon.ico is the browser's own fallback probe -- the app declares PNG icons in <head>.
  const bad404 = hits.filter(h => !h.ok && h.p !== '/favicon.ico');
  chk('no 404s on app-referenced paths', bad404.length===0, JSON.stringify(bad404));
  // Google Fonts cannot be reached from this sandbox; the app documents that fallback.
  const realErrs = errs.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.(googleapis|gstatic)/.test(e));
  chk('no page errors', realErrs.length===0, realErrs.slice(0,3).join(' | '));

  await br.close(); srv.close();
  console.log(notes.join('\n'));
  console.log('\n================  ' + notes.length + ' passed, ' + fails.length + ' failed  ================');
  if(fails.length) console.log(fails.join('\n'));
  process.exit(fails.length?1:0);
})();
