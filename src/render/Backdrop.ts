import Phaser from 'phaser';
import type { ArenaData } from '../sim/types';

let backdropSerial=0;
function bakeLayer(scene:Phaser.Scene,art:Phaser.GameObjects.Graphics,arena:ArenaData):void {
  const width=arena.width*arena.tileSize+512,height=arena.height*arena.tileSize+256;
  if(width>4096||height>4096)return;
  const key=`rivet-backdrop-${backdropSerial++}`;
  art.generateTexture(key,width,height);
  scene.add.image(0,0,key).setOrigin(0).setDepth(art.depth).setScrollFactor(art.scrollFactorX,art.scrollFactorY);
  art.destroy();
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{if(scene.textures.exists(key))scene.textures.remove(key);});
}

export function drawBackdrop(scene: Phaser.Scene, arena: ArenaData):void {
  if(arena.id==='rooftops'){drawSkyline(scene,arena);return;}
  if(arena.id==='mine'){drawDeepcore(scene,arena);return;}
  if(arena.id==='construction'){drawHighbeam(scene,arena);return;}
    const width = arena.width * arena.tileSize; const height = arena.height * arena.tileSize;
    const far = scene.add.graphics().setDepth(-20).setScrollFactor(0.65);
    far.fillStyle(0x131f29).fillRect(-1000, -1000, width + 3000, height + 2500);
    for (let x = -300; x < width + 900; x += 320) {
      const y = 190 + ((x + 300) / 320 % 3) * 32;
      far.fillStyle(0x20343b).fillRect(x, y, 206, 320);
      far.fillStyle(0x29444a).fillRect(x + 6, y + 6, 194, 148);
      far.fillStyle(0x243b42).fillRect(x + 6, y + 162, 194, 148);
      far.fillStyle(0x172830);
      for (let bar = 1; bar < 4; bar++) far.fillRect(x + bar * 51, y, 6, 320);
      far.fillRect(x, y + 154, 206, 8);
      far.fillStyle(0x759389, 0.05).fillTriangle(x, y + 320, x + 205, y + 320, x + 440, height);
    }
    const structure = scene.add.graphics().setDepth(-10);
    structure.fillStyle(0x17262e).fillRect(-200, height - 320, width + 400, 350);
    structure.lineStyle(1, 0x26363d, 0.6);
    for (let y = 450; y < height; y += 60) structure.lineBetween(0, y, width, y);
    for (let x = 72; x < width; x += 432) {
      structure.fillStyle(0x111f29).fillRect(x, 60, 28, height - 100);
      structure.fillStyle(0x2a3b40).fillRect(x, 60, 5, height - 100).fillRect(x + 24, 60, 4, height - 100);
      structure.fillStyle(0x24363c).fillRect(x, 230, 28, 28).fillRect(x, 570, 28, 28);
      structure.lineStyle(11, 0x1d2f36).lineBetween(x + 28, 250, x + 432, 560).lineBetween(x + 28, 560, x + 432, 250);
      structure.lineStyle(2, 0x32464a, 0.45).lineBetween(x + 28, 247, x + 432, 557);
      for (const y of [238, 578]) { structure.fillStyle(0x65716b, 0.5).fillCircle(x + 8, y, 2).fillCircle(x + 20, y, 2); }
    }
    structure.fillStyle(0x2c3e44).fillRect(0, 298, width, 14);
    structure.fillStyle(0x0d1c25).fillRect(0, 312, width, 9);
    structure.lineStyle(3, 0x485448, 0.4).lineBetween(0, 300, width, 300);
    // Warm practical lights and restrained cones make the cold factory feel inhabited.
    const light = scene.add.graphics().setDepth(-5);
    for (let x = 300; x < width; x += 590) {
      const y = 335 + (Math.floor(x / 590) % 2) * 60;
      light.lineStyle(2, 0x0b171e).lineBetween(x, 100, x, y);
      light.fillStyle(0xf5c889, 0.035).fillTriangle(x - 8, y + 6, x - 180, y + 440, x + 180, y + 440);
      light.fillStyle(0xf5c889, 0.025).fillTriangle(x + 8, y + 6, x - 120, y + 390, x + 120, y + 390);
      light.fillStyle(0x0a1720).fillTriangle(x, y - 15, x - 30, y + 6, x + 30, y + 6);
      light.fillStyle(0x46504a).fillRect(x - 30, y + 5, 60, 5);
      light.fillStyle(0xffd799).fillRect(x - 22, y + 10, 44, 3);
    }
    scene.add.text(410, 415, 'IRONWORKS', {fontFamily:'Arial Black, sans-serif',fontStyle:'bold',fontSize:'74px',color:'#3a514f',letterSpacing:7}).setAlpha(0.65).setDepth(-7);
    scene.add.text(417, 500, 'F O U N D R Y   D I S T R I C T    /    E S T .  2 0 8 4', {fontFamily:'monospace',fontSize:'12px',color:'#6c8173'}).setAlpha(0.5).setDepth(-7);
    for (let x = 140; x < width; x += 860) {
      scene.add.text(x, height - 225, '07', {fontFamily:'Arial Black, sans-serif',fontStyle:'bold',fontSize:'83px',color:'#344740'}).setDepth(-5).setAlpha(0.65);
      const sign = scene.add.graphics().setDepth(-5);
      sign.fillStyle(0xc2924f, 0.45).fillRect(x + 4, height - 126, 95, 3);
      scene.add.text(x + 4, height - 115, 'CAUTION / ACTIVE SITE', {fontFamily:'monospace',fontSize:'8px',color:'#8c8d67'}).setDepth(-5);
    }
    bakeLayer(scene,far,arena);bakeLayer(scene,structure,arena);bakeLayer(scene,light,arena);
}

function sky(scene:Phaser.Scene,width:number,height:number,top:number,bottom:number):Phaser.GameObjects.Graphics {
  const g=scene.add.graphics().setDepth(-30).setScrollFactor(0.25);
  const a=Phaser.Display.Color.IntegerToColor(top),b=Phaser.Display.Color.IntegerToColor(bottom);
  g.fillStyle(top).fillRect(-1500,-1500,width+4000,height+3000);
  for(let band=0;band<32;band++) {
    const c=Phaser.Display.Color.Interpolate.ColorWithColor(a,b,32,band);
    g.fillStyle(Phaser.Display.Color.GetColor(c.r,c.g,c.b)).fillRect(-1000,band*height/32,width+3000,height/32+1);
  }
  return g;
}

function drawSkyline(scene:Phaser.Scene,arena:ArenaData):void {
  const width=arena.width*arena.tileSize,height=arena.height*arena.tileSize;
  const g=sky(scene,width,height,0x17233c,0x52677a);
  g.fillStyle(0xe9d3b0,0.8).fillCircle(width*0.53,155,52);
  g.fillStyle(0xb6c3c1,0.04).fillCircle(width*0.53,155,87);
  for(let layer=0;layer<2;layer++) {
    const buildings=scene.add.graphics().setScrollFactor(layer?0.65:0.35).setDepth(-20+layer);
    for(let index=0;index<18;index++) {
      const x=index*190-350,roof=200+((index*173)%290)+layer*110;
      const w=95+(index*37)%95;
      buildings.fillStyle(layer?0x192d3b:0x304652).fillRect(x,roof,w,height);
      buildings.fillStyle(layer?0x243a44:0x3b535d).fillRect(x-4,roof-5,w+8,6);
      if(index%3===0)buildings.lineStyle(3,0x33444e).lineBetween(x+w/2,roof,x+w/2,roof-65);
      for(let row=0;row<9;row++)for(let col=0;col<4;col++) {
        if((row*7+col*3+index)%5===0)continue;
        buildings.fillStyle((row+index)%3===0?0xddba79:0x82aaa8,layer?0.22:0.13).fillRect(x+12+col*21,roof+22+row*29,8,12);
      }
    }
    bakeLayer(scene,buildings,arena);
  }
  const details=scene.add.graphics().setDepth(-7);
  details.lineStyle(2,0x101f30,0.8);
  for(let x=100;x<width;x+=480) {
    details.beginPath().moveTo(x,400).lineTo(x+160,440).lineTo(x+330,425).lineTo(x+480,400).strokePath();
    for(let j=0;j<4;j++)details.fillStyle(0xe0bb7f,0.65).fillCircle(x+j*120+50,413+j%2*15,2);
  }
  scene.add.text(360,520,'SKYLINE / AFTER HOURS',{fontFamily:'monospace',fontSize:'27px',fontStyle:'bold',color:'#9caaa7',letterSpacing:5}).setAlpha(0.25).setDepth(-5);
}

function drawDeepcore(scene:Phaser.Scene,arena:ArenaData):void {
  const width=arena.width*arena.tileSize,height=arena.height*arena.tileSize;
  const g=sky(scene,width,height,0x171d24,0x222c2b);
  for(let row=0;row<22;row++) {
    const y=row*height/22;
    g.fillStyle(row%3===0?0x37413b:0x303a37,0.4).fillTriangle(-500,y,width+800,y+65,width/2,y+180);
    g.lineStyle(3,0x4d5546,0.12).lineBetween(-200,y+20,width+700,y+120);
  }
  const rock=scene.add.graphics().setDepth(-10);
  for(let i=0;i<130;i++) {
    const x=(i*157)%width,y=(i*283)%height;
    rock.fillStyle(i%9===0?0x81bea5:0x66735a,i%9===0?0.28:0.1).fillTriangle(x,y,x+8+(i%4)*6,y-11,x+18,y+7);
  }
  for(let y=180;y<height;y+=420)for(let x=120;x<width;x+=600) {
    rock.fillStyle(0x26352e).fillRect(x,y,17,370).fillRect(x+340,y,17,370).fillRect(x-20,y,397,22);
    rock.lineStyle(4,0x4e4e39,0.5).lineBetween(x,y+130,x+100,y+22).lineBetween(x+340,y+130,x+240,y+22);
    rock.fillStyle(0xf5bf64,0.04).fillCircle(x+170,y+110,150);
    rock.lineStyle(2,0x101b20).lineBetween(x+170,y+20,x+170,y+90);
    rock.fillStyle(0x83805a).fillRect(x+160,y+88,20,7);
    rock.fillStyle(0xf4d491).fillRect(x+164,y+96,12,8);
  }
  scene.add.text(175,350,'DEEPCORE',{fontFamily:'Arial Black,sans-serif',fontSize:'58px',fontStyle:'bold',color:'#78836a',letterSpacing:8}).setDepth(-7).setAlpha(0.3);
  scene.add.text(180,420,'NO DAYLIGHT. NO SHORTCUTS.',{fontFamily:'monospace',fontSize:'14px',color:'#99a37b'}).setDepth(-7).setAlpha(0.5);
  bakeLayer(scene,rock,arena);
}

function drawHighbeam(scene:Phaser.Scene,arena:ArenaData):void {
  const width=arena.width*arena.tileSize,height=arena.height*arena.tileSize;
  const g=sky(scene,width,height,0x344149,0x927965);
  g.fillStyle(0xf6d395,0.5).fillCircle(width*0.7,270,77);
  const distant=scene.add.graphics().setDepth(-20).setScrollFactor(0.45);
  for(let i=0;i<19;i++) {
    const x=i*170-200,top=320+(i*113)%260;
    distant.fillStyle(0x3b4b4d,0.65).fillRect(x,top,125,height);
    distant.fillStyle(0x80918a,0.12).fillRect(x+7,top+14,110,6);
  }
  const cranes=scene.add.graphics().setDepth(-8);
  for(let i=0;i<3;i++) {
    const x=330+i*930,y=120+i%2*90;
    cranes.fillStyle(0x48534f).fillRect(x,y,22,height);
    cranes.fillStyle(0xc29352,0.65).fillRect(x-140,y,650,18);
    cranes.lineStyle(3,0xb78b52,0.7).lineBetween(x+10,y-100,x-140,y).lineBetween(x+10,y-100,x+510,y);
    cranes.lineStyle(2,0x293a40).lineBetween(x+400,y+18,x+400,y+270);
    cranes.fillStyle(0x303c3c).fillRect(x+386,y+260,28,16);
    cranes.lineStyle(5,0xb89b61).beginPath().arc(x+400,y+286,10,0,Math.PI*1.5).strokePath();
    for(let level=y+40;level<height;level+=56) {
      cranes.lineStyle(2,0x839083,0.32).lineBetween(x,level,x+22,level+48).lineBetween(x+22,level,x,level+48);
    }
  }
  scene.add.text(460,440,'HIGHBEAM',{fontFamily:'Arial Black,sans-serif',fontSize:'70px',fontStyle:'bold',color:'#c5bd9b',letterSpacing:9}).setDepth(-6).setAlpha(0.2);
  bakeLayer(scene,distant,arena);bakeLayer(scene,cranes,arena);
}
