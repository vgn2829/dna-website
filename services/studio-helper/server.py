"""Optional loopback-only image-mask provider. No uploads are written to disk.
One warm inference child, one queued job, bounded bodies/dimensions/RSS/time.
The caller must explicitly choose the helper; browser processing remains independent.
"""
from __future__ import annotations
import argparse, hashlib, io, json, multiprocessing as mp, queue, re, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import psutil
from PIL import Image, UnidentifiedImageError

CHECKPOINT='studioludens/birefnet-lite-512@962e67969ec6acec9c19fab76acee4f5e22e990c'
SHA256='1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2'
MAX_BYTES=25*1024*1024
MAX_PIXELS=2560*2560
RSS_BUDGET=2*1024**3
JOB_TIMEOUT=45
Image.MAX_IMAGE_PIXELS=MAX_PIXELS

def infer_worker(connection, model_path):
    import numpy as np
    import onnxruntime as ort
    started=time.perf_counter()
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1;options.enable_cpu_mem_arena=True
    session=ort.InferenceSession(model_path,options,providers=['CPUExecutionProvider'])
    init_ms=(time.perf_counter()-started)*1000
    connection.send({'ready':True,'initMs':init_ms,'runtime':ort.__version__})
    while True:
        data=connection.recv_bytes()
        started=time.perf_counter()
        try:
            image=Image.open(io.BytesIO(data));image.load();image=image.convert('RGB');width,height=image.size
            rgb=np.asarray(image.resize((512,512),Image.Resampling.BILINEAR),dtype=np.float32)/255
            values=((rgb-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)).transpose(2,0,1)[None].copy()
            pre=(time.perf_counter()-started)*1000;started=time.perf_counter()
            logits=session.run([session.get_outputs()[0].name],{session.get_inputs()[0].name:values})[0][0,0]
            inference=(time.perf_counter()-started)*1000;started=time.perf_counter()
            alpha=1/(1+np.exp(-np.clip(logits,-80,80)))
            alpha=np.asarray(Image.fromarray(alpha).resize((width,height),Image.Resampling.BILINEAR))
            mask=Image.fromarray(np.rint(alpha*255).astype(np.uint8))
            output=io.BytesIO();mask.save(output,format='PNG')
            connection.send({'ok':True,'preprocessMs':pre,'inferenceMs':inference,'postprocessExportMs':(time.perf_counter()-started)*1000})
            connection.send_bytes(output.getvalue())
        except Exception:
            connection.send({'ok':False,'error':'Image inference failed'})

class Job:
    def __init__(self, job_id, data):
        self.id=job_id;self.data=data;self.cancelled=threading.Event();self.done=threading.Event();self.result=None;self.error=None;self.metrics={}

class Engine:
    def __init__(self, model):
        self.admission=threading.BoundedSemaphore(2);self.model=str(model);self.jobs={};self.lock=threading.Lock();self.pending=queue.Queue(maxsize=1);self.ready=threading.Event();self.stopping=threading.Event();self.child=None;self.connection=None;self.start_error=None;self.init={}
        self.thread=threading.Thread(target=self.loop,daemon=True);self.thread.start()
    def spawn(self):
        self.ready.clear()
        if self.child:
            self.child.terminate();self.child.join(timeout=2)
            if self.child.is_alive():self.child.kill();self.child.join(timeout=2)
        if self.connection:self.connection.close()
        parent,child=mp.get_context('spawn').Pipe();self.connection=parent
        self.child=mp.get_context('spawn').Process(target=infer_worker,args=(child,self.model),daemon=True);self.child.start();child.close()
        deadline=time.monotonic()+60
        while time.monotonic()<deadline and not self.stopping.is_set():
            if not self.child.is_alive():raise RuntimeError('Inference child failed to initialize')
            if psutil.Process(self.child.pid).memory_info().rss>RSS_BUDGET:raise RuntimeError('Initialization exceeded memory budget')
            if parent.poll(.05):
                self.init=parent.recv();self.ready.set();return
        raise RuntimeError('Initialization timeout')
    def loop(self):
        try:self.spawn()
        except Exception as error:self.start_error=str(error);return
        while not self.stopping.is_set():
            try:job=self.pending.get(timeout=.1)
            except queue.Empty:continue
            dispatched=False
            try:
                if job.cancelled.is_set():raise RuntimeError('Cancelled')
                self.connection.send_bytes(job.data);dispatched=True;job.data=b'';deadline=time.monotonic()+JOB_TIMEOUT;peak=0
                while True:
                    if job.cancelled.is_set():raise RuntimeError('Cancelled')
                    if time.monotonic()>deadline:raise RuntimeError('Inference timed out')
                    if not self.child.is_alive():raise RuntimeError('Inference process stopped')
                    rss=psutil.Process(self.child.pid).memory_info().rss;peak=max(peak,rss)
                    if rss>RSS_BUDGET:raise RuntimeError('Inference exceeded memory budget')
                    if self.connection.poll(.025):
                        result=self.connection.recv()
                        if not result.get('ok'):raise RuntimeError(result.get('error','Inference failed'))
                        job.result=self.connection.recv_bytes(MAX_PIXELS*2);job.metrics={**result,'peakSampledChildRssBytes':peak};break
            except Exception as error:
                job.error=str(error)
                if dispatched:
                    try:self.spawn()
                    except Exception as error:self.start_error=str(error)
            finally:
                job.data=b'';job.done.set();self.pending.task_done()
                with self.lock:self.jobs.pop(job.id,None)
    def submit(self, job_id, data):
        with self.lock:
            if not self.ready.is_set() or self.start_error:raise RuntimeError('Helper is not ready')
            if job_id in self.jobs:raise ValueError('Duplicate job id')
            # One active job plus one waiting, never more than two decoded requests.
            if len(self.jobs)>=2:raise queue.Full()
            job=Job(job_id,data);self.pending.put_nowait(job);self.jobs[job_id]=job;return job
    def cancel(self, job_id):
        with self.lock:
            job=self.jobs.get(job_id)
            if job:job.cancelled.set()
    def close(self):
        self.stopping.set()
        with self.lock:
            for job in self.jobs.values():job.cancelled.set()
        if self.child:self.child.terminate();self.child.join(timeout=2)

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.0'
    server_version='DnAStudioHelper/1'
    def log_message(self,*args):pass
    def allowed(self):
        return self.headers.get('Host') in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'} and self.headers.get('Origin') in self.server.origins
    def reply(self,status,data,content_type='application/json',metrics=None):
        self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store')
        if self.allowed():
            self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Vary','Origin')
            self.send_header('Access-Control-Expose-Headers','Server-Timing,X-DnA-Peak-RSS')
        if metrics:
            self.send_header('Server-Timing',f"preprocess;dur={metrics['preprocessMs']:.3f}, inference;dur={metrics['inferenceMs']:.3f}, postprocess;dur={metrics['postprocessExportMs']:.3f}")
            self.send_header('X-DnA-Peak-RSS',str(metrics['peakSampledChildRssBytes']))
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
    def error(self,status,message):self.reply(status,json.dumps({'error':message}).encode())
    def do_OPTIONS(self):
        if not self.allowed():self.error(403,'Origin or host not allowed');return
        self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type,X-DnA-Job');self.send_header('Access-Control-Allow-Private-Network','true');self.send_header('Vary','Origin');self.end_headers()
    def do_GET(self):
        if not self.allowed():self.error(403,'Origin or host not allowed');return
        if self.path!='/health':self.error(404,'Not found');return
        engine=self.server.engine
        self.reply(200,json.dumps({'protocol':1,'ready':engine.ready.is_set() and not engine.start_error,'checkpoint':CHECKPOINT,'sha256':SHA256,'maxPixels':MAX_PIXELS,'maxBytes':MAX_BYTES,'runtime':engine.init.get('runtime'),'initMs':engine.init.get('initMs'),'error':engine.start_error}).encode())
    def do_DELETE(self):
        if not self.allowed():self.error(403,'Origin or host not allowed');return
        job_id=self.path.removeprefix('/jobs/')
        if self.path!='/jobs/'+job_id or not re.fullmatch(r'[0-9a-f-]{36}',job_id):self.error(400,'Invalid job id');return
        self.server.engine.cancel(job_id);self.reply(200,b'{}')
    def do_POST(self):
        if not self.allowed():self.error(403,'Origin or host not allowed');return
        if self.path!='/mask':self.error(404,'Not found');return
        job_id=self.headers.get('X-DnA-Job','')
        if not re.fullmatch(r'[0-9a-f-]{36}',job_id):self.error(400,'Invalid job id');return
        if self.headers.get('Transfer-Encoding'):self.error(400,'Content-Length required');return
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:self.error(400,'Invalid content length');return
        if length<=0 or length>MAX_BYTES:self.error(413,'Image exceeds 25 MiB limit');return
        if self.headers.get('Content-Type') not in {'image/png','image/jpeg','image/webp'}:self.error(415,'Use PNG, JPEG or WebP');return
        if not self.server.engine.admission.acquire(blocking=False):self.error(429,'Helper busy');return
        try:self.handle_image(job_id,length)
        finally:self.server.engine.admission.release()
    def handle_image(self,job_id,length):
        self.connection.settimeout(5)
        try:
            data=self.rfile.read(length)
            if len(data)!=length:raise ValueError('Incomplete image')
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {'PNG','JPEG','WEBP'} or image.width<1 or image.height<1 or image.width*image.height>MAX_PIXELS or max(image.size)>2560:raise ValueError('Decoded image exceeds 2560px working limit')
                image.verify()
            job=self.server.engine.submit(job_id,data)
        except queue.Full:self.error(429,'Helper busy: one active and one queued request allowed');return
        except (ValueError,UnidentifiedImageError,Image.DecompressionBombError,Image.DecompressionBombWarning):self.error(400,'Invalid image or decoded dimensions');return
        except (OSError,TimeoutError):self.error(400,'Image read failed');return
        except RuntimeError:self.error(503,'Helper not ready');return
        if not job.done.wait(JOB_TIMEOUT+65):job.cancelled.set();self.error(504,'Helper timeout');return
        if job.error:self.error(408 if job.error=='Cancelled' else 503,job.error);return
        self.reply(200,job.result,'image/png',job.metrics);job.result=None

def main():
    p=argparse.ArgumentParser();p.add_argument('--model',required=True,type=Path);p.add_argument('--port',type=int,default=8935);p.add_argument('--origin',action='append',default=[]);args=p.parse_args()
    if hashlib.sha256(args.model.read_bytes()).hexdigest()!=SHA256:raise SystemExit('Wrong model checkpoint. See README for the pinned download.')
    engine=Engine(args.model)
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler);server.daemon_threads=True
    server.engine=engine;server.origins=set(args.origin or ['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173','http://localhost:4173'])
    print(f'Loopback helper listening on 127.0.0.1:{args.port}; checkpoint {CHECKPOINT}. No request/image logging.',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close();engine.close()
if __name__=='__main__':main()
