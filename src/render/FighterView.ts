import Phaser from 'phaser';
import type { Fighter } from '../sim/types';

/** Draws the current pose only. All action timing and collision live in the simulation. */
export class FighterView {
  private readonly art: Phaser.GameObjects.Graphics;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly marker: Phaser.GameObjects.Graphics;
  private readonly weaponArt: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene, fighter: Fighter) {
    this.shadow = scene.add.image(0, 0, 'rivet-shadow').setDepth(12);
    this.art = scene.add.graphics().setDepth(20);
    this.marker = scene.add.graphics().setDepth(25);
    this.weaponArt = scene.add.graphics().setDepth(22);
    this.label = scene.add.text(0, 0, fighter.name.toUpperCase(), {
      fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#edf4ef',
      stroke: '#101b24', strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(26);
  }

  update(fighter: Fighter, time: number): void {
    const g = this.art;
    const active = fighter.alive;
    g.setVisible(active); this.shadow.setVisible(active); this.label.setVisible(active); this.marker.setVisible(active); this.weaponArt.setVisible(active);
    if (!active) return;
    g.clear().setPosition(Math.round(fighter.x), Math.round(fighter.y)).setScale(fighter.facing, 1);
    const run = fighter.action === 'run';
    const climbing = fighter.climbing || fighter.action === 'hang';
    const phase = time * (climbing ? 0.014 : 0.024);
    const stride = run ? Math.sin(phase) * 6 : climbing ? Math.sin(phase) * 5 : 0;
    const bob = run ? Math.abs(Math.sin(phase)) * 1.5 : Math.sin(time * 0.003) * 0.4;
    const crouch = fighter.action === 'roll';
    const offset = crouch ? 7 : bob;
    const head = -14 + offset;
    const airborne = !fighter.grounded && !climbing;
    g.setAlpha(fighter.invulnerableTicks > 0 && Math.floor(time / 90) % 2 ? 0.55 : 1);
    if (crouch) {
      g.lineStyle(2, fighter.color, 0.25).strokeCircle(0, 7, 18);
      g.lineStyle(2, 0xe6f0e6, 0.6).beginPath().arc(0, 7, 16, time * 0.03, time * 0.03 + 2.4).strokePath();
    }
    // Far arm and leg, then jacket, then the camera-facing hand and face.
    g.lineStyle(7, 0x17252c).lineBetween(-4, 7 + offset, -5 - stride, 15 + offset);
    g.lineStyle(7, 0x263840).lineBetween(5, 7 + offset, 5 + stride, 15 + (airborne ? -3 : 0) + offset);
    g.fillStyle(0x101a20).fillRoundedRect(-9 - stride, 13 + offset, 10, 5, 1);
    g.fillStyle(0x142129).fillRoundedRect(2 + stride, 13 + (airborne ? -3 : 0) + offset, 11, 5, 1);
    g.lineStyle(6, 0x273e43).lineBetween(-7, -5 + offset, -10 - stride * 0.6, climbing ? -19 : 4 + offset);
    // A ragged scarf catches motion and makes facing readable even at small scale.
    g.fillStyle(0xf2b363).fillTriangle(-7, -9 + offset, -17 - Math.min(Math.abs(fighter.vx) / 35, 8), -6 + offset, -12, -2 + offset);
    g.fillStyle(0x101d25).fillRoundedRect(-10, -10 + offset, 20, 22, 3);
    g.fillStyle(fighter.color).fillRoundedRect(-8, -9 + offset, 16, 17, 2);
    g.fillStyle(0xe9e8ca, 0.2).fillRect(-6, -7 + offset, 4, 13);
    g.fillStyle(0x1d353b).fillRect(-8, 7 + offset, 16, 4);
    g.fillStyle(0xffcf7a).fillRect(0, 7 + offset, 4, 3);
    let frontHandY = climbing ? -19 : fighter.action === 'block' ? -11 : 2 + offset;
    let frontHandX = 10 + stride * 0.5;
    if (fighter.action === 'melee-windup') { frontHandX = -5; frontHandY = -8; }
    if (fighter.action === 'melee-active') { frontHandX = 23; frontHandY = -5; }
    if (fighter.action === 'melee-recovery') { frontHandX = 16; frontHandY = -2; }
    const combat = fighter.combat;
    if (combat && combat.equipped !== 'melee' && !climbing && !crouch && !fighter.action.startsWith('melee')) {
      frontHandX = combat.aimX * fighter.facing * 15; frontHandY = combat.aimY * 15 - 3;
    }
    if (combat?.cookTicks > 0) { frontHandX = -7; frontHandY = -21; }
    if (combat && combat.heldProp !== null) { frontHandX = 22; frontHandY = -5; }
    g.lineStyle(6, fighter.color).lineBetween(7, -5 + offset, frontHandX, frontHandY);
    g.fillStyle(0xf2c59c).fillRect(frontHandX - 3, frontHandY - 2, 6, 5);
    g.fillStyle(0x162029).fillRoundedRect(-8, head - 8, 18, 16, 3);
    g.fillStyle(0xd9a77e).fillRoundedRect(-5, head - 4, 15, 11, 2);
    g.fillStyle(0x253d43).fillRoundedRect(-9, head - 9, 20, 8, 3);
    g.fillStyle(fighter.color).fillRect(-8, head - 9, 18, 4);
    g.fillStyle(0x111f29).fillRect(0, head - 2, 11, 5);
    g.fillStyle(0xc6fff0).fillRect(3, head - 1, 7, 2);
    g.fillStyle(0x5d3a35).fillRect(6, head + 5, 3, 1);
    g.fillStyle(0xe8ad5e).fillRect(-7, -10 + offset, 17, 4);
    if (fighter.action === 'block') g.lineStyle(2, 0xa5fff0, 0.65).strokeEllipse(12, -4, 18, 32);
    this.shadow.setPosition(fighter.x, fighter.y + fighter.height / 2 + 2).setScale(crouch ? 1.3 : 1, 1).setAlpha(fighter.grounded ? 0.9 : 0.2);
    this.label.setPosition(fighter.x, fighter.y - 40);
    this.marker.clear().setPosition(fighter.x, fighter.y - 33).fillStyle(fighter.color).fillTriangle(-3, -3, 3, -3, 0, 1);
    if(fighter.hp<fighter.maxHp) {
      this.marker.fillStyle(0x14232b,0.9).fillRect(-16,3,32,4);
      this.marker.fillStyle(fighter.hp/fighter.maxHp>0.3?fighter.color:0xff8d77).fillRect(-15,4,30*Math.max(0,fighter.hp/fighter.maxHp),2);
    }
    this.drawWeapon(fighter, crouch || climbing || fighter.action.startsWith('melee'));
  }

  private drawWeapon(fighter: Fighter, hidden: boolean): void {
    const g = this.weaponArt; g.clear();
    const combat = fighter.combat;
    if (!combat || hidden || combat.heldProp !== null) return;
    if (combat.cookTicks > 0) {
      g.setPosition(fighter.x - fighter.facing * 7, fighter.y - 24).setRotation(0).setScale(1);
      g.fillStyle(0x263d3b).fillCircle(0, 0, 5);
      g.fillStyle(0x90a985).fillRect(-3, -4, 6, 7);
      g.fillStyle(0xf8c25e).fillRect(-2, -7, 4, 3);
      return;
    }
    const weapon = combat[combat.equipped];
    if (combat.equipped === 'melee' || !weapon) return;
    const angle = Math.atan2(combat.aimY, combat.aimX);
    const recoil = fighter.action === 'shoot' ? 3 : 0;
    g.setPosition(fighter.x + combat.aimX * (12 - recoil), fighter.y - 3 + combat.aimY * (12 - recoil));
    g.setRotation(angle).setScale(1, combat.aimX < 0 ? -1 : 1);
    const pistol = weapon === 'pistol'; const shotgun = weapon === 'shotgun';
    const length = pistol ? 18 : shotgun ? 34 : 28;
    g.fillStyle(0x12232c).fillRect(-3, -5, length + 5, 10);
    g.fillStyle(0x95a7a2).fillRect(0, -5, length, 4);
    g.fillStyle(0x3b5156).fillRect(0, -1, length, 5);
    g.fillStyle(0x263840).fillRect(0, 3, 6, 8);
    g.fillStyle(shotgun ? 0xa47a48 : 0xc7a766).fillRect(pistol ? 2 : 11, 1, pistol ? 4 : 11, 4);
    g.fillStyle(0x0e1a23).fillRect(length - 2, -3, 5, 4);
    g.fillStyle(0xe2c58f).fillRect(2, -6, 3, 1);
    if (!pistol) g.fillStyle(0x728583).fillRect(-10, -1, 9, 6);
    if (fighter.action === 'reload') g.lineStyle(1, 0xffdc8e, 0.8).strokeCircle(10, 0, 18);
  }

  destroy(): void { this.art.destroy(); this.shadow.destroy(); this.label.destroy(); this.marker.destroy(); this.weaponArt.destroy(); }
}
