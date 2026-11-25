import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium,firefox,webkit}=await import(process.env.STUDIO_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.STUDIO_BASE_URL||'http://127.0.0.1:4175';const results=[];
for(const [engine,type] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]){
 const browser=await type.launch();const page=await browser.newPage();const record={engine,version:browser.version(),base,checks:[],assetFailures:[],pageErrors:[],environmentErrors:[]};let helperRequests=0;
 page.on('pageerror',e=>{if(new URL(base).hostname==='127.0.0.1' && /^\/127\.0\.0\.1:\d+\/api\/(live-sessions\/active|settings\/public|domains|artworks|events|team) due to access control checks\.$/.test(e.message))record.environmentErrors.push(e.message);else record.pageErrors.push(e.message);});
 page.on('request',r=>{if(r.url().includes(':8935'))helperRequests++;});
 page.on('requestfailed',r=>{if(/\.(wasm|woff2)(\?|$)|\/models\//.test(r.url()))record.assetFailures.push({url:r.url(),error:r.failure()?.errorText});});
 try{
 await page.goto(base+'/design-studio?tab=palette');await page.getByLabel('Seed hex',{exact:true}).fill('#ff006e');await page.getByLabel('Palette variation seed').fill('release-repro');await page.getByRole('button',{name:'Generate',exact:true}).click();
 await page.getByLabel('Edit Accent',{exact:true}).fill('#123456');await page.getByLabel('Lock Accent',{exact:true}).click();await page.getByRole('button',{name:'Dark',exact:true}).click();assert.equal(await page.getByLabel('Accent hex value',{exact:true}).inputValue(),'#123456');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__studioShared=value;}}}));
 await page.getByRole('button',{name:'Copy palette link',exact:true}).click();const link=await page.evaluate(()=>window.__studioShared);assert(link?.includes('palette='));
 const primary=await page.getByLabel('Primary hex value',{exact:true}).inputValue();await page.goto(link);await page.getByText('Shared palette recipe loaded.',{exact:true}).waitFor();await page.getByRole('button',{name:'Dark',exact:true}).click();assert.equal(await page.getByLabel('Primary hex value',{exact:true}).inputValue(),primary);
 await page.reload();assert.equal(await page.getByLabel('Palette variation seed').inputValue(),'release-repro');assert.equal(await page.getByLabel('Accent hex value',{exact:true}).inputValue(),'#123456');
 await page.getByLabel('Seed hex',{exact:true}).fill('#12');await page.getByRole('button',{name:'Generate',exact:true}).click();await page.getByRole('alert').filter({hasText:'complete hex'}).waitFor();
 record.checks.push('palette generation, exact lock across themes, shared edited variants, refresh recovery and invalid-input rejection');
 await page.goto(base+'/design-studio?tab=font');await page.getByText('Selected fonts loaded',{exact:true}).waitFor();
 const face=await page.evaluate(()=>document.fonts.check('700 40px "Source Serif 4"'));assert(face);
 const license=await page.request.get(base+'/fonts/studio/sourceserif4-OFL.txt');assert(license.ok());assert((await license.text()).includes('SIL OPEN FONT LICENSE'));
 record.checks.push('direct font query, actual selected weight and self-hosted licence');
 await page.goto(base+'/design-studio?tab=halftone');await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/fixtures/ramp-wide.png');await page.waitForFunction(()=>document.querySelector('canvas')?.width===700);
 for(const format of ['PNG','SVG']){const [downloaded]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:format==='SVG'?'Export vector SVG':format,exact:true}).click()]);assert(downloaded.suggestedFilename().includes('1400x700'));if(format==='SVG'){const text=await fs.readFile(await downloaded.path(),'utf8');assert(text.includes('width="1400"'));}}
 await page.getByRole('button',{name:'Font Pairing',exact:true}).click();await page.getByText('Selected fonts loaded',{exact:true}).waitFor();await page.getByRole('button',{name:'Halftone',exact:true}).click();await page.waitForFunction(()=>document.querySelector('canvas')?.width===700);
 record.checks.push('full-resolution PNG/SVG exports and source recovery after lazy tool switch');
 await page.goto(base+'/design-studio?tab=bg');await page.reload();await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/fixtures/astronaut.png');assert.equal(await page.getByLabel('Background processing location').inputValue(),'browser');
 assert(await page.getByLabel('Background processing location').locator('option[value=helper]').isDisabled());
 await page.getByRole('button',{name:'Remove Background',exact:true}).click();await page.getByRole('button',{name:'Re-run',exact:true}).waitFor({timeout:120000});assert.deepEqual(await page.getByRole('alert').allTextContents(),[]);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'PNG',exact:true}).click();assert((await pending).suggestedFilename().endsWith('-nobg.png'));
 assert.equal(helperRequests,0);record.checks.push('direct background route/refresh, real default General inference/export with helper absent and zero loopback requests');
 record.backendStatus=await page.getByRole('status').allTextContents();assert.deepEqual(record.assetFailures,[]);assert.deepEqual(record.pageErrors,[]);
 }catch(error){record.failure=error.stack;}await browser.close();results.push(record);
}
const output=process.env.STUDIO_RESULT_FILE||'docs/studio-validation/release/smoke-preview.json';await fs.writeFile(output,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.failure))process.exitCode=1;
