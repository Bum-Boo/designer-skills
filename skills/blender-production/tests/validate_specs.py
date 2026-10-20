"""Run with Blender --background --python-exit-code 1 --python this_file."""
import copy
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from product_scene import validate
base=json.loads((Path(__file__).resolve().parents[1]/'assets/example-product.json').read_text())
validate(base)
checks=0
for key,value in [('width_m',0),('height_m',float('nan')),('depth_m',-.1),('corner_radius_m',.2),('resolution',[0,1024]),('samples',0),('label','한글'),('label','A\nB'),('screen_top',[float('nan'),0,0,1]),('width_m',10),('depth_m',1),('resolution',None),('body_color',3)]:
 spec=copy.deepcopy(base);spec[key]=value
 try:validate(spec)
 except ValueError:checks+=1
 else:raise AssertionError('Invalid specification accepted: '+key)
for bad in [None,[],{**base,'unknown':1},{k:v for k,v in base.items() if k!='width_m'}]:
 try:validate(bad)
 except ValueError:checks+=1
 else:raise AssertionError('Invalid schema accepted')
print('VALIDATION_CASES',checks,'passed')
