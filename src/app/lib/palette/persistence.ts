import { createEditor, type Editor } from './editor';
import { checkedPalette, HARMONY_MODES, normalizeHex, type Harmony } from './engine';
const KEY='dna.studio.palette.editor.v1';
function record(value: unknown): Record<string,string> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid palette recipe');
  const result: Record<string,string>={};
  for(const [key,item] of Object.entries(value)){if(typeof item!=='string'||!/^#[0-9a-f]{6}$/i.test(item))throw new Error('Invalid palette colour');result[key]=item;}
  return result;
}
export function parseEditor(text: string): Editor {
  if(text.length>6000)throw new Error('Palette recipe exceeds size limit');
  const value=JSON.parse(text);
  if(value?.version!==1 || typeof value.seed!=='string' || typeof value.harmony!=='string' || !Object.prototype.hasOwnProperty.call(HARMONY_MODES,value.harmony) || typeof value.variation!=='string' || value.variation.length>128)throw new Error('Invalid palette recipe');
  const locks=record(value.locks), base=createEditor(normalizeHex(value.seed),value.harmony as Harmony,locks,value.variation);
  for(const key of Object.keys(locks))if(!Object.prototype.hasOwnProperty.call(base.variants.light,key))throw new Error('Invalid locked role');
  return {...base,variants:{light:checkedPalette(record(value.variants?.light)),dark:checkedPalette(record(value.variants?.dark))}};
}
export const serializeEditor=(editor: Editor)=>JSON.stringify({version:1,...editor});
export function loadEditor(memory?: Editor): {editor:Editor;error?:string;shared?:boolean} {
  try {const shared=new URLSearchParams(window.location.search).get('palette');if(shared)return {editor:parseEditor(shared),shared:true};}
  catch(error){return {editor:memory||createEditor(),error:error instanceof Error?error.message:'Invalid shared recipe'};}
  if(memory)return {editor:memory};
  try {const saved=localStorage.getItem(KEY);if(saved)return {editor:parseEditor(saved)};}catch{/* Session memory remains available. */}
  return {editor:createEditor()};
}
export function persistEditor(editor: Editor){try{localStorage.setItem(KEY,serializeEditor(editor));return true;}catch{return false;}}
