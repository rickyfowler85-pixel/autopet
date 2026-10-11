import { paintCreature } from './assets';
import { assistCare, completeLearning } from './learning';
import { createWorld, STEP, type Activity, type Affordance, type Point, type World } from './model';
import { advance } from './simulation';

export const DEVELOPMENT_DAY_SECONDS = 86_400;

export const HISTORY_PRESETS = [
  { id: 'autonomous', label: 'Autonomous mix' },
  { id: 'feeding-help', label: 'Frequent feeding help' },
  { id: 'grooming-help', label: 'Frequent grooming help' },
  { id: 'wading-heavy', label: 'Wading-heavy activity' },
  { id: 'foraging-heavy', label: 'Foraging-heavy activity' },
] as const;

export type HistoryPreset = typeof HISTORY_PRESETS[number]['id'];
type AnatomyParameters = World['creature']['anatomy']['current'];
type AnatomyParameter = keyof AnatomyParameters;
type AnatomyPressure = keyof World['creature']['anatomy']['pressures'];

const PARAMETER_LABELS: Record<AnatomyParameter, string> = {
  bodyLength: 'Body length',
  bodyDepth: 'Body depth',
  limbLength: 'Limb length',
  limbBuild: 'Limb build',
  earSize: 'Ear size',
  earLift: 'Ear lift',
  tailLength: 'Tail length',
  tailDepth: 'Tail depth',
  posture: 'Posture',
  coatHue: 'Coat hue',
  coatLightness: 'Coat lightness',
  creamCoverage: 'Cream coverage',
};

const PRESSURE_LABELS: Record<AnatomyPressure, string> = {
  mobility: 'Mobility',
  aquatic: 'Aquatic activity',
  groundForaging: 'Ground foraging',
  recovery: 'Rest and recovery',
  selfCare: 'Independent self-care',
  grooming: 'Grooming activity',
};

export interface AnatomyTableRow {
  key: AnatomyParameter;
  label: string;
  current: number;
  target: number;
  delta: number;
}

export interface PressureTableRow {
  key: AnatomyPressure;
  label: string;
  value: number;
}

export function anatomyTableRows(world: World): AnatomyTableRow[] {
  const anatomy = world.creature.anatomy;
  return (Object.keys(PARAMETER_LABELS) as AnatomyParameter[]).map(key => ({
    key,
    label: PARAMETER_LABELS[key],
    current: anatomy.current[key],
    target: anatomy.target[key],
    delta: anatomy.target[key] - anatomy.current[key],
  }));
}

export function pressureTableRows(world: World): PressureTableRow[] {
  return (Object.keys(PRESSURE_LABELS) as AnatomyPressure[]).map(key => ({
    key,
    label: PRESSURE_LABELS[key],
    value: world.creature.anatomy.pressures[key],
  }));
}

interface RecordedExposure {
  activity: Activity;
  affordance: Affordance;
  opportunityId: string;
  position: Point;
  attempts: number;
}

const ACTIVITY_HISTORIES: Partial<Record<HistoryPreset, RecordedExposure[]>> = {
  'wading-heavy': [
    { activity: 'wade', affordance: 'wade', opportunityId: 'shallow-pool', position: { x: 270, y: 184 }, attempts: 100 },
  ],
  'foraging-heavy': [
    { activity: 'forage', affordance: 'forage', opportunityId: 'north-vegetation', position: { x: 180, y: 146 }, attempts: 25 },
    { activity: 'rest', affordance: 'rest', opportunityId: 'root-shelter', position: { x: 86, y: 167 }, attempts: 40 },
  ],
};

/** Replays compact completed actions through the production evidence/learning path. */
function recordActivityHistoryDay(world: World, history: RecordedExposure[], elapsedDay: number) {
  const nextDay = Math.floor(world.time / DEVELOPMENT_DAY_SECONDS) + 1;
  world.tick = Math.round(nextDay * DEVELOPMENT_DAY_SECONDS / STEP);
  world.time = world.tick * STEP;
  for (const exposure of history) {
    for (let attempt = 0; attempt < exposure.attempts; attempt++) {
      completeLearning(
        world,
        exposure.activity,
        exposure.affordance,
        exposure.opportunityId,
        (attempt + elapsedDay) % 5 === 0 ? 'partial' : 'success',
        false,
        30,
        exposure.position,
      );
    }
  }
}

function offerPresetCare(world: World, preset: HistoryPreset) {
  const intent = world.creature.intent;
  if (!intent || intent.careOfferResolved || (intent.phase !== 'request' && intent.phase !== 'attempt')) return;
  if (preset === 'feeding-help' && intent.activity === 'forage') assistCare(world, 'feeding');
  if (preset === 'grooming-help' && intent.activity === 'groom') assistCare(world, 'grooming');
}

function nextPaint() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

export async function advanceDevelopment(
  world: World,
  days: number,
  onProgress?: (completedDays: number, totalDays: number) => void,
) {
  const totalDays = Math.max(0, Math.floor(days));
  for (let day = 0; day < totalDays; day++) {
    advance(world, DEVELOPMENT_DAY_SECONDS);
    onProgress?.(day + 1, totalDays);
    await nextPaint();
  }
}

export async function replayRecordedHistory(
  identitySeed: number,
  days: number,
  preset: HistoryPreset,
  onProgress?: (completedDays: number, totalDays: number) => void,
): Promise<World> {
  const world = createWorld(identitySeed);
  const totalDays = Math.max(0, Math.floor(days));
  const careHistory = preset === 'feeding-help' || preset === 'grooming-help';
  const activityHistory = ACTIVITY_HISTORIES[preset];
  for (let day = 0; day < totalDays; day++) {
    if (activityHistory) {
      recordActivityHistoryDay(world, activityHistory, day + 1);
    } else if (careHistory) {
      const end = world.time + DEVELOPMENT_DAY_SECONDS;
      while (world.time < end - 0.05) {
        offerPresetCare(world, preset);
        advance(world, Math.min(10, end - world.time));
      }
    } else {
      advance(world, DEVELOPMENT_DAY_SECONDS);
    }
    onProgress?.(day + 1, totalDays);
    await nextPaint();
  }
  return world;
}

export function paintAnatomyPair(
  canvas: HTMLCanvasElement,
  left: AnatomyParameters,
  right: AnatomyParameters,
) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#dfe1d2';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#d3d6c4';
  context.fillRect(0, Math.round(height * 0.7), width, Math.ceil(height * 0.3));
  context.fillStyle = '#afb69b';
  context.fillRect(Math.floor(width / 2), 8, 1, height - 16);
  context.imageSmoothingEnabled = false;
  const ground = Math.round(height * 0.72);
  paintCreature(context, left, Math.round(width * 0.25), ground, {
    pose: 'stand', facing: 1, gaitFrame: 0, blink: false, scale: 3,
  });
  paintCreature(context, right, Math.round(width * 0.75), ground, {
    pose: 'stand', facing: 1, gaitFrame: 0, blink: false, scale: 3,
  });
}

export function developmentFingerprint(world: World): string {
  const state = JSON.stringify({
    identitySeed: world.identitySeed,
    time: world.time,
    random: [world.seed, world.outcomeSeed, world.socialSeed],
    anatomy: world.creature.anatomy,
    evidence: world.development.evidence,
    independence: world.creature.learning.independence,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < state.length; index++) {
    hash ^= state.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function comparisonText(left: World, right: World, leftLabel: string, rightLabel: string): string {
  const rows = anatomyTableRows(left).map(leftRow => {
    const rightValue = right.creature.anatomy.current[leftRow.key];
    const difference = rightValue - leftRow.current;
    return `${leftRow.label.padEnd(17)} ${leftRow.current.toFixed(3)}  ${rightValue.toFixed(3)}  ${difference >= 0 ? '+' : ''}${difference.toFixed(3)}`;
  });
  return [
    `${leftLabel} / ${rightLabel}`,
    `Seed ${left.identitySeed} · ${Math.round(left.time / DEVELOPMENT_DAY_SECONDS)} simulated days`,
    `State ${developmentFingerprint(left)} / ${developmentFingerprint(right)}`,
    '',
    `${'Parameter'.padEnd(17)} left   right  Δ right`,
    ...rows,
  ].join('\n');
}

