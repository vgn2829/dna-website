"""Exercise the actual ONNX rewrite against ORT on positive/negative axes and 1024 inputs."""
import importlib.util, pathlib, unittest
import numpy as np
import onnx
from onnx import helper, TensorProto
import onnxruntime as ort
spec=importlib.util.spec_from_file_location('prepare',pathlib.Path(__file__).with_name('prepare-birefnet-browser.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ConcatTests(unittest.TestCase):
    def test_exact_outputs(self):
        rng=np.random.default_rng(2315)
        for count,axis in [(8,0),(17,1),(50,-1),(1024,0)]:
            names=[f'x{i}'for i in range(count)];shape=[2,3];outshape=shape.copy();outshape[axis]+=shape[axis]*(count-1)
            graph=helper.make_graph([helper.make_node('Concat',names,['out'],axis=axis,name='original')],'test',[helper.make_tensor_value_info(n,TensorProto.FLOAT,shape)for n in names],[helper.make_tensor_value_info('out',TensorProto.FLOAT,outshape)])
            model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',17)],ir_version=10)
            original=model.SerializeToString();module.bound_concats(model);onnx.checker.check_model(model)
            self.assertTrue(all(len(n.input)<=7 for n in model.graph.node if n.op_type=='Concat'))
            inputs={n:rng.normal(size=shape).astype('float32')for n in names};a=ort.InferenceSession(original,providers=['CPUExecutionProvider']).run(None,inputs)[0];b=ort.InferenceSession(model.SerializeToString(),providers=['CPUExecutionProvider']).run(None,inputs)[0]
            np.testing.assert_array_equal(a,b)
if __name__=='__main__':unittest.main()
