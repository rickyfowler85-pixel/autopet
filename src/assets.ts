import { type AnatomyParameters, type Point } from './model';

// Creature art is assembled on one small native pixel grid. The continuous
// anatomy remains in the simulation; this layer deliberately exposes only a
// restrained set of integer silhouettes so slow development never shimmers.
export interface PixelAsset { rows: string[]; palette: Record<string, string> }
export type CreaturePose = 'stand' | 'sleep';

export interface PixelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CreatureMetrics {
  bounds: PixelBounds;
  headTop: Point;
  mouth: Point;
  back: Point;
  tailTip: Point;
  front: Point;
  supportMin: number;
  supportMax: number;
  shadowRadius: number;
}

export interface CreatureWorldMetrics extends CreatureMetrics {}

export interface CreatureRaster extends PixelAsset {
  /** Parallel semantic rows: 1-4 limbs, 5-6 eyes, a/z ears, t tail, r ridge. */
  partRows: string[];
  width: number;
  height: number;
  originX: number;
  groundY: number;
  metrics: CreatureMetrics;
  visualKey: string;
}

export interface CreaturePaintOptions {
  pose?: CreaturePose;
  facing?: number;
  blink?: boolean;
  gaitFrame?: number;
  scale?: number;
}

export const BASELINE_RENDER_ANATOMY: AnatomyParameters = {
  bodyLength: 1,
  bodyDepth: 1,
  limbLength: 1,
  limbBuild: 1,
  earSize: 1,
  earLift: 0,
  tailLength: 1,
  tailDepth: 1,
  posture: 0,
  coatHue: 0,
  coatLightness: 0,
  creamCoverage: 1,
};

const WIDTH = 40;
const HEIGHT = 27;
const ORIGIN_X = 20;
// Local y=0 is retained for the low point of a moving paw. The calm frame
// ends at y=-1, matching the original authored sprite's world-space anchor.
const GROUND_Y = 26;

const HUE_RAMPS = [
  { body: '#796b66', highlight: '#a58f84' },
  { body: '#687d7a', highlight: '#8fa7a0' },
  { body: '#60849b', highlight: '#87a7b4' },
  { body: '#5d7fa0', highlight: '#84a1ba' },
  { body: '#69789d', highlight: '#909fba' },
] as const;

const PART = {
  outline: 'o',
  body: 'b',
  head: 'h',
  earFar: 'a',
  earNear: 'z',
  tail: 't',
  ridge: 'r',
  legFarFront: '1',
  legFarRear: '2',
  legNearFront: '3',
  legNearRear: '4',
  eyeFar: '5',
  eyeNear: '6',
} as const;

interface VisualAnatomy {
  bodyLength: number;
  bodyDepth: number;
  limbLength: number;
  limbBuild: number;
  earSize: number;
  earLift: number;
  tailLength: number;
  tailDepth: number;
  posture: number;
  coatHue: number;
  coatLightness: number;
  creamCoverage: number;
}

interface Cell { color: string; part: string }

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function bucket(value: number, baseline: number, size: number, minimum: number, maximum: number): number {
  return clamp(Math.round((finite(value, baseline) - baseline) / size), minimum, maximum);
}

function visualAnatomy(anatomy: AnatomyParameters): VisualAnatomy {
  return {
    bodyLength: bucket(anatomy.bodyLength, 1, 0.055, -2, 2),
    bodyDepth: bucket(anatomy.bodyDepth, 1, 0.09, -1, 1),
    limbLength: bucket(anatomy.limbLength, 1, 0.07, -2, 2),
    limbBuild: bucket(anatomy.limbBuild, 1, 0.1, -1, 1),
    earSize: bucket(anatomy.earSize, 1, 0.08, -2, 2),
    earLift: bucket(anatomy.earLift, 0, 0.1, -1, 1),
    tailLength: bucket(anatomy.tailLength, 1, 0.085, -2, 3),
    tailDepth: bucket(anatomy.tailDepth, 1, 0.12, -1, 1),
    posture: bucket(anatomy.posture, 0, 0.11, -1, 1),
    coatHue: bucket(anatomy.coatHue, 0, 0.05, -2, 2),
    coatLightness: bucket(anatomy.coatLightness, 0, 0.03, -2, 2),
    creamCoverage: bucket(anatomy.creamCoverage, 1, 0.04, -2, 2),
  };
}

export function anatomyVisualKey(anatomy: AnatomyParameters): string {
  const visual = visualAnatomy(anatomy);
  return [
    visual.bodyLength,
    visual.bodyDepth,
    visual.limbLength,
    visual.limbBuild,
    visual.earSize,
    visual.earLift,
    visual.tailLength,
    visual.tailDepth,
    visual.posture,
    visual.coatHue,
    visual.coatLightness,
    visual.creamCoverage,
  ].join(':');
}

function shiftHex(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => clamp(shift + amount, 0, 255).toString(16).padStart(2, '0');
  return `#${channel(value >> 16)}${channel((value >> 8) & 255)}${channel(value & 255)}`;
}

function palette(visual: VisualAnatomy): Record<string, string> {
  const ramp = HUE_RAMPS[visual.coatHue + 2];
  const light = visual.coatLightness * 4;
  return {
    o: '#263c4d',
    b: shiftHex(ramp.body, light),
    s: shiftHex(ramp.highlight, light),
    c: '#f2dfb6',
    p: '#d9a293',
    e: '#172d3c',
    w: '#fff5dd',
  };
}

class RasterBuilder {
  readonly cells = new Map<string, Cell>();
  private key(x: number, y: number) { return `${Math.round(x)},${Math.round(y)}`; }

  set(x: number, y: number, color: string, part: string) {
    x = Math.round(x); y = Math.round(y);
    const gx = x + ORIGIN_X, gy = y + GROUND_Y;
    if (gx >= 0 && gx < WIDTH && gy >= 0 && gy < HEIGHT) this.cells.set(this.key(x, y), { color, part });
  }

  get(x: number, y: number): Cell | undefined { return this.cells.get(this.key(x, y)); }

  rect(x: number, y: number, width: number, height: number, color: string, part: string) {
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) this.set(x + xx, y + yy, color, part);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: string, part: string) {
    rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    for (let y = -ry; y <= ry; y++) {
      const width = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)));
      for (let x = -width; x <= width; x++) this.set(cx + x, cy + y, color, part);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, color: string, part: string) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      const offset = Math.floor((width - 1) / 2);
      this.rect(x0 - offset, y0 - offset, width, width, color, part);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }

  ear(baseX: number, baseY: number, height: number, tipShift: number, part: string) {
    const tipX = baseX + tipShift;
    for (let row = 0; row <= height; row++) {
      const t = row / height;
      const center = Math.round(tipX * (1 - t) + baseX * t);
      const half = Math.round(t * 3);
      for (let x = center - half; x <= center + half + (row === 0 ? 1 : 0); x++) this.set(x, baseY - height + row, 'b', part);
    }
    const innerHeight = Math.max(2, height - 1);
    for (let row = 1; row < innerHeight; row++) {
      const t = row / innerHeight;
      const center = Math.round(tipX * (1 - t) + baseX * t);
      const half = Math.max(0, Math.round(t * 2) - 1);
      for (let x = center - half; x <= center + half; x++) this.set(x, baseY - height + 1 + row, 'p', part);
    }
  }

  outline() {
    const occupied = [...this.cells.entries()];
    for (const [key] of occupied) {
      const [x, y] = key.split(',').map(Number);
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
        if ((xx || yy) && !this.get(x + xx, y + yy)) this.set(x + xx, y + yy, 'o', PART.outline);
      }
    }
  }
}

function gaitOffset(frame: number, pair: number): number {
  const phase = ((Math.round(frame) % 4) + 4) % 4;
  if (phase === 1) return pair === 0 ? -1 : 1;
  if (phase === 3) return pair === 0 ? 1 : -1;
  return 0;
}

function addLeg(builder: RasterBuilder, x: number, top: number, width: number, part: string, footOffset: number) {
  // Rounded upper support stays substantial even on the high-clearance form.
  const left = x - Math.floor(width / 2);
  builder.ellipse(x, top + 1, 2, 3, 'b', part);
  builder.rect(left, top + 1, width, Math.max(2, -3 + footOffset - top), 'b', part);
  builder.rect(left, -3 + footOffset, width, 2, 'c', part);
  builder.rect(left, -2 + footOffset, width + 1, 1, 'b', part);
}

interface BuildLandmarks {
  headX: number;
  headY: number;
  bodyX: number;
  bodyY: number;
  bodyRy: number;
  mouth: Point;
  tailTip: Point;
}

function buildStand(builder: RasterBuilder, visual: VisualAnatomy, gaitFrame: number): BuildLandmarks {
  const bodyRx = 9 + visual.bodyLength;
  const bodyRy = 5 + visual.bodyDepth;
  const clearance = clamp(4 + visual.limbLength - visual.bodyDepth + visual.posture, 2, 7);
  const bodyBottom = -1 - clearance;
  const bodyY = bodyBottom - bodyRy;
  const bodyX = 3;
  const headX = -7;
  // Keep the largest ears inside the native raster at maximum clearance.
  const headY = Math.max(-15, bodyY - Math.max(0, visual.posture));
  const rear = bodyX + bodyRx - 1;
  const tailReach = 4 + visual.tailLength;
  const tailWidth = clamp(2 + visual.tailDepth, 1, 3);
  // Longer tails curl upward near the right edge instead of being cropped.
  const tailEnd = Math.min(rear + tailReach, 17 - Math.floor(tailWidth / 2));
  const tailRise = 2 + Math.max(0, rear + tailReach - tailEnd);

  // The short juvenile tail stays attached to the rump and curls gently up.
  builder.line(rear - 1, bodyY, tailEnd - 1, bodyY - 2, tailWidth, 'b', PART.tail);
  builder.line(tailEnd - 1, bodyY - 2, tailEnd, bodyY - tailRise, tailWidth, 'b', PART.tail);

  const legWidth = clamp(2 + visual.limbBuild, 2, 3);
  const frontFar = -1;
  const rearFar = 10 + visual.bodyLength;
  const frontNear = -6;
  const rearNear = 5 + Math.round(visual.bodyLength / 2);
  const legTop = bodyBottom - 2;
  addLeg(builder, frontFar, legTop, legWidth, PART.legFarFront, gaitOffset(gaitFrame, 1));
  addLeg(builder, rearFar, legTop, legWidth, PART.legFarRear, gaitOffset(gaitFrame, 0));

  // Two small dorsal structures keep the recognizable juvenile silhouette.
  builder.ellipse(bodyX + 1, bodyY - bodyRy + 1, 2, 2, 'b', PART.ridge);
  builder.ellipse(bodyX + 6, bodyY - bodyRy + 1, 2, 1, 'b', PART.ridge);

  builder.ellipse(bodyX, bodyY, bodyRx, bodyRy, 'b', PART.body);
  builder.ellipse(bodyX - 1, bodyBottom - 1, Math.max(5, bodyRx - 3 + visual.creamCoverage), 2, 'c', PART.body);
  builder.line(bodyX - 1, bodyY - bodyRy + 1, bodyX + 5, bodyY - bodyRy + 2, 1, 's', PART.body);

  addLeg(builder, frontNear, legTop, legWidth, PART.legNearFront, gaitOffset(gaitFrame, 0));
  addLeg(builder, rearNear, legTop, legWidth, PART.legNearRear, gaitOffset(gaitFrame, 1));

  const earHeight = Math.min(5 + visual.earSize, 24 + headY - 4);
  const earBaseY = headY - 4;
  builder.ear(headX + 4, earBaseY, earHeight, 1 - visual.earLift, PART.earFar);
  builder.ear(headX - 3, earBaseY, earHeight, -1 + visual.earLift, PART.earNear);
  builder.ellipse(headX, headY, 8, 6, 'c', PART.head);
  // A small slate crown joins face, ears and continuous body.
  builder.line(headX - 5, headY - 5, headX + 5, headY - 5, 1, 'b', PART.head);
  builder.rect(headX - 1, headY - 4, 3, 1, 'b', PART.head);
  builder.line(headX + 3, headY - 4, headX + 6, headY - 1, 2, 'b', PART.head);

  return {
    headX,
    headY,
    bodyX,
    bodyY,
    bodyRy,
    mouth: { x: headX - 2, y: headY + 3 },
    tailTip: { x: tailEnd, y: bodyY - tailRise },
  };
}

function buildSleep(builder: RasterBuilder, visual: VisualAnatomy): BuildLandmarks {
  const bodyRx = 11 + visual.bodyLength;
  const bodyRy = 4 + visual.bodyDepth;
  const bodyX = 2;
  const bodyY = -5 - Math.max(0, visual.posture);
  const headX = -8;
  const headY = -6 - Math.max(0, visual.posture);
  const rear = bodyX + bodyRx - 1;
  const tailReach = 4 + visual.tailLength;
  const tailWidth = clamp(2 + visual.tailDepth, 1, 3);
  // Longer tails curl upward near the right edge instead of being cropped.
  const tailEnd = Math.min(rear + tailReach, 17 - Math.floor(tailWidth / 2));
  const tailRise = 2 + Math.max(0, rear + tailReach - tailEnd);

  builder.line(rear - 2, bodyY - 1, tailEnd - 1, bodyY - 3, tailWidth, 'b', PART.tail);
  builder.line(tailEnd - 1, bodyY - 3, tailEnd, bodyY - 1 - tailRise, tailWidth, 'b', PART.tail);

  builder.ellipse(bodyX + 2, bodyY - bodyRy + 1, 2, 1, 'b', PART.ridge);
  builder.ellipse(bodyX + 6, bodyY - bodyRy + 1, 2, 1, 'b', PART.ridge);
  builder.ellipse(bodyX, bodyY, bodyRx, bodyRy, 'b', PART.body);
  builder.ellipse(bodyX - 1, -3, Math.max(6, bodyRx - 3 + visual.creamCoverage), 2, 'c', PART.body);
  builder.line(bodyX, bodyY - bodyRy + 1, bodyX + 6, bodyY - bodyRy + 1, 1, 's', PART.body);

  const earHeight = Math.max(3, 4 + visual.earSize);
  const earBaseY = headY - 3;
  builder.ear(headX + 4, earBaseY, earHeight, 2 - visual.earLift, PART.earFar);
  builder.ear(headX - 2, earBaseY, earHeight, -2 + visual.earLift, PART.earNear);
  builder.ellipse(headX, headY, 8, 5, 'c', PART.head);
  builder.line(headX - 5, headY - 4, headX + 4, headY - 4, 2, 's', PART.head);
  builder.line(headX + 3, headY - 3, headX + 6, headY - 1, 2, 'b', PART.head);

  // Four tucked paws stay readable in the resting silhouette. The foremost
  // one sits under the muzzle while the others follow the belly line.
  const pawWidth = clamp(2 + visual.limbBuild, 1, 3);
  const pawXs = [-7, -2, 4 + Math.round(visual.bodyLength / 2), 9 + visual.bodyLength];
  const pawParts = [PART.legNearFront, PART.legFarFront, PART.legNearRear, PART.legFarRear];
  pawXs.forEach((x, index) => builder.rect(x - 1, -2, pawWidth + 1, 1, index % 2 ? 'b' : 'c', pawParts[index]));

  return {
    headX,
    headY,
    bodyX,
    bodyY,
    bodyRy,
    mouth: { x: headX - 2, y: headY + 3 },
    tailTip: { x: tailEnd, y: bodyY - 1 - tailRise },
  };
}

function addFace(builder: RasterBuilder, landmarks: BuildLandmarks, pose: CreaturePose, blink: boolean) {
  const { headX, headY } = landmarks;
  const eyeY = headY - (pose === 'stand' ? 1 : 0);
  const eyes = [
    { x: headX - 3, part: PART.eyeNear },
    { x: headX + 3, part: PART.eyeFar },
  ];
  for (const eye of eyes) {
    if (blink || pose === 'sleep') {
      builder.rect(eye.x - 1, eyeY, 3, 1, 'o', eye.part);
    } else {
      builder.rect(eye.x - 1, eyeY - 1, 3, eye.part === PART.eyeNear ? 4 : 3, 'e', eye.part);
      builder.set(eye.x - 1, eyeY - 1, 'w', eye.part);
    }
  }
  builder.set(headX - 3, headY + 3, 'o', PART.head);
  builder.set(headX - 2, headY + 4, 'o', PART.head);
  builder.set(headX - 1, headY + 3, 'o', PART.head);
}

function makeRows(builder: RasterBuilder): { rows: string[]; partRows: string[] } {
  const rows: string[] = [], partRows: string[] = [];
  for (let gy = 0; gy < HEIGHT; gy++) {
    let colors = '', parts = '';
    for (let gx = 0; gx < WIDTH; gx++) {
      const cell = builder.get(gx - ORIGIN_X, gy - GROUND_Y);
      colors += cell?.color ?? ' ';
      parts += cell?.part ?? ' ';
    }
    rows.push(colors); partRows.push(parts);
  }
  return { rows, partRows };
}

function deriveMetrics(builder: RasterBuilder, landmarks: BuildLandmarks): CreatureMetrics {
  const points = [...builder.cells.keys()].map(key => key.split(',').map(Number) as [number, number]);
  const left = Math.min(...points.map(([x]) => x));
  const right = Math.max(...points.map(([x]) => x));
  const top = Math.min(...points.map(([, y]) => y));
  const bottom = Math.max(...points.map(([, y]) => y));
  const limbParts = new Set<string>([PART.legFarFront, PART.legFarRear, PART.legNearFront, PART.legNearRear]);
  const support = [...builder.cells.entries()]
    .filter(([, cell]) => limbParts.has(cell.part))
    .map(([key]) => Number(key.split(',')[0]));
  return {
    bounds: { left, right, top, bottom },
    headTop: { x: landmarks.headX, y: top },
    mouth: landmarks.mouth,
    back: { x: landmarks.bodyX, y: landmarks.bodyY - landmarks.bodyRy },
    tailTip: landmarks.tailTip,
    front: { x: left - 1, y: landmarks.mouth.y },
    supportMin: Math.min(...support),
    supportMax: Math.max(...support),
    shadowRadius: clamp(Math.ceil((right - left + 1) * 0.42), 14, 18),
  };
}

const rasterCache = new Map<string, CreatureRaster>();
const RASTER_CACHE_LIMIT = 32;

export function rasterizeCreature(
  anatomy: AnatomyParameters,
  pose: CreaturePose = 'stand',
  gaitFrame = 0,
  blink = false,
): CreatureRaster {
  const visual = visualAnatomy(anatomy);
  const visualKey = `${pose}:${((Math.round(gaitFrame) % 4) + 4) % 4}:${blink ? 1 : 0}:${anatomyVisualKey(anatomy)}`;
  const cached = rasterCache.get(visualKey);
  if (cached) return cached;
  const builder = new RasterBuilder();
  const landmarks = pose === 'sleep' ? buildSleep(builder, visual) : buildStand(builder, visual, gaitFrame);
  builder.outline();
  addFace(builder, landmarks, pose, blink);
  const { rows, partRows } = makeRows(builder);
  const raster: CreatureRaster = {
    rows,
    partRows,
    palette: palette(visual),
    width: WIDTH,
    height: HEIGHT,
    originX: ORIGIN_X,
    groundY: GROUND_Y,
    metrics: deriveMetrics(builder, landmarks),
    visualKey,
  };
  rasterCache.set(visualKey, raster);
  if (rasterCache.size > RASTER_CACHE_LIMIT) rasterCache.delete(rasterCache.keys().next().value!);
  return raster;
}

function transformPoint(point: Point, x: number, y: number, facing: number, scale: number): Point {
  const direction = facing >= 0 ? -1 : 1;
  return { x: Math.round(x) + point.x * direction * scale, y: Math.round(y) + point.y * scale };
}

function worldMetrics(raster: CreatureRaster, x: number, y: number, facing: number, scale: number): CreatureWorldMetrics {
  const direction = facing >= 0 ? -1 : 1;
  const left = direction > 0 ? raster.metrics.bounds.left : -raster.metrics.bounds.right;
  const right = direction > 0 ? raster.metrics.bounds.right : -raster.metrics.bounds.left;
  return {
    bounds: {
      left: Math.round(x) + left * scale,
      right: Math.round(x) + right * scale,
      top: Math.round(y) + raster.metrics.bounds.top * scale,
      bottom: Math.round(y) + raster.metrics.bounds.bottom * scale,
    },
    headTop: transformPoint(raster.metrics.headTop, x, y, facing, scale),
    mouth: transformPoint(raster.metrics.mouth, x, y, facing, scale),
    back: transformPoint(raster.metrics.back, x, y, facing, scale),
    tailTip: transformPoint(raster.metrics.tailTip, x, y, facing, scale),
    front: transformPoint(raster.metrics.front, x, y, facing, scale),
    supportMin: Math.round(x) + (direction > 0 ? raster.metrics.supportMin : -raster.metrics.supportMax) * scale,
    supportMax: Math.round(x) + (direction > 0 ? raster.metrics.supportMax : -raster.metrics.supportMin) * scale,
    shadowRadius: raster.metrics.shadowRadius * scale,
  };
}

export function paintCreature(
  ctx: CanvasRenderingContext2D,
  anatomy: AnatomyParameters,
  x: number,
  y: number,
  options: CreaturePaintOptions = {},
): CreatureWorldMetrics {
  const pose = options.pose ?? 'stand';
  const gaitFrame = options.gaitFrame ?? 0;
  const blink = options.blink ?? false;
  const facing = options.facing ?? 1;
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const raster = rasterizeCreature(anatomy, pose, gaitFrame, blink);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(facing >= 0 ? -scale : scale, scale);
  for (let row = 0; row < raster.height; row++) for (let column = 0; column < raster.width; column++) {
    const pixel = raster.rows[row][column];
    if (pixel === ' ') continue;
    ctx.fillStyle = raster.palette[pixel];
    ctx.fillRect(column - raster.originX, row - raster.groundY, 1, 1);
  }
  ctx.restore();
  return worldMetrics(raster, x, y, facing, scale);
}

// Legacy exports remain available for small integrations while all live
// creature rendering uses the anatomy-aware path above.
export const juvenile: PixelAsset = (() => {
  const raster = rasterizeCreature(BASELINE_RENDER_ANATOMY, 'stand');
  return { rows: raster.rows, palette: raster.palette };
})();
export const sleeping: PixelAsset = (() => {
  const raster = rasterizeCreature(BASELINE_RENDER_ANATOMY, 'sleep');
  return { rows: raster.rows, palette: raster.palette };
})();

export function paintAsset(
  ctx: CanvasRenderingContext2D,
  asset: PixelAsset,
  x: number,
  y: number,
  flip: boolean,
  blink: boolean,
  phase: number,
) {
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); if (flip) ctx.scale(-1, 1);
  const origin = Math.floor(asset.rows[0].length / 2), height = asset.rows.length;
  asset.rows.forEach((row, j) => [...row].forEach((value, i) => {
    if (value === ' ') return;
    ctx.fillStyle = blink && (value === 'e' || value === 'w') ? asset.palette.c : asset.palette[value];
    const foot = j >= height - 3 ? Math.round(Math.sin(phase + (i < origin ? 0 : Math.PI))) : 0;
    ctx.fillRect(-origin + i, j - height + foot, 1, 1);
  }));
  ctx.restore();
}
