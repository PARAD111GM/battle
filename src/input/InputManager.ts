import { neutralInput, type InputCommand } from '../sim/types';
export type BindingAction = 'left'|'right'|'up'|'down'|'jump'|'attack'|'shoot'|'throw'|'special'|'roll'|'block'|'interact'|'switch';
export const DEFAULT_BINDINGS: Record<BindingAction,string> = {left:'KeyA',right:'KeyD',up:'KeyW',down:'KeyS',jump:'Space',attack:'KeyJ',shoot:'KeyK',throw:'KeyG',special:'KeyQ',roll:'ShiftLeft',block:'KeyL',interact:'KeyE',switch:'KeyR'};
export class InputManager {
  readonly pressed = new Set<string>(); mouse = {x:0,y:0,active:false,left:false,right:false};
  bindings = {...DEFAULT_BINDINGS};
  constructor(private target: HTMLElement) {
    window.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,select,textarea,button'))return;this.pressed.add(e.code);if(['Space','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();});
    window.addEventListener('keyup',e=>this.pressed.delete(e.code));
    window.addEventListener('blur',()=>{this.pressed.clear();this.mouse.left=false;this.mouse.right=false;});
    target.addEventListener('pointermove',e=>{const r=target.getBoundingClientRect();this.mouse.x=e.clientX-r.left;this.mouse.y=e.clientY-r.top;this.mouse.active=true;});
    target.addEventListener('pointerdown',e=>{if(e.button===0)this.mouse.left=true;if(e.button===2)this.mouse.right=true;});
    window.addEventListener('pointerup',e=>{if(e.button===0)this.mouse.left=false;if(e.button===2)this.mouse.right=false;});
    target.addEventListener('contextmenu',e=>e.preventDefault());
  }
  keyboard(player=0, aimOrigin?:{x:number;y:number}): InputCommand {
    const p=this.pressed;const b=player===0?this.bindings:{left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',down:'ArrowDown',jump:'Numpad0',attack:'Numpad1',shoot:'Numpad2',throw:'Numpad3',special:'Numpad5',roll:'NumpadDecimal',block:'Numpad4',interact:'NumpadEnter',switch:'Numpad6'};
    const has=(a:BindingAction)=>p.has(b[a]);
    const x=Number(has('right'))-Number(has('left')), y=Number(has('down'))-Number(has('up'));
    let ax=x||1,ay=y;
    if(player===0&&this.mouse.active&&aimOrigin){ax=this.mouse.x-aimOrigin.x;ay=this.mouse.y-aimOrigin.y;}
    const len=Math.hypot(ax,ay)||1;
    return {moveX:x,moveY:y,aimX:ax/len,aimY:ay/len,jump:has('jump'),attack:has('attack')||(player===0&&this.mouse.right),shoot:has('shoot')||(player===0&&this.mouse.left),throw:has('throw'),special:has('special'),roll:has('roll'),block:has('block'),interact:has('interact'),switchWeapon:has('switch')?1:0};
  }
  gamepad(index:number):InputCommand {
    const pad=navigator.getGamepads?.()[index];if(!pad)return neutralInput();
    const dead=(v:number)=>Math.abs(v)>0.2?v:0;
    const x=dead(pad.axes[0]??0),y=dead(pad.axes[1]??0),ax=dead(pad.axes[2]??0),ay=dead(pad.axes[3]??0);
    const down=(i:number)=>pad.buttons[i]?.pressed??false;
    return {moveX:x,moveY:y,aimX:ax||x||1,aimY:ay,jump:down(0),attack:down(2),shoot:down(7),throw:down(5),special:down(3),roll:down(1),block:down(6),interact:down(4),switchWeapon:down(10)?1:0};
  }
}
