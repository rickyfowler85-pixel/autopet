import {
  ACTIVITIES,
  AFFORDANCES,
  HABITAT_FEATURES,
  OBJECT_KINDS,
  createWorld,
  type Activity,
  type Affordance,
  type BehaviorIntent,
  type DevelopmentOutcome,
  type EvidenceSummary,
  type HabitatObject,
  type Outcome,
  type World,
  validPosition,
} from './model';
import { advanceOffline } from './simulation';
import { planRoute } from './behavior';

export const STORAGE_KEY = 'autopet.habitat.v1';
const PHASES = ['notice', 'approach', 'attempt', 'outcome', 'reflect'];
const OUTCOMES: Outcome[] = ['success', 'partial', 'deferred'];
const SOCIAL_KEYS = ['invitations', 'accepted', 'declined', 'acknowledgments', 'petAccepted', 'petDeferred'] as const;

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function unit(value: unknown): value is number { return finite(value) && value >= 0 && value <= 1; }
function point(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return finite(candidate.x) && finite(candidate.y) && validPosition({ x: candidate.x, y: candidate.y });
}
function activity(value: unknown): value is Activity { return typeof value === 'string' && ACTIVITIES.includes(value as Activity); }

function summary(value: unknown, worldTime: number): value is EvidenceSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const validCounts = ['attempts', 'successes', 'partials', 'deferred', 'assisted']
    .every(key => Number.isInteger(item[key]) && (item[key] as number) >= 0);
  if (!validCounts
    || !finite(item.totalSeconds) || item.totalSeconds < 0
    || (item.assisted as number) > (item.attempts as number)
    || (item.successes as number) + (item.partials as number) + (item.deferred as number) !== item.attempts) return false;
  const attempts = item.attempts as number;
  if (attempts === 0) return item.totalSeconds === 0 && item.firstAt === null && item.lastAt === null;
  return finite(item.firstAt) && finite(item.lastAt) && item.firstAt >= 0 && item.firstAt <= item.lastAt && item.lastAt <= worldTime;
}

function outcomesFitSummary(summaryValue: EvidenceSummary, outcomes: DevelopmentOutcome[]): boolean {
  return outcomes.length <= summaryValue.attempts
    && outcomes.filter(item => item.outcome === 'success').length <= summaryValue.successes
    && outcomes.filter(item => item.outcome === 'partial').length <= summaryValue.partials
    && outcomes.filter(item => item.outcome === 'deferred').length <= summaryValue.deferred
    && outcomes.filter(item => item.assisted).length <= summaryValue.assisted;
}

function intent(value: unknown): value is BehaviorIntent {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.id) && (item.id as number) > 0
    && activity(item.activity)
    && PHASES.includes(String(item.phase))
    && typeof item.opportunityId === 'string'
    && AFFORDANCES.includes(item.affordance as Affordance)
    && point(item.target)
    && Array.isArray(item.route)
    && item.route.length <= 128
    && item.route.every(point)
    && finite(item.noticedAt)
    && finite(item.phaseRemaining)
    && typeof item.assisted === 'boolean'
    && (item.resolvedPosition === undefined || point(item.resolvedPosition))
    && (item.outcome === undefined || OUTCOMES.includes(item.outcome as Outcome));
}

function objectState(value: unknown): value is HabitatObject {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && OBJECT_KINDS.includes(item.kind as typeof OBJECT_KINDS[number])
    && point(item.position)
    && Array.isArray(item.affordances)
    && item.affordances.every(entry => AFFORDANCES.includes(entry as Affordance))
    && Number.isInteger(item.visits) && (item.visits as number) >= 0
    && (item.lastMovedAt === undefined || finite(item.lastMovedAt));
}

function validV2(value: unknown): value is World {
  if (!value || typeof value !== 'object') return false;
  const w = value as unknown as World;
  if (w.version !== 2
    || !Number.isInteger(w.identitySeed) || w.identitySeed <= 0
    || !Number.isInteger(w.seed) || w.seed <= 0
    || !Number.isInteger(w.outcomeSeed) || w.outcomeSeed <= 0
    || !Number.isInteger(w.socialSeed) || w.socialSeed <= 0
    || !Number.isInteger(w.tick) || w.tick < 0
    || !Number.isInteger(w.nextIntentId) || w.nextIntentId <= 0
    || !finite(w.time) || !finite(w.lastSaved)) return false;
  const creature = w.creature;
  if (!creature || !point(creature.position) || !point(creature.target) || !activity(creature.activity)
    || !finite(creature.facing) || !finite(creature.remaining) || !finite(creature.distance)
    || !creature.anatomy || !creature.temperament || !creature.internal || !creature.learning) return false;
  if (!['curiosity', 'sociability', 'restfulness', 'persistence'].every(key => unit(creature.temperament[key as keyof typeof creature.temperament]))) return false;
  if (!['energy', 'forageReadiness', 'groomingReadiness'].every(key => unit(creature.internal[key as keyof typeof creature.internal]))) return false;
  if (!ACTIVITIES.every(key => unit(creature.learning.activityPreferences[key]))) return false;
  if (!OBJECT_KINDS.every(key => unit(creature.learning.objectInterests[key]))) return false;
  const activityTotal = Object.values(creature.learning.activityPreferences).reduce((sum, entry) => sum + entry, 0);
  const objectTotal = Object.values(creature.learning.objectInterests).reduce((sum, entry) => sum + entry, 0);
  if (Math.abs(activityTotal - 1) > 1e-6 || Math.abs(objectTotal - 1) > 1e-6) return false;
  for (const domain of ['feeding', 'grooming'] as const) {
    const skill = creature.learning.independence[domain];
    if (!skill || !unit(skill.capability) || !unit(skill.confidence) || !unit(skill.reliance)
      || !Number.isInteger(skill.attempts) || skill.attempts < 0
      || !Number.isInteger(skill.successes) || skill.successes < 0
      || !Number.isInteger(skill.assisted) || skill.assisted < 0
      || skill.successes > skill.attempts || skill.assisted > skill.attempts) return false;
  }
  if (!Object.values(creature.learning.habituation).every(entry => entry && unit(entry.level) && finite(entry.updatedAt))) return false;
  if (creature.intent !== undefined && !intent(creature.intent)) return false;
  if (!Array.isArray(w.objects) || w.objects.length !== 3 || !w.objects.every(objectState)) return false;
  if (new Set(w.objects.map(item => item.id)).size !== 3 || new Set(w.objects.map(item => item.kind)).size !== 3) return false;
  if (creature.intent !== undefined && !['player-invitation', ...w.objects.map(item => item.id), ...HABITAT_FEATURES.map(item => item.id)].includes(creature.intent.opportunityId)) return false;
  if (!Array.isArray(w.experiences) || w.experiences.length > 80 || !w.experiences.every(event => event && finite(event.time) && typeof event.kind === 'string')) return false;
  const evidence = w.development?.evidence;
  if (!w.development || w.development.stage !== 'juvenile' || !Number.isInteger(w.development.observations) || w.development.observations < 0 || !evidence) return false;
  const activityEntries = ACTIVITIES.map(key => [key, evidence.activities?.[key]] as const);
  const affordanceEntries = Object.entries(evidence.affordances ?? {}) as [Affordance, EvidenceSummary][];
  const opportunityEntries = Object.entries(evidence.opportunities ?? {});
  if (Object.keys(evidence.activities ?? {}).length !== ACTIVITIES.length
    || !activityEntries.every(([, value]) => summary(value, w.time))
    || !affordanceEntries.every(([key, value]) => AFFORDANCES.includes(key) && summary(value, w.time))
    || !opportunityEntries.every(([key, value]) => key.length > 0 && summary(value, w.time))) return false;
  const activityAttempts = activityEntries.reduce((sum, [, value]) => sum + value.attempts, 0);
  const affordanceAttempts = affordanceEntries.reduce((sum, [, value]) => sum + value.attempts, 0);
  const opportunityAttempts = opportunityEntries.reduce((sum, [, value]) => sum + value.attempts, 0);
  if (activityAttempts !== affordanceAttempts || activityAttempts !== opportunityAttempts) return false;
  if (!Array.isArray(evidence.outcomes) || evidence.outcomes.length !== Math.min(activityAttempts, 240)
    || !evidence.outcomes.every((outcome, index) => finite(outcome.time) && outcome.time >= 0 && outcome.time <= w.time
      && (index === 0 || evidence.outcomes[index - 1].time <= outcome.time)
      && activity(outcome.activity) && AFFORDANCES.includes(outcome.affordance) && typeof outcome.opportunityId === 'string' && outcome.opportunityId.length > 0
      && point(outcome.position) && OUTCOMES.includes(outcome.outcome) && typeof outcome.assisted === 'boolean')) return false;
  for (const [key, summaryValue] of activityEntries) {
    if (!outcomesFitSummary(summaryValue, evidence.outcomes.filter(outcome => outcome.activity === key))) return false;
  }
  for (const [key, summaryValue] of affordanceEntries) {
    if (!outcomesFitSummary(summaryValue, evidence.outcomes.filter(outcome => outcome.affordance === key))) return false;
  }
  for (const [key, summaryValue] of opportunityEntries) {
    if (!outcomesFitSummary(summaryValue, evidence.outcomes.filter(outcome => outcome.opportunityId === key))) return false;
  }
  const social = evidence.social;
  if (!social || !SOCIAL_KEYS.every(key => Number.isInteger(social[key]) && social[key] >= 0)
    || social.invitations !== social.accepted + social.declined) return false;
  if (w.pendingInvitation !== undefined && (!point(w.pendingInvitation.position) || !finite(w.pendingInvitation.createdAt) || !finite(w.pendingInvitation.expiresAt))) return false;
  return true;
}

function migrateV1(legacy: Record<string, unknown>): World | null {
  if (!Number.isInteger(legacy.seed) || (legacy.seed as number) <= 0 || !Number.isInteger(legacy.tick) || (legacy.tick as number) < 0
    || !finite(legacy.time) || !finite(legacy.lastSaved)) return null;
  const oldCreature = legacy.creature as Record<string, unknown> | undefined;
  if (!oldCreature || !point(oldCreature.position) || !point(oldCreature.target) || !activity(oldCreature.activity)) return null;
  const w = createWorld(legacy.seed as number);
  w.seed = legacy.seed as number;
  w.outcomeSeed = ((w.seed ^ 0x9e3779b9) >>> 0) || 1;
  w.socialSeed = ((w.seed ^ 0x85ebca6b) >>> 0) || 1;
  w.tick = legacy.tick as number;
  w.time = legacy.time as number;
  w.lastSaved = legacy.lastSaved as number;
  w.creature.position = { ...oldCreature.position as { x: number; y: number } };
  w.creature.target = { ...oldCreature.target as { x: number; y: number } };
  w.creature.activity = oldCreature.activity as Activity;
  if (finite(oldCreature.facing)) w.creature.facing = oldCreature.facing;
  if (finite(oldCreature.remaining)) w.creature.remaining = oldCreature.remaining;
  if (finite(oldCreature.distance) && oldCreature.distance >= 0) w.creature.distance = oldCreature.distance;
  const temperament = oldCreature.temperament as Record<string, unknown> | undefined;
  if (temperament && unit(temperament.curiosity) && unit(temperament.sociability) && unit(temperament.restfulness)) {
    w.creature.temperament.curiosity = temperament.curiosity;
    w.creature.temperament.sociability = temperament.sociability;
    w.creature.temperament.restfulness = temperament.restfulness;
  }
  if (Array.isArray(legacy.objects) && legacy.objects.length === 3) {
    for (const current of w.objects) {
      const old = legacy.objects.find(value => value && typeof value === 'object' && (value as Record<string, unknown>).id === current.id) as Record<string, unknown> | undefined;
      if (old && point(old.position)) current.position = { ...old.position };
      if (old && Number.isInteger(old.visits) && (old.visits as number) >= 0) current.visits = old.visits as number;
    }
  }
  if (Array.isArray(legacy.experiences)) {
    w.experiences = legacy.experiences.filter(value => value && typeof value === 'object' && finite((value as Record<string, unknown>).time)
      && typeof (value as Record<string, unknown>).kind === 'string').slice(-80) as World['experiences'];
  }
  const development = legacy.development as Record<string, unknown> | undefined;
  if (development && Number.isInteger(development.observations) && (development.observations as number) >= 0) {
    w.development.observations = development.observations as number;
  }
  const explorationTarget = typeof legacy.explorationTarget === 'string' ? legacy.explorationTarget : undefined;
  const map: Partial<Record<Activity, { id: string; affordance: Affordance }>> = {
    idle: { id: 'open-clearing', affordance: 'observe' },
    wander: { id: 'open-clearing', affordance: 'roam' },
    rest: { id: 'root-shelter', affordance: 'rest' },
    explore: { id: explorationTarget ?? 'open-clearing', affordance: 'investigate' },
  };
  const mapped = map[w.creature.activity];
  if (mapped) {
    const route = planRoute(w.creature.position, w.creature.target);
    if (route) {
      w.creature.intent = {
        id: w.nextIntentId++, activity: w.creature.activity, phase: 'approach', opportunityId: mapped.id,
        affordance: mapped.affordance, target: { ...w.creature.target }, route,
        noticedAt: w.time, phaseRemaining: 0, assisted: false,
      };
    }
  }
  return w;
}

export function decode(raw: string): World | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const version = (parsed as { version?: unknown }).version;
    if (version === 1) return migrateV1(parsed as Record<string, unknown>);
    return validV2(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function load(): { world: World; offline: number; available: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const world = raw ? decode(raw) : null;
    if (world) {
      const now = Date.now();
      const offline = Math.min(21600, Math.max(0, (now - world.lastSaved) / 1000));
      advanceOffline(world, offline);
      world.lastSaved = now;
      return { world, offline, available: true };
    }
    return { world: createWorld(), offline: 0, available: true };
  } catch {
    return { world: createWorld(), offline: 0, available: false };
  }
}

export function save(w: World): boolean {
  try {
    w.lastSaved = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
    return true;
  } catch {
    return false;
  }
}
