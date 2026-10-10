import {
  type Activity,
  type Affordance,
  type CareDomain,
  type EvidenceSummary,
  type ObjectKind,
  type Outcome,
  type Point,
  type World,
  clamp,
  emptySummary,
  record,
} from './model';

const HABITUATION_HALF_LIFE = 900;
const MAX_OUTCOMES = 240;

function rebalance<T extends string>(
  distribution: Record<T, number>,
  selected: T,
  signal: number,
  rate: number,
  minimum: number,
  maximum: number,
) {
  const keys = Object.keys(distribution) as T[];
  const oldSelected = distribution[selected];
  const raw = oldSelected + rate * signal * (signal >= 0 ? 1 - oldSelected : oldSelected);
  const upper = Math.min(maximum, 1 - minimum * (keys.length - 1));
  const nextSelected = clamp(raw, minimum, upper);
  const others = keys.filter(key => key !== selected);
  const oldOtherTotal = others.reduce((sum, key) => sum + distribution[key], 0);
  const available = 1 - nextSelected - minimum * others.length;
  const excessTotal = others.reduce((sum, key) => sum + Math.max(0, distribution[key] - minimum), 0);
  distribution[selected] = nextSelected;
  for (const key of others) {
    const share = excessTotal > 0
      ? Math.max(0, distribution[key] - minimum) / excessTotal
      : oldOtherTotal > 0 ? distribution[key] / oldOtherTotal : 1 / others.length;
    distribution[key] = minimum + available * share;
  }
  let excess = 0;
  for (const key of keys) {
    if (distribution[key] > maximum) {
      excess += distribution[key] - maximum;
      distribution[key] = maximum;
    }
  }
  if (excess > 0) {
    const recipients = keys.filter(key => distribution[key] < maximum);
    const capacity = recipients.reduce((sum, key) => sum + maximum - distribution[key], 0);
    for (const key of recipients) distribution[key] += excess * (maximum - distribution[key]) / capacity;
  }
}

export function preferenceTotal(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

export function habituationLevel(w: World, opportunityId: string): number {
  const entry = w.creature.learning.habituation[opportunityId];
  if (!entry) return 0;
  const elapsed = Math.max(0, w.time - entry.updatedAt);
  return entry.level * 0.5 ** (elapsed / HABITUATION_HALF_LIFE);
}

export function markHabituation(w: World, opportunityId: string) {
  const current = habituationLevel(w, opportunityId);
  w.creature.learning.habituation[opportunityId] = {
    level: clamp(current + (1 - current) * 0.22),
    updatedAt: w.time,
  };
}

function summaryFor(recordMap: Record<string, EvidenceSummary>, key: string): EvidenceSummary {
  return recordMap[key] ?? (recordMap[key] = emptySummary());
}

function updateSummary(summary: EvidenceSummary, w: World, outcome: Outcome, assisted: boolean, duration: number) {
  summary.attempts++;
  if (outcome === 'success') summary.successes++;
  else if (outcome === 'partial') summary.partials++;
  else summary.deferred++;
  if (assisted) summary.assisted++;
  summary.totalSeconds += Math.max(0, duration);
  summary.firstAt ??= w.time;
  summary.lastAt = w.time;
}

function updateIndependence(w: World, domain: CareDomain, outcome: Outcome, assisted: boolean) {
  const skill = w.creature.learning.independence[domain];
  const quality = outcome === 'success' ? 1 : outcome === 'partial' ? 0.5 : 0;
  skill.attempts++;
  if (outcome === 'success') skill.successes++;
  if (assisted) {
    skill.assisted++;
    skill.reliance = clamp(skill.reliance + 0.012 * (1 - skill.reliance), 0, 0.85);
    skill.capability = clamp(skill.capability + 0.00002 * quality, 0.2, 0.88);
  } else {
    skill.capability = clamp(skill.capability + (0.00005 + 0.00012 * quality) * (0.88 - skill.capability), 0.2, 0.88);
    skill.reliance = clamp(skill.reliance - 0.0025 * quality * skill.reliance, 0, 0.85);
  }
  const confidenceTarget = outcome === 'success' ? 0.85 : outcome === 'partial' ? 0.5 : 0.18;
  skill.confidence = clamp(skill.confidence + 0.004 * (confidenceTarget - skill.confidence), 0.08, 0.92);
}

export function completeLearning(
  w: World,
  activity: Activity,
  affordance: Affordance,
  opportunityId: string,
  outcome: Outcome,
  assisted: boolean,
  duration: number,
  position: Point = w.creature.position,
) {
  const evidence = w.development.evidence;
  const priorActivity = evidence.activities[activity];
  const expectedQuality = priorActivity.attempts > 4
    ? (priorActivity.successes + priorActivity.partials * 0.5) / priorActivity.attempts
    : 0.65;
  updateSummary(evidence.activities[activity], w, outcome, assisted, duration);
  updateSummary(summaryFor(evidence.affordances as Record<string, EvidenceSummary>, affordance), w, outcome, assisted, duration);
  updateSummary(summaryFor(evidence.opportunities, opportunityId), w, outcome, assisted, duration);
  evidence.outcomes.push({ time: w.time, activity, affordance, opportunityId, position: { ...position }, outcome, assisted });
  if (evidence.outcomes.length > MAX_OUTCOMES) evidence.outcomes.shift();

  const quality = outcome === 'success' ? 1 : outcome === 'partial' ? 0.5 : 0;
  const signal = quality - expectedQuality;
  rebalance(w.creature.learning.activityPreferences, activity, signal * (assisted ? 0.45 : 1), 0.018, 0.035, 0.48);
  const object = w.objects.find(item => item.id === opportunityId);
  if (object) {
    rebalance(w.creature.learning.objectInterests, object.kind, signal * (assisted ? 0.45 : 1), 0.025, 0.12, 0.65);
    object.visits++;
    w.development.observations++;
  }
  if (activity === 'forage') updateIndependence(w, 'feeding', outcome, assisted);
  if (activity === 'groom') updateIndependence(w, 'grooming', outcome, assisted);
  markHabituation(w, `${opportunityId}:${affordance}`);
  markHabituation(w, `activity:${activity}`);
  record(w, 'behavior-outcome', { subject: opportunityId, activity, affordance, phase: 'outcome', outcome, assisted });
}

export function assistCare(w: World, domain: CareDomain) {
  const activity: Activity = domain === 'feeding' ? 'forage' : 'groom';
  const affordance: Affordance = domain === 'feeding' ? 'forage' : 'groom';
  completeLearning(w, activity, affordance, `player-${domain}-assistance`, 'success', true, 0);
  record(w, 'care-assisted', { subject: domain, activity, affordance, outcome: 'success', assisted: true });
}

export function recordInvitation(w: World, accepted: boolean) {
  const social = w.development.evidence.social;
  social.invitations++;
  if (accepted) social.accepted++;
  else social.declined++;
}

export function recordSocialReaction(w: World, kind: 'acknowledgment' | 'pet-accepted' | 'pet-deferred') {
  const social = w.development.evidence.social;
  if (kind === 'acknowledgment') social.acknowledgments++;
  else if (kind === 'pet-accepted') social.petAccepted++;
  else social.petDeferred++;
}

export function objectInterest(w: World, kind?: ObjectKind): number {
  return kind ? w.creature.learning.objectInterests[kind] : 1 / 3;
}
