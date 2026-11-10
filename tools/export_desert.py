"""
Convierte los assets del pack desértico a GLB ligeros para Rift Shooter.
Uso:  python3 -I tools/export_desert.py -- <carpeta_entrada> <carpeta_salida>
Requiere: pip install bpy   (no llames "inspect.py" a ningún script: tapa el módulo estándar)

Para cada modelo: aplica transformaciones, une en una malla, decima si hace falta, recentra
(planta centrada, base en z=0), escala a un tamaño en metros y exporta SIN imágenes:
las texturas se asignan en el juego (así se comparten y se controla el repeat).
"""
import bpy, sys, os, math
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:]
IN, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)

# archivo -> (salida, tamaño objetivo, eje que se ajusta: 'h' altura | 'l' lado mayor, caras máx., rotZ extra en grados)
JOBS = [
    ('cliff_rock_two_obj_1677375859/Cliff_Rock_Two_OBJ.obj', 'cliff.glb', 14.0, 'h', 6000, 0),
    ('rock_03_1676501010/lp_rock03.obj', 'rock.glb', 1.6, 'h', 4000, 0),
    ('bodes_stone/OBJ/bodes_stone_col_1_OBJ.obj', 'stones.glb', 3.2, 'l', 6000, 0),
    ('amforma/amforma 442.stl', 'amphora.glb', 1.05, 'h', 3000, 0),
    ('smallarch_blend_1667995114/SmallArch_Blend.blend', 'arch.glb', 4.0, 'l', 5000, 0),
    ('r2_blender_1645635704/ReichsRevolverM1879_03.blend', 'revolver.glb', 0.34, 'l', 12000, 0),
]


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    p = os.path.join(IN, path)
    if p.endswith('.blend'):
        bpy.ops.wm.open_mainfile(filepath=p)
    elif p.endswith('.obj'):
        clear(); bpy.ops.wm.obj_import(filepath=p)
    elif p.endswith('.stl'):
        clear(); bpy.ops.wm.stl_import(filepath=p)
    return [o for o in bpy.data.objects if o.type == 'MESH']


def bake(objs):
    """Copia con modificadores y transformaciones aplicadas, todo en una sola malla."""
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in objs:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        me.transform(o.matrix_world)
        n = bpy.data.objects.new(o.name + '_x', me)
        bpy.context.scene.collection.objects.link(n)
        out.append(n)
    for o in objs:
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in out:
        o.select_set(True)
    bpy.context.view_layer.objects.active = out[0]
    if len(out) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def bbox(o):
    vs = [v.co for v in o.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx


ONLY = os.environ.get('ONLY')
for src, name, size, mode, max_faces, rotz in JOBS:
    if ONLY and name not in ONLY.split(','):
        continue
    objs = load(src)
    o = bake(objs)
    faces = len(o.data.polygons)
    # STL/OBJ "sopa de triángulos": fusionar vértices duplicados o el decimado no puede colapsar aristas
    import bmesh
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4 * max(o.dimensions))
    bm.to_mesh(o.data); bm.free()
    if faces > max_faces:
        mod = o.modifiers.new('dec', 'DECIMATE')
        mod.ratio = max_faces / faces
        bpy.ops.object.modifier_apply(modifier='dec')
    mn, mx = bbox(o)
    d = mx - mn
    ref = d.z if mode == 'h' else max(d.x, d.y, d.z)
    s = size / ref
    center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    M = Matrix.Rotation(math.radians(rotz), 4, 'Z') @ Matrix.Scale(s, 4) @ Matrix.Translation(-center)
    o.data.transform(M)
    o.data.update()
    for p in o.data.polygons:
        p.use_smooth = True
    o.name = name.replace('.glb', '')
    o.data.name = o.name
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    path = os.path.join(OUT, name)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='NONE', export_animations=False,
                              export_cameras=False, export_lights=False)
    mn, mx = bbox(o)
    print(f'EXPORTED {name}: {os.path.getsize(path)//1024} KB, caras {faces}->{len(o.data.polygons)}, '
          f'medidas (x,y,z) {tuple(round(v,2) for v in (mx-mn))} uv={len(o.data.uv_layers)}')
