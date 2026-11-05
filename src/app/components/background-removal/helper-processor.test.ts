import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkHelper,helperBackgroundProcessor} from './helper-processor';
afterEach(()=>vi.unstubAllGlobals());
describe('explicit loopback helper contract',()=>{
 it('rejects unavailable service and incompatible checkpoint without submitting an image',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({protocol:1,ready:true,checkpoint:'wrong',sha256:'wrong'})));
  vi.stubGlobal('fetch',fetch);await expect(checkHelper()).rejects.toThrow('verified checkpoint');expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8935/health');
  fetch.mockResolvedValue(new Response('',{status:503}));await expect(checkHelper()).rejects.toThrow('unavailable');
 });
 it('rejects unsupported models before encoding or network activity',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await expect(helperBackgroundProcessor.segment({} as ImageData,'general')).rejects.toThrow('Detail checkpoint only');expect(fetch).not.toHaveBeenCalled();
 });
});
