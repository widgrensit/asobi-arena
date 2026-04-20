import type { GameState, PlayerState, Projectile } from './types';
import type { AsobiClient } from './client';

const PLAYER_RADIUS = 16;
const INPUT_RATE = 100;

// Ship sprite: 156x212 spritesheet, 3 cols x 4 rows
// Row order: down, left, right, up
// Each frame: 52x53
const SHIP_FRAME_W = 52;
const SHIP_FRAME_H = 53;
const SHIP_COLS = 3;

// Direction mapping based on movement
function getShipRow(dx: number, dy: number): number {
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0 ? 0 : 3; // down : up
  }
  return dx > 0 ? 2 : 1; // right : left
}

// asobi.dev colors
const COLORS = {
  ocean: '#0a0d1b',
  oceanWave: '#101320',
  primary: '#c9beff',
  secondary: '#91cdff',
  tertiary: '#4ae183',
  error: '#ffb4ab',
  text: '#e0e1f5',
  textMuted: '#938ea0',
  surface: '#1c1f2d',
  hpGood: '#4ae183',
  hpMid: '#c9beff',
  hpLow: '#ffb4ab',
};

function loadImage(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

export class GameRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private client: AsobiClient;
  private state: GameState | null = null;
  private prevState: GameState | null = null;
  private stateTime = 0;
  private prevStateTime = 0;
  private animId = 0;
  private keys = new Set<string>();
  private mouseX = 400;
  private mouseY = 300;
  private mouseDown = false;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private shipPlayer: HTMLImageElement;
  private shipEnemy: HTMLImageElement;
  private frameCounter = 0;
  private waveOffset = 0;
  private lastDx: Record<string, number> = {};
  private lastDy: Record<string, number> = {};

  constructor(canvas: HTMLCanvasElement, client: AsobiClient) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.client = client;
    this.shipPlayer = loadImage('/assets/ship_player.png');
    this.shipEnemy = loadImage('/assets/ship_enemy.png');
  }

  start() {
    this.canvas.style.display = 'block';
    this.bindInput();
    this.inputTimer = setInterval(() => this.sendInput(), INPUT_RATE);
    this.animId = requestAnimationFrame(() => this.render());
  }

  stop() {
    this.canvas.style.display = 'none';
    this.unbindInput();
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this.animId) cancelAnimationFrame(this.animId);
    this.state = null;
    this.prevState = null;
  }

  updateState(state: GameState) {
    this.prevState = this.state;
    this.prevStateTime = this.stateTime;
    this.state = state;
    this.stateTime = performance.now();

    if (state.arena_w && state.arena_h) {
      if (this.canvas.width !== state.arena_w || this.canvas.height !== state.arena_h) {
        this.canvas.width = state.arena_w;
        this.canvas.height = state.arena_h;
      }
    }
  }

  private render() {
    this.animId = requestAnimationFrame(() => this.render());
    this.frameCounter++;
    this.waveOffset += 0.3;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#0d1f3c';
    ctx.fillRect(0, 0, w, h);

    if (!this.state?.players) return;

    const now = performance.now();
    const t = this.prevState && (this.stateTime - this.prevStateTime) > 0
      ? Math.min(1, (now - this.stateTime) / (this.stateTime - this.prevStateTime))
      : 1;

    // Projectiles (cannonballs)
    const projs = this.state.projectiles || [];
    for (const proj of projs) {
      ctx.fillStyle = COLORS.error;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2);
      ctx.fill();
      // Trail
      ctx.fillStyle = COLORS.error;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Players (ships)
    const players = this.state.players;
    const myId = this.client.playerId;
    for (const [id, p] of Object.entries(players)) {
      const prev = this.prevState?.players?.[id];
      const x = prev ? lerp(prev.x, p.x, t) : p.x;
      const y = prev ? lerp(prev.y, p.y, t) : p.y;
      const dead = p.hp <= 0;

      // Track movement direction
      if (prev) {
        this.lastDx[id] = p.x - prev.x;
        this.lastDy[id] = p.y - prev.y;
      }
      const dx = this.lastDx[id] || 0;
      const dy = this.lastDy[id] || 1; // default facing down

      const isMe = id === myId;
      const sprite = isMe ? this.shipPlayer : this.shipEnemy;
      const row = getShipRow(dx, dy);
      const animFrame = Math.floor(this.frameCounter / 10) % SHIP_COLS;

      ctx.globalAlpha = dead ? 0.3 : 1;

      // Draw ship sprite
      if (sprite.complete && sprite.naturalWidth > 0) {
        const sx = animFrame * SHIP_FRAME_W;
        const sy = row * SHIP_FRAME_H;
        const scale = 1.5;
        const dw = SHIP_FRAME_W * scale;
        const dh = SHIP_FRAME_H * scale;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sprite, sx, sy, SHIP_FRAME_W, SHIP_FRAME_H, x - dw / 2, y - dh / 2, dw, dh);
      } else {
        // Fallback circle
        ctx.fillStyle = isMe ? COLORS.primary : COLORS.error;
        ctx.beginPath();
        ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      // Own ship glow
      if (isMe && !dead) {
        ctx.strokeStyle = COLORS.primary;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(x, y, PLAYER_RADIUS + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // HP bar
      if (!dead) {
        const barW = 36;
        const barH = 4;
        const barX = x - barW / 2;
        const barY = y - 30;
        const hpFrac = p.hp / p.max_hp;
        ctx.fillStyle = COLORS.surface;
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = hpFrac > 0.5 ? COLORS.hpGood : hpFrac > 0.25 ? COLORS.hpMid : COLORS.hpLow;
        ctx.fillRect(barX, barY, barW * hpFrac, barH);
      }

      // Name tag
      ctx.fillStyle = dead ? COLORS.textMuted : COLORS.text;
      ctx.font = '11px "Space Grotesk", system-ui';
      ctx.textAlign = 'center';
      const label = isMe ? 'YOU' : id.slice(0, 8);
      ctx.fillText(label, x, y - 34);

      ctx.globalAlpha = 1;
    }

    this.renderHUD();
  }

  private renderHUD() {
    if (!this.state) return;
    const ctx = this.ctx;
    const myId = this.client.playerId;
    const me = myId ? this.state.players?.[myId] : null;

    ctx.font = 'bold 14px "Space Grotesk", system-ui';
    ctx.textAlign = 'left';

    if (me) {
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`HP: ${me.hp}/${me.max_hp}`, 10, 20);
      ctx.fillText(`Kills: ${me.kills}  Deaths: ${me.deaths}`, 10, 38);
    }

    if (this.state.time_remaining != null) {
      const secs = Math.ceil(this.state.time_remaining / 1000);
      ctx.textAlign = 'center';
      ctx.fillStyle = secs <= 10 ? COLORS.error : COLORS.secondary;
      ctx.font = 'bold 18px "Space Grotesk", system-ui';
      ctx.fillText(`${secs}s`, this.canvas.width / 2, 24);
    }

    ctx.textAlign = 'right';
    ctx.font = '13px "Space Grotesk", system-ui';
    ctx.fillStyle = COLORS.textMuted;
    let info = `Round ${this.state.round || 1}`;
    if (this.state.modifier) info += ` | ${this.state.modifier}`;
    ctx.fillText(info, this.canvas.width - 10, 20);

    if (me && me.boons.length > 0) {
      ctx.textAlign = 'left';
      ctx.font = '11px "Space Grotesk", system-ui';
      ctx.fillStyle = COLORS.textMuted;
      ctx.fillText(`Boons: ${me.boons.join(', ')}`, 10, this.canvas.height - 10);
    }

    // Crosshair
    ctx.strokeStyle = 'rgba(201, 190, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.mouseX, this.mouseY, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(this.mouseX - 14, this.mouseY);
    ctx.lineTo(this.mouseX + 14, this.mouseY);
    ctx.moveTo(this.mouseX, this.mouseY - 14);
    ctx.lineTo(this.mouseX, this.mouseY + 14);
    ctx.stroke();
  }

  private sendInput() {
    if (!this.state || this.state.phase !== 'playing') return;
    this.client.sendInput({
      up: this.keys.has('w') || this.keys.has('arrowup'),
      down: this.keys.has('s') || this.keys.has('arrowdown'),
      left: this.keys.has('a') || this.keys.has('arrowleft'),
      right: this.keys.has('d') || this.keys.has('arrowright'),
      shoot: this.mouseDown,
      aim_x: this.mouseX,
      aim_y: this.mouseY,
    });
  }

  private onKeyDown = (e: KeyboardEvent) => { this.keys.add(e.key.toLowerCase()); };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
  };
  private onMouseDown = () => { this.mouseDown = true; };
  private onMouseUp = () => { this.mouseDown = false; };

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.style.cursor = 'none';
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.style.cursor = 'default';
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
