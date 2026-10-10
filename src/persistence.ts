import {
  ACTIVITIES,
  AFFORDANCES,
  DEVELOPMENT_CONTEXTS,
  HABITAT_FEATURES,
  OBJECT_KINDS,
  STEP,
  createWorld,
  type Activity,
  type Affordance,
  type AssistanceSource,
  type BehaviorIntent,
  type CareDomain,
  type CarePeriodTally,
  type DevelopmentDay,
  type DevelopmentOutcome,
  type EvidenceSummary,
  type HabitatObject,
  type Outcome,
  type PeriodTally,
  type SocialEvidence,
  type World,
  validPosition,
} from './model';
import { beginRollingCoverage } from './evidence';
import { advanceOffline } from './simulation';
import { planRoute } from './behavior';

export const STORAGE_KEY = 'autopet.habitat.v1';

const PHASES = ['notice', 'approach', 'request', 'attempt', 'outcome', 'reflect'] as const;
const OUTCOMES: Outcome[] = ['success', 'partial', 'deferred'];
const ASSISTANCE_SOURCES: AssistanceSource[] = ['environment-arranged', 'player-feeding', 'player-grooming'];
const CARE_DOMAINS: CareDomain[] = ['feeding', 'grooming'];
const SOCIAL_KEYS = ['invitations', 'accepted', 'declined', 'acknowledgments', 'petAccepted', 'petDeferred'] as const;
const SKILL_COUNT_KEYS = [
  'attempts',
  'successes',
  'assisted',
  'autonomousAttempts',
  'autonomousSuccesses',
  'assistedAttempts',
  'assistedSuccesses',
  'helpRequests',
  'helpOffers',
  'helpAccepted',
  'helpDeclined',
] as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function unit(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

function point(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return finite(candidate.x) && finite(candidate.y) && validPosition({ x: candidate.x, y: candidate.y });
}

function activity(value: unknown): value is Activity {
  return typeof value === 'string' && ACTIVITIES.includes(value as Activity);
}

function assistanceSource(value: unknown): value is AssistanceSource {
  return typeof value === 'string' && ASSISTANCE_SOURCES.includes(value as AssistanceSource);
}

function social(value: unknown): value is SocialEvidence {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as unknown as SocialEvidence;
  return SOCIAL_KEYS.every(key => count(candidate[key]))
    && candidate.invitations === candidate.accepted + candidate.declined;
}

function summary(value: unknown, worldTime: number): value is EvidenceSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (!['attempts', 'successes', 'partials', 'deferred', 'assisted'].every(key => count(item[key]))
    || !finite(item.totalSeconds) || item.totalSeconds < 0
    || (item.assisted as number) > (item.attempts as number)
    || (item.successes as number) + (item.partials as number) + (item.deferred as number) !== item.attempts) {
    return false;
  }
  if (item.attempts === 0) {
    return item.totalSeconds === 0 && item.firstAt === null && item.lastAt === null;
  }
  return finite(item.firstAt) && finite(item.lastAt)
    && item.firstAt >= 0 && item.firstAt <= item.lastAt && item.lastAt <= worldTime;
}

function period(value: unknown): value is PeriodTally {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['attempts', 'successes', 'partials', 'deferred'].every(key => count(item[key]))
    && (item.successes as number) + (item.partials as number) + (item.deferred as number) === item.attempts
    && finite(item.totalSeconds) && item.totalSeconds >= 0;
}

function carePeriod(value: unknown): value is CarePeriodTally {
  if (!value || typeof value !== 'object') return false;
  const item = value as unknown as CarePeriodTally;
  return period(item.autonomous)
    && period(item.playerAssisted)
    && period(item.playerInfluenced)
    && count(item.helpRequests)
    && count(item.helpOffers)
    && count(item.helpAccepted)
    && count(item.helpDeclined)
    && item.helpAccepted + item.helpDeclined <= item.helpOffers;
}

function sparsePeriods(value: unknown, allowed: readonly string[]): value is Record<string, PeriodTally> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>)
    .every(([key, entry]) => allowed.includes(key) && period(entry) && (entry as PeriodTally).attempts > 0);
}

function rollingDay(value: unknown, currentDay: number): value is DevelopmentDay {
  if (!value || typeof value !== 'object') return false;
  const item = value as unknown as DevelopmentDay;
  if (!count(item.day) || item.day > currentDay
    || !sparsePeriods(item.activities, ACTIVITIES)
    || !sparsePeriods(item.affordances, AFFORDANCES)
    || !sparsePeriods(item.contexts, DEVELOPMENT_CONTEXTS)
    || !item.care || !carePeriod(item.care.feeding) || !carePeriod(item.care.grooming)
    || !social(item.social)) {
    return false;
  }
  const attempts = (record: Record<string, PeriodTally>) =>
    Object.values(record).reduce((sum, entry) => sum + entry.attempts, 0);
  const activityAttempts = attempts(item.activities as Record<string, PeriodTally>);
  if (activityAttempts !== attempts(item.affordances as Record<string, PeriodTally>)
    || activityAttempts !== attempts(item.contexts as Record<string, PeriodTally>)) {
    return false;
  }
  const careAttempts = (care: CarePeriodTally) =>
    care.autonomous.attempts + care.playerAssisted.attempts + care.playerInfluenced.attempts;
  return careAttempts(item.care.feeding) === (item.activities.forage?.attempts ?? 0)
    && careAttempts(item.care.grooming) === (item.activities.groom?.attempts ?? 0);
}

function intent(value: unknown): value is BehaviorIntent {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return count(item.id) && (item.id as number) > 0
    && activity(item.activity)
    && PHASES.includes(item.phase as typeof PHASES[number])
    && typeof item.opportunityId === 'string'
    && AFFORDANCES.includes(item.affordance as Affordance)
    && point(item.target)
    && Array.isArray(item.route)
    && item.route.length <= 128
    && item.route.every(point)
    && finite(item.noticedAt) && item.noticedAt >= 0
    && finite(item.phaseRemaining) && item.phaseRemaining >= 0
    && count(item.phaseTicksRemaining)
    && typeof item.assisted === 'boolean'
    && typeof item.helpRequested === 'boolean'
    && (item.careOfferResolved === undefined || typeof item.careOfferResolved === 'boolean')
    && (item.assistanceSource === undefined || assistanceSource(item.assistanceSource))
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
    && count(item.visits)
    && (item.lastMovedAt === undefined || (finite(item.lastMovedAt) && item.lastMovedAt >= 0));
}

function outcomesFitSummary(summaryValue: EvidenceSummary, outcomes: DevelopmentOutcome[]): boolean {
  return outcomes.length <= summaryValue.attempts
    && outcomes.filter(item => item.outcome === 'success').length <= summaryValue.successes
    && outcomes.filter(item => item.outcome === 'partial').length <= summaryValue.partials
    && outcomes.filter(item => item.outcome === 'deferred').length <= summaryValue.deferred
    && outcomes.filter(item => item.assisted).length <= summaryValue.assisted;
}

function validEvidence(w: World): boolean {
  const evidence = w.development.evidence;
  const activityEntries = ACTIVITIES.map(key => [key, evidence.activities?.[key]] as const);
  const affordanceEntries = Object.entries(evidence.affordances ?? {}) as [Affordance, EvidenceSummary][];
  const opportunityEntries = Object.entries(evidence.opportunities ?? {});
  if (Object.keys(evidence.activities ?? {}).length !== ACTIVITIES.length
    || !activityEntries.every(([, value]) => summary(value, w.time))
    || !affordanceEntries.every(([key, value]) => AFFORDANCES.includes(key) && summary(value, w.time))
    || !opportunityEntries.every(([key, value]) => key.length > 0 && summary(value, w.time))) {
    return false;
  }
  const activityAttempts = activityEntries.reduce((sum, [, value]) => sum + value.attempts, 0);
  const affordanceAttempts = affordanceEntries.reduce((sum, [, value]) => sum + value.attempts, 0);
  const opportunityAttempts = opportunityEntries.reduce((sum, [, value]) => sum + value.attempts, 0);
  if (activityAttempts !== affordanceAttempts || activityAttempts !== opportunityAttempts) return false;

  if (!Array.isArray(evidence.outcomes)
    || evidence.outcomes.length !== Math.min(activityAttempts, 240)
    || !evidence.outcomes.every((outcome, index) =>
      finite(outcome.time) && outcome.time >= 0 && outcome.time <= w.time
      && (index === 0 || evidence.outcomes[index - 1].time <= outcome.time)
      && activity(outcome.activity)
      && AFFORDANCES.includes(outcome.affordance)
      && typeof outcome.opportunityId === 'string' && outcome.opportunityId.length > 0
      && point(outcome.position)
      && OUTCOMES.includes(outcome.outcome)
      && typeof outcome.assisted === 'boolean'
      && (outcome.assistanceSource === undefined || assistanceSource(outcome.assistanceSource))
      && (outcome.assistanceSource === undefined || outcome.assisted))) {
    return false;
  }
  for (const [key, summaryValue] of activityEntries) {
    if (!outcomesFitSummary(summaryValue, evidence.outcomes.filter(outcome => outcome.activity === key))) return false;
  }
  for (const [key, summaryValue] of affordanceEntries) {
    if (!outcomesFitSummary(summaryValue, evidence.outcomes.filter(outcome => outcome.affordance === key))) return false;
  }
  for (const [key, summaryValue] of opportunityEntries) {
    if (!outcomesFitSummary(summaryValue, evidence.outcomes.filter(outcome => outcome.opportunityId === key))) return false;
  }
  if (!social(evidence.social)
    || !evidence.rolling
    || !finite(evidence.rolling.coverageStartedAt)
    || evidence.rolling.coverageStartedAt < 0
    || evidence.rolling.coverageStartedAt > w.time
    || !Array.isArray(evidence.rolling.days)
    || evidence.rolling.days.length > 30) {
    return false;
  }
  const currentDay = Math.floor(w.time / 86_400);
  if (!evidence.rolling.days.every(day => rollingDay(day, currentDay))) return false;
  for (let index = 1; index < evidence.rolling.days.length; index++) {
    if (evidence.rolling.days[index - 1].day >= evidence.rolling.days[index].day) return false;
  }
  for (const key of ACTIVITIES) {
    const rollingAttempts = evidence.rolling.days.reduce((sum, day) => sum + (day.activities[key]?.attempts ?? 0), 0);
    if (rollingAttempts > evidence.activities[key].attempts) return false;
  }
  return true;
}

function validV3(value: unknown): value is World {
  if (!value || typeof value !== 'object') return false;
  const w = value as World;
  if (w.version !== 3
    || !count(w.identitySeed) || w.identitySeed <= 0
    || !count(w.seed) || w.seed <= 0
    || !count(w.outcomeSeed) || w.outcomeSeed <= 0
    || !count(w.socialSeed) || w.socialSeed <= 0
    || !count(w.tick)
    || !count(w.nextIntentId) || w.nextIntentId <= 0
    || !finite(w.time) || w.time < 0
    || Math.abs(w.time - w.tick * STEP) > 1e-6
    || !finite(w.lastSaved)) {
    return false;
  }
  const creature = w.creature;
  if (!creature || !point(creature.position) || !point(creature.target)
    || !activity(creature.activity)
    || !finite(creature.facing) || !finite(creature.remaining) || !finite(creature.distance) || creature.distance < 0
    || creature.anatomy?.stage !== 'juvenile'
    || !creature.temperament || !creature.internal || !creature.learning) {
    return false;
  }
  if (!['curiosity', 'sociability', 'restfulness', 'persistence']
    .every(key => unit(creature.temperament[key as keyof typeof creature.temperament]))) return false;
  if (!['energy', 'forageReadiness', 'groomingReadiness']
    .every(key => unit(creature.internal[key as keyof typeof creature.internal]))) return false;
  if (Object.keys(creature.learning.activityPreferences ?? {}).length !== ACTIVITIES.length
    || !ACTIVITIES.every(key => unit(creature.learning.activityPreferences[key]))
    || Object.keys(creature.learning.objectInterests ?? {}).length !== OBJECT_KINDS.length
    || !OBJECT_KINDS.every(key => unit(creature.learning.objectInterests[key]))) {
    return false;
  }
  const activityTotal = Object.values(creature.learning.activityPreferences).reduce((sum, entry) => sum + entry, 0);
  const objectTotal = Object.values(creature.learning.objectInterests).reduce((sum, entry) => sum + entry, 0);
  if (Math.abs(activityTotal - 1) > 1e-6 || Math.abs(objectTotal - 1) > 1e-6) return false;

  for (const domain of CARE_DOMAINS) {
    const skill = creature.learning.independence?.[domain];
    if (!skill || !unit(skill.capability) || !unit(skill.confidence) || !unit(skill.reliance)
      || !SKILL_COUNT_KEYS.every(key => count(skill[key]))
      || skill.successes > skill.attempts
      || skill.assisted > skill.attempts
      || skill.autonomousAttempts + skill.assistedAttempts > skill.attempts
      || skill.autonomousSuccesses > skill.autonomousAttempts
      || skill.assistedSuccesses > skill.assistedAttempts
      || skill.autonomousSuccesses + skill.assistedSuccesses > skill.successes
      || skill.helpAccepted + skill.helpDeclined > skill.helpOffers) {
      return false;
    }
  }
  if (!Object.values(creature.learning.habituation ?? {})
    .every(entry => entry && unit(entry.level) && finite(entry.updatedAt) && entry.updatedAt >= 0)) return false;
  if (creature.intent !== undefined && !intent(creature.intent)) return false;

  if (!Array.isArray(w.objects) || w.objects.length !== 3 || !w.objects.every(objectState)
    || new Set(w.objects.map(item => item.id)).size !== 3
    || new Set(w.objects.map(item => item.kind)).size !== 3) {
    return false;
  }
  if (creature.intent !== undefined
    && !['player-invitation', ...w.objects.map(item => item.id), ...HABITAT_FEATURES.map(item => item.id)]
      .includes(creature.intent.opportunityId)) {
    return false;
  }
  if (!Array.isArray(w.experiences) || w.experiences.length > 80
    || !w.experiences.every(event => event && finite(event.time) && event.time >= 0 && event.time <= w.time
      && typeof event.kind === 'string'
      && (event.assistanceSource === undefined || assistanceSource(event.assistanceSource)))) {
    return false;
  }
  if (!w.development || w.development.stage !== 'juvenile'
    || !count(w.development.observations)
    || !w.development.evidence
    || !validEvidence(w)) {
    return false;
  }
  if (w.pendingInvitation !== undefined
    && (!point(w.pendingInvitation.position)
      || !finite(w.pendingInvitation.createdAt)
      || !finite(w.pendingInvitation.expiresAt)
      || w.pendingInvitation.expiresAt < w.pendingInvitation.createdAt)) {
    return false;
  }
  return true;
}

function inferLegacyAssistance(opportunityId: string, assisted: boolean): AssistanceSource | undefined {
  if (!assisted) return undefined;
  if (opportunityId === 'player-feeding-assistance') return 'player-feeding';
  if (opportunityId === 'player-grooming-assistance') return 'player-grooming';
  return 'environment-arranged';
}

function migrateV2(value: Record<string, unknown>): World | null {
  if (value.version !== 2) return null;
  const migrated = structuredClone(value) as Record<string, unknown>;
  const creature = migrated.creature as Record<string, unknown> | undefined;
  const learning = creature?.learning as Record<string, unknown> | undefined;
  const independence = learning?.independence as Record<string, Record<string, unknown>> | undefined;
  const development = migrated.development as Record<string, unknown> | undefined;
  const evidence = development?.evidence as Record<string, unknown> | undefined;
  if (!creature || !learning || !independence || !evidence) return null;

  for (const domain of CARE_DOMAINS) {
    const skill = independence[domain];
    if (!skill) return null;
    for (const key of [
      'autonomousAttempts',
      'autonomousSuccesses',
      'assistedAttempts',
      'assistedSuccesses',
      'helpRequests',
      'helpOffers',
      'helpAccepted',
      'helpDeclined',
    ]) {
      skill[key] = 0;
    }
  }
  const oldIntent = creature.intent as Record<string, unknown> | undefined;
  if (oldIntent) {
    const remaining = finite(oldIntent.phaseRemaining) ? Math.max(0, oldIntent.phaseRemaining) : 0;
    oldIntent.phaseTicksRemaining = Math.max(1, Math.ceil((remaining - 1e-9) / STEP));
    oldIntent.phaseRemaining = (oldIntent.phaseTicksRemaining as number) * STEP;
    oldIntent.helpRequested = false;
    oldIntent.careOfferResolved = false;
    if (oldIntent.assisted === true) oldIntent.assistanceSource = 'environment-arranged';
  }
  const outcomes = evidence.outcomes;
  if (Array.isArray(outcomes)) {
    for (const rawOutcome of outcomes) {
      if (!rawOutcome || typeof rawOutcome !== 'object') continue;
      const outcome = rawOutcome as Record<string, unknown>;
      const source = inferLegacyAssistance(String(outcome.opportunityId ?? ''), outcome.assisted === true);
      if (source) outcome.assistanceSource = source;
    }
  }
  const experiences = migrated.experiences;
  if (Array.isArray(experiences)) {
    for (const rawEvent of experiences) {
      if (!rawEvent || typeof rawEvent !== 'object') continue;
      const event = rawEvent as Record<string, unknown>;
      const source = inferLegacyAssistance(String(event.subject ?? ''), event.assisted === true);
      if (source) event.assistanceSource = source;
    }
  }
  const worldTime = finite(migrated.time) ? migrated.time : 0;
  evidence.rolling = { coverageStartedAt: Math.max(0, worldTime), days: [] };
  migrated.version = 3;
  return validV3(migrated) ? migrated : null;
}

function migrateV1(legacy: Record<string, unknown>): World | null {
  if (!count(legacy.seed) || (legacy.seed as number) <= 0
    || !count(legacy.tick)
    || !finite(legacy.time)
    || !finite(legacy.lastSaved)) {
    return null;
  }
  const oldCreature = legacy.creature as Record<string, unknown> | undefined;
  if (!oldCreature || !point(oldCreature.position) || !point(oldCreature.target) || !activity(oldCreature.activity)) return null;
  const w = createWorld(legacy.seed as number);
  w.seed = legacy.seed as number;
  w.outcomeSeed = ((w.seed ^ 0x9e3779b9) >>> 0) || 1;
  w.socialSeed = ((w.seed ^ 0x85ebca6b) >>> 0) || 1;
  w.tick = legacy.tick as number;
  w.time = w.tick * STEP;
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
      const old = legacy.objects.find(entry => entry && typeof entry === 'object'
        && (entry as Record<string, unknown>).id === current.id) as Record<string, unknown> | undefined;
      if (old && point(old.position)) current.position = { ...old.position };
      if (old && count(old.visits)) current.visits = old.visits;
    }
  }
  if (Array.isArray(legacy.experiences)) {
    w.experiences = legacy.experiences.filter(entry => entry && typeof entry === 'object'
      && finite((entry as Record<string, unknown>).time)
      && typeof (entry as Record<string, unknown>).kind === 'string').slice(-80) as World['experiences'];
  }
  const development = legacy.development as Record<string, unknown> | undefined;
  if (development && count(development.observations)) w.development.observations = development.observations;

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
        id: w.nextIntentId++,
        activity: w.creature.activity,
        phase: 'approach',
        opportunityId: mapped.id,
        affordance: mapped.affordance,
        target: { ...w.creature.target },
        route,
        noticedAt: w.time,
        phaseRemaining: STEP,
        phaseTicksRemaining: 1,
        assisted: false,
        helpRequested: false,
        careOfferResolved: false,
      };
    }
  }
  beginRollingCoverage(w.development.evidence, w.time);
  return validV3(w) ? w : null;
}

export function decode(raw: string): World | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const version = (parsed as { version?: unknown }).version;
    if (version === 1) return migrateV1(parsed as Record<string, unknown>);
    if (version === 2) return migrateV2(parsed as Record<string, unknown>);
    return validV3(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function load(): { world: World; offline: number; available: boolean; capped?: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const world = raw ? decode(raw) : null;
    if (world) {
      const now = Date.now();
      const elapsed = Math.max(0, (now - world.lastSaved) / 1000);
      const result = advanceOffline(world, elapsed);
      world.lastSaved = now;
      return { world, offline: result.simulatedSeconds, capped: result.capped, available: true };
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
