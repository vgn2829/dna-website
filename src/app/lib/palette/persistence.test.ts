import {expect,it} from 'vitest';
import {createEditor,paletteReducer} from './editor';
import {parseEditor,serializeEditor} from './persistence';
it('round-trips both edited variants, exact locks and reproducible variation',()=>{
 let editor=createEditor('#ff006e','triadic',{},'release-check');
 editor=paletteReducer(editor,{type:'edit',theme:'light',role:'accent',value:'#123456'});
 editor=paletteReducer(editor,{type:'lock',theme:'light',role:'accent'});
 expect(parseEditor(serializeEditor(editor))).toEqual(editor);
 expect(createEditor(editor.seed,editor.harmony,editor.locks,editor.variation)).toEqual(createEditor(editor.seed,editor.harmony,editor.locks,editor.variation));
});
it('rejects malformed, oversized, unknown harmony and incomplete variants',()=>{
 const editor=createEditor();
 for(const value of ['bad','x'.repeat(6001),JSON.stringify({version:1,...editor,harmony:'evil'}),JSON.stringify({version:1,...editor,variants:{light:{},dark:{}}})])expect(()=>parseEditor(value)).toThrow();
});
