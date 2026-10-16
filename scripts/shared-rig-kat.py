"""Katnip Neverdo's mesh styling on the shared humanoid rest skeleton.

Input is the actual Quaternius female Casual model, normalized to the canonical
rest pose by normalize-shared-rig-source.py. The builder subsequently applies
the small body profile to this complete, weighted character. This module never
changes bone transforms or animation: the braid, archery equipment and clothes
are mesh variants with ordinary skin weights.
"""
import importlib.util
import math
from pathlib import Path

import bpy
from mathutils import Vector

_spec = importlib.util.spec_from_file_location(
    'shared_rig_style_for_kat', Path(__file__).with_name('shared-rig-style.py'))
_style = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_style)


def _weights(z, head=False):
    if head:
        amount = max(0, min(1, (z - 1.43) / .20))
        return {'Head': amount, 'Chest': 1 - amount}
    amount = max(0, min(1, (z - 1.20) / .23))
    return {'Chest': amount, 'Torso': 1 - amount}


def _tube(name, centers, radii, rig, material, weights=None, sides=12):
    """A connected tube along a path, with normalized skin weights per ring."""
    points = [Vector(p) for p in centers]
    vertices, faces, skin = [], [], []
    for i, center in enumerate(points):
        tangent = (points[min(i + 1, len(points) - 1)] -
                   points[max(0, i - 1)]).normalized()
        reference = Vector((0, 1, 0))
        if abs(tangent.dot(reference)) > .95:
            reference = Vector((1, 0, 0))
        u = tangent.cross(reference).normalized()
        v = tangent.cross(u).normalized()
        for j in range(sides):
            theta = math.tau * j / sides
            vertices.append(center + radii[i] *
                            (u * math.cos(theta) + v * math.sin(theta)))
            skin.append(weights[i] if weights else {'Chest': 1.0})
    for i in range(len(points) - 1):
        for j in range(sides):
            a = i * sides + j
            b = i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.append(tuple(reversed(range(sides))))
    faces.append(tuple((len(points) - 1) * sides + j for j in range(sides)))
    return _style.bind_mesh(name, vertices, faces, rig, material, skin)


def _braid(rig, hair, tie, factor):
    # One joined silhouette sweeps from the nape over the left shoulder. Three
    # interwoven strands read as a braid; lower rings follow the torso gently.
    anchors = [Vector(p) for p in [
        (.064, .074, 1.696), (.111, .068, 1.622),
        (.145, .010, 1.540), (.149, -.115, 1.445),
        (.142, -.211, 1.355), (.130, -.213, 1.280)]]
    centers, widths, skin = [], [], []
    rings = 66
    for i in range(rings):
        t = i / (rings - 1)
        segment = min(len(anchors) - 2, int(t * (len(anchors) - 1)))
        u = t * (len(anchors) - 1) - segment
        p = anchors[segment].lerp(anchors[segment + 1], u)
        head_blend = max(0, min(1, (p.z - 1.48) / .15))
        p = p.lerp(_style.enlarged_head(p, factor), head_blend)
        centers.append(p)
        widths.append(.018 * (1 - .45 * t))
        skin.append(_weights(p.z, head=True))
    extras = []
    for strand in range(3):
        path = []
        for i, center in enumerate(centers):
            tangent = (centers[min(i + 1, rings - 1)] -
                       centers[max(0, i - 1)]).normalized()
            u = tangent.cross(Vector((0, 1, 0))).normalized()
            v = tangent.cross(u).normalized()
            t = i / (rings - 1)
            angle = math.tau * (5.5 * t + strand / 3)
            offset = widths[i] * .60
            path.append(center + offset *
                        (u * math.cos(angle) + v * math.sin(angle)))
        extras.append(_tube('Katnip_Braid_' + str(strand + 1), path,
                            [w * .70 for w in widths], rig, hair, skin, 8))
    end = centers[-1]
    extras.append(_tube('Katnip_BraidTie', [end + Vector((0, 0, .008)),
                                           end - Vector((0, 0, .007))],
                        [.016, .014], rig, tie,
                        [_weights(end.z, head=True)] * 2, 12))
    return extras


def _strap(rig, leather):
    points = [Vector(p) for p in [(-.13, -.154, 1.475),
                                 (-.065, -.204, 1.370),
                                 (.025, -.188, 1.260),
                                 (.132, -.150, 1.138)]]
    vertices, faces, weights = [], [], []
    for point in points:
        for direction in (-1, 1):
            vertices.append(point + Vector((.014 * direction, 0,
                                            .012 * direction)))
            weights.append(_weights(point.z))
    for i in range(len(points) - 1):
        faces.append((i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1))
    obj = _style.bind_mesh('Katnip_QuiverStrap', vertices, faces,
                          rig, leather, weights)
    solid = obj.modifiers.new('Leather thickness', 'SOLIDIFY')
    solid.thickness = .006
    return obj


def _archery_gear(rig, leather, trim, wood, feather, string):
    # The bow is visibly slung, keeping the inherited unarmed run unchanged.
    base = Vector((.070, .080, 1.095))
    top = Vector((-.130, .095, 1.545))
    axis = (top - base).normalized()
    side = axis.cross(Vector((0, 1, 0))).normalized()
    depth = axis.cross(side).normalized()
    extras = [_strap(rig, leather)]
    extras.append(_tube('Katnip_Quiver', [base, base.lerp(top, .05), top],
                        [.030, .046, .054], rig, leather))
    extras.append(_tube('Katnip_QuiverRim', [top - axis * .018,
                                          top + axis * .010],
                        [.058, .058], rig, trim))
    for i, (side_offset, depth_offset, length) in enumerate([
            (-.023, -.006, .265), (.012, -.017, .290),
            (.024, .016, .242)]):
        arrow_base = top - axis * .26 + side * side_offset + depth * depth_offset
        arrow_tip = top + axis * length + side * side_offset + depth * depth_offset
        extras.append(_tube('Katnip_ArrowShaft_' + str(i + 1),
                            [arrow_base, arrow_tip], [.0035, .0035],
                            rig, wood, sides=8))
        # Three small vanes, with their broad face visible from multiple angles.
        verts, faces = [], []
        for vane in range(3):
            theta = math.tau * vane / 3
            spread = side * math.cos(theta) + depth * math.sin(theta)
            start = arrow_tip - axis * .095
            end = arrow_tip - axis * .014
            j = len(verts)
            verts.extend([start, start + axis * .012 + spread * .020,
                          end + spread * .013, end])
            faces.append((j, j + 1, j + 2, j + 3))
            faces.append((j + 3, j + 2, j + 1, j))
        extras.append(_style.bind_mesh('Katnip_ArrowFletching_' + str(i + 1),
                                      verts, faces, rig, feather,
                                      [{'Chest': 1.0}] * len(verts)))
    bow_path = []
    bow_radii = []
    for i in range(31):
        t = i / 30
        # A compact recurved bow sits behind the right shoulder and hip.
        recurved = .025 * math.sin(math.tau * t)
        bow_path.append(Vector((.115 + .165 * math.sin(math.pi * t) + recurved,
                                .110, .955 + .80 * t)))
        bow_radii.append(.006 + .005 * math.sin(math.pi * t))
    extras.append(_tube('Katnip_SlungBow', bow_path, bow_radii,
                        rig, wood, sides=10))
    extras.append(_tube('Katnip_BowString', [bow_path[0], bow_path[-1]],
                        [.0018, .0018], rig, string, sides=6))
    center = bow_path[15]
    extras.append(_tube('Katnip_BowGrip', [center - Vector((0, 0, .043)),
                                         center + Vector((0, 0, .043))],
                        [.014, .014], rig, leather, sides=10))
    return extras


def _jacket_trim(rig, trim):
    # A zip front and a compact folded collar turn the simple source tee into
    # an outdoor jacket, without adding a stiff unweighted shell over it.
    centers = [Vector(p) for p in [(0, -.171, 1.115),
                                   (0, -.183, 1.235),
                                   (0, -.197, 1.355),
                                   (0, -.184, 1.438)]]
    zipper = _tube('Katnip_JacketZip', centers, [.003] * len(centers),
                   rig, trim, [_weights(p.z) for p in centers], sides=6)
    vertices = []
    faces = []
    weights = []
    for side in (-1, 1):
        j = len(vertices)
        points = [Vector((side * .012, -.174, 1.455)),
                  Vector((side * .066, -.134, 1.507)),
                  Vector((side * .098, -.151, 1.472)),
                  Vector((side * .052, -.192, 1.422))]
        vertices.extend(points)
        faces.append((j, j + 1, j + 2, j + 3))
        weights.extend([{'Chest': 1.0}] * 4)
    collar = _style.bind_mesh('Katnip_JacketCollar', vertices, faces,
                             rig, trim, weights)
    solid = collar.modifiers.new('Collar thickness', 'SOLIDIFY')
    solid.thickness = .004
    return [zipper, collar]


def style_character(character, rig, meshes):
    """Style normalized female Casual parts; return weighted accessory meshes."""
    head_factor = 1.20
    palette = {
        'skin': _style.material('Katnip_Skin', (.51, .33, .22)),
        'hair': _style.material('Katnip_DarkHair', (.025, .017, .014), .72),
        'eyes': _style.material('Katnip_Eyes', (.020, .027, .021), .45),
        'jacket': _style.material('Katnip_OliveJacket', (.105, .145, .065), .87),
        'jacket_trim': _style.material('Katnip_JacketTrim', (.054, .073, .035), .88),
        'trousers': _style.material('Katnip_UtilityTrousers', (.038, .045, .035), .86),
        'boots': _style.material('Katnip_Boots', (.025, .020, .016), .69),
        'leather': _style.material('Katnip_Leather', (.105, .052, .023), .78),
        'trim': _style.material('Katnip_QuiverTrim', (.19, .102, .041), .74),
        'wood': _style.material('Katnip_BowWood', (.24, .135, .048), .64),
        'feather': _style.material('Katnip_RustFletching', (.40, .095, .038), .83),
        'string': _style.material('Katnip_BowString', (.43, .37, .25), .9),
    }
    for obj in meshes:
        name = _style.base_name(obj.name)
        part = 'Head' if 'Head' in name else 'Body' if 'Body' in name else 'Feet' if 'Feet' in name else 'Legs'
        originals = [_style.base_name(m.name) if m else '' for m in obj.data.materials]
        for index, old in enumerate(originals):
            if part == 'Head':
                mat = palette['skin'] if old == 'Skin' else palette['hair'] if 'Hair' in old else palette['eyes']
            elif part == 'Body':
                mat = palette['skin'] if old == 'Skin' else palette['jacket']
            elif part == 'Feet':
                # Original ankle skin is recolored into the boot upper.
                mat = palette['boots']
            else:
                mat = palette['trousers']
            obj.data.materials[index] = mat
        if part == 'Body':
            jacket_index = next(i for i, m in enumerate(obj.data.materials)
                                if m == palette['jacket'])
            for poly in obj.data.polygons:
                center = sum((obj.data.vertices[i].co for i in poly.vertices), Vector()) / len(poly.vertices)
                # Continue sleeves over the source's bare arms, ending at the
                # wrist. Existing hands and neck remain skin colored.
                if originals[poly.material_index] == 'Skin' and .20 < abs(center.x) < .645:
                    poly.material_index = jacket_index
            for vert in obj.data.vertices:
                p = vert.co
                # A little ease gives the source fitted tee the silhouette of
                # a practical jacket without altering the shoulder/neck seam.
                if 1.10 < p.z < 1.43 and abs(p.x) < .22:
                    blend = math.sin(math.pi * (p.z - 1.10) / .33)
                    p.x *= 1 + .045 * blend
                    p.y += (p.y + .075) * .075 * blend
        elif part == 'Head':
            for vert in obj.data.vertices:
                vert.co = _style.enlarged_head(vert.co, head_factor)
        elif part == 'Legs':
            # The lower trouser cuff becomes a matching boot shaft. Keeping
            # source geometry and weights avoids a shoe/ankle gap during runs.
            obj.data.materials.append(palette['boots'])
            boot_index = len(obj.data.materials) - 1
            for poly in obj.data.polygons:
                if max(obj.data.vertices[i].co.z for i in poly.vertices) < .34:
                    poly.material_index = boot_index
        _style.weld_and_smooth(obj)
        obj.name = 'Katnip_' + part
    extras = _braid(rig, palette['hair'], palette['leather'], head_factor)
    extras.extend(_jacket_trim(rig, palette['jacket_trim']))
    extras.extend(_archery_gear(rig, palette['leather'], palette['trim'],
                               palette['wood'], palette['feather'], palette['string']))
    rig['character'] = 'Katnip Neverdo'
    rig['shared_rig_variant'] = True
    rig['art_status'] = 'Original archer parody prototype based on Quaternius CC0 modular characters'
    return extras
