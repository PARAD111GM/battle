"""Rebind a compatible source mesh to the canonical humanoid rest skeleton.

Run within Blender. The imported female Quaternius models have the same 62
joint names and hierarchy as the male sources, but different bind transforms.
Moving the mesh into the target bind space lets all variants use the same
local animation Action after body proportion edits. Source files remain intact.
"""
from math import isfinite

from mathutils import Matrix, Vector


def _hierarchy(rig):
    return [(bone.name, bone.parent.name if bone.parent else None)
            for bone in rig.data.bones]


def _rest_signature(rig):
    return [(bone.name, tuple(value for row in bone.matrix_local for value in row),
             float(bone.length)) for bone in rig.data.bones]


def normalize_source(source, target_rig, scale_bone_lengths=True):
    """Convert raw vertex positions from source bind space to target bind space.

    ``source`` is the builder's import_source() dictionary. Only mesh vertices
    and stale custom normals change. Parents, modifiers, rigs, and Actions stay
    untouched; the caller then parents selected meshes to ``target_rig`` and
    redirects their armature modifiers, preserving mesh world transforms.

    Each vertex is mapped by its existing skin weights from the source bone
    head/long axis to the corresponding target head/long axis. A shortest-arc
    rotation preserves the mesh cross section: these source rigs differ by 90
    degrees of arbitrary local bone roll at the thighs, so directly multiplying
    full bind matrices would twist the anatomy. The mesh is rebound to the
    target's complete bind matrices only when the caller changes its modifier.
    Optional limb length scaling uses named anatomical joint positions, never
    Blender's inferred bone tails. Object/armature transforms are included.
    """
    source_rig = source['rig']
    assert _hierarchy(source_rig) == _hierarchy(target_rig), 'Source joint hierarchy differs'
    source_signature = _rest_signature(source_rig)
    target_signature = _rest_signature(target_rig)
    transforms = {}
    ratios = {}
    next_joint = {**{f'UpperArm.{side}': f'LowerArm.{side}' for side in ('L', 'R')},
                  **{f'LowerArm.{side}': f'Wrist.{side}' for side in ('L', 'R')},
                  **{f'UpperLeg.{side}': f'LowerLeg.{side}' for side in ('L', 'R')},
                  **{f'LowerLeg.{side}': f'Foot.{side}' for side in ('L', 'R')}}
    max_rest_rotation_difference = 0.0
    max_rest_axis_alignment_error = 0.0
    max_anatomical_joint_mapping_error = 0.0
    for source_bone in source_rig.data.bones:
        target_bone = target_rig.data.bones[source_bone.name]
        ratio = 1.0
        if scale_bone_lengths and source_bone.name in next_joint:
            following = next_joint[source_bone.name]
            old_span = (source_rig.data.bones[following].head_local - source_bone.head_local).length
            new_span = (target_rig.data.bones[following].head_local - target_bone.head_local).length
            assert old_span > 1e-8, source_bone.name
            ratio = new_span / old_span
        assert isfinite(ratio) and ratio > 0, (source_bone.name, ratio)
        scale = Matrix.Diagonal((1.0, ratio, 1.0, 1.0))
        source_basis = source_bone.matrix_local.to_3x3().to_4x4()
        # Bone.y_axis is parent-relative. The source and canonical rigs use
        # different parent rolls, so comparing those axes would rotate an
        # otherwise straight upper arm away from its shoulder-to-elbow line.
        # Both directions must be in armature rest space, like the heads and
        # source_basis used by the surrounding affine transform.
        source_direction = (source_bone.tail_local - source_bone.head_local).normalized()
        target_direction = (target_bone.tail_local - target_bone.head_local).normalized()
        direction_rotation = source_direction.rotation_difference(target_direction)
        max_rest_axis_alignment_error = max(max_rest_axis_alignment_error,
            ((direction_rotation @ source_direction) - target_direction).length)
        transforms[source_bone.name] = (Matrix.Translation(target_bone.head_local)
            @ direction_rotation.to_matrix().to_4x4()
            @ source_basis @ scale @ source_basis.inverted()
            @ Matrix.Translation(-source_bone.head_local))
        if scale_bone_lengths and source_bone.name in next_joint:
            following = next_joint[source_bone.name]
            mapped_joint = transforms[source_bone.name] @ source_rig.data.bones[following].head_local
            max_anatomical_joint_mapping_error = max(max_anatomical_joint_mapping_error,
                (mapped_joint - target_rig.data.bones[following].head_local).length)
        ratios[source_bone.name] = ratio
        max_rest_rotation_difference = max(max_rest_rotation_difference,
            source_bone.matrix_local.to_quaternion().rotation_difference(
                target_bone.matrix_local.to_quaternion()).angle)
    assert max_rest_axis_alignment_error < 1e-5, 'Rebind rest axes do not align'
    assert max_anatomical_joint_mapping_error < 1e-5, 'Rebind limb endpoints do not align'

    meshes = []
    skipped = []
    for obj in source['meshes'].values():
        is_bound = any(mod.type == 'ARMATURE' and mod.object == source_rig for mod in obj.modifiers)
        if not is_bound:
            skipped.append(obj.name)
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        to_source = source_rig.matrix_world.inverted() @ obj.matrix_world
        from_target = obj.matrix_world.inverted() @ target_rig.matrix_world
        groups = {group.index: group.name for group in obj.vertex_groups}
        max_displacement = 0.0
        max_weight_error = 0.0
        for vertex in obj.data.vertices:
            point = to_source @ vertex.co
            total = 0.0
            converted = Vector((0.0, 0.0, 0.0))
            for group in vertex.groups:
                name = groups[group.group]
                if name not in transforms or group.weight <= 0:
                    continue
                converted += (transforms[name] @ point) * group.weight
                total += group.weight
            assert total > 1e-8, f'{obj.name} vertex {vertex.index} has no deform weights'
            converted /= total
            assert all(isfinite(value) for value in converted), (obj.name, vertex.index)
            updated = from_target @ converted
            max_displacement = max(max_displacement, (updated - vertex.co).length)
            max_weight_error = max(max_weight_error, abs(total - 1.0))
            vertex.co = updated
        if obj.data.has_custom_normals:
            obj.data.normals_split_custom_set([(0.0, 0.0, 0.0)] * len(obj.data.loops))
        obj.data.update()
        meshes.append({'name': obj.name, 'vertices': len(obj.data.vertices),
                       'max_vertex_displacement': max_displacement,
                       'max_source_weight_sum_error': max_weight_error})
    assert meshes, 'Source has no meshes bound to its armature'
    assert _rest_signature(source_rig) == source_signature, 'Source rig changed during conversion'
    assert _rest_signature(target_rig) == target_signature, 'Target rig changed during conversion'
    return {'method': 'skin-weighted joint-axis rebind with joint-distance limb length scaling'
                       if scale_bone_lengths else 'skin-weighted joint-axis rebind',
            'joint_count': len(transforms), 'matching_ordered_hierarchy': True,
            'source_rig': source_rig.name, 'target_rig': target_rig.name,
            'max_rest_rotation_difference_radians': max_rest_rotation_difference,
            'mesh_cross_section_orientation_preserved': True,
            'rest_axis_coordinate_space': 'armature',
            'max_rest_axis_alignment_error': max_rest_axis_alignment_error,
            'max_anatomical_joint_mapping_error': max_anatomical_joint_mapping_error,
            'bone_length_ratio_min': min(ratios.values()),
            'bone_length_ratio_max': max(ratios.values()),
            'scaled_limb_segments': {name: ratio for name, ratio in ratios.items() if abs(ratio - 1.0) > 1e-7},
            'meshes': meshes, 'skipped_unbound_meshes': skipped,
            'source_and_target_rigs_unchanged': True}
