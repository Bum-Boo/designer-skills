"""Read and validate the currently opened .blend; optionally render a fresh check image."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--render-check', action='store_true')
    parser.add_argument('--device',choices=['CPU','CUDA','OPTIX'],default='CPU')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    out = args.out.resolve()
    if out.exists() and any(out.iterdir()):
        raise FileExistsError('Use a new empty inspection directory')
    out.mkdir(parents=True,exist_ok=True)
    scene = bpy.context.scene
    failures = []
    if not bpy.data.filepath or not Path(bpy.data.filepath).is_file():
        failures.append('No saved .blend is open')
    if not scene.camera:
        failures.append('Active camera missing')
    meshes = [o for o in scene.objects if o.type=='MESH' and not o.hide_render]
    lights = [o for o in scene.objects if o.type=='LIGHT' and not o.hide_render]
    if not meshes:failures.append('No renderable meshes')
    if not lights:failures.append('No scene lights; inspect world lighting manually')
    missing = []
    for image in bpy.data.images:
        if image.source=='FILE' and not image.packed_file:
            if not Path(bpy.path.abspath(image.filepath)).is_file():missing.append(image.name)
    if missing:failures.append('Missing images: '+','.join(missing))
    template = scene.get('production_spec_json')
    info = {}
    if template:
        spec = json.loads(template)
        body = scene.objects.get('Body')
        if not body:failures.append('Template Body mesh missing')
        else:
            expected = (spec['width_m'],spec['depth_m'],spec['height_m'])
            actual = tuple(body.dimensions)
            if any(not math.isclose(a,b,abs_tol=.00002) for a,b in zip(actual,expected)):
                failures.append('Body dimensions differ from stored specification')
            info['body_dimensions_m'] = actual
        required = ['Body','Glass','Screen','PowerButton','Label']
        if any(not scene.objects.get(name) for name in required):failures.append('Editable template parts missing')
        if scene.camera:
            product = bpy.data.collections.get('PRODUCT_EditTheseParts')
            coords = [world_to_camera_view(scene,scene.camera,o.matrix_world@Vector(c))
                      for o in product.objects if o.type in ('MESH','FONT') for c in o.bound_box] if product else []
            if not coords or any(p.z<=0 or not .01<p.x<.99 or not .01<p.y<.99 for p in coords):
                failures.append('Product mesh outside camera margin or behind camera')
            info['camera_product_bounds'] = {'x':[min(p.x for p in coords),max(p.x for p in coords)],
                                          'y':[min(p.y for p in coords),max(p.y for p in coords)]} if coords else None
        screen = scene.objects.get('Screen')
        if screen:
            screen_points = [screen.matrix_world@Vector(c) for c in screen.bound_box]
            for name in ('Label','SubLabel'):
                obj = scene.objects.get(name)
                if not obj:
                    failures.append('Template text missing: '+name)
                    continue
                points = [obj.matrix_world@Vector(c) for c in obj.bound_box]
                for axis in (0,2):
                    if min(p[axis] for p in points)<min(p[axis] for p in screen_points)-.00001 or max(p[axis] for p in points)>max(p[axis] for p in screen_points)+.00001:
                        failures.append('Text outside screen: '+name)
        if [scene.render.resolution_x,scene.render.resolution_y]!=spec['resolution']:
            failures.append('Output resolution differs from stored specification')
    result = {'blender_version':bpy.app.version_string,'blend':bpy.data.filepath,
              'mesh_count':len(meshes),'light_count':len(lights),
              'external_images_missing':missing,'template':bool(template),'render_engine':scene.render.engine,
              'dependency_check_scope':'FILE images only; inspect libraries/caches/sequences separately',
              'structural_failures':failures,**info,'fresh_render':False,
              'visual_review':'requires actual image inspection'}
    if args.render_check and not failures:
        if scene.render.engine=='CYCLES':
            sys.path.insert(0,str(Path(__file__).resolve().parent))
            from product_scene import configure_device
            result['device']=configure_device(scene,args.device)
        else:
            result['device']='engine-managed; requested Cycles backend not applied'
        scene.render.filepath = str(out/'reopened.png')
        bpy.ops.render.render(write_still=True)
        image_path = out/'reopened.png'
        if not image_path.is_file() or image_path.stat().st_size<1000:
            failures.append('Fresh render missing/too small')
        else:
            image = bpy.data.images.load(str(image_path),check_existing=False)
            result['render_size'] = list(image.size)
            result['fresh_render'] = True
            bpy.data.images.remove(image)
    result['passed'] = not failures
    (out/'inspection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print('PRODUCT_INSPECTION',json.dumps(result,ensure_ascii=False))
    if failures:raise RuntimeError('; '.join(failures))


if __name__=='__main__':
    main()
