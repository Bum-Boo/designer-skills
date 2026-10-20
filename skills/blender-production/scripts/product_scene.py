"""Blender background script: editable synthetic product scene, not image-to-3D inference."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--spec', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--render', action='store_true')
    p.add_argument('--device', choices=['CPU', 'CUDA', 'OPTIX'], default='CPU')
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])


def validate(spec):
    required = {'name','width_m','height_m','depth_m','corner_radius_m','body_color','screen_bottom','screen_top','resolution','samples','camera_mm','label','sublabel'}
    if not isinstance(spec,dict) or set(spec)!=required:
        raise ValueError('Spec must be an object with exactly the example-product.json fields')
    for key in ['width_m', 'height_m', 'depth_m', 'corner_radius_m']:
        value = spec[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(key + ' must be a finite positive number')
    if spec['width_m'] < .04 or spec['height_m'] < .06 or spec['depth_m'] < .002:
        raise ValueError('Template requires width>=.04m, height>=.06m, depth>=.002m')
    if not .06 <= spec['height_m'] <= 1 or not .3 <= spec['width_m']/spec['height_m'] <= 1.2 or not .01 <= spec['depth_m']/spec['height_m'] <= .25:
        raise ValueError('Portrait-device template: height .06..1m, width/height .3..1.2, depth/height .01...25')
    if spec['corner_radius_m'] >= min(spec['width_m'], spec['height_m']) / 2:
        raise ValueError('Corner radius too large')
    res = spec['resolution']
    if not isinstance(res,(list,tuple)) or len(res) != 2 or any(isinstance(x, bool) or not isinstance(x, int) or not 64 <= x <= 4096 for x in res):
        raise ValueError('Resolution needs two integer values in 64..4096')
    samples = spec['samples']
    if isinstance(samples, bool) or not isinstance(samples, int) or not 1 <= samples <= 512:
        raise ValueError('Samples must be in 1..512')
    for key in ['body_color', 'screen_bottom', 'screen_top']:
        color = spec[key]
        if not isinstance(color,(list,tuple)) or len(color) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in color):
            raise ValueError(key + ' must contain four finite values in 0..1')
    if not isinstance(spec['camera_mm'], (int, float)) or not 20 <= spec['camera_mm'] <= 150:
        raise ValueError('camera_mm must be in 20..150')
    for key in ['name', 'label', 'sublabel']:
        if not isinstance(spec[key], str) or not spec[key].strip() or len(spec[key]) > 50:
            raise ValueError(key + ' must be 1..50 characters')
        if key in ('label','sublabel') and (not spec[key].isascii() or not spec[key].isprintable()):
            raise ValueError('Template labels require printable ASCII; adapt the font for other scripts')


def material(name, color, metallic=0, roughness=.35):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = color
    node.inputs['Metallic'].default_value = metallic
    node.inputs['Roughness'].default_value = roughness
    return mat


def rounded_panel(name, width, depth, height, radius, location, mat, collection):
    points = []
    for cx, cz, start in [(width/2-radius,height/2-radius,0),(-width/2+radius,height/2-radius,90),(-width/2+radius,-height/2+radius,180),(width/2-radius,-height/2+radius,270)]:
        for step in range(13):
            angle = math.radians(start + step * 90 / 12)
            points.append((cx + radius*math.cos(angle), cz + radius*math.sin(angle)))
    n = len(points)
    verts = [(x,y,z) for y in (-depth/2,depth/2) for x,z in points]
    faces = [tuple(range(n)),tuple(reversed(range(n,2*n)))]
    faces += [(i,n+i,n+(i+1)%n,(i+1)%n) for i in range(n)]
    mesh = bpy.data.meshes.new(name + '_Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    bevel = obj.modifiers.new('EdgeHighlights', 'BEVEL')
    bevel.width = min(depth*.16, .0005)
    bevel.segments = 3
    bevel.limit_method = 'ANGLE'
    obj['role'] = name
    return obj


def text_object(name, value, size, position, mat, collection, max_width):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = value
    curve.size = size
    curve.extrude = .000008
    curve.space_character = 1.1
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (math.pi/2,0,0)
    obj.data.materials.append(mat)
    bpy.context.view_layer.update()
    if obj.dimensions.x > max_width:
        curve.size *= max_width / obj.dimensions.x
        bpy.context.view_layer.update()
    return obj


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def light(name, location, target, energy, size, color, collection):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.color = energy, 'DISK', size, color
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    aim(obj,target)
    return obj


def configure_device(scene, requested):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    if requested == 'CPU':
        return 'CPU'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = requested
    prefs.get_devices()
    devices = [d for d in prefs.devices if d.type == requested]
    if not devices:
        raise RuntimeError('Requested GPU backend unavailable: ' + requested)
    for d in prefs.devices:
        d.use = d.type == requested
    scene.cycles.device = 'GPU'
    return requested


def main():
    args = arguments()
    spec = json.loads(args.spec.read_text(encoding='utf-8'))
    validate(spec)
    out = args.out.resolve()
    if out.exists() and any(out.iterdir()):
        raise FileExistsError('Choose a new empty output directory: ' + str(out))
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    product = bpy.data.collections.new('PRODUCT_EditTheseParts')
    studio = bpy.data.collections.new('STUDIO_CameraAndLights')
    scene.collection.children.link(product)
    scene.collection.children.link(studio)
    w,h,d,r = (spec[k] for k in ['width_m','height_m','depth_m','corner_radius_m'])
    scale = h/.238
    z = h/2 + .001*scale
    metal = material('Anodized_Teal',spec['body_color'],.82,.28)
    glass = material('Display_Glass',[.004,.008,.012,1],.15,.14)
    screen = material('Display_Gradient',spec['screen_bottom'],.1,.24)
    nodes,links = screen.node_tree.nodes,screen.node_tree.links
    coords = nodes.new('ShaderNodeTexCoord')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = spec['screen_bottom']
    ramp.color_ramp.elements[1].color = spec['screen_top']
    links.new(coords.outputs['Generated'],separate.inputs[0])
    links.new(separate.outputs['Z'],ramp.inputs[0])
    bsdf = nodes.get('Principled BSDF')
    links.new(ramp.outputs['Color'],bsdf.inputs['Base Color'])
    links.new(ramp.outputs['Color'],bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = .22
    white = material('Display_Ink',[.68,.93,.86,1],.05,.4)
    black = material('Controls_Dark',[.008,.012,.014,1],.2,.27)
    rounded_panel('Body',w,d,h,r,(0,0,z),metal,product)
    rounded_panel('Glass',w*.94,.0007*scale,h*.96,r*.85,(0,-d/2-.0002*scale,z),glass,product)
    front = -d/2-.00075*scale
    rounded_panel('Screen',w*.88,.0003*scale,h*.90,r*.68,(0,front,z),screen,product)
    for index,(ratio,width) in enumerate([(.21,.66),(.09,.52),(-.03,.36)]):
        rounded_panel('DisplayLine_'+str(index),w*width,.0001*scale,h*.009,h*.004,(0,front-.0003*scale,z+h*ratio),white,product)
    text_object('Label',spec['label'],.012*scale,(-w*.34,front-.0004*scale,z-h*.26),white,product,w*.68)
    text_object('SubLabel',spec['sublabel'],.0035*scale,(-w*.33,front-.0004*scale,z-h*.32),white,product,w*.66)
    rounded_panel('PowerButton',.002*scale,d*.72,.020*scale,.0008*scale,(w/2+.0004*scale,0,z+h*.26),metal,product)
    rounded_panel('SideAccent',.002*scale,d*.65,.010*scale,.0007*scale,(w/2+.0005*scale,0,z+h*.10),black,product)
    rounded_panel('FrontSensor',.012*scale,.0001*scale,.002*scale,.0008*scale,(0,front-.0005*scale,z+h*.46),black,product)
    floor_mat = material('Studio_Warm',[.20,.24,.235,1],0,.72)
    bpy.ops.mesh.primitive_plane_add(size=200*scale,location=(0,0,0))
    floor = bpy.context.object
    floor.name = 'StudioFloor'
    for coll in list(floor.users_collection):coll.objects.unlink(floor)
    studio.objects.link(floor)
    floor.data.materials.append(floor_mat)
    target = (0,0,h*.47)
    light('Key',(-.30*scale,-.30*scale,.48*scale),target,32*scale**2,.34*scale,(.79,.90,1),studio)
    light('Fill',(.28*scale,-.12*scale,.25*scale),target,9*scale**2,.25*scale,(.85,1,.94),studio)
    light('Rim',(.10*scale,.22*scale,.40*scale),target,42*scale**2,.22*scale,(1,.79,.57),studio)
    camera_data = bpy.data.cameras.new('ProductCamera')
    camera = bpy.data.objects.new('ProductCamera',camera_data)
    studio.objects.link(camera)
    camera.location = (.32*scale,-.50*scale,.31*scale)
    aim(camera,target)
    camera_data.lens = spec['camera_mm']
    camera_data.clip_start, camera_data.clip_end = .001*scale, 100*scale
    scene.camera = camera
    scene.world = bpy.data.worlds.new('StudioWorld')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.10,.14,.17,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .25
    scene.unit_settings.system = 'METRIC'
    scene.render.resolution_x,scene.render.resolution_y = spec['resolution']
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    # Blender otherwise embeds the absolute .blend path and timestamps in PNGs,
    # even when the visible stamp overlay is disabled. Keep shared exports clean.
    for prop in scene.render.bl_rna.properties:
        if prop.identifier.startswith('use_stamp'):
            setattr(scene.render, prop.identifier, False)
    scene.render.film_transparent = False
    scene.render.threads_mode,scene.render.threads = 'FIXED',4
    device = configure_device(scene,args.device)
    scene.cycles.samples = spec['samples']
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = '//product.png'
    scene['production_spec_json'] = json.dumps(spec,ensure_ascii=False)
    scene['production_kind'] = 'synthetic-rounded-device-example'
    scene['production_builder_version'] = 1
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'product.blend'))
    receipt = {'blender_version':bpy.app.version_string,'device':device,'spec':spec,
               'blend':'product.blend','render':'product.png' if args.render else None,
               'editable_parts':[o.name for o in product.objects],
               'note':'Synthetic template, no reference image reconstruction performed'}
    if args.render:
        bpy.ops.render.render(write_still=True)
        png = out/'product.png'
        if not png.is_file() or png.stat().st_size < 1000:
            raise RuntimeError('Render output missing/too small')
        image = bpy.data.images.load(str(png),check_existing=False)
        actual_size = list(image.size)
        bpy.data.images.remove(image)
        if actual_size != spec['resolution']:
            raise RuntimeError('Render dimensions differ from specification')
        receipt['render_size'] = actual_size
    (out/'build.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print('PRODUCT_BUILD',json.dumps(receipt,ensure_ascii=False))


if __name__ == '__main__':
    main()
