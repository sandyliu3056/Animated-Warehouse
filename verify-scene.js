const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
/* 這支驗的是畫布內容，需要拿到 app 自己作用域裡的 g（那是 let，外面取不到），
   所以先做一份注入取用點的暫存副本再驗。佈署資料夾本身不會被改到。 */
const REAL=__dirname, ROOT='/tmp/aw-verify-scene';
{
  const fsx=require('fs'), px=require('path');
  fsx.mkdirSync(ROOT,{recursive:true});
  for(const f of fsx.readdirSync(REAL))
    if(/\.(png|webmanifest)$/.test(f) || f==='sw.js')
      fsx.copyFileSync(px.join(REAL,f), px.join(ROOT,f));
  const h=fsx.readFileSync(px.join(REAL,'index.html'),'utf8');
  const CAP="\n/*TESTCAP*/ try{ window.__cap={ SUB:SUB, setG:c=>{g=c;}, getG:()=>g }; }catch(e){}\n";
  const i=h.indexOf('</script>');
  fsx.writeFileSync(px.join(ROOT,'index.html'), h.slice(0,i)+CAP+h.slice(i));
}
const srv=http.createServer((q,r)=>{const p=decodeURIComponent(url.parse(q.url).pathname);
 const f=path.join(ROOT,p==='/'?'/index.html':p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
 r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
const fails=[],notes=[];
const chk=(n,c,x)=>(c?notes:fails).push((c?'PASS ':'FAIL ')+n+(x?'  '+x:''));
(async()=>{
 await new Promise(r=>srv.listen(8088,r));
 const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
 const ctx=await br.newContext({viewport:{width:1000,height:800}});
 await ctx.addInitScript(()=>{try{localStorage.setItem('3pl.tourdone','1');}catch(e){}});
 const p=await ctx.newPage();
 await p.goto('http://localhost:8088/index.html',{waitUntil:'networkidle'});
 await p.click('#coverSkip'); await p.waitForTimeout(1200);

 /* ---------- 狗灑尿：尿柱要真的打在消防栓上，水漬要在栓腳下 ---------- */
 const geo = await p.evaluate(()=>{
   const W=620,H=250, cv=document.createElement('canvas');
   cv.width=W; cv.height=H; const cx=cv.getContext('2d',{willReadFrequently:true});
   const keep=window.__cap.getG(); window.__cap.setG(cx);
   sceneDelivery(275/0.55, W, H);
   window.__cap.setG(keep);
   const d=cx.getImageData(0,0,W,H).data;
   const hydX=Math.round(W*0.155), base=128;
   /* 尿的顏色是偏綠的淡黃：R,G 高、B 低，而且 R≈G */
   const isPee=(r,g,b)=> g>170 && r>170 && b<170 && Math.abs(r-g)<40 && (g-b)>45;
   let hitCap=0, past=0, onFoot=0, minX=1e9, maxX=-1e9;
   for(let y=0;y<H;y++) for(let x=0;x<W;x++){
     const i=(y*W+x)*4; if(!isPee(d[i],d[i+1],d[i+2])) continue;
     if(x<minX)minX=x; if(x>maxX)maxX=x;
     /* 右側蓋：x 在 hydX+5..hydX+10，y 在 base-16..base-9 */
     if(x>=hydX+4 && x<=hydX+11 && y>=base-17 && y<=base-8) hitCap++;
     /* 打過頭：跑到消防栓左邊去了 */
     if(x < hydX-9) past++;
     /* 水漬：底座腳邊 x 在 hydX-8..hydX+16、y 在 base-4..base+4 */
     if(x>=hydX-8 && x<=hydX+16 && y>=base-4 && y<=base+4) onFoot++;
   }
   return {hitCap,past,onFoot,minX,maxX,hydX,base};
 });
 chk('尿柱打在消防栓右側蓋上', geo.hitCap >= 6, JSON.stringify(geo));
 chk('沒有噴過頭到消防栓左邊', geo.past === 0, 'past='+geo.past);
 /* 水漬是半透明疊在路面上，絕對色值抓不準（實測跟路面只差幾階）。
    改成跟「還沒開始尿」的那一幀相減，看變的是哪一塊。 */
 const pud = await p.evaluate(()=>{
   const W=620,H=250;
   const shot=t=>{ const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
     const cx=cv.getContext('2d',{willReadFrequently:true});
     const keep=window.__cap.getG(); window.__cap.setG(cx);
     sceneDelivery(t/0.55, W, H); window.__cap.setG(keep);
     return cx.getImageData(0,0,W,H).data; };
   const dry=shot(200), wet=shot(300);          /* 200 還沒尿，300 水漬最大 */
   const base=128, hydX=Math.round(W*0.155);
   /* 只看消防栓腳邊那一塊。整張畫面相減的話，貨車、貓、廣場上的人
      在這兩幀之間本來就會動，量到的是它們不是水漬。
      右界收在 hydX+17：狗的影子從 hydX+18 開始（x±bw(22)）。 */
   const X0=hydX-24, X1=hydX+17;
   let n=0, sx=0, minx=1e9, maxx=-1e9;
   for(let y=base-6;y<=base+6;y++) for(let x=X0;x<=X1;x++){
     const i=(y*W+x)*4;
     const d=Math.abs(dry[i]-wet[i])+Math.abs(dry[i+1]-wet[i+1])+Math.abs(dry[i+2]-wet[i+2]);
     if(d>10){ n++; sx+=x; if(x<minx)minx=x; if(x>maxx)maxx=x; }
   }
   return {n, cx: n?Math.round(sx/n):-1, minx, maxx, hydX, base, X0, X1};
 });
 chk('地上有水漬（跟未尿的那一幀相減）', pud.n >= 40, JSON.stringify(pud));
 chk('水漬中心在消防栓腳邊（±12px）', Math.abs(pud.cx - pud.hydX) <= 12,
     'cx='+pud.cx+' hydX='+pud.hydX);
 chk('水漬貼著消防栓、沒有飄到別處', pud.minx >= pud.hydX-16 && pud.maxx <= pud.hydX+17,
     'minx='+pud.minx+' maxx='+pud.maxx+' hydX='+pud.hydX);
 chk('尿柱最左端沒有超出消防栓', geo.minX >= geo.hydX-9, 'minX='+geo.minX+' hydX='+geo.hydX);

 /* ---------- Doodle 標題的星星不能自成一行 ---------- */
 for(const th of ['doodle','goldie','poppy','barney']){
   await p.selectOption('#thsel', th); await p.waitForTimeout(450);
   const m = await p.evaluate(()=>{
     const h=document.getElementById('title');
     const lh=parseFloat(getComputedStyle(h).lineHeight)||18;
     return {lines: Math.round(h.getBoundingClientRect().height/lh),
             barH: Math.round(document.getElementById('bar').getBoundingClientRect().height)};
   });
   chk(`${th}: 標題只有兩行（標題＋副標）`, m.lines <= 2, JSON.stringify(m));
 }
 await p.selectOption('#thsel','doodle'); await p.waitForTimeout(400);
 await p.screenshot({path:REAL+'/_verify_star.png',clip:{x:0,y:0,width:1000,height:90}});

 /* ---------- 時區：不在清單上的地方也要算得出座標 ---------- */
 const tz = await p.evaluate(()=>{
   const out={};
   ['Asia/Taipei','Europe/Madrid','America/Phoenix','Asia/Kolkata','Australia/Sydney','America/Sao_Paulo','Africa/Lagos']
     .forEach(z=>{ out[z]= (typeof tzGeo==='function') ? tzGeo(z) : 'no tzGeo'; });
   return out;
 });
 for(const [z,v] of Object.entries(tz)){
   const ok = Array.isArray(v) && isFinite(v[0]) && isFinite(v[1]) && Math.abs(v[0])<=90 && Math.abs(v[1])<=180;
   chk(`時區 ${z} 算得出座標`, ok, JSON.stringify(v));
 }
 // known zones must keep their exact table values
 chk('已知時區維持原本的精確座標', JSON.stringify(tz['Asia/Taipei'])==='[25.03,121.57]', JSON.stringify(tz['Asia/Taipei']));
 // Madrid ~ +2h summer -> lon ~30 (rough but right hemisphere); Phoenix -7 -> -105
 chk('Europe/Madrid 落在東半球正值經度', tz['Europe/Madrid'][1] >= 0, JSON.stringify(tz['Europe/Madrid']));
 chk('America/Phoenix 落在西半球負值經度', tz['America/Phoenix'][1] < 0, JSON.stringify(tz['America/Phoenix']));
 chk('Australia/Sydney 緯度為負（南半球）', tz['Australia/Sydney'][0] < 0, JSON.stringify(tz['Australia/Sydney']));

 await br.close(); srv.close();
 console.log(notes.join('\n'));
 console.log('\n=========  '+notes.length+' passed, '+fails.length+' failed  =========');
 if(fails.length) console.log(fails.join('\n'));
 process.exit(fails.length?1:0);
})();
