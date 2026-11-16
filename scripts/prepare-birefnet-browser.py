"""Lossless Concat partitioning for the pinned MIT BiRefNet Lite ONNX export.
No weights, precision, dimensions or arithmetic change. Rewritten Concat nodes bind <=8 buffers.
Preparation dependency: onnx 1.20.1 (Apache-2.0); retain upstream model MIT notice.
"""
import argparse, hashlib, json, pathlib
import onnx
from onnx import helper
SOURCE_SHA='5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333'
MAX_INPUTS=7

def bound_concats(model):
    nodes=[]; rewritten=[]
    for index,node in enumerate(model.graph.node):
        if node.op_type!='Concat' or len(node.input)<=MAX_INPUTS:
            nodes.append(node);continue
        axis=next(a.i for a in node.attribute if a.name=='axis');current=list(node.input);level=0
        rewritten.append({'node':node.name,'inputCount':len(current),'axis':axis})
        while len(current)>MAX_INPUTS:
            outputs=[]
            for start in range(0,len(current),MAX_INPUTS):
                group=current[start:start+MAX_INPUTS]
                if len(group)==1:outputs.append(group[0]);continue
                name=f'dna_bounded_concat_{index}_{level}_{start}'
                nodes.append(helper.make_node('Concat',group,[name],axis=axis,name=name));outputs.append(name)
            current=outputs;level+=1
        final=onnx.NodeProto();final.CopyFrom(node);del final.input[:];final.input.extend(current);nodes.append(final)
    del model.graph.node[:];model.graph.node.extend(nodes)
    return rewritten

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    source=pathlib.Path(args.source);target=pathlib.Path(args.output)
    if hashlib.sha256(source.read_bytes()).hexdigest()!=SOURCE_SHA:raise ValueError('Wrong source checkpoint')
    model=onnx.load(source);before=[v.SerializeToString() for v in model.graph.initializer];changes=bound_concats(model)
    assert before==[v.SerializeToString() for v in model.graph.initializer]
    onnx.checker.check_model(model);target.parent.mkdir(parents=True,exist_ok=True);onnx.save(model,target)
    meta={'source':'onnx-community/BiRefNet_lite-ONNX','revision':'de15b22ba131738a16dff04aab8bdf8dc32e3ac1','sourceSha256':SOURCE_SHA,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'maxConcatInputs':MAX_INPUTS,'rewritten':changes,'weightsByteIdentical':True,'inputUnchanged':[1,3,1024,1024],'output':'float32 logits; sigmoid required','onnxVersion':onnx.__version__}
    target.with_suffix('.json').write_text(json.dumps(meta,indent=2));print(json.dumps(meta,indent=2))
if __name__=='__main__':main()
