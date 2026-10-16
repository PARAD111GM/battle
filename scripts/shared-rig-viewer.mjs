/*
 * Local comparison viewer for the shared humanoid rig prototype.
 * Rebuild with Three.js 0.180.0 installed under /tmp/rivetfall-three-tools:
 * NODE_PATH=/tmp/rivetfall-three-tools/node_modules ./node_modules/.bin/esbuild \
 *   scripts/shared-rig-viewer.mjs --bundle --minify --format=esm \
 *   --outfile=docs/art-direction/shared-rig/viewer.js --legal-comments=inline
 * Third-party license: docs/art-direction/shared-rig/THREE-LICENSE.txt.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const ui = {
  play: $('play'), speed: $('speed'), bones: $('bones'), side: $('side'),
  front: $('front'), reset: $('reset'), timeline: $('timeline'),
  status: $('status'), label: $('view-label'), details: $('details'),
};
const state = { ready: false, paused: matchMedia('(prefers-reduced-motion: reduce)').matches,
  speed: 1, time: 0, duration: 0, camera: 'three-quarter', bones: false, error: null };

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  ui.status.textContent = 'This preview needs a browser with WebGL enabled.';
  state.error = String(error);
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xeeede8);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label', 'Small female, medium male and large muscular male, animated with a shared run cycle');
renderer.domElement.setAttribute('role', 'img');
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeeede8);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.maxPolarAngle = Math.PI / 2 + 0.05;
controls.minDistance = 0.5;
controls.maxDistance = 30;

scene.add(new THREE.HemisphereLight(0xffffff, 0xa5a099, 2.1));
const key = new THREE.DirectionalLight(0xfff7eb, 3.1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.normalBias = 0.018;
key.shadow.bias = -0.0001;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xe1ebff, 0.9);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1.5);
scene.add(rim);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0xe3e3dc, roughness: 1, metalness: 0 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

let model, mixer;
const actions = [];
const rigHelpers = [];
const layoutRoots = [];
const profiles = [
  { name: 'SmallRig', label: 'Small', character: 'Katnip Neverdo', description: 'Female' },
  { name: 'MidnightRig', label: 'Medium', character: 'Mr. Midnight', description: 'Average male' },
  { name: 'BrickRig', label: 'Large', character: 'Brick Barrage', description: 'Muscular male' },
];
const size = new THREE.Vector3(4, 2, 2);
const center = new THREE.Vector3();
const target = new THREE.Vector3();
let modelHeight = 2;
// GLTF uses Y up. The generated Blender models face +Z after GLTF export.
let frontDirection = new THREE.Vector3(0, 0, 1);

function boxCorners(box) {
  return [box.min.x, box.max.x].flatMap((x) =>
    [box.min.y, box.max.y].flatMap((y) =>
      [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, y, z))));
}

function measureAnimationBounds() {
  // Measure real deformed vertices across the run, once on load. Cached mesh
  // bounds describe a single pose and can clip a swinging hand or raised foot.
  layoutRoots.forEach((entry) => { entry.motionBounds = new THREE.Box3(); });
  for (let frame = 0; frame < 48; frame++) {
    mixer.setTime(frame / 48 * state.duration);
    model.updateMatrixWorld(true);
    layoutRoots.forEach((entry) => entry.motionBounds.union(new THREE.Box3().setFromObject(entry.root, true)));
  }
  const bounds = new THREE.Box3();
  layoutRoots.forEach((entry) => bounds.union(entry.motionBounds));
  bounds.getSize(size);
  bounds.getCenter(center);
  modelHeight = size.y;
  floor.position.y = bounds.min.y - modelHeight * 0.002;
  target.set(center.x, bounds.min.y + modelHeight * 0.52, center.z);
  mixer.setTime(0);
  model.updateMatrixWorld(true);
}

function resize() {
  const { width, height } = stage.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (state.ready && state.camera !== 'custom') setCamera(state.camera);
}
new ResizeObserver(resize).observe(stage);
resize();

function setCamera(view = 'three-quarter') {
  state.camera = view;
  const isSide = view === 'side';
  const isFront = view === 'front';
  const direction = isSide ? new THREE.Vector3(-1, 0.13, 0)
    : isFront ? frontDirection.clone().add(new THREE.Vector3(0, 0.04, 0))
    : frontDirection.clone().multiplyScalar(1.0).add(new THREE.Vector3(-0.667, 0.178, 0));
  direction.normalize();
  // Turn the inspection camera and keep all three complete profiles abreast.
  // Only wrappers move; imported skeletons and animation tracks stay untouched.
  const horizontal = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
  const vertical = new THREE.Vector3().crossVectors(direction, horizontal).normalize();
  const allCorners = [];
  if (layoutRoots.length === profiles.length) {
    const intervals = layoutRoots.map(({ motionBounds, origin }) => {
      const projected = boxCorners(motionBounds).map((corner) => corner.sub(origin).dot(horizontal));
      return { min: Math.min(...projected), max: Math.max(...projected) };
    });
    const gap = modelHeight * 0.15;
    const totalWidth = intervals.reduce((sum, interval) => sum + interval.max - interval.min, 0) + gap * (layoutRoots.length - 1);
    let nextLeft = -totalWidth / 2;
    layoutRoots.forEach(({ wrapper, origin, motionBounds }, index) => {
      const interval = intervals[index];
      const offset = nextLeft - interval.min;
      nextLeft += interval.max - interval.min + gap;
      wrapper.position.x = center.x + horizontal.x * offset - origin.x;
      wrapper.position.z = center.z + horizontal.z * offset - origin.z;
      allCorners.push(...boxCorners(motionBounds).map((corner) => corner.add(wrapper.position)));
    });
    model.updateMatrixWorld(true);
  }
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  // Fit every corner in camera space, including perspective depth. A common
  // camera preserves the authored height/width differences between profiles.
  const distance = Math.max(modelHeight, ...allCorners.map((corner) => {
    const relative = corner.sub(target);
    const depth = relative.dot(direction);
    return Math.max(Math.abs(relative.dot(horizontal)) / Math.tan(horizontalFov / 2) + depth,
      Math.abs(relative.dot(vertical)) / Math.tan(verticalFov / 2) + depth);
  })) * 1.12;
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.near = Math.max(0.001, modelHeight / 1000);
  camera.far = Math.max(100, distance * 20);
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  controls.minDistance = modelHeight * 0.6;
  controls.maxDistance = distance * 3;
  controls.update();
  controls.saveState();
  ui.label.textContent = isSide ? 'Side view' : isFront ? 'Front view' : 'Three-quarter view';
  ui.side.setAttribute('aria-pressed', String(isSide));
  ui.front.setAttribute('aria-pressed', String(isFront));
}

function setPaused(value) {
  state.paused = Boolean(value);
  ui.play.textContent = state.paused ? 'Play' : 'Pause';
  ui.play.setAttribute('aria-label', state.paused ? 'Play animation' : 'Pause animation');
}
function seek(seconds) {
  if (!state.ready) return;
  const number = Number(seconds);
  state.time = Number.isFinite(number) ? ((number % state.duration) + state.duration) % state.duration : 0;
  mixer.setTime(state.time);
  model.updateMatrixWorld(true);
  rigHelpers.forEach((helper) => helper.updateMatrixWorld(true));
  ui.timeline.value = String(Math.round(state.time / state.duration * 1000));
}
function setSpeed(speed) {
  const number = Number(speed);
  if (!Number.isFinite(number)) return;
  state.speed = THREE.MathUtils.clamp(number, 0, 4);
  ui.speed.value = String(state.speed);
}
function setBones(visible) {
  state.bones = Boolean(visible);
  rigHelpers.forEach((helper) => { helper.visible = state.bones; });
  ui.bones.checked = state.bones;
}
function render() { renderer.render(scene, camera); }

ui.play.addEventListener('click', () => setPaused(!state.paused));
ui.speed.addEventListener('change', () => setSpeed(ui.speed.value));
ui.bones.addEventListener('change', () => setBones(ui.bones.checked));
ui.side.addEventListener('click', () => setCamera('side'));
ui.front.addEventListener('click', () => setCamera('front'));
ui.reset.addEventListener('click', () => setCamera());
ui.timeline.addEventListener('input', () => { setPaused(true); seek(Number(ui.timeline.value) / 1000 * state.duration); });
controls.addEventListener('start', () => {
  state.camera = 'custom';
  ui.label.textContent = 'Orbit view';
  ui.side.setAttribute('aria-pressed', 'false');
  ui.front.setAttribute('aria-pressed', 'false');
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !/INPUT|BUTTON|SELECT|TEXTAREA/.test(event.target.tagName)) {
    event.preventDefault();
    setPaused(!state.paused);
  }
});
setPaused(state.paused);

window.__SHARED_RIG_VIEWER__ = {
  getState: () => ({ ...state, animationCount: actions.length, skeletonCount: rigHelpers.length,
    profiles: layoutRoots.map(({ label, character, description, root, motionBounds }) => ({ label, character, description,
      root: root.name, scale: root.scale.toArray(), motionSize: motionBounds?.getSize(new THREE.Vector3()).toArray() })) }),
  inspectLayout: () => layoutRoots.map(({ label, root }) => {
    const bounds = new THREE.Box3().setFromObject(root, true);
    const projected = boxCorners(bounds).map((corner) => corner.project(camera));
    return { label, min: ['x', 'y'].map((axis) => Math.min(...projected.map((point) => point[axis]))),
      max: ['x', 'y'].map((axis) => Math.max(...projected.map((point) => point[axis]))) };
  }),
  pause: () => setPaused(true), play: () => setPaused(false), setSpeed, setBones,
  seek: (seconds) => { seek(seconds); render(); },
  setCamera: (view) => { setCamera(view); render(); },
  render,
};

new GLTFLoader().load(new URL('./shared-rig.glb', import.meta.url).href, (gltf) => {
  model = gltf.scene;
  scene.add(model);
  const characterNodes = profiles.map(({ name }) => model.getObjectByName(name));
  if (!characterNodes.every(Boolean)) throw new Error('The model must contain SmallRig, MidnightRig and BrickRig.');
  model.updateMatrixWorld(true);
  characterNodes.forEach((root, index) => {
      const wrapper = new THREE.Group();
      wrapper.name = `${root.name}_ViewerLayout`;
      const origin = root.getWorldPosition(new THREE.Vector3());
      root.parent.add(wrapper);
      wrapper.add(root);
      layoutRoots.push({ ...profiles[index], root, wrapper, origin });
    });
  const meshes = [];
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    meshes.push(object);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      material.envMapIntensity = 0.5;
      if (material.transparent) material.depthWrite = false;
    });
  });
  // Fit the supplied layout without changing character scales or bone transforms.
  const box = new THREE.Box3().setFromObject(model);
  box.getSize(size);
  box.getCenter(center);
  modelHeight = size.y;
  floor.position.y = box.min.y - modelHeight * 0.002;
  target.set(center.x, box.min.y + modelHeight * 0.52, center.z);
  key.position.set(center.x - modelHeight * 2.5, box.max.y + modelHeight * 2.5, center.z + modelHeight * 2.5);
  key.target.position.copy(target);
  key.shadow.camera.left = -modelHeight * 3;
  key.shadow.camera.right = modelHeight * 3;
  key.shadow.camera.top = modelHeight * 3;
  key.shadow.camera.bottom = -modelHeight * 3;
  key.shadow.camera.near = modelHeight * 0.1;
  key.shadow.camera.far = modelHeight * 12;
  key.shadow.camera.updateProjectionMatrix();
  fill.position.set(center.x + modelHeight * 3, box.max.y, center.z + modelHeight);
  rim.position.set(center.x, box.max.y + modelHeight * 2, center.z - modelHeight * 3);
  const roots = new Set();
  meshes.filter((mesh) => mesh.isSkinnedMesh).forEach((mesh) => {
    mesh.skeleton.bones.forEach((bone) => {
      if (!bone.parent?.isBone) roots.add(bone);
    });
  });
  roots.forEach((root) => {
    const helper = new THREE.SkeletonHelper(root);
    helper.material.depthTest = false;
    helper.material.depthWrite = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.85;
    helper.renderOrder = 10;
    helper.visible = false;
    scene.add(helper);
    rigHelpers.push(helper);
  });
  if (!gltf.animations.length) throw new Error('The model does not contain the run animation.');
  mixer = new THREE.AnimationMixer(model);
  const runClips = gltf.animations.filter((clip) => /(?:^|[|_ ])(?:Shared)?Run(?:\.\d+)?$/i.test(clip.name));
  (runClips.length ? runClips : [gltf.animations[0]]).forEach((clip) => {
    actions.push(mixer.clipAction(clip).play());
  });
  state.duration = Math.max(...actions.map((action) => action.getClip().duration));
  measureAnimationBounds();
  state.ready = true;
  state.error = null;
  ui.status.textContent = '';
  ui.details.textContent = `Shared run cycle · ${state.duration.toFixed(2)} s · Three body profiles`;
  [ui.play, ui.speed, ui.bones, ui.side, ui.front, ui.reset, ui.timeline].forEach((control) => { control.disabled = false; });
  seek(0);
  setCamera();
  render();
}, undefined, (error) => {
  state.error = String(error?.message || error);
  ui.status.textContent = location.protocol === 'file:'
    ? 'Open this preview through the local web server. The README has the launch command.'
    : 'The character model could not load. Keep shared-rig.glb beside viewer.html and viewer.js.';
});

let previous = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previous) / 1000, 0.1);
  previous = now;
  if (state.ready && !state.paused) seek(state.time + dt * state.speed);
  controls.update();
  render();
}
requestAnimationFrame(animate);
