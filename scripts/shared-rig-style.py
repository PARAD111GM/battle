"""Character mesh variants for the shared Quaternius skeleton.

Changes mesh shape, materials and bone-weighted accessories only. Bone rest
transforms and the shared animation Action are deliberately left untouched.
"""
import math
import re
import bpy
import bmesh
from mathutils import Vector


def material(name, color, roughness=.72, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Roughness'].default_value = roughness
    node.inputs['Metallic'].default_value = metallic
    mat.diffuse_color = (*color, 1)
    return mat


def bind_mesh(name, vertices, faces, rig, mat, weights=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = rig
    if weights is None:
        group = obj.vertex_groups.new(name='Head')
        group.add(list(range(len(vertices))), 1, 'REPLACE')
    else:
        for index, groups in enumerate(weights):
            for bone, weight in groups.items():
                group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
                group.add([index], weight, 'REPLACE')
    mod = obj.modifiers.new('Shared skeleton', 'ARMATURE')
    mod.object = rig
    for poly in data.polygons:
        poly.use_smooth = True
    return obj


def weld_and_smooth(obj):
    # glTF duplicates vertices at normals/material seams. Weld only coincident
    # vertices; existing deform weights remain on the resulting topology.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    if obj.data.has_custom_normals:
        obj.data.normals_split_custom_set([(0, 0, 0)] * len(obj.data.loops))
    for poly in obj.data.polygons:
        poly.use_smooth = True
    obj.data.update()


def base_name(name):
    return re.sub(r'\.\d+$', '', name)


def enlarged_head(point, factor):
    pivot = Vector((0, -.0430836, 1.5872614))
    # Neck seam stays in its original position. The face/hair gain the compact,
    # expressive proportions of the art direction without changing the rig.
    blend = max(0, min(1, (point.z - 1.52) / .10))
    return pivot + (point - pivot) * (1 + (factor - 1) * blend)


def eye(name, center, radii, rig, mat, head_factor):
    vertices = []
    faces = []
    rings, sides = 10, 20
    for row in range(rings + 1):
        a = math.pi * row / rings
        for side in range(sides):
            b = math.tau * side / sides
            p = Vector((center[0] + radii[0]*math.sin(a)*math.cos(b),
                        center[1] + radii[1]*math.sin(a)*math.sin(b),
                        center[2] + radii[2]*math.cos(a)))
            vertices.append(enlarged_head(p, head_factor))
    for row in range(rings):
        for side in range(sides):
            a = row*sides + side
            b = row*sides + (side+1)%sides
            faces.append((a,a+sides,b+sides,b))
    return bind_mesh(name, vertices, faces, rig, mat)


def midnight_hair(rig, mat, head_factor):
    """A continuous swept cap and shoulder-length back section, not tubes."""
    vertices, faces = [], []
    rows, sides = 12, 48
    for row in range(rows + 1):
        for side in range(sides):
            phi = math.tau * side / sides
            end = 1.75 - .45*max(0,-math.sin(phi)) + .35*max(0,math.sin(phi))
            theta = end * row / rows
            ridge = .0035*math.cos(phi*5+theta*2)*math.sin(theta)
            p = Vector(((.119+ridge)*math.sin(theta)*math.cos(phi)+.008*math.cos(theta),
                        -.012+(.131+ridge)*math.sin(theta)*math.sin(phi),
                        1.714+.153*math.cos(theta)))
            vertices.append(enlarged_head(p,head_factor))
    for row in range(rows):
        for side in range(sides):
            a=row*sides+side;b=row*sides+(side+1)%sides
            faces.append((a,a+sides,b+sides,b))
    cap=bind_mesh('Midnight_SweptHair',vertices,faces,rig,mat)
    vertices,faces=[],[]
    z_values=[1.77,1.70,1.63,1.56,1.50]
    x_radii=[.105,.123,.131,.128,.112]
    y_radii=[.09,.13,.140,.145,.14]
    sides=30
    for row,z in enumerate(z_values):
        for side in range(sides+1):
            phi=-.13+(math.pi+.26)*side/sides
            ridge=.003*math.cos(7*phi+row*.2)
            p=Vector(((x_radii[row]+ridge)*math.cos(phi),
                      -.008+(y_radii[row]+ridge)*math.sin(phi),
                      z+(.012*math.cos(phi*5) if row==4 else 0)))
            vertices.append(enlarged_head(p,head_factor))
    for row in range(4):
        for side in range(sides):
            a=row*(sides+1)+side
            faces.append((a,a+sides+1,a+sides+2,a+1))
    back=bind_mesh('Midnight_LongHair',vertices,faces,rig,mat)
    solid=back.modifiers.new('Hair volume','SOLIDIFY');solid.thickness=.009
    return [cap,back]


def bulk_body(obj, rig):
    names = {group.index: group.name for group in obj.vertex_groups}
    for vertex in obj.data.vertices:
        p = vertex.co.copy()
        delta = Vector((0,0,0))
        total = 0
        for group in vertex.groups:
            name = names.get(group.group, '')
            weight = group.weight
            total += weight
            change = Vector((0,0,0))
            if name in ('Torso','Chest','Abdomen','Shoulder.L','Shoulder.R'):
                chest = max(0,min(1,(p.z-1.02)/.30))
                change = Vector((p.x*(.12+.16*chest), (p.y+.055)*.20, 0))
            elif name.startswith(('UpperArm.','LowerArm.','UpperLeg.','LowerLeg.')):
                bone = rig.data.bones.get(name)
                if bone:
                    a, b = bone.head_local, bone.tail_local
                    axis = b-a
                    t = max(0,min(1,(p-a).dot(axis)/axis.length_squared))
                    center = a+axis*t
                    amount = .52 if name.startswith('UpperArm') else .28 if name.startswith('LowerArm') else .17 if name.startswith('UpperLeg') else .06
                    bulge = amount*(.4+.6*math.sin(math.pi*t))
                    perpendicular = p-center
                    perpendicular -= axis.normalized()*perpendicular.dot(axis.normalized())
                    change = perpendicular*bulge
            delta += change*weight
        if total:
            vertex.co = p+delta/total


def bandolier(rig, webbing, brass):
    centers = [Vector(v) for v in [(-.13,-.216,1.46),(-.07,-.229,1.35),(.035,-.218,1.23),(.15,-.190,1.10)]]
    vertices, faces, weights = [], [], []
    for c in centers:
        for side in (-1,1):
            vertices.append(c+Vector((.021*side,0,.014*side)))
            chest=max(0,min(1,(c.z-1.24)/.20))
            weights.append({'Chest':chest,'Torso':1-chest})
    for i in range(len(centers)-1):
        faces.append((i*2,i*2+2,i*2+3,i*2+1))
    strap=bind_mesh('Brick_Bandolier',vertices,faces,rig,webbing,weights)
    solid=strap.modifiers.new('Webbing thickness','SOLIDIFY');solid.thickness=.006
    extras=[strap]
    for i in range(5):
        t=(i+.5)/5
        segment=min(2,int(t*3));u=t*3-segment
        center=centers[segment].lerp(centers[segment+1],u)+Vector((0,-.011,0))
        verts=[];faces=[];w=[]
        for z,r in [(-.027,.008),(.018,.008),(.031,.001)]:
            for j in range(10):
                a=j*math.tau/10
                verts.append(center+Vector((r*math.cos(a),r*math.sin(a),z)))
                chest=max(0,min(1,(center.z-1.24)/.20));w.append({'Chest':chest,'Torso':1-chest})
        for row in range(2):
            for j in range(10): faces.append((row*10+j,row*10+(j+1)%10,(row+1)*10+(j+1)%10,(row+1)*10+j))
        faces.append(tuple(reversed(range(10))))
        extras.append(bind_mesh('Brick_Cartridge_'+str(i+1),verts,faces,rig,brass,w))
    return extras


def style_character(character_id, rig, meshes):
    is_midnight = character_id == 'midnight'
    prefix = 'Midnight' if is_midnight else 'Brick'
    head_factor = 1.23 if is_midnight else 1.21
    palette = {
        'skin':material(prefix+'_Skin',(.50,.29,.17) if is_midnight else (.57,.33,.17)),
        'skin_shadow':material(prefix+'_SkinShadow',(.32,.17,.095)),
        'hair':material(prefix+'_Hair',(.012,.014,.019) if is_midnight else (.058,.028,.012),.62),
        'eye':material(prefix+'_Pupil',(.012,.009,.007),.38),
        'white_eye':material(prefix+'_EyeWhite',(.42,.40,.35),.6),
        'cloth':material(prefix+'_Jacket',(.035,.042,.054) if is_midnight else (.022,.027,.023)),
        'shirt':material(prefix+'_Shirt',(.72,.70,.64) if is_midnight else (.025,.032,.026)),
        'tie':material(prefix+'_Tie',(.012,.015,.020)),
        'pants':material(prefix+'_Trousers',(.029,.034,.043) if is_midnight else (.13,.17,.075)),
        'boots':material(prefix+'_Shoes',(.014,.018,.024),.37),
        'webbing':material(prefix+'_Webbing',(.027,.025,.020)),
        'brass':material(prefix+'_Brass',(.42,.25,.065),.34,.65),
    }
    extras=[]
    for obj in meshes:
        original_materials=[base_name(m.name) if m else '' for m in obj.data.materials]
        is_head='Head' in obj.name
        is_body='Body' in obj.name
        is_legs='Legs' in obj.name
        is_feet='Feet' in obj.name
        for index, name in enumerate(original_materials):
            if name=='Skin': mat=palette['skin']
            elif name=='Skin_Darker': mat=palette['skin_shadow']
            elif name in ('Hair','Eyebrows'): mat=palette['hair']
            elif name=='Eye': mat=palette['eye']
            elif is_feet: mat=palette['boots']
            elif is_legs: mat=palette['pants'] if name not in ('Black','Grey','DarkGrey') else palette['webbing']
            elif name=='White': mat=palette['shirt']
            elif name=='Tie': mat=palette['tie']
            else: mat=palette['cloth']
            obj.data.materials[index]=mat
        if not is_midnight:
            if is_body:
                skin_slot = next((i for i,m in enumerate(obj.data.materials) if m==palette['skin']),None)
                if skin_slot is not None:
                    for poly in obj.data.polygons:
                        c=sum((obj.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
                        if abs(c.x)>.165 and c.z>1.34:
                            poly.material_index=skin_slot
                bulk_body(obj,rig)
            elif is_legs:
                bulk_body(obj,rig)
        if is_head:
            if is_midnight:
                beard=material('Midnight_Beard',(.014,.016,.020),.84)
                obj.data.materials.append(beard);beard_index=len(obj.data.materials)-1
                for poly in obj.data.polygons:
                    source=original_materials[poly.material_index]
                    c=sum((obj.data.vertices[i].co for i in poly.vertices),Vector())/len(poly.vertices)
                    if source in ('Skin','Skin_Darker') and 1.567<c.z<1.68 and c.y<-.065-.30*abs(c.x) and c.z<1.637+.43*abs(c.x):
                        poly.material_index=beard_index
                hair_slots={i for i,name in enumerate(original_materials) if name=='Hair'}
                bm=bmesh.new();bm.from_mesh(obj.data)
                bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.material_index in hair_slots],context='FACES')
                bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
                bm.to_mesh(obj.data);bm.free();obj.data.update()
            for v in obj.data.vertices:
                v.co=enlarged_head(v.co,head_factor)
        weld_and_smooth(obj)
        obj.name=prefix+'_'+('Head' if is_head else 'Body' if is_body else 'Legs' if is_legs else 'Feet')
    for side in (-1,1):
        # Keep the source's eyebrow shapes; inset whites add a readable eye at
        # sprite scale instead of turning the face into two dark holes.
        extras.append(eye(prefix+'_EyeWhite_'+str(side),(side*.043,-.150,1.696),(.014,.012,.0065),rig,palette['white_eye'],head_factor))
        extras.append(eye(prefix+'_Pupil_'+str(side),(side*.043,-.162,1.696),(.0045,.004,.0055),rig,palette['eye'],head_factor))
    if is_midnight:
        extras.extend(midnight_hair(rig,palette['hair'],head_factor))
        lip=material('Midnight_Lips',(.24,.11,.07),.85)
        extras.append(eye('Midnight_Mouth',(0,-.157,1.623),(.026,.007,.005),rig,lip,head_factor))
        extras.append(eye('Midnight_MouthLine',(0,-.164,1.623),(.021,.002,.0015),rig,palette['eye'],head_factor))
    else:
        extras.extend(bandolier(rig,palette['webbing'],palette['brass']))
    rig['character']= 'Mr. Midnight' if is_midnight else 'Brick Barrage'
    rig['shared_rig_variant']=True
    rig['art_status']='Shared-rig prototype based on Quaternius CC0 modular characters'
    return extras
