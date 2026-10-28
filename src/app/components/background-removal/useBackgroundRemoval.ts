import { useCallback } from 'react';
import { useWorkerTask } from '../useWorkerTask';
import type { ModelId,SegmentProgress,SegmentResult } from './types';
export interface RemovalProgress {phase:'download'|'init'|'infer';pct?:number}
export function useBackgroundRemoval(){
  const task=useWorkerTask<Uint8ClampedArray,RemovalProgress>(()=>new Worker(new URL('./bg-removal.worker.ts',import.meta.url),{type:'module'}),(message:SegmentResult)=>new Uint8ClampedArray(message.mask),(message:SegmentProgress)=>({phase:message.phase,pct:message.pct}));
  const removeBackground=useCallback((image:ImageData,model:ModelId='general')=>{const rgba=image.data.slice().buffer;return task.run({type:'segment',model,width:image.width,height:image.height,rgba},[rgba]);},[task.run]);
  return {...task,removeBackground};
}
