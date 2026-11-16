"""Reproducible local CPU candidate benchmark. See fixture provenance; no reference-mask scores."""
import argparse, hashlib, json, pathlib, platform, threading, time
import numpy as np
import onnxruntime as ort
import psutil
from PIL import Image, ImageEnhance, ImageFilter
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/studio-validation/followup'
MODEL_SHA = '1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2'

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--model', required=True); parser.add_argument('--runs', type=int, default=3); args=parser.parse_args()
    model=pathlib.Path(args.model)
    if hashlib.sha256(model.read_bytes()).hexdigest()!=MODEL_SHA: raise RuntimeError('Checkpoint hash mismatch')
    fixtures=OUTPUT/'fixtures'; fixtures.mkdir(parents=True,exist_ok=True); (OUTPUT/'outputs').mkdir(exist_ok=True)
    astro=Image.open(ROOT/'docs/studio-validation/fixtures/astronaut.png').convert('RGBA')
    astro.save(fixtures/'portrait.png')
    ImageEnhance.Contrast(astro.convert('RGB')).enhance(.35).save(fixtures/'similar-colours.png')
    # Image-only synthetic motion blur, no invented segmentation reference.
    blurred=Image.blend(astro,astro.transform(astro.size,Image.Transform.AFFINE,(1,0,4,0,1,0)),.5).filter(ImageFilter.GaussianBlur(.6));blurred.save(fixtures/'motion-soft.png')
    for name in ['product-holes.png','soft-transparent.png','illustrated-fine-edges.png']:
        Image.open(ROOT/'docs/studio-validation/fixtures'/name).save(fixtures/name)
    samples=[]; stop=threading.Event(); process=psutil.Process()
    def sample():
        while not stop.wait(.02): samples.append(process.memory_info().rss)
    thread=threading.Thread(target=sample,daemon=True);thread.start()
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    start=time.perf_counter();session=ort.InferenceSession(str(model),options,providers=['CPUExecutionProvider']);init=time.perf_counter()-start
    results=[]
    for path in sorted(fixtures.glob('*.png')):
        image=Image.open(path).convert('RGBA');runs=[]
        for run in range(args.runs):
            t=time.perf_counter();rgb=np.asarray(image.convert('RGB').resize((512,512),Image.Resampling.BILINEAR),dtype=np.float32)/255
            tensor=((rgb-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)).transpose(2,0,1)[None].copy()
            pre=(time.perf_counter()-t)*1000;t=time.perf_counter();logits=session.run([session.get_outputs()[0].name],{session.get_inputs()[0].name:tensor})[0][0,0];infer=(time.perf_counter()-t)*1000;t=time.perf_counter()
            alpha=1/(1+np.exp(-np.clip(logits,-80,80)));matte=np.asarray(Image.fromarray(alpha).resize(image.size,Image.Resampling.BILINEAR))
            pixels=np.array(image);pixels[:,:,3]=np.rint(pixels[:,:,3].astype(np.float32)*matte).astype(np.uint8)
            result=Image.fromarray(pixels);post=(time.perf_counter()-t)*1000;t=time.perf_counter();result.save(OUTPUT/'outputs'/(path.stem+'-candidate.png'));export=(time.perf_counter()-t)*1000
            print(path.name,run,round(infer,1),flush=True)
            runs.append({'preprocessMs':pre,'inferenceMs':infer,'postprocessMs':post,'exportMs':export,'rssBytes':process.memory_info().rss})
        ordered=sorted(r['inferenceMs'] for r in runs)
        results.append({'fixture':path.name,'dimensions':list(image.size),'runs':runs,'medianInferenceMs':ordered[len(ordered)//2],'slowInferenceMs':max(ordered)})
        print(path.name,results[-1]['medianInferenceMs'],flush=True)
    stop.set();thread.join();result={'model':'studioludens/birefnet-lite-512','revision':'962e67969ec6acec9c19fab76acee4f5e22e990c','sha256':MODEL_SHA,'precision':'float32','input':[1,3,512,512],'runtime':ort.__version__,'provider':session.get_providers(),'initMs':init*1000,'peakSampledRssBytes':max(samples),'hardware':platform.platform(),'comparisonReferenceBytesNotEnforced':2*1024**3,'results':results}
    (OUTPUT/'candidate-512-cpu.json').write_text(json.dumps(result,indent=2))
if __name__=='__main__':main()
