"""Fetch only the exact selected, MIT-licensed FP32 export; never a changing default."""
import argparse,hashlib,pathlib,urllib.request
REVISION='962e67969ec6acec9c19fab76acee4f5e22e990c'
URL=f'https://huggingface.co/studioludens/birefnet-lite-512/resolve/{REVISION}/onnx/model.onnx'
SHA='1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2'
SIZE=191877254
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);args=p.parse_args()
 if args.output.exists() and hashlib.sha256(args.output.read_bytes()).hexdigest()==SHA:print(args.output);raise SystemExit(0)
 args.output.parent.mkdir(parents=True,exist_ok=True);temporary=args.output.with_suffix('.partial');digest=hashlib.sha256();received=0
 try:
  with urllib.request.urlopen(URL,timeout=30) as source,temporary.open('wb') as target:
   while chunk:=source.read(1024*1024):
    received+=len(chunk)
    if received>SIZE:raise RuntimeError('Download exceeds pinned artifact size')
    digest.update(chunk);target.write(chunk)
  if received!=SIZE or digest.hexdigest()!=SHA:raise RuntimeError('Model download failed integrity check')
  temporary.replace(args.output);print(args.output)
 finally:temporary.unlink(missing_ok=True)
