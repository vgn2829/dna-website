import { useCallback } from 'react';
import { useWorkerTask } from '../useWorkerTask';
import type { TracerConfig, VectorizeResult } from './types';
export function useVectorize() {
  const task=useWorkerTask<string,never>(()=>new Worker(new URL('./vectorize.worker.ts',import.meta.url),{type:'module'}),(message:VectorizeResult)=>message.svg);
  const vectorize=useCallback((image:ImageData,config:TracerConfig)=>{const rgba=image.data.slice().buffer;return task.run({type:'vectorize',width:image.width,height:image.height,rgba,config},[rgba]);},[task.run]);
  return {...task,vectorize};
}
