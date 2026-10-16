"""Compatible size/proportion profiles for the shared humanoid animation rig.

Each character gets independent rest-bone data with the same names, parents,
and local axes. The Run Action remains shared and unchanged. Meshes (including
weighted accessories) are rebased from the old rest coordinates to the new
ones using their existing skin weights.

The source feet are animated Root children, not children of the lower legs.
Leg lengths remain unchanged. A wider hip stance translates each complete
leg and its independent foot/pole nodes laterally by the same amount. The Run
preserves that lateral axis, and every sample is checked against its original
ankle-to-foot offset. Other clips must pass that check independently. Uniform
whole-character scale changes leg length, stride and foot motion together;
independent leg-length edits require contact-aware retargeting.
"""
import math
import bpy
from mathutils import Matrix, Vector


PROFILES = {
    'small': {
        # Match exterior shoulder/hip widths, not just joint spacing. Core
        # head-to-sole height is 95% of medium; hair/equipment do not set size.
        'label': 'Small / female', 'uniform_scale': .9454754863,
        'shoulder_anchor_width': 1.42, 'hip_anchor_width': 1.23,
        'lengths': {'Abdomen': .98, 'Torso': .97, 'Chest': .98,
                    'Shoulder': .92, 'UpperArm': .97, 'LowerArm': .97},
        'radial': {'Hips': 1.035, 'Abdomen': .96, 'Torso': .95,
                   'Chest': .95, 'Shoulder': .93, 'UpperArm': .90,
                   'LowerArm': .92, 'UpperLeg': .98, 'LowerLeg': .95},
    },
    'medium': {
        'label': 'Medium / average male', 'uniform_scale': 1.0,
        'shoulder_anchor_width': 1.0, 'hip_anchor_width': 1.0,
        'lengths': {}, 'radial': {},
    },
    'large': {
        # Lose the same .104898264 scene units that the small body gains.
        'label': 'Large / muscular male', 'uniform_scale': 1.0255581096,
        'shoulder_anchor_width': 1.22, 'hip_anchor_width': 1.0,
        'lengths': {'Abdomen': 1.025, 'Torso': 1.04, 'Chest': 1.04,
                    'Neck': .94, 'Shoulder': 1.10,
                    'UpperArm': 1.035, 'LowerArm': 1.02},
        'radial': {'Hips': 1.06, 'Abdomen': 1.05, 'Torso': 1.055,
                   'Chest': 1.06, 'Shoulder': 1.05, 'UpperArm': 1.055,
                   'LowerArm': 1.04, 'UpperLeg': 1.045, 'LowerLeg': 1.025},
    },
}

ALIASES = {'midnight': 'medium', 'brick': 'large', 'scout': 'small',
           'small': 'small', 'medium': 'medium', 'large': 'large'}
PROTECTED = ('Root', 'Body', 'Hips')
LOWER_BODY = PROTECTED + ('UpperLeg.L', 'UpperLeg.R', 'LowerLeg.L',
                         'LowerLeg.R', 'Foot.L', 'Foot.R', 'PT.L', 'PT.R')


def _factor(mapping, name):
    return mapping.get(name, mapping.get(name.rsplit('.', 1)[0], 1.0))


def _snapshot(rig):
    return {bone.name: {'parent': bone.parent.name if bone.parent else None,
                        'head': bone.head_local.copy(),
                        'tail': bone.tail_local.copy(),
                        'matrix': bone.matrix_local.copy(),
                        'length': bone.length,
                        'connected': bone.use_connect}
            for bone in rig.data.bones}


def _metrics(bones, uniform_scale=1.0):
    span = (bones['UpperArm.L']['head'] - bones['UpperArm.R']['head']).length
    return {
        'shoulder_joint_span': span * uniform_scale,
        'hip_joint_span': (bones['UpperLeg.L']['head'] - bones['UpperLeg.R']['head']).length * uniform_scale,
        'arm_chain_length': sum(bones[name]['length'] for name in ('UpperArm.L', 'LowerArm.L', 'Wrist.L')) * uniform_scale,
        'leg_chain_length': sum(bones[name]['length'] for name in ('UpperLeg.L', 'LowerLeg.L')) * uniform_scale,
        'torso_chain_length': sum(bones[name]['length'] for name in ('Hips', 'Abdomen', 'Torso', 'Chest')) * uniform_scale,
        'head_joint_height': bones['Head']['head'].z * uniform_scale,
    }


def _ankle_offsets(rig, action):
    """Capture actual ankle/foot alignment independently of object scale."""
    scene = bpy.context.scene
    saved_frame, saved_subframe = scene.frame_current, scene.frame_subframe
    samples = {}
    if action:
        frames = range(math.floor(action.frame_range[0]), math.ceil(action.frame_range[1]) + 1)
    else:
        frames = [saved_frame]
    for frame in frames:
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        samples[frame] = {side: rig.pose.bones['Foot.' + side].head - rig.pose.bones['LowerLeg.' + side].tail
                          for side in ('L', 'R')}
    scene.frame_set(saved_frame, subframe=saved_subframe)
    bpy.context.view_layer.update()
    return samples


def apply_proportions(character, rig, meshes):
    """Apply one compatible rest profile and return JSON-serializable evidence.

    Call after styling creates all meshes, before positioning the characters.
    The object scale is uniform: animated foot translations and the entire
    skeleton scale together, without introducing scaled animation channels.
    """
    if rig.get('proportions_applied'):
        raise ValueError(f'{rig.name} already has a proportion profile')
    profile_id = ALIASES[character]
    profile = PROFILES[profile_id]
    old = _snapshot(rig)
    assert max(rig.scale) - min(rig.scale) < 1e-6, 'Expected uniform initial rig scale'
    action = rig.animation_data.action if rig.animation_data else None
    old_ankle_offsets = _ankle_offsets(rig, action)
    initial_scale = float(rig.scale.x)
    rig.data = rig.data.copy()
    rig.data.name = 'Humanoid_' + profile_id.capitalize()

    # Keep every rest axis unchanged. Move children by their parent's length
    # change in its old local Y axis, then apply their own length factor.
    # Leg lengths and rotations remain unchanged; any stance change is a
    # paired lateral translation applied after this upper-body calculation.
    proposed = {}

    def propose(name):
        if name in proposed:
            return proposed[name]
        bone = old[name]
        parent = bone['parent']
        head = bone['head'].copy()
        if parent:
            parent_new = propose(parent)
            local = old[parent]['matrix'].inverted() @ head
            local.y *= _factor(profile['lengths'], parent)
            head = parent_new['matrix'] @ local
        if name.startswith('Shoulder.'):
            chest_head = proposed['Chest']['head']
            head.x = chest_head.x + (head.x - chest_head.x) * profile['shoulder_anchor_width']
        matrix = bone['matrix'].copy()
        matrix.translation = head
        length = bone['length'] * _factor(profile['lengths'], name)
        tail = head + (bone['tail'] - bone['head']).normalized() * length
        proposed[name] = {'head': head, 'tail': tail, 'matrix': matrix, 'length': length}
        return proposed[name]

    for name in old:
        propose(name)
    # Recomputing an unchanged chain can accumulate floating point noise.
    # Preserve these source transforms bit-for-bit where possible.
    for name in LOWER_BODY:
        proposed[name].update({key: old[name][key].copy() if hasattr(old[name][key], 'copy') else old[name][key]
                               for key in ('head', 'tail', 'matrix', 'length')})

    hip_center = (old['UpperLeg.L']['head'].x + old['UpperLeg.R']['head'].x) / 2
    stance_shifts = {}
    for side in ('L', 'R'):
        shift = Vector(((old['UpperLeg.' + side]['head'].x - hip_center) *
                        (profile['hip_anchor_width'] - 1), 0, 0))
        for prefix in ('UpperLeg', 'LowerLeg', 'Foot', 'PT'):
            name = prefix + '.' + side
            stance_shifts[name] = shift
            proposed[name]['head'] += shift
            proposed[name]['tail'] += shift
            proposed[name]['matrix'].translation += shift

    previous_active = bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name, bone in old.items():
        if name in LOWER_BODY:
            if name in stance_shifts and stance_shifts[name].length:
                rig.data.edit_bones[name].translate(stance_shifts[name])
            continue
        if profile_id == 'medium':
            continue
        edit = rig.data.edit_bones[name]
        edit.use_connect = False
        edit.matrix = proposed[name]['matrix']
        edit.length = proposed[name]['length']
    for name, bone in old.items():
        if name not in LOWER_BODY and profile_id != 'medium':
            rig.data.edit_bones[name].use_connect = bone['connected']
    bpy.ops.object.mode_set(mode='OBJECT')
    new = _snapshot(rig)

    # A bone rest matrix encodes orientation and origin but not bone length.
    # Include the length ratio along local Y plus an optional radial change.
    # Blend the maps by the original deform weights so garment seams and
    # joint transitions follow the same deformation as the body underneath.
    maps = {}
    for name, bone in old.items():
        radial = _factor(profile['radial'], name)
        axial = new[name]['length'] / bone['length']
        stretch = Matrix.Diagonal((radial, axial, radial, 1.0))
        maps[name] = new[name]['matrix'] @ stretch @ bone['matrix'].inverted()
    inverse_rig = rig.matrix_world.inverted()
    vertex_count = 0
    weighted_vertices = 0
    max_vertex_change = 0.0
    for obj in meshes:
        assert obj.type == 'MESH'
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        to_rig = inverse_rig @ obj.matrix_world
        from_rig = to_rig.inverted()
        groups = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            point = to_rig @ vertex.co
            influences = [(maps[groups[g.group]], g.weight) for g in vertex.groups
                          if groups.get(g.group) in maps and g.weight > 0]
            total = sum(weight for _, weight in influences)
            if total:
                moved = sum((matrix @ point * weight for matrix, weight in influences), Vector()) / total
                max_vertex_change = max(max_vertex_change, (moved - point).length)
                vertex.co = from_rig @ moved
                weighted_vertices += 1
            vertex_count += 1
        obj.data.update()

    scale = profile['uniform_scale']
    rig.scale *= scale
    rig['proportions_applied'] = True
    rig['body_profile'] = profile_id
    rig['body_profile_label'] = profile['label']
    rig['shared_animation'] = 'Run'
    bpy.context.view_layer.update()
    if previous_active and previous_active.name in bpy.context.view_layer.objects:
        bpy.context.view_layer.objects.active = previous_active

    orientation_error = max(abs(old[name]['matrix'][row][column] - new[name]['matrix'][row][column])
                            for name in old for row in range(3) for column in range(3))
    protected_error = max(abs(old[name]['matrix'][row][column] - new[name]['matrix'][row][column])
                          for name in PROTECTED for row in range(4) for column in range(4))
    lower_body_length_error = max(abs(old[name]['length'] - new[name]['length']) for name in LOWER_BODY)
    new_ankle_offsets = _ankle_offsets(rig, action)
    ankle_error = max((old_ankle_offsets[frame][side] - new_ankle_offsets[frame][side]).length
                      for frame in old_ankle_offsets for side in ('L', 'R'))
    assert orientation_error < 1e-5, f'Rest axes changed: {orientation_error}'
    assert protected_error < 1e-6, f'Lower-body reference anchors changed: {protected_error}'
    assert lower_body_length_error < 1e-6, f'Lower-body bone lengths changed: {lower_body_length_error}'
    assert ankle_error < 1e-5, f'Clip needs stance retargeting: ankle-to-foot alignment changed by {ankle_error}'
    assert [old[name]['parent'] for name in old] == [new[name]['parent'] for name in old]
    assert (rig.animation_data.action if rig.animation_data else None) is action
    return {
        'id': profile_id, **profile,
        'strategy': 'Compatible rest proportions, weighted rest-mesh rebasing, uniform whole-character scale',
        'shared_action_preserved': True,
        'bone_names_and_parents_preserved': True,
        'rest_axis_max_matrix_error': orientation_error,
        'protected_lower_body_max_matrix_error': protected_error,
        'protected_reference_bones': list(PROTECTED),
        'lower_body_max_length_error': lower_body_length_error,
        'hip_stance_lateral_offsets': {name: list(delta) for name, delta in stance_shifts.items()},
        'ankle_foot_offset_max_error': ankle_error,
        'ankle_foot_offset_sample_count': len(old_ankle_offsets),
        'lower_body_note': 'Leg bone lengths remain unchanged. Hip width shifts each leg chain and its Root-child Foot/PT nodes laterally together; the Run preserves the lateral axis, and all sampled ankle-to-foot offsets match the source. Other clips require the same validation or stance retargeting. Uniform scale changes skeleton, mesh, stride and foot translations together; independent leg-length edits require contact-aware retargeting.',
        'source_local_metrics': _metrics(old),
        'profile_local_metrics': _metrics(new),
        'physical_metrics': _metrics(new, initial_scale * scale),
        'rest_bone_lengths': {name: bone['length'] for name, bone in new.items()},
        'mesh_vertices': vertex_count, 'rebased_weighted_vertices': weighted_vertices,
        'max_mesh_rest_displacement': max_vertex_change,
    }
