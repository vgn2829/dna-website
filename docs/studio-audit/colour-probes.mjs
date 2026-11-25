import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const root=process.cwd();
const require=createRequire(root+'/package.json');
const esbuild=require('esbuild');
const source=fs.readFileSync(root+'/src/app/components/PaletteStudio.tsx','utf8');
const js=esbuild.transformSync(source+'\nexport { hexToRgb, rgbToOKLCH, oklchToHex, contrastRatio, apcaContrast, GRADE, findAccessibleLightness };',{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const mod={exports:{}};
vm.runInNewContext(js,{module:mod,exports:mod.exports,require,Math,console});
const e=mod.exports;
const cr=(a,b)=>e.contrastRatio(e.hexToRgb(a),e.hexToRgb(b));
const realRandom=Math.random;
const controlled=(mode,sequence)=>{let i=0; Math.random=()=>sequence[i++] ?? .5;return e.derivePalette('#6366F1',false,mode);};
const a=controlled('complementary',[.5,.5,.5,.5,.5]);
const fresh={exports:{}}; vm.runInNewContext(js,{module:fresh,exports:fresh.exports,require,Math,console}); Math.random=()=>.5; const b=fresh.exports.derivePalette('#6366F1',false,'triadic');
Math.random=realRandom;
const invalid=e.derivePalette('#12',false,'complementary');
const p=e.derivePalette('#6366F1',false,'complementary');
const q=e.derivePalette('#6366F1',true,'complementary');
const black=e.hexToRgb('#000000'),white=e.hexToRgb('#FFFFFF');
const neutral=e.oklchToHex({L:0.5,C:0,H:0});
const result={
 sameHarmonyOutputUnderSameChosenStrategy:JSON.stringify(a)===JSON.stringify(b),
 invalidSeed:invalid,
 wcag:{blackWhite:cr('#000000','#FFFFFF'),same:cr('#777777','#777777'),grayWhite:cr('#777777','#FFFFFF')},
 primaryForeground:{light:{primary:p.primary,fg:p.primaryFg,contrast:cr(p.primary,p.primaryFg)},dark:{primary:q.primary,fg:q.primaryFg,contrast:cr(q.primary,q.primaryFg)}},
 apca:{blackWhite:e.apcaContrast(black,white),whiteBlack:e.apcaContrast(white,black),grayWhite:e.apcaContrast(e.hexToRgb('#777777'),white)},
 roundedGrade:{raw:4.499,stored:(4.499).toFixed(2),grade:e.GRADE((4.499).toFixed(2)).label},
 oklch:{red:e.rgbToOKLCH(e.hexToRgb('#FF0000')),roundtrips:['#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#777777'].map(hex=>({hex,out:e.oklchToHex(e.rgbToOKLCH(e.hexToRgb(hex)))})),neutral},
 contrastSearch:{target:.8,returned:e.findAccessibleLightness(0,0,'#FFFFFF',.8,4.5)},
 lightScore:e.scorePalette(p)
};
fs.writeFileSync('/private/tmp/dna-studio-probes.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
