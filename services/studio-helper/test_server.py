"""Real loopback service contracts; run with the server listening on 8935."""
import concurrent.futures, io, json, time, unittest, urllib.error, urllib.request, uuid
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
URL='http://127.0.0.1:8935';ORIGIN='http://127.0.0.1:5173'

def request(path, data=None, method=None, headers=None):
    common={'Origin':ORIGIN,**(headers or {})}
    req=urllib.request.Request(URL+path,data=data,method=method,headers=common)
    try:
        with urllib.request.urlopen(req,timeout=65) as response:return response.status,dict(response.headers),response.read()
    except urllib.error.HTTPError as error:return error.code,dict(error.headers),error.read()

def submit(data,job_id=None):return request('/mask',data,'POST',{'Content-Type':'image/png','X-DnA-Job':job_id or str(uuid.uuid4())})

class ProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=(ROOT/'docs/studio-validation/followup/fixtures/portrait.png').read_bytes()
        for _ in range(100):
            if json.loads(request('/health')[2]).get('ready'):break
            time.sleep(.1)
        else:raise RuntimeError('Helper not ready')
    def test_health_origin_and_host(self):
        self.assertEqual(request('/health')[0],200)
        self.assertEqual(request('/health',headers={'Origin':'https://untrusted.example'})[0],403)
        self.assertEqual(request('/health',headers={'Host':'evil.example:8935'})[0],403)
    def test_malformed_and_dimensions(self):
        self.assertEqual(submit(b'not an image')[0],400)
        buf=io.BytesIO();Image.new('RGB',(3000,3)).save(buf,'PNG');self.assertEqual(submit(buf.getvalue())[0],400)
        self.assertEqual(request('/mask',b'bad','POST',{'Content-Type':'application/pdf','X-DnA-Job':str(uuid.uuid4())})[0],415)
    def test_real_mask_and_warm_reuse(self):
        results=[]
        for _ in range(3):
            status,headers,body=submit(self.data);self.assertEqual(status,200)
            with Image.open(io.BytesIO(body)) as mask:self.assertEqual(mask.size,(512,512));self.assertEqual(mask.mode,'L');self.assertEqual(mask.getextrema(),(0,255))
            results.append({'serverTiming':headers.get('Server-Timing'),'peakSampledChildRssBytes':headers.get('X-DnA-Peak-RSS')})
        (ROOT/'docs/studio-validation/followup/helper-runs.json').write_text(json.dumps(results,indent=2))
    def test_queue_and_cancellation(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            a,b=str(uuid.uuid4()),str(uuid.uuid4());one=pool.submit(submit,self.data,a);time.sleep(.15);two=pool.submit(submit,self.data,b);time.sleep(.15)
            self.assertEqual(submit(self.data)[0],429)
            self.assertEqual(request('/jobs/'+a,method='DELETE')[0],200)
            self.assertEqual(one.result()[0],408)
            self.assertEqual(two.result()[0],200)
if __name__=='__main__':unittest.main()
