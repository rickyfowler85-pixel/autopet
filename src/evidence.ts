import {
  type Activity,
  type Affordance,
  type AssistanceSource,
  type CareDomain,
  type CarePeriodTally,
  type DevelopmentContext,
  type DevelopmentDay,
  type DevelopmentEvidence,
  type Outcome,
  type PeriodTally,
  type Point,
  type SocialEvidence,
  type World,
  HABITAT_FEATURES,
  emptyCarePeriodTally,
  emptyPeriodTally,
  emptySocialEvidence,
  emptySummary,
} from './model';

const DAY_SECONDS = 86_400;
const MAX_ROLLING_DAYS = 30;
const MAX_OUTCOMES = 240;

export interface DevelopmentOutcomeInput {
  activity: Activity;
  affordance: Affordance;
  opportunityId: string;
  outcome: Outcome;
  assisted: boolean;
  duration: number;
  position: Point;
  assistanceSource?: AssistanceSource;
}

export type CareInteractionEvent = 'help-request' | 'help-offer' | 'help-accepted' | 'help-declined';
export type SocialReaction = 'acknowledgment' | 'pet-accepted' | 'pet-deferred';

export interface RecentDevelopmentEvidence {
  windowDays: 7 | 30;
  fromDay: number;
  throughDay: number;
  complete: boolean;
  activities: Partial<Record<Activity, PeriodTally>>;
  affordances: Partial<Record<Affordance, PeriodTally>>;
  contexts: Partial<Record<DevelopmentContext, PeriodTally>>;
  care: Record<CareDomain, CarePeriodTally>;
  social: SocialEvidence;
}

function updateLifetimeSummary(
  summary: ReturnType<typeof emptySummary>,
  time: number,
  outcome: Outcome,
  assisted: boolean,
  duration: number,
) {
  summary.attempts++;
  if (outcome === 'success') summary.successes++;
  else if (outcome === 'partial') summary.partials++;
  else summary.deferred++;
  if (assisted) summary.assisted++;
  summary.totalSeconds += Math.max(0, duration);
  summary.firstAt ??= time;
  summary.lastAt = time;
}

function updatePeriod(tally: PeriodTally, outcome: Outcome, duration: number) {
  tally.attempts++;
  if (outcome === 'success') tally.successes++;
  else if (outcome === 'partial') tally.partials++;
  else tally.deferred++;
  tally.totalSeconds += Math.max(0, duration);
}

function tallyFor<K extends string>(map: Partial<Record<K, PeriodTally>>, key: K): PeriodTally {
  return map[key] ?? (map[key] = emptyPeriodTally());
}

function emptyDay(day: number): DevelopmentDay {
  return {
    day,
    activities: {},
    affordances: {},
    contexts: {},
    care: { feeding: emptyCarePeriodTally(), grooming: emptyCarePeriodTally() },
    social: emptySocialEvidence(),
  };
}

/** Returns today's sparse bucket and keeps at most the most recent 30 days. */
function currentDay(w: World): DevelopmentDay {
  const day = Math.floor(w.time / DAY_SECONDS);
  const rolling = w.development.evidence.rolling;
  let bucket = rolling.days.find(entry => entry.day === day);
  if (!bucket) {
    bucket = emptyDay(day);
    rolling.days.push(bucket);
    rolling.days.sort((left, right) => left.day - right.day);
  }
  const firstRetained = day - (MAX_ROLLING_DAYS - 1);
  rolling.days = rolling.days.filter(entry => entry.day >= firstRetained && entry.day <= day);
  return bucket;
}

/** Classifies evidence by the concrete opportunity before using spatial proximity. */
export function classifyDevelopmentContext(w: World, opportunityId: string, position: Point): DevelopmentContext {
  if (opportunityId.startsWith('player-')) return 'player';
  const object = w.objects.find(entry => entry.id === opportunityId);
  if (object) return object.kind;
  const feature = HABITAT_FEATURES.find(entry => entry.id === opportunityId);
  if (feature) return feature.kind;

  let closest: { context: DevelopmentContext; distance: number } | undefined;
  for (const candidate of [
    ...w.objects.map(entry => ({ context: entry.kind as DevelopmentContext, position: entry.position, radius: 30 })),
    ...HABITAT_FEATURES.map(entry => ({ context: entry.kind as DevelopmentContext, position: entry.position, radius: 55 })),
  ]) {
    const distance = Math.hypot(position.x - candidate.position.x, position.y - candidate.position.y);
    if (distance <= candidate.radius && (!closest || distance < closest.distance)) {
      closest = { context: candidate.context, distance };
    }
  }
  return closest?.context ?? 'other';
}

function directCareSource(domain: CareDomain, source?: AssistanceSource): boolean {
  return source === (domain === 'feeding' ? 'player-feeding' : 'player-grooming');
}

/** Records the durable lifetime result and its bounded daily counterpart atomically. */
export function recordDevelopmentOutcome(w: World, input: DevelopmentOutcomeInput) {
  const evidence = w.development.evidence;
  const activitySummary = evidence.activities[input.activity];
  const affordanceSummary = evidence.affordances[input.affordance]
    ?? (evidence.affordances[input.affordance] = emptySummary());
  const opportunitySummary = evidence.opportunities[input.opportunityId]
    ?? (evidence.opportunities[input.opportunityId] = emptySummary());
  updateLifetimeSummary(activitySummary, w.time, input.outcome, input.assisted, input.duration);
  updateLifetimeSummary(affordanceSummary, w.time, input.outcome, input.assisted, input.duration);
  updateLifetimeSummary(opportunitySummary, w.time, input.outcome, input.assisted, input.duration);
  evidence.outcomes.push({
    time: w.time,
    activity: input.activity,
    affordance: input.affordance,
    opportunityId: input.opportunityId,
    position: { ...input.position },
    outcome: input.outcome,
    assisted: input.assisted,
    ...(input.assistanceSource ? { assistanceSource: input.assistanceSource } : {}),
  });
  if (evidence.outcomes.length > MAX_OUTCOMES) evidence.outcomes.shift();

  const day = currentDay(w);
  updatePeriod(tallyFor(day.activities, input.activity), input.outcome, input.duration);
  updatePeriod(tallyFor(day.affordances, input.affordance), input.outcome, input.duration);
  const context = classifyDevelopmentContext(w, input.opportunityId, input.position);
  updatePeriod(tallyFor(day.contexts, context), input.outcome, input.duration);

  const domain: CareDomain | undefined = input.activity === 'forage'
    ? 'feeding'
    : input.activity === 'groom' ? 'grooming' : undefined;
  if (domain) {
    const care = day.care[domain];
    const source = directCareSource(domain, input.assistanceSource)
      ? care.playerAssisted
      : input.assistanceSource === 'environment-arranged' || input.assisted
        ? care.playerInfluenced
        : care.autonomous;
    updatePeriod(source, input.outcome, input.duration);
  }
}

/** Records a help-seeking or care-offer event in lifetime skill counters and today's compact evidence. */
export function recordCareInteraction(w: World, domain: CareDomain, event: CareInteractionEvent) {
  const skill = w.creature.learning.independence[domain];
  const care = currentDay(w).care[domain];
  if (event === 'help-request') {
    skill.helpRequests++;
    care.helpRequests++;
  } else if (event === 'help-offer') {
    skill.helpOffers++;
    care.helpOffers++;
  } else if (event === 'help-accepted') {
    skill.helpAccepted++;
    care.helpAccepted++;
  } else {
    skill.helpDeclined++;
    care.helpDeclined++;
  }
}

/** Records invitations without retaining each social event indefinitely. */
export function recordInvitationEvidence(w: World, accepted: boolean) {
  const lifetime = w.development.evidence.social;
  const daily = currentDay(w).social;
  lifetime.invitations++;
  daily.invitations++;
  if (accepted) {
    lifetime.accepted++;
    daily.accepted++;
  } else {
    lifetime.declined++;
    daily.declined++;
  }
}

/** Records low-stakes social reactions in lifetime and rolling summaries. */
export function recordSocialReactionEvidence(w: World, kind: SocialReaction) {
  const lifetime = w.development.evidence.social;
  const daily = currentDay(w).social;
  if (kind === 'acknowledgment') {
    lifetime.acknowledgments++;
    daily.acknowledgments++;
  } else if (kind === 'pet-accepted') {
    lifetime.petAccepted++;
    daily.petAccepted++;
  } else {
    lifetime.petDeferred++;
    daily.petDeferred++;
  }
}

function addPeriod(target: PeriodTally, source: PeriodTally) {
  target.attempts += source.attempts;
  target.successes += source.successes;
  target.partials += source.partials;
  target.deferred += source.deferred;
  target.totalSeconds += source.totalSeconds;
}

function addSparse<K extends string>(target: Partial<Record<K, PeriodTally>>, source: Partial<Record<K, PeriodTally>>) {
  for (const [rawKey, tally] of Object.entries(source) as [K, PeriodTally][]) {
    addPeriod(tallyFor(target, rawKey), tally);
  }
}

function addCare(target: CarePeriodTally, source: CarePeriodTally) {
  addPeriod(target.autonomous, source.autonomous);
  addPeriod(target.playerAssisted, source.playerAssisted);
  addPeriod(target.playerInfluenced, source.playerInfluenced);
  target.helpRequests += source.helpRequests;
  target.helpOffers += source.helpOffers;
  target.helpAccepted += source.helpAccepted;
  target.helpDeclined += source.helpDeclined;
}

function addSocial(target: SocialEvidence, source: SocialEvidence) {
  target.invitations += source.invitations;
  target.accepted += source.accepted;
  target.declined += source.declined;
  target.acknowledgments += source.acknowledgments;
  target.petAccepted += source.petAccepted;
  target.petDeferred += source.petDeferred;
}

/** Produces a new 7- or 30-day aggregate without mutating saved evidence. */
export function recentEvidence(w: Pick<World, 'time' | 'development'>, windowDays: 7 | 30): RecentDevelopmentEvidence {
  const throughDay = Math.floor(w.time / DAY_SECONDS);
  const fromDay = throughDay - windowDays + 1;
  const result: RecentDevelopmentEvidence = {
    windowDays,
    fromDay,
    throughDay,
    complete: w.development.evidence.rolling.coverageStartedAt <= fromDay * DAY_SECONDS,
    activities: {},
    affordances: {},
    contexts: {},
    care: { feeding: emptyCarePeriodTally(), grooming: emptyCarePeriodTally() },
    social: emptySocialEvidence(),
  };
  for (const day of w.development.evidence.rolling.days) {
    if (day.day < fromDay || day.day > throughDay) continue;
    addSparse(result.activities, day.activities);
    addSparse(result.affordances, day.affordances);
    addSparse(result.contexts, day.contexts);
    addCare(result.care.feeding, day.care.feeding);
    addCare(result.care.grooming, day.care.grooming);
    addSocial(result.social, day.social);
  }
  return result;
}

/** Useful to persistence migration without fabricating historical rolling data. */
export function beginRollingCoverage(evidence: DevelopmentEvidence, time: number) {
  evidence.rolling = { coverageStartedAt: Math.max(0, time), days: [] };
}
