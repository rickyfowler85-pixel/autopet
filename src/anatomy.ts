import type {
  Activity,
  AdaptationPressures,
  Anatomy,
  AnatomyParameters,
  DevelopmentContext,
  DevelopmentDay,
  World,
} from './model';

const DAY_SECONDS = 86_400;
const DEVELOPMENT_TIME_CONSTANT = 6 * DAY_SECONDS;
const CARE_PRIOR_ATTEMPTS = 6;
const PRECISION = 1_000_000_000;
const VALIDATION_EPSILON = 1e-6;

export const ANATOMY_PARAMETER_KEYS = [
  'bodyLength',
  'bodyDepth',
  'limbLength',
  'limbBuild',
  'earSize',
  'earLift',
  'tailLength',
  'tailDepth',
  'posture',
  'coatHue',
  'coatLightness',
  'creamCoverage',
] as const;
export type AnatomyParameter = typeof ANATOMY_PARAMETER_KEYS[number];

export const ADAPTATION_PRESSURE_KEYS = [
  'mobility',
  'aquatic',
  'groundForaging',
  'recovery',
  'selfCare',
  'grooming',
] as const;
export type AdaptationPressure = typeof ADAPTATION_PRESSURE_KEYS[number];

export interface AnatomyBound {
  minimum: number;
  maximum: number;
}

export const ANATOMY_BOUNDS: Readonly<Record<AnatomyParameter, AnatomyBound>> = {
  bodyLength: { minimum: 0.9, maximum: 1.12 },
  bodyDepth: { minimum: 0.9, maximum: 1.12 },
  limbLength: { minimum: 0.88, maximum: 1.16 },
  limbBuild: { minimum: 0.9, maximum: 1.15 },
  earSize: { minimum: 0.86, maximum: 1.18 },
  earLift: { minimum: -0.16, maximum: 0.16 },
  tailLength: { minimum: 0.82, maximum: 1.25 },
  tailDepth: { minimum: 0.88, maximum: 1.18 },
  posture: { minimum: -0.16, maximum: 0.16 },
  coatHue: { minimum: -0.1, maximum: 0.1 },
  coatLightness: { minimum: -0.06, maximum: 0.06 },
  creamCoverage: { minimum: 0.92, maximum: 1.08 },
};

export const BASELINE_ANATOMY_PARAMETERS: Readonly<AnatomyParameters> = {
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

export const NEUTRAL_ADAPTATION_PRESSURES: Readonly<AdaptationPressures> = {
  mobility: 0.5,
  aquatic: 0.5,
  groundForaging: 0.5,
  recovery: 0.5,
  selfCare: 0.5,
  grooming: 0.5,
};

/** Rates normalize evidence volume; they do not assign an evolutionary class. */
export const ANATOMY_EXPOSURE_RATES = {
  explore: 300,
  wander: 105,
  play: 220,
  wade: 78,
  forage: 12,
  groom: 8,
  rest: 145,
  pool: 128,
  vegetation: 95,
  shelter: 130,
  clearing: 225,
} as const;

interface WindowEvidence {
  coveredDays: number;
  activities: Partial<Record<Activity, number>>;
  contexts: Partial<Record<DevelopmentContext, number>>;
  autonomousCare: number;
  assistedCare: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

function copyParameters(source: Readonly<AnatomyParameters>): AnatomyParameters {
  return Object.fromEntries(ANATOMY_PARAMETER_KEYS.map(key => [key, source[key]])) as unknown as AnatomyParameters;
}

function copyPressures(source: Readonly<AdaptationPressures>): AdaptationPressures {
  return Object.fromEntries(ADAPTATION_PRESSURE_KEYS.map(key => [key, source[key]])) as unknown as AdaptationPressures;
}

function addDay(target: WindowEvidence, day: DevelopmentDay) {
  for (const [key, tally] of Object.entries(day.activities) as [Activity, { attempts: number }][]) {
    target.activities[key] = (target.activities[key] ?? 0) + tally.attempts;
  }
  for (const [key, tally] of Object.entries(day.contexts) as [DevelopmentContext, { attempts: number }][]) {
    target.contexts[key] = (target.contexts[key] ?? 0) + tally.attempts;
  }
  for (const domain of ['feeding', 'grooming'] as const) {
    target.autonomousCare += day.care[domain].autonomous.attempts;
    target.assistedCare += day.care[domain].playerAssisted.attempts;
  }
}

function windowEvidence(w: Pick<World, 'time' | 'development'>, windowDays: 7 | 30): WindowEvidence {
  const rolling = w.development.evidence.rolling;
  const throughDay = Math.floor(w.time / DAY_SECONDS);
  const fromDay = throughDay - windowDays + 1;
  const startTime = Math.max(0, rolling.coverageStartedAt, fromDay * DAY_SECONDS);
  const result: WindowEvidence = {
    coveredDays: clamp((w.time - startTime) / DAY_SECONDS, 0, windowDays),
    activities: {},
    contexts: {},
    autonomousCare: 0,
    assistedCare: 0,
  };
  for (const day of rolling.days) {
    if (day.day >= fromDay && day.day <= throughDay) addDay(result, day);
  }
  return result;
}

function normalizedExposure(attempts: number, coveredDays: number, expectedPerDay: number): number {
  if (coveredDays <= 0) return 0.5;
  const observedPerDay = Math.max(0, attempts) / coveredDays;
  const raw = observedPerDay / (observedPerDay + expectedPerDay);
  const confidence = coveredDays / (coveredDays + 2);
  return clamp(0.5 + (raw - 0.5) * confidence, 0, 1);
}

function pressureProfile(evidence: WindowEvidence): AdaptationPressures {
  const activity = (key: Activity, expected: number) =>
    normalizedExposure(evidence.activities[key] ?? 0, evidence.coveredDays, expected);
  const context = (key: DevelopmentContext, expected: number) =>
    normalizedExposure(evidence.contexts[key] ?? 0, evidence.coveredDays, expected);
  const mobility = activity('explore', ANATOMY_EXPOSURE_RATES.explore) * 0.35
    + activity('wander', ANATOMY_EXPOSURE_RATES.wander) * 0.25
    + activity('play', ANATOMY_EXPOSURE_RATES.play) * 0.2
    + context('clearing', ANATOMY_EXPOSURE_RATES.clearing) * 0.2;
  const aquatic = activity('wade', ANATOMY_EXPOSURE_RATES.wade) * 0.65
    + context('pool', ANATOMY_EXPOSURE_RATES.pool) * 0.35;
  const groundForaging = activity('forage', ANATOMY_EXPOSURE_RATES.forage) * 0.65
    + context('vegetation', ANATOMY_EXPOSURE_RATES.vegetation) * 0.35;
  const recovery = activity('rest', ANATOMY_EXPOSURE_RATES.rest) * 0.65
    + context('shelter', ANATOMY_EXPOSURE_RATES.shelter) * 0.35;
  const careTotal = evidence.autonomousCare + evidence.assistedCare;
  const selfCare = (evidence.autonomousCare + CARE_PRIOR_ATTEMPTS)
    / (careTotal + CARE_PRIOR_ATTEMPTS * 2);
  return {
    mobility: clamp(mobility, 0, 1),
    aquatic: clamp(aquatic, 0, 1),
    groundForaging: clamp(groundForaging, 0, 1),
    recovery: clamp(recovery, 0, 1),
    selfCare: clamp(selfCare, 0, 1),
    grooming: activity('groom', ANATOMY_EXPOSURE_RATES.groom),
  };
}

/** Derives current pressures solely from bounded recorded developmental evidence. */
export function deriveAnatomyPressures(w: Pick<World, 'time' | 'development'>): AdaptationPressures {
  const recent = pressureProfile(windowEvidence(w, 7));
  const sustained = pressureProfile(windowEvidence(w, 30));
  return Object.fromEntries(ADAPTATION_PRESSURE_KEYS.map(key => [
    key,
    round(clamp(recent[key] * 0.65 + sustained[key] * 0.35, 0, 1)),
  ])) as unknown as AdaptationPressures;
}

/** Applies bounded anatomical relationships shared by generation and save validation. */
export function projectAnatomy(parameters: Readonly<AnatomyParameters>): AnatomyParameters {
  const projected = {} as AnatomyParameters;
  for (const key of ANATOMY_PARAMETER_KEYS) {
    const bound = ANATOMY_BOUNDS[key];
    const value = Number.isFinite(parameters[key]) ? parameters[key] : BASELINE_ANATOMY_PARAMETERS[key];
    projected[key] = clamp(value, bound.minimum, bound.maximum);
  }

  projected.bodyDepth = Math.min(projected.bodyDepth, 2.18 - projected.bodyLength);
  projected.limbLength = Math.max(projected.limbLength, 0.9 + 0.45 * (projected.bodyLength - 0.9));
  projected.limbBuild = Math.max(projected.limbBuild, 0.93 + 0.65 * (projected.bodyDepth - 0.9));
  projected.posture = Math.min(projected.posture, 0.16 - 0.45 * Math.max(0, projected.bodyDepth - 1));
  projected.tailDepth = Math.max(projected.tailDepth, 0.88 + 0.45 * (projected.bodyDepth - 0.9));
  projected.tailDepth = Math.min(projected.tailDepth, 1.18 - 0.28 * Math.max(0, projected.tailLength - 1));

  for (const key of ANATOMY_PARAMETER_KEYS) {
    const bound = ANATOMY_BOUNDS[key];
    projected[key] = round(clamp(projected[key], bound.minimum, bound.maximum));
  }
  return projected;
}

export const projectAnatomyParameters = projectAnatomy;

/** Maps independent pressures into one continuous, constrained body. */
export function deriveAnatomyTarget(pressures: Readonly<AdaptationPressures>): AnatomyParameters {
  const mobility = pressures.mobility - 0.5;
  const aquatic = pressures.aquatic - 0.5;
  const foraging = pressures.groundForaging - 0.5;
  const recovery = pressures.recovery - 0.5;
  const selfCare = pressures.selfCare - 0.5;
  const grooming = pressures.grooming - 0.5;
  return projectAnatomy({
    bodyLength: 1 + 0.14 * mobility + 0.16 * aquatic - 0.1 * foraging + 0.04 * selfCare,
    bodyDepth: 1 - 0.12 * mobility - 0.08 * aquatic + 0.16 * foraging + 0.1 * recovery - 0.04 * selfCare,
    limbLength: 1 + 0.24 * mobility - 0.1 * aquatic - 0.12 * foraging + 0.05 * selfCare,
    limbBuild: 1 - 0.08 * mobility + 0.16 * foraging + 0.1 * selfCare,
    earSize: 1 + 0.16 * mobility - 0.16 * aquatic + 0.06 * selfCare,
    earLift: 0.24 * mobility - 0.14 * aquatic - 0.12 * recovery + 0.06 * selfCare,
    tailLength: 1 + 0.28 * mobility + 0.18 * aquatic - 0.12 * foraging,
    tailDepth: 1 - 0.1 * mobility + 0.2 * aquatic + 0.16 * foraging,
    posture: 0.24 * mobility - 0.18 * foraging - 0.14 * recovery + 0.08 * selfCare,
    coatHue: 0.16 * aquatic + 0.07 * mobility - 0.12 * foraging,
    coatLightness: -0.06 * foraging + 0.04 * recovery + 0.04 * grooming,
    creamCoverage: 1 + 0.08 * recovery + 0.06 * grooming,
  });
}

export function anatomyParametersCompatible(parameters: Readonly<AnatomyParameters>, epsilon = VALIDATION_EPSILON): boolean {
  return parameters.bodyLength + parameters.bodyDepth <= 2.18 + epsilon
    && parameters.limbBuild + epsilon >= 0.93 + 0.65 * (parameters.bodyDepth - 0.9)
    && parameters.limbLength + epsilon >= 0.9 + 0.45 * (parameters.bodyLength - 0.9)
    && parameters.posture <= 0.16 - 0.45 * Math.max(0, parameters.bodyDepth - 1) + epsilon
    && parameters.tailDepth + epsilon >= 0.88 + 0.45 * (parameters.bodyDepth - 0.9)
    && parameters.tailDepth <= 1.18 - 0.28 * Math.max(0, parameters.tailLength - 1) + epsilon;
}

export function validAnatomyParameters(value: unknown): value is AnatomyParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== ANATOMY_PARAMETER_KEYS.length) return false;
  for (const key of ANATOMY_PARAMETER_KEYS) {
    const entry = candidate[key];
    const bound = ANATOMY_BOUNDS[key];
    if (typeof entry !== 'number' || !Number.isFinite(entry)
      || entry < bound.minimum - VALIDATION_EPSILON || entry > bound.maximum + VALIDATION_EPSILON) return false;
  }
  return anatomyParametersCompatible(candidate as unknown as AnatomyParameters);
}

export function validAdaptationPressures(value: unknown): value is AdaptationPressures {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === ADAPTATION_PRESSURE_KEYS.length
    && ADAPTATION_PRESSURE_KEYS.every(key => typeof candidate[key] === 'number'
      && Number.isFinite(candidate[key]) && (candidate[key] as number) >= 0 && (candidate[key] as number) <= 1);
}

export function validAnatomy(value: unknown, worldTime = Number.POSITIVE_INFINITY): value is Anatomy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.stage === 'juvenile'
    && typeof candidate.sprite === 'string' && candidate.sprite.length > 0
    && validAnatomyParameters(candidate.baseline)
    && validAnatomyParameters(candidate.current)
    && validAnatomyParameters(candidate.target)
    && validAdaptationPressures(candidate.pressures)
    && typeof candidate.lastUpdatedAt === 'number' && Number.isFinite(candidate.lastUpdatedAt)
    && candidate.lastUpdatedAt >= 0 && candidate.lastUpdatedAt <= worldTime + VALIDATION_EPSILON;
}

export function createAnatomy(time = 0): Anatomy {
  const cursor = Number.isFinite(time) ? Math.max(0, time) : 0;
  return {
    stage: 'juvenile',
    sprite: 'juvenile-procedural-v1',
    baseline: copyParameters(BASELINE_ANATOMY_PARAMETERS),
    current: copyParameters(BASELINE_ANATOMY_PARAMETERS),
    target: copyParameters(BASELINE_ANATOMY_PARAMETERS),
    pressures: copyPressures(NEUTRAL_ADAPTATION_PRESSURES),
    lastUpdatedAt: cursor,
  };
}

/** Integrates physical state toward the already-persisted target in simulation time. */
export function advanceAnatomy(anatomy: Anatomy, time: number): Anatomy {
  const nextTime = Number.isFinite(time) ? Math.max(anatomy.lastUpdatedAt, time) : anatomy.lastUpdatedAt;
  const elapsed = nextTime - anatomy.lastUpdatedAt;
  if (elapsed > 0) {
    const alpha = 1 - Math.exp(-elapsed / DEVELOPMENT_TIME_CONSTANT);
    const next = {} as AnatomyParameters;
    for (const key of ANATOMY_PARAMETER_KEYS) {
      next[key] = round(anatomy.current[key] + (anatomy.target[key] - anatomy.current[key]) * alpha);
    }
    anatomy.current = projectAnatomy(next);
  }
  anatomy.lastUpdatedAt = nextTime;
  return anatomy;
}

/** Recomputes pressure and target after durable evidence has been recorded. */
export function refreshAnatomyTarget(w: Pick<World, 'time' | 'development' | 'creature'>): Anatomy {
  const anatomy = w.creature.anatomy;
  anatomy.pressures = deriveAnatomyPressures(w);
  anatomy.target = deriveAnatomyTarget(anatomy.pressures);
  return anatomy;
}

/** Public synchronization helper for replay, devtools, and future cadence hooks. */
export function updateAnatomy(w: Pick<World, 'time' | 'development' | 'creature'>): Anatomy {
  advanceAnatomy(w.creature.anatomy, w.time);
  return refreshAnatomyTarget(w);
}

export const refreshAnatomy = updateAnatomy;

