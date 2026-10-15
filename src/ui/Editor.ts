import { ARENAS } from '../data/arenas';
import { TUNING } from '../data/tuning';
import { MATERIALS } from '../data/materials';
import { ARENA_LIMITS, EDITOR_PROP_TYPES, parseArenaJSON, validateArena } from '../data/arenaValidation';
import type { ArenaData, ArenaProp } from '../sim/types';
import { html } from './Menu';

type Tool = 'paint' | 'erase' | 'prop' | 'spawn' | 'weapon' | 'remove';
interface EditorActions { back: () => void; test: (arena: ArenaData) => void }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function newArena(width = 80, height = 40): ArenaData {
  const tileSize = 24, ground = height - 3;
  const tiles = Array<number>(width * height).fill(0);
  for (let row = ground; row < height; row++) for (let col = 0; col < width; col++) tiles[row * width + col] = row === height - 1 ? 6 : 1;
  return { id: 'custom-workshop', name: 'Workshop', subtitle: 'A custom battleground', background: '', width, height, tileSize, tiles,
    spawns: Array.from({ length: 4 }, (_, index) => ({ x: (6 + (width - 12) * index / 3) * tileSize, y: ground * tileSize - TUNING.fighter.height / 2 })),
    props: [], weaponSpawns: [{ x: width * tileSize / 2, y: ground * tileSize - 22 }],
    spawnTable: [{ weapon: 'shotgun', weight: 2 }, { weapon: 'smg', weight: 2 }, { weapon: 'grenade', weight: 1 }, { weapon: 'health', weight: 1 }],
  };
}

/** Standalone canvas authoring UI. Testing always runs a copy, preserving the editable map. */
export class ArenaEditor {
  arena: ArenaData = newArena();
  private tool: Tool = 'paint';
  private material = 2;
  private brush = 1;
  private propType: string = 'crate';
  private propWidth = 2;
  private propHeight = 2;
  private travelX = 6;
  private travelY = 0;
  private undo: ArenaData[] = [];
  private redo: ArenaData[] = [];
  private canvas?: HTMLCanvasElement;
  private dragging = false;
  private dragErase = false;
  private lastCell?: { col: number; row: number };
  private visible = false;
  constructor(private root: HTMLElement, private actions: EditorActions) {
    try { const saved = localStorage.getItem('rivetfall.editor'); if (saved) this.arena = parseArenaJSON(saved); } catch { /* Invalid or unavailable drafts never prevent opening the editor. */ }
  }
  show(): void { this.visible = true; this.render(); }
  hide(): void { this.visible = false; this.dragging = false; }
  load(arena: ArenaData): void {
    const validated = validateArena(arena); if (!validated.arena) throw new Error(validated.errors.join('\n'));
    this.remember(); this.arena = validated.arena; this.show();
  }
  private remember(): void { this.undo.push(copy(this.arena)); if (this.undo.length > 25) this.undo.shift(); this.redo = []; }
  private notify(message: string, error = false): void {
    const status = this.root.querySelector<HTMLElement>('.editor-status');
    if (status) { status.textContent = message; status.classList.toggle('error', error); }
  }
  private validated(): ArenaData | undefined {
    const result = validateArena(this.arena);
    if (!result.arena) this.notify(result.errors.slice(0, 3).join(' '), true);
    return result.arena;
  }
  private async importFile(file?: File): Promise<void> {
    if (!file) return;
    try {
      if (file.size > ARENA_LIMITS.maxBytes) throw new Error('Arena files must be smaller than 2 MiB.');
      const arena = parseArenaJSON(await file.text());
      this.remember(); this.arena = arena; this.render(); this.notify(`Loaded ${arena.name}. ${arena.width} × ${arena.height} tiles, ${arena.spawns.length} fighter spawns.`);
    } catch (error) { this.notify(error instanceof Error ? error.message : 'Could not load this arena.', true); }
  }
  private save(): void {
    const arena = this.validated(); if (!arena) return;
    const json = JSON.stringify(arena, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${arena.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { localStorage.setItem('rivetfall.editor', json); } catch { /* Download remains usable when local persistence is denied. */ }
    this.notify('Arena JSON saved. Your valid draft is also kept in this browser when storage is available.');
  }
  private action(action: string): void {
    if (action === 'back') { this.hide(); this.actions.back(); }
    if (action === 'save') this.save();
    if (action === 'load') this.root.querySelector<HTMLInputElement>('#arena-file')?.click();
    if (action === 'test') { const arena = this.validated(); if (arena) { this.hide(); this.actions.test(arena); } }
    if (action === 'undo' && this.undo.length) { this.redo.push(copy(this.arena)); this.arena = this.undo.pop()!; this.render(); }
    if (action === 'redo' && this.redo.length) { this.undo.push(copy(this.arena)); this.arena = this.redo.pop()!; this.render(); }
    if (action === 'new') {
      const width = Number(this.root.querySelector<HTMLInputElement>('#arena-width')?.value), height = Number(this.root.querySelector<HTMLInputElement>('#arena-height')?.value);
      if (!Number.isInteger(width) || width < 20 || width > 160 || !Number.isInteger(height) || height < 12 || height > 100) { this.notify('Choose a width of 20–160 and a height of 12–100 tiles.', true); return; }
      this.remember(); this.arena = newArena(width, height); this.render(); this.notify('New arena ready. Undo restores your previous layout.');
    }
    if (action === 'copy') {
      const id = this.root.querySelector<HTMLSelectElement>('#arena-template')?.value, source = ARENAS.find(a => a.id === id);
      if (!source) return;
      this.remember(); this.arena = copy(source); this.arena.id = `custom-${source.id.replace(/^custom-/, '').slice(0, 50)}`; this.arena.name = `${source.name} Remix`.slice(0, 80); this.render(); this.notify('Copied arena. The original stays untouched.');
    }
  }
  private render(): void {
    if (!this.visible) return;
    const movementProp = ['moving-platform', 'elevator'].includes(this.propType);
    this.root.dataset.screen = 'editor';
    this.root.innerHTML = `<section class="screen screen-editor" aria-label="Arena editor"><div class="screen-heading"><div><div class="eyebrow">THE WORKSHOP / BUILD YOUR OWN BATTLEGROUND</div><h1>MAKE SOME BREAKABLE THINGS.</h1></div><button class="text-button" data-editor-action="back">← MAIN MENU</button></div><div class="editor-topbar"><label class="field editor-name"><span>Arena name</span><input id="arena-name" maxlength="80" value="${html(this.arena.name)}"/></label><label class="field"><span>Template</span><select id="arena-template" aria-label="Arena template">${ARENAS.filter(a => !a.id.startsWith('custom-')).map(a => `<option value="${a.id}">${html(a.name)}</option>`).join('')}</select></label><button class="secondary-button" data-editor-action="copy">COPY ARENA</button><label class="field editor-dimension"><span>Width</span><input id="arena-width" type="number" min="20" max="160" value="${this.arena.width}"/></label><label class="field editor-dimension"><span>Height</span><input id="arena-height" type="number" min="12" max="100" value="${this.arena.height}"/></label><button class="secondary-button" data-editor-action="new">NEW</button></div><div class="editor-layout"><aside class="editor-tools"><div class="section-line"><span>TOOLS</span><span>CLICK + DRAG</span></div><div class="tool-buttons">${([['paint', 'Paint terrain'], ['erase', 'Erase terrain'], ['prop', 'Place prop'], ['spawn', 'Fighter spawn'], ['weapon', 'Weapon spawn'], ['remove', 'Remove object']] as [Tool, string][]).map(([id, label]) => `<button data-tool="${id}" class="${this.tool === id ? 'selected' : ''}" aria-pressed="${this.tool === id}">${label}</button>`).join('')}</div><div class="tool-options">${this.tool === 'paint' || this.tool === 'erase' ? `<label class="field"><span>Brush size</span><select id="brush-size" aria-label="Brush size">${[1, 3, 5].map(n => `<option ${this.brush === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><div class="material-palette">${Object.values(MATERIALS).map(m => `<button data-material="${m.id}" class="${m.id === this.material ? 'selected' : ''}" style="--material:#${m.debrisColor.toString(16).padStart(6, '0')}" aria-label="Paint ${m.name}" aria-pressed="${m.id === this.material}"><i></i>${html(m.name)}</button>`).join('')}</div>` : this.tool === 'prop' ? `<label class="field"><span>Prop type</span><select id="prop-type" aria-label="Prop type">${EDITOR_PROP_TYPES.map(p => `<option value="${p}" ${this.propType === p ? 'selected' : ''}>${p.replaceAll('-', ' ')}</option>`).join('')}</select></label><div class="prop-dimensions"><label class="field"><span>Width / tiles</span><input id="prop-width" type="number" min="1" max="16" value="${this.propWidth}"/></label><label class="field"><span>Height / tiles</span><input id="prop-height" type="number" min="1" max="30" value="${this.propHeight}"/></label></div>${movementProp ? `<div class="prop-dimensions"><label class="field"><span>Travel X / tiles</span><input id="prop-travel-x" type="number" min="-30" max="30" value="${this.travelX}"/></label><label class="field"><span>Travel Y / tiles</span><input id="prop-travel-y" type="number" min="-30" max="30" value="${this.travelY}"/></label></div>` : ''}<p>Click to place. Ladders, ropes, and lights attach to the solid tile just above them when available.</p>` : `<p>${this.tool === 'spawn' ? 'Place 2–16 fighter starts. Keep the full outlined body clear of terrain. The match cycles through these points.' : this.tool === 'weapon' ? 'Place a pickup point. All points use the arena’s weighted weapon and supply pool.' : 'Click a prop or marker to remove it. This does not erase terrain.'}</p>`}</div><div class="editor-history"><button class="secondary-button" data-editor-action="undo" ${this.undo.length ? '' : 'disabled'}>UNDO</button><button class="secondary-button" data-editor-action="redo" ${this.redo.length ? '' : 'disabled'}>REDO</button></div><p class="editor-help">Right-drag erases terrain with any tool. Undo restores the last stroke, object, or map replacement.</p></aside><div class="editor-workspace"><div class="editor-canvas-wrap"><canvas id="editor-canvas" aria-label="Arena painting canvas" tabindex="0"></canvas></div><div class="editor-canvas-footer"><span class="editor-counts"></span><span>AMBER = FIGHTER · CYAN = PICKUP</span></div><div class="editor-status" role="status">Paint terrain, place props, and test your layout. Save and test both validate fighter spawn clearance.</div></div></div><div class="editor-bottom"><div><button class="secondary-button" data-editor-action="load">LOAD JSON</button><button class="secondary-button" data-editor-action="save">SAVE JSON</button><input id="arena-file" type="file" accept="application/json,.json" hidden/></div><button class="primary-button" data-editor-action="test">TEST ARENA <span>→</span></button></div></section>`;
    this.canvas = this.root.querySelector<HTMLCanvasElement>('#editor-canvas')!;
    this.canvas.width = this.arena.width * 12; this.canvas.height = this.arena.height * 12;
    this.root.querySelectorAll<HTMLElement>('[data-editor-action]').forEach(button => button.addEventListener('click', () => this.action(button.dataset.editorAction!)));
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach(button => button.addEventListener('click', () => { this.tool = button.dataset.tool as Tool; this.render(); }));
    this.root.querySelectorAll<HTMLElement>('[data-material]').forEach(button => button.addEventListener('click', () => { this.material = Number(button.dataset.material); this.tool = 'paint'; this.render(); }));
    this.root.querySelector<HTMLInputElement>('#arena-name')!.addEventListener('change', event => {
      this.remember(); this.arena.name = (event.target as HTMLInputElement).value.trim() || 'Workshop'; this.arena.id = `custom-${this.arena.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'workshop'}`; this.updateCounts();
    });
    this.root.querySelector<HTMLInputElement>('#arena-file')!.addEventListener('change', event => { void this.importFile((event.target as HTMLInputElement).files?.[0]); });
    this.root.querySelector<HTMLSelectElement>('#brush-size')?.addEventListener('change', event => { this.brush = Number((event.target as HTMLSelectElement).value); });
    this.root.querySelector<HTMLSelectElement>('#prop-type')?.addEventListener('change', event => {
      this.propType = (event.target as HTMLSelectElement).value;
      this.propWidth = ['moving-platform', 'elevator'].includes(this.propType) ? 4 : ['rope', 'ladder', 'door', 'support'].includes(this.propType) ? 1 : 2;
      this.propHeight = ['rope', 'ladder'].includes(this.propType) ? 6 : ['door', 'support'].includes(this.propType) ? 4 : ['moving-platform', 'elevator', 'hanging-light'].includes(this.propType) ? 1 : 2;
      this.travelX = this.propType === 'elevator' ? 0 : 6; this.travelY = this.propType === 'elevator' ? -6 : 0; this.render();
    });
    for (const [id, key, min, max] of [['prop-width', 'propWidth', 1, 16], ['prop-height', 'propHeight', 1, 30], ['prop-travel-x', 'travelX', -30, 30], ['prop-travel-y', 'travelY', -30, 30]] as const) this.root.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('change', event => { const value = Number((event.target as HTMLInputElement).value); if (Number.isFinite(value)) this[key] = Math.max(min, Math.min(max, Math.round(value))); });
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault(); this.canvas!.setPointerCapture(event.pointerId); this.remember(); this.dragging = true; this.dragErase = event.button === 2; this.lastCell = undefined; this.paintPointer(event);
    });
    this.canvas.addEventListener('pointermove', event => { if (this.dragging && (this.dragErase || this.tool === 'paint' || this.tool === 'erase')) this.paintPointer(event); });
    const finish = (): void => { this.dragging = false; this.lastCell = undefined; this.updateCounts(); };
    this.canvas.addEventListener('pointerup', finish); this.canvas.addEventListener('pointercancel', finish);
    this.draw();
  }
  private paintPointer(event: PointerEvent): void {
    const bounds = this.canvas!.getBoundingClientRect();
    const col = Math.floor((event.clientX - bounds.left) / bounds.width * this.arena.width), row = Math.floor((event.clientY - bounds.top) / bounds.height * this.arena.height);
    if (col < 0 || row < 0 || col >= this.arena.width || row >= this.arena.height) return;
    if (this.dragErase || this.tool === 'paint' || this.tool === 'erase') {
      const previous = this.lastCell ?? { col, row }, steps = Math.max(1, Math.abs(col - previous.col), Math.abs(row - previous.row));
      for (let i = 0; i <= steps; i++) this.paintCell(Math.round(previous.col + (col - previous.col) * i / steps), Math.round(previous.row + (row - previous.row) * i / steps));
    } else this.place(col, row);
    this.lastCell = { col, row }; this.draw();
  }
  private paintCell(col: number, row: number): void {
    const radius = Math.floor(this.brush / 2);
    for (let y = row - radius; y <= row + radius; y++) for (let x = col - radius; x <= col + radius; x++) if (x >= 0 && y >= 0 && x < this.arena.width && y < this.arena.height) this.arena.tiles[y * this.arena.width + x] = this.dragErase || this.tool === 'erase' ? 0 : this.material;
  }
  private place(col: number, row: number): void {
    const size = this.arena.tileSize, x = (col + 0.5) * size, y = (row + 0.5) * size;
    if (this.tool === 'spawn' || this.tool === 'weapon') {
      const target = this.tool === 'spawn' ? this.arena.spawns : this.arena.weaponSpawns, limit = this.tool === 'spawn' ? ARENA_LIMITS.maxSpawns : ARENA_LIMITS.maxWeaponSpawns;
      if (target.length >= limit) { this.notify(`Maximum ${limit} ${this.tool === 'spawn' ? 'fighter' : 'weapon'} spawns. Remove one first.`, true); return; }
      target.push({ x, y: this.tool === 'spawn' ? (row + 1) * size - TUNING.fighter.height / 2 : y });
    } else if (this.tool === 'prop') {
      if (this.arena.props.length >= ARENA_LIMITS.maxProps) { this.notify('Maximum 256 props. Remove one first.', true); return; }
      const width = this.propWidth * size, height = this.propHeight * size;
      if (col * size + width > this.arena.width * size || row * size + height > this.arena.height * size) { this.notify('This prop would extend outside the arena.', true); return; }
      const prop: ArenaProp = { id: this.arena.props.reduce((n, p) => Math.max(n, p.id + 1), 0), type: this.propType, x: col * size, y: row * size, width, height };
      if (['moving-platform', 'elevator'].includes(this.propType)) { prop.travelX = this.travelX * size; prop.travelY = this.travelY * size; prop.periodTicks = 240; }
      const anchorCol = Math.floor((prop.x + width / 2) / size), anchorRow = row - 1;
      if (['ladder', 'rope', 'hanging-light'].includes(this.propType) && anchorRow >= 0 && this.arena.tiles[anchorRow * this.arena.width + anchorCol]) { prop.anchorCol = anchorCol; prop.anchorRow = anchorRow; }
      this.arena.props.push(prop);
    } else if (this.tool === 'remove') {
      for (const points of [this.arena.spawns, this.arena.weaponSpawns]) { const index = points.findIndex(p => Math.hypot(p.x - x, p.y - y) < size); if (index >= 0) { points.splice(index, 1); return; } }
      let index = -1; for (let i = this.arena.props.length - 1; i >= 0; i--) { const p = this.arena.props[i]; if (x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height) { index = i; break; } }
      if (index >= 0) this.arena.props.splice(index, 1);
    }
  }
  private updateCounts(): void {
    const counts = this.root.querySelector('.editor-counts'); if (counts) counts.textContent = `${this.arena.width} × ${this.arena.height} TILES · ${this.arena.spawns.length} STARTS · ${this.arena.props.length} PROPS · ${this.arena.weaponSpawns.length} PICKUPS`;
    const undo = this.root.querySelector<HTMLButtonElement>('[data-editor-action="undo"]'); if (undo) undo.disabled = !this.undo.length;
    const redo = this.root.querySelector<HTMLButtonElement>('[data-editor-action="redo"]'); if (redo) redo.disabled = !this.redo.length;
  }
  private draw(): void {
    const canvas = this.canvas; if (!canvas) return;
    const context = canvas.getContext('2d')!; const tile = 12, scale = tile / this.arena.tileSize;
    context.fillStyle = '#10212b'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < this.arena.height; row++) for (let col = 0; col < this.arena.width; col++) {
      const material = MATERIALS[this.arena.tiles[row * this.arena.width + col]];
      if (material) { context.fillStyle = `#${material.debrisColor.toString(16).padStart(6, '0')}`; context.fillRect(col * tile, row * tile, tile, tile); context.fillStyle = '#ffffff18'; context.fillRect(col * tile, row * tile, tile, 1); }
    }
    context.strokeStyle = '#52748324'; context.lineWidth = 0.5; context.beginPath();
    for (let col = 0; col <= this.arena.width; col++) { context.moveTo(col * tile, 0); context.lineTo(col * tile, canvas.height); }
    for (let row = 0; row <= this.arena.height; row++) { context.moveTo(0, row * tile); context.lineTo(canvas.width, row * tile); } context.stroke();
    context.font = '9px monospace'; context.textAlign = 'center';
    for (const prop of this.arena.props) {
      const x = prop.x * scale, y = prop.y * scale, w = prop.width * scale, h = prop.height * scale;
      context.fillStyle = prop.type === 'barrel' ? '#b55b43aa' : '#839ca34d'; context.fillRect(x, y, w, h);
      context.strokeStyle = prop.type === 'barrel' ? '#ff8c61' : '#9bbac4'; context.strokeRect(x + .5, y + .5, w - 1, h - 1);
      context.fillStyle = '#e4eef2'; context.fillText(prop.type.slice(0, 3).toUpperCase(), x + w / 2, y + h / 2 + 3);
      if (typeof prop.travelX === 'number' || typeof prop.travelY === 'number') { context.setLineDash([4, 4]); context.beginPath(); context.moveTo(x + w / 2, y + h / 2); context.lineTo(x + w / 2 + Number(prop.travelX ?? 0) * scale, y + h / 2 + Number(prop.travelY ?? 0) * scale); context.stroke(); context.setLineDash([]); }
    }
    for (const [index, spawn] of this.arena.spawns.entries()) {
      context.fillStyle = '#ffb74d66'; context.strokeStyle = '#ffb74d'; context.fillRect((spawn.x - TUNING.fighter.width / 2) * scale, (spawn.y - TUNING.fighter.height / 2) * scale, TUNING.fighter.width * scale, TUNING.fighter.height * scale); context.strokeRect((spawn.x - TUNING.fighter.width / 2) * scale, (spawn.y - TUNING.fighter.height / 2) * scale, TUNING.fighter.width * scale, TUNING.fighter.height * scale); context.fillStyle = '#ffdc9b'; context.fillText(`P${index + 1}`, spawn.x * scale, (spawn.y - 25) * scale);
    }
    for (const spawn of this.arena.weaponSpawns) { context.strokeStyle = '#68e2df'; context.lineWidth = 2; context.beginPath(); context.moveTo(spawn.x * scale - 4, spawn.y * scale); context.lineTo(spawn.x * scale + 4, spawn.y * scale); context.moveTo(spawn.x * scale, spawn.y * scale - 4); context.lineTo(spawn.x * scale, spawn.y * scale + 4); context.stroke(); }
    this.updateCounts();
  }
}
