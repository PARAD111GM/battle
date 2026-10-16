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


def _strap(rig, leather, surface):
    points = [Vector(p) for p in [(-.13, -.154, 1.475),
                                 (-.065, -.204, 1.370),
                                 (.025, -.188, 1.260),
                                 (.132, -.150, 1.138)]]
    points = _sample_path(points, 10)
    vertices, faces, weights = [], [], []
    for point in points:
        for direction in (-1, 1):
            edge = point + Vector((.014 * direction, 0, .012 * direction))
            vertices.append(_front_surface_point(surface, edge, .012))
            weights.append(_weights(edge.z))
    for i in range(len(points) - 1):
        faces.append((i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1))
    obj = _style.bind_mesh('Katnip_QuiverStrap', vertices, faces,
                          rig, leather, weights)
    solid = obj.modifiers.new('Leather thickness', 'SOLIDIFY')
    solid.thickness = .006
    return obj


def _archery_gear(rig, leather, trim, wood, feather, string, surface):
    # The bow is visibly slung, keeping the inherited unarmed run unchanged.
    base = Vector((.070, .080, 1.095))
    top = Vector((-.130, .095, 1.545))
    axis = (top - base).normalized()
    side = axis.cross(Vector((0, 1, 0))).normalized()
    depth = axis.cross(side).normalized()
    extras = [_strap(rig, leather, surface)]
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


def _jacket_trim(rig, trim, surface):
    # A zip front and a compact folded collar turn the simple source tee into
    # an outdoor jacket, without adding a stiff unweighted shell over it.
    centers = [Vector(p) for p in [(0, -.171, 1.115),
                                   (0, -.183, 1.235),
                                   (0, -.197, 1.355),
                                   (0, -.184, 1.438)]]
    centers = [_front_surface_point(surface, point, .007)
               for point in _sample_path(centers, 10)]
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


def _curve(z, knots):
    """C1-continuous profile in canonical rest space, with flat end slopes."""
    if z <= knots[0][0]:
        return knots[0][1]
    for (a, first), (b, second) in zip(knots, knots[1:]):
        if z <= b:
            t = (z - a) / (b - a)
            return first + (second - first) * t * t * (3 - 2 * t)
    return knots[-1][1]


def _jacket_shape(point):
    """Keep the fitted waist, giving the lower ribs a little jacket volume."""
    p = point.copy()
    if abs(p.x) >= .24 or not 1.10 < p.z < 1.43:
        return p
    lateral = 1 - _curve(abs(p.x), [(.15, 0), (.24, 1)])
    ease = math.sin(math.pi * (p.z - 1.10) / .33)
    ribs = _curve(p.z, [(1.10, 0), (1.18, 0), (1.30, 1), (1.40, 0)])
    p.x *= 1 + lateral * (.045 * ease + .035 * ribs)
    p.y += (p.y + .075) * lateral * (.075 * ease + .12 * ribs)
    return p


def _trouser_shape(point, rig):
    """Move thigh fullness upward without moving joints or widening the frame.

    The source's widest leg section sat near mid-thigh. A modest radial taper
    toward each knee, followed by upper-pelvis volume, reads closer to the
    athletic reference. The continuous map leaves waistband and boot seams
    fixed and softens the source's abrupt rear-pelvis shelf.
    """
    p = point.copy()
    side = 'L' if p.x >= 0 else 'R'
    leg = rig.data.bones['UpperLeg.' + side]
    center_x = leg.head_local.x
    taper = _curve(p.z, [(.30, 1), (.42, .97), (.53, .84),
                        (.62, .84), (.72, .90), (.80, .96), (.86, 1)])
    p.x = center_x + (p.x - center_x) * taper
    upper = _curve(p.z, [(.80, 1), (.85, 1.020), (.90, 1.045),
                        (.94, 1.045), (.98, 1.035), (1.02, 1.02),
                        (1.045, 1)])
    p.x *= upper
    posterior = _curve(p.y, [(-.035, 0), (.025, 1)])
    soften = _curve(p.z, [(.77, 0), (.88, .012), (.94, .012),
                          (1.00, -.003), (1.04, 0)])
    p.y -= posterior * soften
    return p


def _round_upper_hip(obj):
    """Round the actual front outline across the waist-to-thigh transition.

    Sparse source rings made a hard corner even with a smooth scale function.
    Add only local pelvis edge cuts, carrying the existing deform weights, then
    fit the outer silhouette to a cubic arc with matched endpoint tangents.
    Inner-thigh geometry, depth, waistband and lower legs stay in place.
    """
    import bmesh
    _style.weld_and_smooth(obj)
    obj.data.calc_loop_triangles()
    points = [v.co.copy() for v in obj.data.vertices]
    triangles = [tuple(t.vertices) for t in obj.data.loop_triangles]

    def outer_width(z):
        intersections = []
        for triangle in triangles:
            vertices = [points[index] for index in triangle]
            for a, b in zip(vertices, vertices[1:] + vertices[:1]):
                if (a.z - z) * (b.z - z) < 0:
                    intersections.append(abs(a.lerp(b, (z - a.z) / (b.z - a.z)).x))
        return max(intersections)

    low, peak, high = .80, .89, 1.03
    step = .0001
    def tangent(z):
        return (outer_width(z + step) - outer_width(z - step)) / (2 * step)

    knots = [(low, outer_width(low), tangent(low)), (peak, .204, 0),
             (high, outer_width(high), tangent(high))]

    def outline(z):
        first, second = knots[:2] if z <= peak else knots[1:]
        a, x0, slope0 = first
        b, x1, slope1 = second
        t = (z - a) / (b - a)
        return ((2 * t**3 - 3 * t**2 + 1) * x0 +
                (t**3 - 2 * t**2 + t) * (b - a) * slope0 +
                (-2 * t**3 + 3 * t**2) * x1 +
                (t**3 - t**2) * (b - a) * slope1)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    original = set(bm.verts)
    edges = [edge for edge in bm.edges
             if all(.70 < vert.co.z < 1.05 for vert in edge.verts)]
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=2, use_grid_fill=True)
    deform = bm.verts.layers.deform.active
    for vertex in bm.verts:
        if vertex not in original:
            weights = vertex[deform]
            strongest = sorted(weights.items(), key=lambda pair: pair[1], reverse=True)[:4]
            total = sum(weight for _, weight in strongest)
            assert total > 1e-6, 'New pelvis vertex must retain skin weights'
            weights.clear()
            for group, weight in strongest:
                weights[group] = weight / total
        if low < vertex.co.z < high:
            width = outer_width(vertex.co.z)
            lateral = _curve(abs(vertex.co.x) / width, [(.55, 0), (.85, 1)])
            side = 1 if vertex.co.x >= 0 else -1
            vertex.co.x += side * lateral * (outline(vertex.co.z) - width)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _sample_path(points, intervals):
    # Sparse straight segments would cut through the convex chest even when
    # their endpoints lie outside it. Sample the entire strap/zipper path.
    return [a.lerp(b, step / intervals)
            for a, b in zip(points, points[1:])
            for step in range(intervals)] + [points[-1]]


def _front_surface_point(surface, point, clearance):
    p = point.copy()
    hit, _, _, _ = surface.ray_cast(Vector((p.x, -1, p.z)), Vector((0, 1, 0)))
    if hit is not None:
        p.y = hit.y - clearance
    return p



def _inherit_jacket_weights(body, extras):
    """Trim follows the same local cloth deformation during the shared Run.

    Matching only the rest surface is insufficient near the shoulder and
    chest: the jacket includes shoulder influences as well as torso bones.
    Interpolate its triangle weights, retaining the four strongest influences
    supported by the runtime GLB, without changing the jacket's own weights.
    """
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform
    body.data.calc_loop_triangles()
    triangles = [tuple(t.vertices) for t in body.data.loop_triangles]
    coordinates = [v.co.copy() for v in body.data.vertices]
    surface = BVHTree.FromPolygons(coordinates, triangles, all_triangles=True)
    names = {group.index: group.name for group in body.vertex_groups}
    source = [{names[group.group]: group.weight for group in vertex.groups}
              for vertex in body.data.vertices]
    for obj in extras:
        if obj.name not in {'Katnip_JacketZip', 'Katnip_QuiverStrap'}:
            continue
        for group in list(obj.vertex_groups):
            obj.vertex_groups.remove(group)
        for vertex in obj.data.vertices:
            nearest, _, triangle, _ = surface.find_nearest(vertex.co)
            assert nearest is not None, 'Trim has no jacket surface'
            indices = triangles[triangle]
            a, b, c = (coordinates[index] for index in indices)
            blend = barycentric_transform(nearest, a, b, c,
                    Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
            weights = {}
            for index, amount in zip(indices, blend):
                for name, weight in source[index].items():
                    weights[name] = weights.get(name, 0) + max(0, amount) * weight
            influences = sorted(weights.items(), key=lambda pair: pair[1], reverse=True)[:4]
            total = sum(weight for _, weight in influences)
            assert total > 1e-6, 'Trim has no skin weights'
            for name, weight in influences:
                if weight > 1e-8:
                    group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
                    group.add([vertex.index], weight / total, 'REPLACE')


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
                vert.co = _jacket_shape(vert.co)
        elif part == 'Head':
            for vert in obj.data.vertices:
                vert.co = _style.enlarged_head(vert.co, head_factor)
        elif part == 'Legs':
            for vert in obj.data.vertices:
                vert.co = _trouser_shape(vert.co, rig)
            _round_upper_hip(obj)
            # The lower trouser cuff becomes a matching boot shaft. Keeping
            # source geometry and weights avoids a shoe/ankle gap during runs.
            obj.data.materials.append(palette['boots'])
            boot_index = len(obj.data.materials) - 1
            for poly in obj.data.polygons:
                if max(obj.data.vertices[i].co.z for i in poly.vertices) < .34:
                    poly.material_index = boot_index
        _style.weld_and_smooth(obj)
        obj.name = 'Katnip_' + part
    from mathutils.bvhtree import BVHTree
    body = next(obj for obj in meshes if obj.name == 'Katnip_Body')
    surface = BVHTree.FromPolygons([v.co for v in body.data.vertices],
                                  [tuple(p.vertices) for p in body.data.polygons])
    extras = _braid(rig, palette['hair'], palette['leather'], head_factor)
    extras.extend(_jacket_trim(rig, palette['jacket_trim'], surface))
    extras.extend(_archery_gear(rig, palette['leather'], palette['trim'],
                               palette['wood'], palette['feather'], palette['string'], surface))
    for extra in extras:
        if 'Braid' in extra.name or extra.name == 'Katnip_JacketCollar':
            for vertex in extra.data.vertices:
                vertex.co = _jacket_shape(vertex.co)
    _inherit_jacket_weights(body, extras)
    rig['character'] = 'Katnip Neverdo'
    rig['shared_rig_variant'] = True
    rig['art_status'] = 'Original archer parody prototype based on Quaternius CC0 modular characters'
    return extras
