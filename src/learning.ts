import {
  type Activity,
  type Affordance,
  type AssistanceSource,
  type CareDomain,
  type ObjectKind,
  type Outcome,
  type Point,
  type World,
  clamp,
  random,
  record,
} from './model';
import {
  recordCareInteraction,
  recordDevelopmentOutcome,
  recordInvitationEvidence,
  recordSocialReactionEvidence,
} from './evidence';
import { advanceAnatomy, refreshAnatomyTarget } from './anatomy';

const HABITUATION_HALF_LIFE = 900;

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

function directCareSource(domain: CareDomain, source?: AssistanceSource): boolean {
  return source === (domain === 'feeding' ? 'player-feeding' : 'player-grooming');
}

function updateIndependence(
  w: World,
  domain: CareDomain,
  outcome: Outcome,
  assistanceSource?: AssistanceSource,
  requested = false,
) {
  const skill = w.creature.learning.independence[domain];
  const quality = outcome === 'success' ? 1 : outcome === 'partial' ? 0.55 : 0.15;
  const assisted = directCareSource(domain, assistanceSource);
  skill.attempts++;
  if (outcome === 'success') skill.successes++;
  if (assisted) {
    skill.assisted++;
    skill.assistedAttempts++;
    if (outcome === 'success') skill.assistedSuccesses++;
    skill.capability = clamp(
      skill.capability + 0.0007 * (0.3 + 0.7 * quality) * (0.82 - skill.capability),
      0.2,
      0.94,
    );
    skill.confidence = clamp(
      skill.confidence + 0.004 * quality * Math.max(0, 0.72 - skill.confidence),
      0.08,
      0.92,
    );
    skill.reliance = clamp(
      skill.reliance + (requested ? 0.007 : 0.004) * quality * (0.9 - skill.reliance),
      0,
      0.9,
    );
  } else {
    skill.autonomousAttempts++;
    if (outcome === 'success') skill.autonomousSuccesses++;
    skill.capability = clamp(
      skill.capability + 0.0045 * (0.3 + 0.7 * quality) * (0.94 - skill.capability),
      0.2,
      0.94,
    );
    const confidenceTarget = 0.22 + 0.7 * quality;
    skill.confidence = clamp(
      skill.confidence + 0.04 * (confidenceTarget - skill.confidence),
      0.08,
      0.92,
    );
    skill.reliance = clamp(
      skill.reliance * (1 - 0.008 * (0.3 + 0.7 * quality)),
      0,
      0.9,
    );
  }
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
  assistanceSource?: AssistanceSource,
  requested = false,
) {
  const evidence = w.development.evidence;
  const priorActivity = evidence.activities[activity];
  const expectedQuality = priorActivity.attempts > 4
    ? (priorActivity.successes + priorActivity.partials * 0.5) / priorActivity.attempts
    : 0.65;
  // Physical development follows simulation time and the previously persisted
  // target. The new outcome can only influence the next target, never rewrite
  // the body retroactively.
  advanceAnatomy(w.creature.anatomy, w.time);
  recordDevelopmentOutcome(w, {
    activity,
    affordance,
    opportunityId,
    outcome,
    assisted,
    duration,
    position,
    assistanceSource,
  });
  refreshAnatomyTarget(w);

  const quality = outcome === 'success' ? 1 : outcome === 'partial' ? 0.5 : 0;
  const signal = quality - expectedQuality;
  rebalance(w.creature.learning.activityPreferences, activity, signal * (assisted ? 0.45 : 1), 0.018, 0.035, 0.48);
  const object = w.objects.find(item => item.id === opportunityId);
  if (object) {
    rebalance(w.creature.learning.objectInterests, object.kind, signal * (assisted ? 0.45 : 1), 0.025, 0.12, 0.65);
    object.visits++;
    w.development.observations++;
  }
  if (activity === 'forage') updateIndependence(w, 'feeding', outcome, assistanceSource, requested);
  if (activity === 'groom') updateIndependence(w, 'grooming', outcome, assistanceSource, requested);
  markHabituation(w, `${opportunityId}:${affordance}`);
  markHabituation(w, `activity:${activity}`);
  record(w, 'behavior-outcome', {
    subject: opportunityId,
    activity,
    affordance,
    phase: 'outcome',
    outcome,
    assisted,
    assistanceSource,
  });
}

/**
 * Offers optional care to the creature's current intention. Acceptance only
 * marks that intention; its normal attempt, outcome, state effects, and
 * learning still happen in the simulation sequence.
 */
export function assistCare(w: World, domain: CareDomain): boolean {
  const intent = w.creature.intent;
  const activity: Activity = domain === 'feeding' ? 'forage' : 'groom';
  if (!intent || intent.activity !== activity || (intent.phase !== 'request' && intent.phase !== 'attempt')) return false;
  if (intent.careOfferResolved || directCareSource(domain, intent.assistanceSource)) return false;

  intent.careOfferResolved = true;
  recordCareInteraction(w, domain, 'help-offer');
  const skill = w.creature.learning.independence[domain];
  const readiness = domain === 'feeding'
    ? w.creature.internal.forageReadiness
    : w.creature.internal.groomingReadiness;
  const acceptanceChance = clamp(
    0.14 + readiness * 0.22 + w.creature.temperament.sociability * 0.18 + skill.reliance * 0.34,
    0.12,
    0.82,
  );
  const accepted = intent.helpRequested || random(w, 'social') < acceptanceChance;
  recordCareInteraction(w, domain, accepted ? 'help-accepted' : 'help-declined');
  if (!accepted) {
    record(w, 'care-declined', { subject: domain, activity, affordance: intent.affordance, phase: intent.phase });
    return false;
  }

  intent.assisted = true;
  intent.assistanceSource = domain === 'feeding' ? 'player-feeding' : 'player-grooming';
  record(w, 'care-accepted', {
    subject: domain,
    activity,
    affordance: intent.affordance,
    phase: intent.phase,
    assisted: true,
    assistanceSource: intent.assistanceSource,
  });
  return true;
}

export function recordHelpRequest(w: World, domain: CareDomain) {
  recordCareInteraction(w, domain, 'help-request');
}

export function recordInvitation(w: World, accepted: boolean) {
  recordInvitationEvidence(w, accepted);
}

export function recordSocialReaction(w: World, kind: 'acknowledgment' | 'pet-accepted' | 'pet-deferred') {
  recordSocialReactionEvidence(w, kind);
}

export function objectInterest(w: World, kind?: ObjectKind): number {
  return kind ? w.creature.learning.objectInterests[kind] : 1 / 3;
}
