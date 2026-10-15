import type Phaser from 'phaser';
import { WEAPONS } from '../sim/weapons/definitions';

export const THROWABLE_COLORS:Record<string,number>={grenade:0x95ae76,molotov:0xcc8e53,'sticky-mine':0xe6856a,flashbang:0xd8e5d6,smoke:0x8eabb6};

/** All weapon views share this small original art adapter; unknown data entries get a useful generic silhouette. */
export function drawWeaponArt(g:Phaser.GameObjects.Graphics,id:string):void {
  const definition=WEAPONS[id];
  if(definition?.kind==='melee') {
    if(id==='unarmed')return;
    const reach=Math.min(39,Math.max(16,(definition.range||40)*0.5));
    g.fillStyle(0x18242a).fillRect(-4,-3,reach+6,6);
    if(id==='knife'||id==='machete') {
      g.fillStyle(0xc5dbd4).fillTriangle(5,-3,reach,-2,7,3);
      g.fillStyle(0x98b7ae).fillRect(5,-3,reach-11,5);
      g.fillStyle(0x624a39).fillRect(-4,-3,10,6);
      g.fillStyle(0xe0bc7b).fillRect(5,-5,2,10);
    } else {
      g.fillStyle(0xa17b4d).fillRect(-4,-2,reach,5);
      g.fillStyle(0xe3bc76).fillRect(-2,-2,8,5);
      if(id==='sledge'||id==='sledgehammer') {
        g.fillStyle(0x17252c).fillRect(reach-9,-11,17,23);
        g.fillStyle(0x93a49a).fillRect(reach-8,-10,15,19);
        g.fillStyle(0xd2dbbd).fillRect(reach-8,-10,15,4);
      } else g.fillStyle(0xc39c66).fillRoundedRect(reach-20,-4,22,9,3);
    }
    return;
  }
  const pistol=id==='pistol',shotgun=id==='shotgun',sniper=id==='sniper',launcher=id==='grenade-launcher';
  const length=pistol?18:sniper?44:launcher?33:shotgun?34:30;
  g.fillStyle(0x12232c).fillRect(-3,-5,length+5,launcher?14:10);
  g.fillStyle(0x95a7a2).fillRect(0,-5,length,launcher?7:4);
  g.fillStyle(0x3b5156).fillRect(0,-1,length,launcher?8:5);
  g.fillStyle(0x263840).fillRect(0,3,6,8);
  g.fillStyle(shotgun?0xa47a48:0xc7a766).fillRect(pistol?2:11,1,pistol?4:11,4);
  g.fillStyle(0x0e1a23).fillRect(length-2,-3,5,launcher?8:4);
  g.fillStyle(0xe2c58f).fillRect(2,-6,3,1);
  if(!pistol)g.fillStyle(0x728583).fillRect(-10,-1,9,6);
  if(sniper) {
    g.fillStyle(0x192930).fillRect(8,-12,16,7);
    g.fillStyle(0xb0e2ca).fillRect(22,-11,2,4);
    g.lineStyle(2,0x768d83).lineBetween(33,5,39,11);
  } else if(launcher) {
    g.fillStyle(0xd5ab69).fillRect(6,-4,4,10).fillRect(15,-4,4,10).fillRect(24,-4,4,10);
  } else if(id==='assault'||id==='assault-rifle')g.fillStyle(0x687d78).fillRect(8,4,7,11);
}

export function drawThrowableArt(g:Phaser.GameObjects.Graphics,id:string,x:number,y:number,radius=6,flash=false):void {
  const color=THROWABLE_COLORS[id]??0x95ae76;
  g.fillStyle(0x14212a).fillCircle(x,y,radius+1);
  if(id==='molotov') {
    g.fillStyle(0x758d51).fillRoundedRect(x-4,y-4,8,12,2);
    g.fillStyle(0xb6b77c).fillRect(x-2,y-8,4,5);
    g.fillStyle(0xffd086).fillTriangle(x-3,y-8,x+2,y-16,x+4,y-8);
  } else if(id==='sticky-mine') {
    g.fillStyle(flash?0xffd897:color).fillEllipse(x,y,radius*2+4,radius+4);
    g.fillStyle(0xffe9bf).fillRect(x-2,y-3,4,2);
  } else {
    g.fillStyle(flash?0xffc187:color).fillRoundedRect(x-radius+1,y-radius,radius*2-2,radius*2,2);
    g.fillStyle(0x3b514e).fillRect(x-radius,y-1,radius*2,2);
    g.fillStyle(0xdacb9e).fillRect(x-2,y-radius-3,4,3);
  }
}
