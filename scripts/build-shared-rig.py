#!/usr/bin/env python3
"""Build the isolated shared humanoid rig study with Blender 4.3+.

  blender -b --python scripts/build-shared-rig.py -- --preview
  blender -b --python scripts/build-shared-rig.py -- --render

The first command builds the editable scene/GLB and review poses. The second
also renders one exact 0.8-second run cycle as 48 PNG frames at 60 fps.
All four source GLBs are CC0 Quaternius models; see SOURCES.md beside them.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import tempfile
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'art/characters/shared-rig'
DOCS = ROOT / 'docs/art-direction/shared-rig'
FPS = 60
DURATION = 0.8
FRAME_COUNT = 48
SOURCE_NAMES = ('suit', 'casual', 'swat', 'female')


def arguments():
    values = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--preview', action='store_true', help='Build and render approval poses only (default).')
    modes.add_argument('--render', action='store_true', help='Also render all 48 animation frames.')
    parser.add_argument('--samples', type=int, default=16)
    parser.add_argument('--engine', choices=['CYCLES', 'BLENDER_EEVEE_NEXT'], default='BLENDER_EEVEE_NEXT')
    return parser.parse_args(values)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def skeleton_signature(rig):
    return [{'name': b.name, 'parent': b.parent.name if b.parent else None,
             'matrix': [round(value, 7) for row in b.matrix_local for value in row]}
            for b in rig.data.bones]


def action_signature(action):
    # Includes every key, tangent, interpolation mode, and curve modifier.
    return [{'path': f.data_path, 'index': f.array_index,
             'keys': [[list(k.co), list(k.handle_left), list(k.handle_right),
                       k.interpolation, k.handle_left_type, k.handle_right_type]
                      for k in f.keyframe_points],
             'modifiers': [m.type for m in f.modifiers]}
            for f in action.fcurves]


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def hierarchy(rig):
    return [(b.name, b.parent.name if b.parent else None) for b in rig.data.bones]


def matrix_difference(first, second):
    return max(abs(a - b) for ra, rb in zip(first, second) for a, b in zip(ra, rb))


def verify_variants(rigs, action):
    """Compatible rigs share local animation, not identical posed joint positions."""
    reference = rigs['midnight']
    assert len(reference.data.bones) == 62
    first, reports = {}, {}
    at_frame(0)
    for name, rig in rigs.items():
        assert hierarchy(rig) == hierarchy(reference)
        assert rig.animation_data.action is action
        first[name] = {b.name: b.matrix.copy() for b in rig.pose.bones}
        reports[name] = {'loop_max_matrix_error': 0, 'max_bone_length_drift': 0,
                         'max_local_animation_matrix_error': 0}
    for frame in range(FRAME_COUNT + 1):
        at_frame(frame)
        for name, rig in rigs.items():
            report = reports[name]
            for bone in rig.pose.bones:
                report['max_bone_length_drift'] = max(report['max_bone_length_drift'],
                    abs((bone.tail - bone.head).length - rig.data.bones[bone.name].length))
                report['max_local_animation_matrix_error'] = max(report['max_local_animation_matrix_error'],
                    matrix_difference(bone.matrix_basis, reference.pose.bones[bone.name].matrix_basis))
                if frame == FRAME_COUNT:
                    report['loop_max_matrix_error'] = max(report['loop_max_matrix_error'],
                        matrix_difference(first[name][bone.name], bone.matrix))
    for name, report in reports.items():
        assert max(report.values()) < 1e-5, (name, report)
    return reports



def close_authored_loop(action):
    """Preserve all authored poses; add the omitted repeated first pose.

    Source has 25 distinct samples at 30 Hz, with the last at .8 seconds.
    Add the next sample at 50/60 seconds, then uniformly compress the closed
    cycle by .96 to keep the intended .8-second gameplay preview duration.
    """
    original_count = sum(len(f.keyframe_points) for f in action.fcurves)
    source_end = float(action.frame_range[1])
    appended_frame = 50.0
    scale = FRAME_COUNT / appended_frame
    assert abs(source_end - 48.0) < 1e-4
    for curve in action.fcurves:
        original = [(float(p.co.x), float(p.co.y)) for p in curve.keyframe_points]
        first = float(curve.evaluate(0))
        closing = curve.keyframe_points.insert(appended_frame, first, options={'FAST'})
        closing.interpolation = 'LINEAR'
        for point in curve.keyframe_points:
            point.co.x *= scale
            point.handle_left.x *= scale
            point.handle_right.x *= scale
        curve.update()
        for old, new in zip(original, curve.keyframe_points):
            assert abs(float(new.co.x) - old[0] * scale) < 1e-5
            assert float(new.co.y) == old[1], 'An authored pose value changed'
        assert abs(curve.evaluate(FRAME_COUNT) - first) < 1e-6
    return {'source_duration_seconds': source_end / FPS,
            'source_samples_at_30fps': 25,
            'appended_first_pose_at_source_seconds': appended_frame / FPS,
            'uniform_key_time_scale': scale,
            'playback_speed_multiplier': 1 / scale,
            'final_duration_seconds': DURATION,
            'authored_pose_values_preserved': True,
            'source_key_count': original_count,
            'appended_key_count': len(action.fcurves)}


def import_source(name):
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(ART / 'sources' / (name + '.glb')))
    objects = set(bpy.data.objects) - before_objects
    actions = set(bpy.data.actions) - before_actions
    rigs = [o for o in objects if o.type == 'ARMATURE']
    assert len(rigs) == 1, f'{name} must contain one armature'
    return {'rig': rigs[0], 'objects': objects, 'actions': actions,
            'meshes': {o.name.split('.')[0]: o for o in objects if o.type == 'MESH'}}


def configure_action(rig, action):
    rig.animation_data_clear()
    rig.animation_data_create()
    rig.animation_data.action = action


def character_meshes(rig):
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and
            (o.parent == rig or any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers))]


def assemble(sources):
    master = sources['suit']['rig']
    reference = skeleton_signature(master)
    assert len(reference) == 62
    for name, source in sources.items():
        actual = skeleton_signature(source['rig'])
        assert [b['name'] for b in actual] == [b['name'] for b in reference], name
        assert [b['parent'] for b in actual] == [b['parent'] for b in reference], name
        if name != 'female':
            error = max(abs(x - y) for a, b in zip(actual, reference) for x, y in zip(a['matrix'], b['matrix']))
            assert error < 1e-6, f'{name} rest skeleton differs by {error}'
    normalizer = load_module('normalize_shared_rig_source', 'normalize-shared-rig-source.py')
    normalization = normalizer.normalize_source(sources['female'], master)
    action = next(a for a in sources['suit']['actions'] if a.name.startswith('Run_CharacterArmature'))
    raw_signature = digest(action_signature(action))
    assert abs(float(action.frame_range[1]) / FPS - DURATION) < 1e-6
    loop_fix = close_authored_loop(action)
    prepared_signature = digest(action_signature(action))
    action.name = 'Run'
    action.use_fake_user = True
    master.name = 'MidnightRig'
    master.data.name = 'SharedHumanoidSkeleton'
    brick_rig = master.copy()
    brick_rig.data = master.data
    brick_rig.name = 'BrickRig'
    bpy.context.collection.objects.link(brick_rig)
    small_rig = master.copy()
    small_rig.data = master.data
    small_rig.name = 'SmallRig'
    bpy.context.collection.objects.link(small_rig)
    rigs = {'small': small_rig, 'midnight': master, 'brick': brick_rig}
    parts = {
        'small': [('female', 'Casual_Body'), ('female', 'Casual_Legs'), ('female', 'Casual_Feet'), ('female', 'Casual_Head')],
        'midnight': [('suit', 'Suit_Body'), ('suit', 'Suit_Legs'), ('suit', 'Suit_Feet'), ('casual', 'Casual2_Head')],
        'brick': [('casual', 'Casual2_Body'), ('suit', 'Suit_Head'), ('swat', 'Swat_Legs'), ('swat', 'Swat_Feet')],
    }
    chosen = {}
    keep = set(rigs.values())
    for character, rig in rigs.items():
        configure_action(rig, action)
        chosen[character] = []
        for source, name in parts[character]:
            mesh = sources[source]['meshes'][name]
            transform = mesh.matrix_world.copy()
            mesh.parent = rig
            mesh.matrix_parent_inverse = Matrix.Identity(4)
            mesh.matrix_world = transform
            for modifier in mesh.modifiers:
                if modifier.type == 'ARMATURE':
                    modifier.object = rig
            mesh['source_mesh'] = name
            mesh['source_asset'] = source
            chosen[character].append(mesh)
            keep.add(mesh)
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    for other in list(bpy.data.actions):
        if other != action:
            bpy.data.actions.remove(other)
    # Styling happens in the common rest coordinate system. It changes meshes,
    # materials, and attachments; it must not change the skeleton or animation.
    bpy.context.scene.frame_set(0)
    style = load_module('shared_rig_style', 'shared-rig-style.py')
    kat_style = load_module('shared_rig_kat', 'shared-rig-kat.py')
    for character, rig in rigs.items():
        character_style = kat_style if character == 'small' else style
        extras = character_style.style_character(character, rig, chosen[character])
        if extras:
            for extra in extras:
                if extra.parent is None:
                    extra.parent = rig
        chosen[character] = character_meshes(rig)
        for mesh in chosen[character]:
            if not mesh.name.startswith(character.capitalize() + '_'):
                mesh.name = character.capitalize() + '_' + mesh.name
        rig['character_id'] = character
        rig['shared_animation'] = 'Run'
    assert master.data is brick_rig.data
    assert master.animation_data.action is brick_rig.animation_data.action is action
    assert digest(action_signature(action)) == prepared_signature, 'Styling modified the prepared run'
    assert skeleton_signature(master) == reference, 'Styling modified the shared rest skeleton'
    proportions = load_module('shared_rig_proportions', 'shared-rig-proportions.py')
    profiles = {character: proportions.apply_proportions(character, rig, chosen[character])
                for character, rig in rigs.items()}
    assert digest(action_signature(action)) == prepared_signature, 'Proportions modified the shared run'
    # Separate on the camera's screen-horizontal axis while keeping equal depth.
    horizontal = Vector((9, -6, 0)).normalized()
    for character, multiplier in [('small', -1), ('midnight', 0), ('brick', 1)]:
        rigs[character].location += horizontal * (1.85 * multiplier)
    bpy.context.view_layer.update()
    return rigs, chosen, action, raw_signature, prepared_signature, loop_fix, profiles, normalization


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def setup_studio(options):
    scene = bpy.context.scene
    ground_material = bpy.data.materials.new('Studio warm neutral')
    ground_material.use_nodes = True
    shader = ground_material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.49, .455, .40, 1)
    shader.inputs['Roughness'].default_value = .93
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.025))
    ground = bpy.context.object
    ground.name = 'StudioGround'
    ground.data.materials.append(ground_material)
    for name, location, energy, size in [
        ('Soft key', (-3, -4, 6), 750, 5),
        ('Soft fill', (4, -2, 3.5), 340, 4),
        ('Shoulder rim', (1, 3, 5), 650, 3),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        lamp = bpy.data.objects.new(name, data)
        scene.collection.objects.link(lamp)
        lamp.location = location
        aim(lamp, (0, 0, 1))
    bpy.ops.object.camera_add(location=(-6, -9, 2.6))
    camera = bpy.context.object
    camera.name = 'SharedRigReviewCamera'
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 6.0
    aim(camera, (0, 0, .94))
    scene.camera = camera
    scene.world = bpy.data.worlds.new('Warm studio world')
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes['Background']
    background.inputs['Color'].default_value = (.67, .70, .76, 1)
    background.inputs['Strength'].default_value = .45
    scene.render.engine = options.engine
    if options.engine == 'CYCLES':
        scene.cycles.device = 'CPU'
        scene.cycles.samples = max(1, options.samples)
        scene.cycles.use_denoising = False  # This cloud Blender build has no OIDN.
    else:
        scene.eevee.taa_render_samples = max(1, options.samples)
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = False
    scene.render.fps = FPS
    scene.render.fps_base = 1
    scene.render.use_file_extension = True
    scene.frame_start = 0
    scene.frame_end = FRAME_COUNT
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    return camera


def at_frame(frame):
    bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
    bpy.context.view_layer.update()


def report_pose(rig, frame):
    at_frame(frame)
    return {name: [round(float(v), 7) for v in rig.pose.bones[name].matrix.translation]
            for name in ['Body', 'Head', 'UpperLeg.L', 'UpperLeg.R', 'LowerLeg.L', 'LowerLeg.R', 'Foot.L', 'Foot.R']}


def evaluated_bounds(meshes):
    graph = bpy.context.evaluated_depsgraph_get()
    points = []
    for original in meshes:
        obj = original.evaluated_get(graph)
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    return {'min': [min(v[i] for v in points) for i in range(3)],
            'max': [max(v[i] for v in points) for i in range(3)]}


def gltf_json(path):
    data = path.read_bytes()
    length, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4E4F534A
    return json.loads(data[20:20 + length])


def export_glb(rigs, meshes):
    bpy.ops.object.select_all(action='DESELECT')
    for rig in rigs.values():
        rig.select_set(True)
    for group in meshes.values():
        for mesh in group:
            mesh.select_set(True)
    bpy.context.view_layer.objects.active = rigs['midnight']
    target = DOCS / 'shared-rig.glb'
    bpy.ops.export_scene.gltf(
        filepath=str(target), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIVE_ACTIONS',
        export_nla_strips_merged_animation_name='Run',
        export_force_sampling=True, export_frame_range=False, export_frame_step=1,
        export_armature_object_remove=False, export_anim_single_armature=False,
        export_rest_position_armature=True, export_skins=True,
        export_apply=True, export_extras=True, export_cameras=False, export_lights=False,
    )
    document = gltf_json(target)
    animations = document.get('animations', [])
    assert len(animations) == 1, f'Expected one shared run clip, got {len(animations)}'
    clips = []
    for animation in animations:
        maxima = [document['accessors'][sampler['input']]['max'][0] for sampler in animation['samplers']]
        duration = max(maxima)
        assert abs(duration - DURATION) < 1e-5
        clips.append({'name': animation.get('name'), 'duration': duration,
                      'channels': len(animation['channels'])})
    names = {n.get('name') for n in document['nodes']}
    assert {'SmallRig', 'MidnightRig', 'BrickRig'} <= names
    assert len(document.get('skins', [])) == 3
    return {'path': str(target.relative_to(ROOT)), 'clips': clips,
            'skins': len(document.get('skins', [])), 'nodes': len(document['nodes'])}


def render_frame(path, frame):
    at_frame(frame)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    options = arguments()
    ART.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    os.environ.setdefault('MESA_SHADER_CACHE_DIR', str(Path(tempfile.gettempdir()) / 'rivetfall-mesa-cache'))
    # Imported key times are expressed in scene frames. Importing at 60 fps
    # keeps the source's exact .8-second duration as 48 timeline units.
    bpy.context.scene.render.fps = FPS
    sources = {name: import_source(name) for name in SOURCE_NAMES}
    rigs, meshes, action, raw_signature, prepared_signature, loop_fix, profiles, normalization = assemble(sources)
    camera = setup_studio(options)
    variant_checks = verify_variants(rigs, action)
    pose_samples = [report_pose(rigs['midnight'], frame) for frame in [0, 12, 24, 36, 48]]
    glb = export_glb(rigs, meshes)
    assert digest(action_signature(action)) == prepared_signature, 'Export changed the prepared action'
    at_frame(6)
    bpy.ops.wm.save_as_mainfile(filepath=str(ART / 'shared-rig.blend'))
    metadata = {
        'fps': FPS, 'duration': DURATION, 'unique_frames': FRAME_COUNT,
        'clip': glb['clips'][0]['name'], 'source_animation': 'Quaternius Run (authored poses preserved; closing pose added and uniformly retimed)',
        'shared_armature_data': rigs['midnight'].data is rigs['brick'].data,
        'shared_action_data': all(rig.animation_data.action is action for rig in rigs.values()),
        'bone_count': len(rigs['midnight'].data.bones),
        'compatible_hierarchy': True,
        'proportion_profiles': profiles,
        'female_source_normalization': normalization,
        'source_action_sha256': raw_signature, 'action_sha256': prepared_signature,
        'loop_preparation': loop_fix,
        'variant_checks': variant_checks,
        'quarter_poses_armature_space': pose_samples,
        'characters': {key: {'name': rig.get('character'), 'root': rig.name, 'blender_position': list(rig.location),
                            'gltf_position': [rig.location.x, rig.location.z, -rig.location.y],
                            'object_scale': list(rig.scale),
                            'skeleton_sha256': digest(skeleton_signature(rig)),
                            'meshes': [{'name': obj.name, 'source_mesh': obj.get('source_mesh'),
                                        'vertices': len(obj.data.vertices), 'faces': len(obj.data.polygons)}
                                       for obj in meshes[key]],
                            'poster_world_bounds': evaluated_bounds(meshes[key])}
                       for key, rig in rigs.items()},
        'camera': {'blender_position': list(camera.location), 'gltf_position': [-6, 2.6, 9],
                   'gltf_target': [0, .94, 0], 'orthographic_width': camera.data.ortho_scale},
        'axes': {'blender': {'up': '+Z', 'front': '-Y'}, 'gltf': {'up': '+Y', 'front': '+Z'}},
        'export': glb, 'render': {'engine': options.engine, 'samples': options.samples, 'denoising': False,
                                'width': 1200, 'height': 640},
    }
    (DOCS / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (ART / 'verification.json').write_text(json.dumps(metadata, indent=2) + '\n')
    render_frame(DOCS / 'shared-rig-poster.png', 6)
    poses = DOCS / 'poses'
    poses.mkdir(exist_ok=True)
    for index, frame in enumerate([0, 12, 24, 36]):
        render_frame(poses / f'quarter-{index}.png', frame)
    if options.render:
        frames = ART / 'renders'
        frames.mkdir(exist_ok=True)
        for frame in range(FRAME_COUNT):
            render_frame(frames / f'frame-{frame:03d}.png', frame)
    at_frame(6)
    bpy.context.scene.render.filepath = str(DOCS / 'shared-rig-poster.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(ART / 'shared-rig.blend'))
    print('SHARED_RIG_REPORT=' + json.dumps({'metadata': str(DOCS / 'metadata.json'),
          'poster': str(DOCS / 'shared-rig-poster.png'), 'mode': 'render' if options.render else 'preview',
          'compatible_hierarchy': True, 'shared_action': True, 'bones': metadata['bone_count'], 'glb': glb}))


if __name__ == '__main__':
    main()
