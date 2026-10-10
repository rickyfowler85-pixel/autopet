export interface Point { x: number; y: number }

export const ACTIVITIES = ['idle', 'wander', 'rest', 'explore', 'forage', 'groom', 'wade', 'play'] as const;
export type Activity = typeof ACTIVITIES[number];
export const OBJECT_KINDS = ['branch', 'stone', 'seedpod'] as const;
export type ObjectKind = typeof OBJECT_KINDS[number];
export const AFFORDANCES = ['observe', 'roam', 'rest', 'investigate', 'forage', 'groom', 'wade', 'play'] as const;
export type Affordance = typeof AFFORDANCES[number];
export type IntentPhase = 'notice' | 'approach' | 'attempt' | 'outcome' | 'reflect';
export type Outcome = 'success' | 'partial' | 'deferred';
export type CareDomain = 'feeding' | 'grooming';

export interface Anatomy {
  stage: 'juvenile';
  sprite: string;
  traits: { ears: number; tail: number; coat: string };
}

export interface Temperament {
  curiosity: number;
  sociability: number;
  restfulness: number;
  persistence: number;
}

export interface IndependenceSkill {
  capability: number;
  confidence: number;
  reliance: number;
  attempts: number;
  successes: number;
  assisted: number;
}

export interface Habituation {
  level: number;
  updatedAt: number;
}

export interface LearningState {
  activityPreferences: Record<Activity, number>;
  objectInterests: Record<ObjectKind, number>;
  habituation: Record<string, Habituation>;
  independence: Record<CareDomain, IndependenceSkill>;
}

export interface InternalState {
  energy: number;
  forageReadiness: number;
  groomingReadiness: number;
}

export interface BehaviorIntent {
  id: number;
  activity: Activity;
  phase: IntentPhase;
  opportunityId: string;
  affordance: Affordance;
  target: Point;
  route: Point[];
  noticedAt: number;
  phaseRemaining: number;
  assisted: boolean;
  outcome?: Outcome;
  resolvedPosition?: Point;
}

export interface Creature {
  position: Point;
  target: Point;
  facing: number;
  activity: Activity;
  remaining: number;
  anatomy: Anatomy;
  temperament: Temperament;
  distance: number;
  internal: InternalState;
  learning: LearningState;
  intent?: BehaviorIntent;
}

export interface HabitatObject {
  id: string;
  kind: ObjectKind;
  position: Point;
  affordances: Affordance[];
  visits: number;
  lastMovedAt?: number;
}

export interface HabitatFeature {
  id: string;
  kind: 'shelter' | 'pool' | 'vegetation' | 'clearing';
  position: Point;
  affordances: Affordance[];
  comfort?: number;
}

export interface Experience {
  time: number;
  kind: string;
  subject?: string;
  activity?: Activity;
  affordance?: Affordance;
  phase?: IntentPhase;
  outcome?: Outcome;
  assisted?: boolean;
}

export interface EvidenceSummary {
  attempts: number;
  successes: number;
  partials: number;
  deferred: number;
  assisted: number;
  totalSeconds: number;
  firstAt: number | null;
  lastAt: number | null;
}

export interface DevelopmentOutcome {
  time: number;
  activity: Activity;
  affordance: Affordance;
  opportunityId: string;
  position: Point;
  outcome: Outcome;
  assisted: boolean;
}

export interface DevelopmentEvidence {
  activities: Record<Activity, EvidenceSummary>;
  affordances: Partial<Record<Affordance, EvidenceSummary>>;
  opportunities: Record<string, EvidenceSummary>;
  outcomes: DevelopmentOutcome[];
  social: {
    invitations: number;
    accepted: number;
    declined: number;
    acknowledgments: number;
    petAccepted: number;
    petDeferred: number;
  };
}

export interface PlayerEvent { type: 'invite'; position: Point }
export interface PendingInvitation { position: Point; createdAt: number; expiresAt: number }
export interface DevelopmentState {
  stage: 'juvenile';
  observations: number;
  evidence: DevelopmentEvidence;
}

export interface World {
  version: 2;
  identitySeed: number;
  seed: number;
  outcomeSeed: number;
  socialSeed: number;
  time: number;
  tick: number;
  nextIntentId: number;
  creature: Creature;
  objects: HabitatObject[];
  experiences: Experience[];
  development: DevelopmentState;
  lastSaved: number;
  pendingInvitation?: PendingInvitation;
}

export const STEP = 0.1;
export const SHELTER: Point = { x: 86, y: 167 };
export const HABITAT_FEATURES: HabitatFeature[] = [
  { id: 'root-shelter', kind: 'shelter', position: SHELTER, affordances: ['rest', 'observe'], comfort: 1 },
  { id: 'shallow-pool', kind: 'pool', position: { x: 270, y: 184 }, affordances: ['investigate', 'groom', 'wade'], comfort: 0.45 },
  { id: 'north-vegetation', kind: 'vegetation', position: { x: 180, y: 146 }, affordances: ['forage', 'investigate'], comfort: 0.35 },
  { id: 'south-vegetation', kind: 'vegetation', position: { x: 278, y: 222 }, affordances: ['forage', 'investigate', 'groom'], comfort: 0.4 },
  { id: 'open-clearing', kind: 'clearing', position: { x: 202, y: 194 }, affordances: ['observe', 'roam', 'play'], comfort: 0.25 },
];

export function validPosition(p: Point): boolean {
  return p.x >= 54 && p.x <= 345 && p.y >= 139 && p.y <= 239
    && !(((p.x - 333) / 66) ** 2 + ((p.y - 166) / 31) ** 2 < 1);
}

export function random(w: World, stream: 'decision' | 'outcome' | 'social' = 'decision'): number {
  const field = stream === 'decision' ? 'seed' : stream === 'outcome' ? 'outcomeSeed' : 'socialSeed';
  let x = w[field] | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  w[field] = x >>> 0;
  return w[field] / 4294967296;
}

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function record(w: World, kind: string, details?: string | Omit<Experience, 'time' | 'kind'>) {
  const extra = typeof details === 'string' ? { subject: details } : details ?? {};
  w.experiences.push({ time: w.time, kind, ...extra });
  if (w.experiences.length > 80) w.experiences.shift();
}

export function emptySummary(): EvidenceSummary {
  return { attempts: 0, successes: 0, partials: 0, deferred: 0, assisted: 0, totalSeconds: 0, firstAt: null, lastAt: null };
}

export function emptyEvidence(): DevelopmentEvidence {
  return {
    activities: Object.fromEntries(ACTIVITIES.map(activity => [activity, emptySummary()])) as Record<Activity, EvidenceSummary>,
    affordances: {},
    opportunities: {},
    outcomes: [],
    social: { invitations: 0, accepted: 0, declined: 0, acknowledgments: 0, petAccepted: 0, petDeferred: 0 },
  };
}

function seedValue(seed: number, salt: number): number {
  let x = (seed ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function normalize<T extends string>(values: Record<T, number>): Record<T, number> {
  const total = Object.values<number>(values).reduce((sum, value) => sum + value, 0);
  for (const key of Object.keys(values) as T[]) values[key] /= total;
  return values;
}

export function createWorld(seed = 42891): World {
  const stableSeed = seed || 1;
  const temperament: Temperament = {
    curiosity: 0.35 + seedValue(stableSeed, 0x91e10da5) * 0.5,
    sociability: 0.25 + seedValue(stableSeed, 0x7f4a7c15) * 0.55,
    restfulness: 0.16 + seedValue(stableSeed, 0x6c8e9cf5) * 0.3,
    persistence: 0.3 + seedValue(stableSeed, 0x2d51a8ed) * 0.5,
  };
  const activityPreferences = normalize<Activity>({
    idle: 0.15,
    wander: 0.13,
    rest: 0.1 + temperament.restfulness * 0.12,
    explore: 0.1 + temperament.curiosity * 0.13,
    forage: 0.13,
    groom: 0.1,
    wade: 0.07 + temperament.curiosity * 0.04,
    play: 0.07 + temperament.sociability * 0.06,
  });
  return {
    version: 2,
    identitySeed: stableSeed,
    seed: stableSeed,
    outcomeSeed: (stableSeed ^ 0x9e3779b9) >>> 0 || 1,
    socialSeed: (stableSeed ^ 0x85ebca6b) >>> 0 || 1,
    time: 0,
    tick: 0,
    nextIntentId: 1,
    lastSaved: Date.now(),
    creature: {
      position: { x: 191, y: 190 },
      target: { x: 191, y: 190 },
      facing: 1,
      activity: 'idle',
      remaining: 3,
      anatomy: { stage: 'juvenile', sprite: 'juvenile-placeholder', traits: { ears: 2, tail: 1, coat: 'slate' } },
      temperament,
      distance: 0,
      internal: { energy: 0.72, forageReadiness: 0.34, groomingReadiness: 0.28 },
      learning: {
        activityPreferences,
        objectInterests: normalize<ObjectKind>({ branch: 1, stone: 1, seedpod: 1 }),
        habituation: {},
        independence: {
          feeding: { capability: 0.3, confidence: 0.28, reliance: 0.12, attempts: 0, successes: 0, assisted: 0 },
          grooming: { capability: 0.25, confidence: 0.25, reliance: 0.12, attempts: 0, successes: 0, assisted: 0 },
        },
      },
    },
    objects: [
      { id: 'fallen-branch', kind: 'branch', position: { x: 147, y: 213 }, affordances: ['investigate', 'play', 'groom'], visits: 0 },
      { id: 'warm-stone', kind: 'stone', position: { x: 245, y: 192 }, affordances: ['investigate', 'rest', 'groom'], visits: 0 },
      { id: 'seedpod', kind: 'seedpod', position: { x: 212, y: 150 }, affordances: ['investigate', 'forage', 'play'], visits: 0 },
    ],
    experiences: [],
    development: { stage: 'juvenile', observations: 0, evidence: emptyEvidence() },
  };
}
