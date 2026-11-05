import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium,firefox,webkit}=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const results=[];
for(const [engine,type] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]) {
 const browser=await type.launch();const page=await browser.newPage();const result={engine,version:browser.version(),checks:[]};
 try {
 await page.goto('http://127.0.0.1:5173/design-studio?tab=fonts');
 await page.getByRole('button',{name:'Font Pairing',exact:true}).click();
 await page.getByText('Selected fonts loaded',{exact:true}).waitFor();
 const initial=await page.evaluate(()=>document.fonts.size);
 for(let i=0;i<8;i++){await page.getByRole('button',{name:'Next pairing',exact:true}).click();await page.getByText('Selected fonts loaded',{exact:true}).waitFor();}
 assert(await page.evaluate(()=>document.fonts.size)<=initial);
 const failureContext=await browser.newContext();const fontPage=await failureContext.newPage();
 await fontPage.route('**/*.woff2',r=>r.abort());await fontPage.goto('http://127.0.0.1:5173/design-studio?tab=fonts');await fontPage.getByRole('button',{name:'Font Pairing',exact:true}).click();
 await fontPage.getByText(/Font download failed/).waitFor();await fontPage.unroute('**/*.woff2');await fontPage.getByRole('button',{name:'Retry fonts'}).click();await fontPage.getByText('Selected fonts loaded',{exact:true}).waitFor();await failureContext.close();
 const offlineContext=await browser.newContext();const offlinePage=await offlineContext.newPage();await offlinePage.goto('http://127.0.0.1:5173/design-studio?tab=palette');
 await offlinePage.evaluate(()=>import('/src/app/components/studio/FontPairing.tsx'));await offlineContext.setOffline(true);await offlinePage.getByRole('button',{name:'Font Pairing',exact:true}).click();await offlinePage.getByText(/Font download failed/).waitFor();await offlineContext.setOffline(false);await offlinePage.getByRole('button',{name:'Retry fonts'}).click();await offlinePage.getByText('Selected fonts loaded',{exact:true}).waitFor();await offlineContext.close();
 result.checks.push('font face count bounded after 8 changes; missing file and offline errors recover on retry');
 result.exports=await page.evaluate(async()=>{
 const {halftoneGeometry,paintHalftone,halftoneSvg}=await import('/src/app/lib/halftone-logic.ts');
 const out=[];const canvas=document.createElement('canvas');canvas.width=700;canvas.height=350;const ctx=canvas.getContext('2d');
 for(const fixture of ['black','ramp','portrait','texture','transparent']) {
 let image=new ImageData(700,350);
 if(fixture==='portrait'){const b=await createImageBitmap(await(await fetch('/docs/studio-validation/followup/fixtures/portrait.png')).blob());ctx.drawImage(b,0,0,700,350);b.close();image=ctx.getImageData(0,0,700,350);}
 else for(let y=0;y<350;y++)for(let x=0;x<700;x++){const v=fixture==='black'?0:fixture==='ramp'?Math.round(x/699*255):fixture==='texture'?((x+y)%2)*255:0;image.data.set([v,v,v,fixture==='transparent'?0:255],(y*700+x)*4);}
 for(const type of ['squares','lines','dots']){
 const options={type,frequency:10,resolution:4,angle:37,contrast:100,brightness:100,inverted:false,color:'#000000',backgroundColor:'#FFFFFF',minWidth:0,maxWidth:1};
 const geometry=halftoneGeometry(image,options);paintHalftone(ctx,geometry,options);const png=ctx.getImageData(0,0,700,350).data;
 const svg=halftoneSvg(geometry,options),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const img=new Image();img.src=url;await img.decode();ctx.clearRect(0,0,700,350);ctx.drawImage(img,0,0);URL.revokeObjectURL(url);const raster=ctx.getImageData(0,0,700,350).data;
 let error=0,mean=0;for(let i=0;i<png.length;i+=4){error+=Math.abs(png[i]-raster[i]);mean+=raster[i];}out.push({fixture,type,meanAbsoluteChannelDifference:error/(700*350),svgMean:mean/(700*350)});
 }
 }return out;});
 for(const value of result.exports){assert(value.meanAbsoluteChannelDifference<3);if(value.fixture==='black')assert(value.svgMean<1);if(value.fixture==='transparent')assert.equal(value.svgMean,255);}
 result.checks.push('actual browser SVG raster vs PNG: rotated black, ramp, portrait, fine texture and transparent fixtures');
 await page.goto('http://127.0.0.1:5173/design-studio?tab=bg');
 let posts=0;page.on('request',r=>{if(r.url().includes(':8935/mask')&&r.method()==='POST')posts++;});
 await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/followup/fixtures/portrait.png');
 await page.getByRole('button',{name:'Check Python helper',exact:true}).click();await page.getByText(/Verified local helper ready/).waitFor();assert.equal(posts,0);
 await page.getByLabel('Background processing location').selectOption('helper');assert.equal(posts,0);
 await page.getByRole('button',{name:'Remove Background',exact:true}).click();await page.getByRole('button',{name:'Re-run',exact:true}).waitFor({timeout:65000});assert.equal(posts,1);assert.deepEqual(await page.getByRole('alert').allTextContents(),[]);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'PNG',exact:true}).click();await(await download).saveAs(`docs/studio-validation/followup/helper-${engine}.png`);
 await page.reload();await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/followup/fixtures/portrait.png');assert.equal(await page.getByLabel('Background processing location').inputValue(),'browser');assert.equal(posts,1);
 await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/followup/fixtures/soft-transparent.png');await page.getByRole('button',{name:'Keep source transparency (skip AI)',exact:true}).click();
 const alphaDownload=page.waitForEvent('download');await page.getByRole('button',{name:'PNG',exact:true}).click();await(await alphaDownload).saveAs(`docs/studio-validation/followup/source-alpha-${engine}.png`);assert.equal(posts,1);
 result.checks.push('real helper inference/export; no upload on check/select/reload; provider resets to browser; explicit source-alpha bypass');
 }catch(e){result.failure=e.stack;}await browser.close();results.push(result);
}
await fs.writeFile('docs/studio-validation/followup/workflows.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.failure))process.exitCode=1;
