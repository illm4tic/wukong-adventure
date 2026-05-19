const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
import { getLanguage, onLanguageChange, t } from "./i18n.js";

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const FLOOR_Y = 592;
const WORLD_WIDTH = 4200;
const FIXED_STEP = 1000 / 60;
const MAX_ACCUMULATOR = 200;
const GRAVITY = 2400;
const WUKONG_FRAME_SIZE = 384;
const WUKONG_ANCHOR_X = 192;
const WUKONG_ANCHOR_Y = 352;

const createSpriteImage = (src) => {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  return image;
};

const spriteUrl = (file) => new URL(`../wukong_sprites/${file}`, import.meta.url).href;

const WUKONG_SPRITES = {
  stand: createSpriteImage(spriteUrl("01_stand.png")),
  jumpStart: createSpriteImage(spriteUrl("02_jump_start.png")),
  jumpAir: createSpriteImage(spriteUrl("03_jump_air.png")),
  jumpLand: createSpriteImage(spriteUrl("04_jump_land.png")),
  move: createSpriteImage(spriteUrl("05_move.png")),
  staffThrust: createSpriteImage(spriteUrl("06_staff_thrust.png")),
  victory: createSpriteImage(spriteUrl("07_victory.png")),
};

const areWukongSpritesReady = () =>
  Object.values(WUKONG_SPRITES).every((image) => image.complete && image.naturalWidth > 0);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (start, end, t) => start + (end - start) * t;
const approach = (value, target, delta) => {
  if (value < target) return Math.min(value + delta, target);
  if (value > target) return Math.max(value - delta, target);
  return target;
};
const randomRange = (min, max) => min + Math.random() * (max - min);

class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();

    window.addEventListener("keydown", (event) => {
      const code = event.code;
      if (["KeyW", "KeyA", "KeyD", "KeyJ", "KeyK", "KeyL", "Space", "KeyP"].includes(code)) {
        event.preventDefault();
      }

      if (!this.keys.has(code)) {
        this.pressed.add(code);
      }

      this.keys.add(code);
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
  }
}

class ParticleSystem {
  constructor(capacity) {
    this.capacity = capacity;
    this.pool = Array.from({ length: capacity }, () => ({ active: false }));
  }

  spawn(options) {
    const slot = this.pool.find((particle) => !particle.active);
    if (!slot) return;

    Object.assign(slot, {
      active: true,
      x: options.x,
      y: options.y,
      vx: options.vx ?? 0,
      vy: options.vy ?? 0,
      life: options.life ?? 0.4,
      maxLife: options.life ?? 0.4,
      size: options.size ?? 6,
      growth: options.growth ?? -8,
      color: options.color ?? "#ffffff",
      alpha: options.alpha ?? 1,
      gravity: options.gravity ?? 0,
      shape: options.shape ?? "circle",
    });
  }

  burst(x, y, count, color, spread = 1) {
    for (let i = 0; i < count; i += 1) {
      const angle = randomRange(-Math.PI * spread, Math.PI * spread);
      const speed = randomRange(70, 360);
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - randomRange(0, 120),
        life: randomRange(0.18, 0.55),
        size: randomRange(3, 9),
        growth: randomRange(-18, -5),
        color,
        alpha: randomRange(0.5, 0.95),
        gravity: 420,
      });
    }
  }

  update(dt) {
    for (const particle of this.pool) {
      if (!particle.active) continue;

      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }

      particle.vy += particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.size = Math.max(0.5, particle.size + particle.growth * dt);
    }
  }

  render(context, cameraX) {
    context.save();
    for (const particle of this.pool) {
      if (!particle.active) continue;

      const alpha = (particle.life / particle.maxLife) * particle.alpha;
      context.globalAlpha = alpha;
      context.fillStyle = particle.color;
      const screenX = particle.x - cameraX;
      const screenY = particle.y;

      if (particle.shape === "diamond") {
        context.beginPath();
        context.moveTo(screenX, screenY - particle.size);
        context.lineTo(screenX + particle.size, screenY);
        context.lineTo(screenX, screenY + particle.size);
        context.lineTo(screenX - particle.size, screenY);
        context.closePath();
        context.fill();
      } else {
        context.beginPath();
        context.arc(screenX, screenY, particle.size, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }
}

class Attack {
  constructor(owner, config) {
    this.owner = owner;
    Object.assign(this, config);
    this.time = 0;
    this.active = false;
    this.finished = false;
    this.hitTargets = new Set();
  }

  update(game, dt) {
    this.time += dt;
    const wasActive = this.active;
    this.active = this.time >= this.start && this.time <= this.end;

    if (!wasActive && this.active && this.windColor) {
      game.particles.burst(
        this.owner.x + this.owner.facing * this.range * 0.3,
        this.owner.y - this.height * 0.55,
        8,
        this.windColor,
        0.45
      );
    }

    if (this.active) {
      this.tryHit(game);
    }

    if (this.time >= this.duration) {
      this.finished = true;
    }
  }

  tryHit(game) {
    const targets = this.owner.kind === "player" ? game.enemies : [game.player];
    for (const target of targets) {
      if (!target.alive || this.hitTargets.has(target.id) || target.invulnTime > 0) continue;

      const dx = target.x - this.owner.x;
      const inDirection = Math.sign(dx || this.owner.facing) === this.owner.facing || Math.abs(dx) < 40;
      const inRange = Math.abs(dx) < this.range;
      const inHeight = Math.abs((target.y - target.height * 0.5) - (this.owner.y - this.height * 0.5)) < this.height;

      if (inDirection && inRange && inHeight) {
        this.hitTargets.add(target.id);
        target.takeHit(game, {
          damage: this.damage,
          knockbackX: this.knockbackX * this.owner.facing,
          knockbackY: this.knockbackY,
          hitstun: this.hitstun,
          flash: this.hitColor,
        });
        if (this.onHit) this.onHit(game, target);
      }
    }
  }
}

let entityId = 0;

class Fighter {
  constructor(config) {
    this.id = ++entityId;
    this.kind = config.kind;
    this.x = config.x;
    this.y = FLOOR_Y;
    this.width = config.width;
    this.height = config.height;
    this.vx = 0;
    this.vy = 0;
    this.speed = config.speed;
    this.maxHp = config.maxHp;
    this.hp = config.maxHp;
    this.alive = true;
    this.onGround = true;
    this.facing = 1;
    this.hitstun = 0;
    this.attackCooldown = 0;
    this.invulnTime = 0;
    this.dashCooldown = 0;
    this.ultCooldown = 0;
    this.currentAttack = null;
    this.comboTimer = 0;
    this.comboIndex = 0;
    this.flashTime = 0;
    this.tint = config.tint;
    this.accent = config.accent;
    this.outline = config.outline;
    this.shadow = config.shadow;
  }

  get feetX() {
    return this.x;
  }

  updateTimers(dt) {
    this.hitstun = Math.max(0, this.hitstun - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.invulnTime = Math.max(0, this.invulnTime - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.ultCooldown = Math.max(0, this.ultCooldown - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.flashTime = Math.max(0, this.flashTime - dt);
  }

  move(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += GRAVITY * dt;

    if (this.y >= FLOOR_Y) {
      this.y = FLOOR_Y;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    this.x = clamp(this.x, 60, WORLD_WIDTH - 60);
  }

  takeHit(game, options) {
    this.hp -= options.damage;
    this.vx = options.knockbackX;
    this.vy = -options.knockbackY;
    this.hitstun = options.hitstun;
    this.invulnTime = 0.08;
    this.flashTime = 0.1;
    this.currentAttack = null;

    game.particles.burst(this.x, this.y - this.height * 0.62, 14, options.flash ?? "#fda4af", 0.85);
    game.hitstop = 0.04;
    game.screenShake = Math.max(game.screenShake, 10);

    if (this.hp <= 0) {
      this.alive = false;
      game.particles.burst(this.x, this.y - this.height * 0.6, 28, this.kind === "player" ? "#22d3ee" : "#f97316", 1);
    }
  }

  renderBase(context, cameraX, time) {
    const px = this.x - cameraX;
    const bodyTop = this.y - this.height;
    const hover = Math.sin(time * 8 + this.id * 0.8) * 2.4;
    const flash = this.flashTime > 0;

    context.save();
    context.translate(px, hover);
    context.globalAlpha = this.alive ? 1 : 0.28;

    context.fillStyle = this.shadow;
    context.beginPath();
    context.ellipse(0, this.y + 10, this.width * 0.52, 14, 0, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = flash ? "#ffffff" : this.outline;
    context.lineWidth = 4;
    context.fillStyle = flash ? "#f8fafc" : this.tint;

    context.beginPath();
    context.roundRect(-this.width * 0.42, bodyTop + 34, this.width * 0.84, this.height - 34, 18);
    context.fill();
    context.stroke();

    context.fillStyle = flash ? "#ffffff" : this.accent;
    context.beginPath();
    context.arc(0, bodyTop + 12, this.width * 0.26, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#0f172a";
    context.fillRect(-11, bodyTop + 6, 8, 4);
    context.fillRect(3, bodyTop + 6, 8, 4);

    context.strokeStyle = flash ? "#ffffff" : this.accent;
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(this.width * 0.12 * this.facing, bodyTop + 52);
    context.lineTo((this.width * 0.36 + (this.currentAttack ? 26 : 0)) * this.facing, bodyTop + 88);
    context.stroke();

    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(-this.width * 0.18, bodyTop + this.height - 10);
    context.lineTo(-this.width * 0.08, bodyTop + this.height + 22);
    context.moveTo(this.width * 0.18, bodyTop + this.height - 10);
    context.lineTo(this.width * 0.08, bodyTop + this.height + 22);
    context.stroke();

    context.restore();
  }
}

class Player extends Fighter {
  constructor(x) {
    super({
      kind: "player",
      x,
      width: 96,
      height: 160,
      speed: 380,
      maxHp: 300,
      tint: "#92400e",
      accent: "#facc15",
      outline: "#fde68a",
      shadow: "rgba(245, 158, 11, 0.2)",
    });
    this.heroName = "Wukong";
    this.energy = 0;
    this.maxEnergy = 100;
    this.score = 0;
    this.spriteState = "stand";
    this.previousSpriteState = "stand";
    this.stateBlend = 1;
    this.stateTime = 0;
    this.airTime = 0;
    this.jumpStartTimer = 0;
    this.landTimer = 0;
    this.attackPoseTimer = 0;
  }

  update(game, input, dt) {
    this.updateTimers(dt);

    if (!this.alive) return;

    const wasOnGround = this.onGround;
    const moveAxis = (input.isDown("KeyD") ? 1 : 0) - (input.isDown("KeyA") ? 1 : 0);
    if (moveAxis !== 0) this.facing = moveAxis;

    if (this.hitstun <= 0) {
      const targetSpeed = moveAxis * this.speed;
      const accel = this.currentAttack ? 1600 : 2600;
      this.vx = approach(this.vx, targetSpeed, accel * dt);

      if (input.wasPressed("KeyW") && this.onGround) {
        this.vy = -920;
        this.onGround = false;
        this.jumpStartTimer = 0.14;
        game.particles.burst(this.x, this.y + 4, 10, "#fbbf24", 0.35);
      }

      if (!this.currentAttack) {
        if (input.wasPressed("KeyJ")) {
          this.startComboAttack(game);
        } else if (input.wasPressed("KeyK") && this.dashCooldown <= 0) {
          this.startDashAttack(game);
        } else if (input.wasPressed("KeyL") && this.ultCooldown <= 0 && this.energy >= 50) {
          this.startUltimate(game);
        }
      }
    } else {
      this.vx = approach(this.vx, 0, 1000 * dt);
    }

    if (this.currentAttack) {
      this.currentAttack.update(game, dt);
      if (this.currentAttack.finished) {
        this.currentAttack = null;
      }
    }

    this.move(dt);
    this.energy = clamp(this.energy + dt * 8, 0, this.maxEnergy);
    this.attackPoseTimer = Math.max(0, this.attackPoseTimer - dt);
    this.jumpStartTimer = Math.max(0, this.jumpStartTimer - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);

    if (!wasOnGround && this.onGround) {
      this.landTimer = 0.14;
    }

    if (this.onGround) {
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }

    this.updateSpriteState(game, dt);
  }

  startComboAttack(game) {
    const comboConfigs = [
      { damage: 16, range: 112, duration: 0.24, start: 0.05, end: 0.12, knockbackX: 320, knockbackY: 160, hitstun: 0.18, windColor: "#f59e0b", hitColor: "#fde68a" },
      { damage: 19, range: 128, duration: 0.27, start: 0.06, end: 0.14, knockbackX: 380, knockbackY: 190, hitstun: 0.2, windColor: "#fb7185", hitColor: "#fdba74" },
      { damage: 26, range: 142, duration: 0.32, start: 0.09, end: 0.18, knockbackX: 520, knockbackY: 260, hitstun: 0.26, windColor: "#facc15", hitColor: "#fde68a" },
    ];

    this.comboIndex = this.comboTimer > 0 ? (this.comboIndex + 1) % comboConfigs.length : 0;
    this.comboTimer = 0.45;
    this.attackCooldown = 0.08;
    this.attackPoseTimer = 0.22;
    const cfg = comboConfigs[this.comboIndex];
    this.currentAttack = new Attack(this, { ...cfg, height: 120, onHit: () => { this.energy = clamp(this.energy + 12, 0, this.maxEnergy); } });
    game.screenShake = Math.max(game.screenShake, 4);
  }

  startDashAttack(game) {
    this.dashCooldown = 2.8;
    this.attackCooldown = 0.18;
    this.invulnTime = 0.22;
    this.vx = this.facing * 880;
    this.attackPoseTimer = 0.3;
    this.currentAttack = new Attack(this, {
      damage: 34,
      range: 166,
      height: 110,
      duration: 0.36,
      start: 0.05,
      end: 0.24,
      knockbackX: 840,
      knockbackY: 180,
      hitstun: 0.34,
      windColor: "#f59e0b",
      hitColor: "#fde68a",
      onHit: () => {
        this.energy = clamp(this.energy + 18, 0, this.maxEnergy);
      },
    });
    game.particles.burst(this.x, this.y - 48, 18, "#f59e0b", 0.2);
  }

  startUltimate(game) {
    this.energy -= 50;
    this.ultCooldown = 6;
    this.attackCooldown = 0.25;
    this.vx = 0;
    this.attackPoseTimer = 0.68;
    this.currentAttack = new Attack(this, {
      damage: 20,
      range: 170,
      height: 150,
      duration: 0.85,
      start: 0.12,
      end: 0.72,
      knockbackX: 190,
      knockbackY: 220,
      hitstun: 0.22,
      windColor: "#facc15",
      hitColor: "#fde68a",
      onHit: (battlefield, target) => {
        this.energy = clamp(this.energy + 6, 0, this.maxEnergy);
        battlefield.particles.spawn({
          x: target.x + randomRange(-16, 16),
          y: target.y - randomRange(70, 130),
          vx: randomRange(-20, 20),
          vy: -randomRange(90, 180),
          life: 0.45,
          size: randomRange(8, 16),
          growth: -10,
          color: "#fbbf24",
          alpha: 0.8,
          shape: "diamond",
        });
      },
    });
    game.particles.burst(this.x, this.y - 76, 24, "#facc15", 1);
    game.screenShake = Math.max(game.screenShake, 10);
  }

  updateSpriteState(game, dt) {
    let nextState = "stand";

    if (game.state === "victory" && this.alive) {
      nextState = "victory";
    } else if (this.landTimer > 0) {
      nextState = "jumpLand";
    } else if (!this.onGround) {
      nextState = this.jumpStartTimer > 0 || this.airTime < 0.08 ? "jumpStart" : "jumpAir";
    } else if (this.attackPoseTimer > 0 || this.currentAttack) {
      nextState = "staffThrust";
    } else if (Math.abs(this.vx) > 40) {
      nextState = "move";
    }

    if (nextState !== this.spriteState) {
      this.previousSpriteState = this.spriteState;
      this.spriteState = nextState;
      this.stateBlend = 0;
      this.stateTime = 0;
    } else {
      this.stateTime += dt;
    }

    this.stateBlend = Math.min(1, this.stateBlend + dt * 8);
  }

  getSpritePose(state, time) {
    const pulse = Math.sin(time * 10);
    switch (state) {
      case "move":
        return {
          x: Math.sin(time * 13) * 4,
          y: Math.abs(Math.sin(time * 13)) * -8,
          rotation: Math.sin(time * 13) * 0.025,
          scaleX: 1.02,
          scaleY: 0.99,
        };
      case "jumpStart":
        return {
          x: 0,
          y: 4 - Math.min(this.airTime * 80, 10),
          rotation: -0.03,
          scaleX: 0.98,
          scaleY: 1.02,
        };
      case "jumpAir":
        return {
          x: 0,
          y: Math.sin(time * 8) * -3,
          rotation: clamp(this.vy / 1800, -0.08, 0.08),
          scaleX: 1,
          scaleY: 1,
        };
      case "jumpLand":
        return {
          x: 0,
          y: Math.sin((1 - this.landTimer / 0.14) * Math.PI) * 4,
          rotation: 0.02,
          scaleX: 1.05,
          scaleY: 0.94,
        };
      case "staffThrust":
        return {
          x: 14,
          y: -2,
          rotation: 0.01,
          scaleX: 1.03,
          scaleY: 1,
        };
      case "victory":
        return {
          x: 0,
          y: Math.sin(time * 5) * -4,
          rotation: Math.sin(time * 4.2) * 0.01,
          scaleX: 1.02,
          scaleY: 1.02,
        };
      default:
        return {
          x: 0,
          y: pulse * -2,
          rotation: pulse * 0.01,
          scaleX: 1,
          scaleY: 1,
        };
    }
  }

  drawSpriteState(context, cameraX, state, alpha) {
    const image = WUKONG_SPRITES[state];
    if (!image?.complete || image.naturalWidth === 0) return;

    const baseScale = state === "victory" ? 0.88 : 0.84;
    const pose = this.getSpritePose(state, this.stateTime);

    context.save();
    context.translate(this.x - cameraX + pose.x * this.facing, this.y + pose.y);
    context.scale(this.facing, 1);
    context.rotate(pose.rotation * this.facing);
    context.scale(pose.scaleX, pose.scaleY);
    context.globalAlpha *= alpha;
    context.drawImage(
      image,
      -WUKONG_ANCHOR_X * baseScale,
      -WUKONG_ANCHOR_Y * baseScale,
      WUKONG_FRAME_SIZE * baseScale,
      WUKONG_FRAME_SIZE * baseScale
    );
    context.restore();
  }

  render(context, cameraX, time) {
    const attackGlow = this.currentAttack?.active;
    const bodyAlpha = this.alive ? 1 : 0.3;

    if (!areWukongSpritesReady()) {
      this.renderBase(context, cameraX, time);
      return;
    }

    context.save();
    context.globalAlpha = bodyAlpha;

    context.fillStyle = "rgba(180, 83, 9, 0.22)";
    context.beginPath();
    context.ellipse(this.x - cameraX, this.y + 10, this.width * 0.58, 16, 0, 0, Math.PI * 2);
    context.fill();

    if (attackGlow) {
      context.fillStyle = "rgba(250, 204, 21, 0.2)";
      context.beginPath();
      context.ellipse(
        this.x - cameraX + this.facing * this.currentAttack.range * 0.42,
        this.y - this.currentAttack.height * 0.58,
        this.currentAttack.range * 0.54,
        this.currentAttack.height * 0.34,
        0,
        0,
        Math.PI * 2
      );
      context.fill();
    }

    if (this.previousSpriteState !== this.spriteState && this.stateBlend < 1) {
      this.drawSpriteState(context, cameraX, this.previousSpriteState, 1 - this.stateBlend);
    }

    this.drawSpriteState(context, cameraX, this.spriteState, this.stateBlend);

    if (this.currentAttack?.active) {
      const alpha = 0.24 + Math.sin(time * 32) * 0.08;
      context.save();
      context.globalAlpha = alpha;
      context.fillStyle = this.comboIndex === 1 ? "#fb7185" : "#facc15";
      context.beginPath();
      context.ellipse(
        this.x - cameraX + this.facing * this.currentAttack.range * 0.52,
        this.y - this.currentAttack.height * 0.55,
        this.currentAttack.range * 0.65,
        this.currentAttack.height * 0.42,
        0,
        0,
        Math.PI * 2
      );
      context.fill();
      context.restore();
    }

    context.restore();
  }
}

class Enemy extends Fighter {
  constructor(x, tier = 1) {
    const stats = tier === 2
      ? {
          width: 92,
          height: 146,
          speed: 270,
          maxHp: 108,
          tint: "#7c2d12",
          accent: "#fb923c",
          outline: "#fdba74",
          shadow: "rgba(249, 115, 22, 0.18)",
        }
      : {
          width: 82,
          height: 132,
          speed: 240,
          maxHp: 68,
          tint: "#5b2138",
          accent: "#fb7185",
          outline: "#fecdd3",
          shadow: "rgba(244, 63, 94, 0.18)",
        };

    super({
      kind: "enemy",
      x,
      ...stats,
    });

    this.tier = tier;
    this.aiTimer = randomRange(0.1, 0.45);
    this.preferredDistance = tier === 2 ? 136 : 112;
  }

  update(game, dt) {
    this.updateTimers(dt);
    if (!this.alive) return;

    const player = game.player;
    const distance = player.x - this.x;
    this.facing = distance >= 0 ? 1 : -1;

    if (this.hitstun <= 0) {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        this.aiTimer = randomRange(0.08, 0.2);

        if (Math.abs(distance) > this.preferredDistance) {
          this.vx = this.facing * this.speed;
        } else {
          this.vx = approach(this.vx, 0, 2400 * dt);
          if (!this.currentAttack && this.attackCooldown <= 0) {
            this.startAttack(game);
          }
        }
      }
    } else {
      this.vx = approach(this.vx, 0, 1400 * dt);
    }

    if (this.currentAttack) {
      this.currentAttack.update(game, dt);
      if (this.currentAttack.finished) {
        this.currentAttack = null;
      }
    }

    this.move(dt);
  }

  startAttack(game) {
    this.attackCooldown = this.tier === 2 ? 0.95 : 1.15;
    this.currentAttack = new Attack(this, {
      damage: this.tier === 2 ? 18 : 11,
      range: this.tier === 2 ? 120 : 104,
      height: 110,
      duration: this.tier === 2 ? 0.44 : 0.36,
      start: 0.08,
      end: 0.18,
      knockbackX: this.tier === 2 ? 420 : 260,
      knockbackY: this.tier === 2 ? 220 : 160,
      hitstun: this.tier === 2 ? 0.26 : 0.17,
      windColor: this.tier === 2 ? "#fb923c" : "#fb7185",
      hitColor: "#fecdd3",
      onHit: () => {
        game.screenShake = Math.max(game.screenShake, this.tier === 2 ? 8 : 5);
      },
    });
  }

  render(context, cameraX, time) {
    this.renderBase(context, cameraX, time);

    if (this.currentAttack?.active) {
      context.save();
      context.globalAlpha = 0.15;
      context.fillStyle = this.tier === 2 ? "#fb923c" : "#fb7185";
      context.beginPath();
      context.ellipse(
        this.x - cameraX + this.facing * this.currentAttack.range * 0.5,
        this.y - 62,
        this.currentAttack.range * 0.62,
        this.currentAttack.height * 0.36,
        0,
        0,
        Math.PI * 2
      );
      context.fill();
      context.restore();
    }
  }
}

class Game {
  constructor() {
    this.input = new Input();
    this.particles = new ParticleSystem(320);
    this.cameraX = 0;
    this.time = 0;
    this.hitstop = 0;
    this.screenShake = 0;
    this.paused = false;
    this.displayHpRatio = 1;
    this.displayEnergyRatio = 0;
    this.language = getLanguage();
    this.lastMessageKey = "msgRiftOpened";
    onLanguageChange((language) => {
      this.language = language;
      if (this.player) {
        this.player.heroName = t("heroName");
      }
      this.refreshLocaleText();
    });
    this.restart();
  }

  restart() {
    this.player = new Player(260);
    this.player.heroName = t("heroName");
    this.enemies = [];
    this.currentWave = 0;
    this.maxWaves = 4;
    this.killCount = 0;
    this.state = "intro";
    this.stateTimer = 1.2;
    this.levelGoalX = WORLD_WIDTH - 220;
    this.lastMessageKey = "msgRiftOpened";
    this.message = t("msgRiftOpened");
    this.messageTimer = 2;
    this.cameraX = 0;
    this.hitstop = 0;
    this.screenShake = 0;
    this.particles = new ParticleSystem(320);
    this.spawnWave();
  }

  spawnWave() {
    this.currentWave += 1;
    const composition = {
      1: [1, 1, 1],
      2: [1, 1, 2],
      3: [1, 2, 1, 2],
      4: [2, 2, 1, 1, 2],
    }[this.currentWave] ?? [];

    const startX = 980 + this.currentWave * 340;
    this.enemies = composition.map((tier, index) => new Enemy(startX + index * 160, tier));
    this.lastMessageKey = "msgWaveIncoming";
    this.message = t("msgWaveIncoming", this.currentWave);
    this.messageTimer = 2.2;
    this.state = "battle";
  }

  refreshLocaleText() {
    if (this.lastMessageKey === "msgWaveIncoming") {
      this.message = t("msgWaveIncoming", this.currentWave);
      return;
    }

    if (this.lastMessageKey) {
      this.message = t(this.lastMessageKey);
    }
  }

  update(dt) {
    if (this.input.wasPressed("Space")) {
      this.restart();
      this.input.endFrame();
      return;
    }

    if (this.input.wasPressed("KeyP")) {
      this.paused = !this.paused;
    }

    if (this.paused) {
      this.input.endFrame();
      return;
    }

    this.time += dt;
    this.messageTimer = Math.max(0, this.messageTimer - dt);

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.input.endFrame();
      return;
    }

    this.player.update(this, this.input, dt);
    for (const enemy of this.enemies) {
      enemy.update(this, dt);
    }

    const aliveBefore = this.enemies.length;
    this.enemies = this.enemies.filter((enemy) => enemy.alive);
    this.killCount += aliveBefore - this.enemies.length;

    if (!this.player.alive) {
      this.state = "defeat";
      this.lastMessageKey = "msgDefeat";
      this.message = t("msgDefeat");
      this.messageTimer = 999;
    } else if (this.enemies.length === 0) {
      if (this.currentWave < this.maxWaves) {
        this.spawnWave();
      } else if (this.player.x >= this.levelGoalX - 100) {
        this.state = "victory";
        this.lastMessageKey = "msgVictory";
        this.message = t("msgVictory");
        this.messageTimer = 999;
      }
    }

    if (this.currentWave >= this.maxWaves && this.enemies.length === 0 && this.player.x < this.levelGoalX - 100) {
      this.lastMessageKey = "msgAdvance";
      this.message = t("msgAdvance");
      this.messageTimer = 0.5;
    }

    this.particles.update(dt);
    this.updateCamera(dt);
    this.screenShake = Math.max(0, this.screenShake - dt * 22);
    this.displayHpRatio = lerp(this.displayHpRatio, this.player.hp / this.player.maxHp, 1 - Math.exp(-dt * 10));
    this.displayEnergyRatio = lerp(this.displayEnergyRatio, this.player.energy / this.player.maxEnergy, 1 - Math.exp(-dt * 10));
    this.syncSkillBar();
    this.input.endFrame();
  }

  syncSkillBar() {
    const skillBar = window.__skillBar;
    if (!skillBar) return;
    skillBar.setCooldowns({
      k: { current: this.player.dashCooldown, max: 2.8 },
      l: { current: this.player.ultCooldown, max: 6 },
    });
  }

  updateCamera(dt) {
    const target = clamp(this.player.x - WIDTH * 0.33, 0, WORLD_WIDTH - WIDTH);
    this.cameraX = lerp(this.cameraX, target, 1 - Math.exp(-dt * 8));
  }

  render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const shakeX = this.screenShake > 0 ? randomRange(-this.screenShake, this.screenShake) : 0;
    const shakeY = this.screenShake > 0 ? randomRange(-this.screenShake, this.screenShake) * 0.45 : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    this.drawBackground();
    this.drawStage();
    this.particles.render(ctx, this.cameraX);

    const entities = [...this.enemies, this.player].sort((a, b) => a.y - b.y);
    for (const entity of entities) {
      entity.render(ctx, this.cameraX, this.time);
    }

    this.drawGoalMarker();
    ctx.restore();

    this.drawHud();

    if (!areWukongSpritesReady()) {
      this.drawOverlay(t("overlayLoadingTitle"), t("overlayLoadingSubtitle"));
    }
  }

  drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, "#081423");
    sky.addColorStop(0.5, "#0a1630");
    sky.addColorStop(1, "#020611");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (let i = 0; i < 5; i += 1) {
      const layerDepth = i / 4;
      const offset = (this.cameraX * (0.16 + layerDepth * 0.13)) % 900;
      ctx.fillStyle = `rgba(15, 23, 42, ${0.22 + layerDepth * 0.08})`;
      for (let x = -offset - 200; x < WIDTH + 300; x += 280) {
        const peak = 280 - layerDepth * 80;
        ctx.beginPath();
        ctx.moveTo(x, FLOOR_Y + 40);
        ctx.lineTo(x + 100, FLOOR_Y - peak);
        ctx.lineTo(x + 220, FLOOR_Y + 40);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.fillStyle = "rgba(45, 212, 191, 0.14)";
    for (let i = 0; i < 24; i += 1) {
      const x = ((i * 223) - this.cameraX * 0.2) % (WIDTH + 120);
      const y = 80 + (i % 6) * 44;
      ctx.beginPath();
      ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawStage() {
    const floorGradient = ctx.createLinearGradient(0, FLOOR_Y - 40, 0, HEIGHT);
    floorGradient.addColorStop(0, "#0f172a");
    floorGradient.addColorStop(1, "#020617");
    ctx.fillStyle = floorGradient;
    ctx.fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);

    const lineOffset = -(this.cameraX % 120);
    for (let x = lineOffset; x < WIDTH + 120; x += 120) {
      ctx.strokeStyle = "rgba(56, 189, 248, 0.11)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, FLOOR_Y + 12);
      ctx.lineTo(x + 72, HEIGHT);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(15, 118, 110, 0.16)";
    ctx.fillRect(0, FLOOR_Y - 12, WIDTH, 12);

    for (let i = 0; i < 14; i += 1) {
      const crystalWorldX = 260 + i * 280;
      const screenX = crystalWorldX - this.cameraX;
      if (screenX < -80 || screenX > WIDTH + 80) continue;

      ctx.save();
      ctx.translate(screenX, FLOOR_Y - 14);
      ctx.fillStyle = i % 3 === 0 ? "rgba(45, 212, 191, 0.26)" : "rgba(56, 189, 248, 0.2)";
      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.lineTo(22, -12);
      ctx.lineTo(0, 18);
      ctx.lineTo(-22, -12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawGoalMarker() {
    const x = this.levelGoalX - this.cameraX;
    if (x < -120 || x > WIDTH + 120) return;

    ctx.save();
    ctx.translate(x, FLOOR_Y - 8);
    ctx.strokeStyle = "#facc15";
    ctx.fillStyle = "rgba(250, 204, 21, 0.18)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -180);
    ctx.lineTo(0, 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -178);
    ctx.lineTo(62, -152);
    ctx.lineTo(0, -128);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawHud() {
    ctx.save();

    ctx.fillStyle = "rgba(4, 10, 18, 0.78)";
    ctx.beginPath();
    ctx.roundRect(28, 24, 338, 92, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(233, 190, 102, 0.34)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(250, 204, 21, 0.94)";
    ctx.font = "700 18px Segoe UI";
    ctx.fillText(this.player.heroName, 46, 54);

    this.drawBar(46, 66, 292, 12, this.displayHpRatio, "rgba(244, 114, 182, 0.96)", "rgba(72, 22, 41, 0.92)", t("hudHp"));
    this.drawBar(46, 88, 292, 10, this.displayEnergyRatio, "rgba(56, 189, 248, 0.96)", "rgba(13, 40, 62, 0.92)", t("hudEnergy"));

    ctx.fillStyle = "rgba(4, 10, 18, 0.76)";
    ctx.beginPath();
    ctx.roundRect(WIDTH - 218, 24, 186, 82, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(233, 190, 102, 0.34)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(246, 210, 123, 0.96)";
    ctx.font = "600 13px Segoe UI";
    ctx.fillText(`${t("hudWave")} ${Math.min(this.currentWave, this.maxWaves)} / ${this.maxWaves}`, WIDTH - 192, 57);
    ctx.fillStyle = "rgba(235, 241, 248, 0.96)";
    ctx.font = "700 24px Segoe UI";
    ctx.fillText(`${this.killCount}`, WIDTH - 192, 92);
    ctx.fillStyle = "rgba(200, 213, 234, 0.92)";
    ctx.font = "600 12px Segoe UI";
    ctx.fillText(t("hudKills"), WIDTH - 146, 92);

    if (this.messageTimer > 0) {
      ctx.fillStyle = "rgba(2, 6, 23, 0.6)";
      ctx.beginPath();
      ctx.roundRect(WIDTH * 0.5 - 170, 156, 340, 52, 18);
      ctx.fill();

      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 22px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText(this.message, WIDTH * 0.5, 190);
      ctx.textAlign = "left";
    }

    if (this.paused) {
      this.drawOverlay(t("overlayPausedTitle"), t("overlayPausedSubtitle"));
    }

    if (this.state === "defeat") {
      this.drawOverlay(t("overlayDefeatTitle"), t("overlayDefeatSubtitle"));
    } else if (this.state === "victory") {
      this.drawOverlay(t("overlayVictoryTitle"), t("overlayVictorySubtitle"));
    }

    ctx.restore();
  }

  drawBar(x, y, width, height, ratio, fillColor, emptyColor, label) {
    ctx.fillStyle = emptyColor;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.roundRect(x, y, width * clamp(ratio, 0, 1), height, height / 2);
    ctx.fill();

    ctx.fillStyle = "#f8fafc";
    ctx.font = "600 11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(label, x + width * 0.5, y + height - 1.5);
    ctx.textAlign = "left";
  }

  drawOverlay(title, subtitle) {
    ctx.fillStyle = "rgba(2, 6, 23, 0.64)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "rgba(15, 23, 42, 0.86)";
    ctx.beginPath();
    ctx.roundRect(WIDTH * 0.5 - 230, HEIGHT * 0.5 - 94, 460, 188, 28);
    ctx.fill();

    ctx.strokeStyle = "rgba(103, 232, 249, 0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.font = "700 38px Segoe UI";
    ctx.fillText(title, WIDTH * 0.5, HEIGHT * 0.5 - 8);
    ctx.font = "600 18px Segoe UI";
    ctx.fillStyle = "rgba(191, 219, 254, 0.96)";
    ctx.fillText(subtitle, WIDTH * 0.5, HEIGHT * 0.5 + 34);
    ctx.textAlign = "left";
  }
}

const game = new Game();

let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  const delta = Math.min(MAX_ACCUMULATOR, now - lastTime);
  lastTime = now;
  accumulator += delta;

  while (accumulator >= FIXED_STEP) {
    game.update(FIXED_STEP / 1000);
    accumulator -= FIXED_STEP;
  }

  game.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

export {};
