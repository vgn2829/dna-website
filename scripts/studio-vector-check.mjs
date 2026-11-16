const { chromium } = await import(process.env.STUDIO_PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs/promises';
const browser=await chromium.launch();const page=await browser.newPage();let result={};try {
 await page.goto('http://127.0.0.1:4173/design-studio?tab=svg');await page.locator('input[type=file]').first().setInputFiles('docs/studio-validation/fixtures/product-holes.png');
 await page.getByRole('button',{name:'Vector Trace',exact:true}).click();await page.getByRole('button',{name:'Vectorize',exact:true}).click();await page.getByRole('button',{name:'Download',exact:true}).waitFor({timeout:30000});result={pass:true,check:'Existing VTracer module worker still produces an SVG in production'};
}catch(e){result={failure:e.message};}await fs.writeFile('docs/studio-validation/vector-smoke.json',JSON.stringify(result,null,2));console.log(result);await browser.close();
