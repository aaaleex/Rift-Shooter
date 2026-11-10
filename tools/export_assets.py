"""
Convierte los assets de Blender a GLB listos para web (Rift Shooter).
Uso:  python3 -I tools/export_assets.py -- <out_dir>
Requiere: pip install bpy  (no llamar a ningún script de esta carpeta "inspect.py": tapa el módulo estándar)
"""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

OUT = sys.argv[-1]
os.makedirs(OUT, exist_ok=True)
ROBOT_BLEND = 'assets_in/robot/Bot Enemies Itch.blend'
RIFLES_BLEND = 'assets_in/rifles.blend'
M16_GLB = 'assets_in/m16/Rifle_M16_3D/gLTF/Rifle_M16.glb'


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def world_bbox(objs):
    # Se calcula desde los vértices reales (bound_box puede estar desactualizado tras data.transform)
    pts = [o.matrix_world @ v.co for o in objs if o.type == 'MESH' for v in o.data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def make_real(objs):
    """Copia los objetos, aplica modificadores y transformaciones; devuelve las copias."""
    out = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev)
        me.transform(o.matrix_world)
        n = bpy.data.objects.new(o.name + '_x', me)
        bpy.context.scene.collection.objects.link(n)
        out.append(n)
    return out


def join(objs, name):
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    select_only(objs)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def export(objs, path, **kw):
    select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
        export_animations=False, export_cameras=False, export_lights=False, **kw)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


# --------------------------------------------------------------------------------- ROBOTS
ROBOTS = {
    # colección en el .blend  -> (archivo, altura objetivo en metros)
    'Missiles Robot': ('robot_trooper.glb', 2.0),
    'Big Robot': ('robot_titan.glb', 3.1),
    'Dog Bot': ('robot_hound.glb', 1.15),
    'Flying Bot': ('robot_wasp.glb', 1.3),
}
EYE_WORDS = ('Lens', 'Eyes')


def is_pedestal(o):
    d = o.dimensions
    return o.name.startswith('Floor') or (d.x > 2.4 and d.y > 2.4 and d.z < 0.5)


def export_robots():
    bpy.ops.wm.open_mainfile(filepath=ROBOT_BLEND)
    for coll_name, (fname, height) in ROBOTS.items():
        coll = bpy.data.collections[coll_name]
        src = [o for o in coll.objects if o.type == 'MESH' and not is_pedestal(o)]
        real = make_real(src)
        eyes = [o for o, s in zip(real, src) if any(w in s.name for w in EYE_WORDS)]
        body = [o for o in real if o not in eyes]

        # Centrar en planta, pies a z=0, escalar a la altura objetivo, girar para mirar a -Y (=> +Z en three)
        mn, mx = world_bbox(real)
        center = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
        s = height / (mx.z - mn.z)
        # Los robots miran a +X en el .blend; -90º en Z => miran a -Y, que el exportador (Y-up) convierte en +Z
        M = Matrix.Rotation(math.radians(-90), 4, 'Z') @ Matrix.Scale(s, 4) @ Matrix.Translation(-center)
        for o in real:
            o.data.transform(M)
            o.data.update()

        parts = [join(body, 'Body')]
        if eyes:
            parts.append(join(eyes, 'Eye'))
        # Sin imágenes embebidas: el atlas se carga una sola vez en el juego y se comparte entre robots
        export(parts, os.path.join(OUT, fname), export_image_format='NONE', export_materials='EXPORT')
        for o in parts:
            bpy.data.objects.remove(o)

    # Atlas compartido
    img = bpy.data.images['deHaht.png']
    print('ATLAS', img.filepath)


# --------------------------------------------------------------------------------- M16
def export_m16():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=M16_GLB)
    gun = bpy.data.objects['M16.003']
    for o in list(bpy.data.objects):
        if o != gun:
            bpy.data.objects.remove(o)
    gun.data.transform(gun.matrix_world)
    gun.matrix_world = Matrix.Identity(4)
    mn, mx = world_bbox([gun])
    center = (mn + mx) / 2
    # El cañón va a lo largo de X; lo alineamos con -Y (=> -Z en three, hacia delante de la cámara).
    M = Matrix.Rotation(math.radians(90), 4, 'Z') @ Matrix.Translation(-center)
    gun.data.transform(M)
    gun.name = 'M16'
    export([gun], os.path.join(OUT, 'm16.glb'))


# --------------------------------------------------------------------------------- RIFLES PACK
def bake_face_colors(o):
    """Materiales de color plano -> atributo de color por esquina (1 material, 1 draw call)."""
    me = o.data
    cols = []
    for m in me.materials:
        c = m.diffuse_color if m else (0.5, 0.5, 0.5, 1)
        cols.append((c[0], c[1], c[2], 1.0))
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly in me.polygons:
        c = cols[poly.material_index] if cols else (0.5, 0.5, 0.5, 1)
        for li in poly.loop_indices:
            attr.data[li].color = c
    me.color_attributes.active_color = attr
    me.materials.clear()
    mat = bpy.data.materials.get('RifleVC') or bpy.data.materials.new('RifleVC')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    if not any(n.type == 'VERTEX_COLOR' for n in nt.nodes):
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = 0.4
    bsdf.inputs['Roughness'].default_value = 0.5
    me.materials.append(mat)


def export_rifles(which):
    bpy.ops.wm.open_mainfile(filepath=RIFLES_BLEND)
    for src_name, fname in which.items():
        o = bpy.data.objects[src_name]
        r = make_real([o])[0]
        uniq = {tuple(round(c, 2) for c in m.diffuse_color[:3]) for m in r.data.materials if m}
        if len(uniq) > 1:
            bake_face_colors(r)          # hay colores reales: se hornean a vértices
        else:
            r.data.materials.clear()     # pack sin color (referencia de escala): el juego le pone material propio
        mn, mx = world_bbox([r])
        center = (mn + mx) / 2
        length = mx.x - mn.x
        # Rifles a lo largo de X (cañón hacia -X en este pack). Escalamos a ~0.95 m y alineamos con -Y.
        s = 0.95 / length
        M = Matrix.Rotation(math.radians(-90), 4, 'Z') @ Matrix.Scale(s, 4) @ Matrix.Translation(-center)
        r.data.transform(M)
        r.name = fname.replace('.glb', '')
        export([r], os.path.join(OUT, fname), export_vertex_color='ACTIVE' if r.data.color_attributes else 'NONE')
        bpy.data.objects.remove(r)


if __name__ == '__main__':
    mode = os.environ.get('EXPORT', 'all')
    if mode in ('all', 'robots'):
        export_robots()
    if mode in ('all', 'm16'):
        export_m16()
    if mode in ('all', 'rifles_preview'):
        names = [o.name for o in bpy.data.objects] if False else None
        bpy.ops.wm.open_mainfile(filepath=RIFLES_BLEND)
        meshes = [o.name for o in bpy.data.objects if o.type == 'MESH' and o.name != 'Plane']
        export_rifles({n: f'pack_{n.replace(".", "_")}.glb' for n in meshes})
    if mode == 'rifles_final':
        export_rifles({os.environ['RIFLE_SRC']: 'rifle_heavy.glb'})
