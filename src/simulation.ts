import {
  type Activity,
  type Outcome,
  type Point,
  type PlayerEvent,
  type World,
  STEP,
  clamp,
  random,
  record,
  validPosition,
} from './model';
import {
  approachTarget,
  beginIntent,
  careDomainForActivity,
  chooseActivity,
  invitationOpportunity,
  planRoute,
  resolveOpportunity,
  shouldRequestHelp,
} from './behavior';
import { completeLearning, recordHelpRequest, recordInvitation } from './learning';

const OFFLINE_LIMIT_SECONDS = 30 * 86400;
const INTERNAL_SCALE = 1_000_000_000;

export interface OfflineAdvanceResult {
  requestedSeconds: number;
  simulatedSeconds: number;
  capped: boolean;
  ticks: number;
}

function phaseDuration(w: World, activity: Activity): number {
  const variation = random(w) * 0.35 + 0.85;
  const durations: Record<Activity, number> = {
    idle: 45,
    wander: 28,
    rest: 120,
    explore: 38,
    forage: 34,
    groom: 36,
    wade: 38,
    play: 42,
  };
  return durations[activity] * variation;
}

function outcomeFor(w: World, activity: Activity, assisted: boolean): Outcome {
  const creature = w.creature;
  let success = 0.74;
  let partial = 0.18;
  if (activity === 'forage') {
    const skill = creature.learning.independence.feeding;
    success = 0.48 + skill.capability * 0.3 + skill.confidence * 0.12;
    partial = 0.22;
  } else if (activity === 'groom') {
    const skill = creature.learning.independence.grooming;
    success = 0.46 + skill.capability * 0.3 + skill.confidence * 0.13;
    partial = 0.24;
  } else if (activity === 'explore' || activity === 'wade') {
    success = 0.56 + creature.temperament.curiosity * 0.32;
    partial = 0.16;
  } else if (activity === 'play') {
    success = 0.48 + creature.temperament.sociability * 0.22 + creature.temperament.persistence * 0.18;
    partial = 0.2;
  } else if (activity === 'rest') {
    success = 0.82;
    partial = 0.14;
  }
  if (assisted) success += 0.04;
  success = clamp(success, 0.2, 0.93);
  partial = clamp(partial, 0.05, 1 - success);
  const roll = random(w, 'outcome');
  return roll < success ? 'success' : roll < success + partial ? 'partial' : 'deferred';
}

/**
 * These rates are exact at nanounit precision. Fixed-point updates make one
 * large catch-up identical to the same number of live simulation ticks.
 */
function applyInternalTicks(w: World, ticks: number) {
  if (ticks <= 0) return;
  const creature = w.creature;
  const resting = creature.activity === 'rest' && creature.intent?.phase === 'attempt';
  const energyDelta = resting ? 55_000 : -8_000;
  const toUnits = (value: number) => Math.round(value * INTERNAL_SCALE);
  const fromUnits = (value: number) => clamp(value, 0, INTERNAL_SCALE) / INTERNAL_SCALE;
  creature.internal.energy = fromUnits(toUnits(creature.internal.energy) + energyDelta * ticks);
  creature.internal.forageReadiness = fromUnits(toUnits(creature.internal.forageReadiness) + 7_500 * ticks);
  creature.internal.groomingReadiness = fromUnits(toUnits(creature.internal.groomingReadiness) + 4_500 * ticks);
}

function advanceClock(w: World, ticks: number) {
  applyInternalTicks(w, ticks);
  w.tick += ticks;
  w.time = w.tick * STEP;
}

function durationTicks(seconds: number): number {
  return Math.max(1, Math.ceil((Math.max(0, seconds) - 1e-9) / STEP));
}

function setPhaseTimer(w: World, seconds: number) {
  const intent = w.creature.intent!;
  intent.phaseTicksRemaining = durationTicks(seconds);
  intent.phaseRemaining = intent.phaseTicksRemaining * STEP;
}

function remainingPhaseTicks(w: World): number {
  const intent = w.creature.intent!;
  if (Number.isInteger(intent.phaseTicksRemaining) && intent.phaseTicksRemaining > 0) {
    return intent.phaseTicksRemaining;
  }
  intent.phaseTicksRemaining = durationTicks(intent.phaseRemaining);
  intent.phaseRemaining = intent.phaseTicksRemaining * STEP;
  return intent.phaseTicksRemaining;
}

function consumePhaseTicks(w: World, ticks: number) {
  const intent = w.creature.intent!;
  const remaining = remainingPhaseTicks(w) - ticks;
  intent.phaseTicksRemaining = Math.max(0, remaining);
  intent.phaseRemaining = intent.phaseTicksRemaining * STEP;
}

function applyOutcomeEffects(w: World, activity: Activity, outcome: Outcome) {
  const amount = outcome === 'success' ? 1 : outcome === 'partial' ? 0.5 : 0.15;
  if (activity === 'rest') w.creature.internal.energy = clamp(w.creature.internal.energy + 0.32 * amount);
  if (activity === 'forage') w.creature.internal.forageReadiness = clamp(0.12 + (1 - amount) * 0.42);
  if (activity === 'groom') w.creature.internal.groomingReadiness = clamp(0.1 + (1 - amount) * 0.45);
}

function beginAttempt(w: World) {
  const intent = w.creature.intent!;
  intent.phase = 'attempt';
  setPhaseTimer(w, phaseDuration(w, intent.activity));
  w.creature.target = { ...w.creature.position };
  record(w, 'behavior-attempted', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: 'attempt',
    assisted: intent.assisted,
    assistanceSource: intent.assistanceSource,
  });
}

function startAttempt(w: World) {
  const intent = w.creature.intent!;
  const source = resolveOpportunity(w, intent.opportunityId);
  intent.resolvedPosition = intent.activity === 'idle' || intent.activity === 'wander' || intent.opportunityId === 'player-invitation'
    ? { ...intent.target }
    : { ...(source?.position ?? intent.target) };
  const domain = careDomainForActivity(intent.activity);
  if (domain && shouldRequestHelp(w, intent.activity)) {
    intent.phase = 'request';
    intent.helpRequested = true;
    setPhaseTimer(w, 6 + random(w, 'social') * 6);
    w.creature.target = { ...w.creature.position };
    recordHelpRequest(w, domain);
    record(w, 'care-help-requested', {
      subject: domain,
      activity: intent.activity,
      affordance: intent.affordance,
      phase: 'request',
      assisted: false,
    });
    return;
  }
  beginAttempt(w);
}

function experienceOutcome(w: World, forced?: Outcome) {
  const intent = w.creature.intent!;
  intent.phase = 'outcome';
  intent.outcome = forced ?? outcomeFor(w, intent.activity, intent.assisted);
  setPhaseTimer(w, 0.6);
  applyOutcomeEffects(w, intent.activity, intent.outcome);
  record(w, 'behavior-experienced', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: 'outcome',
    outcome: intent.outcome,
    assisted: intent.assisted,
    assistanceSource: intent.assistanceSource,
  });
}

function learnFromOutcome(w: World) {
  const intent = w.creature.intent!;
  const outcome = intent.outcome ?? 'deferred';
  completeLearning(
    w,
    intent.activity,
    intent.affordance,
    intent.opportunityId,
    outcome,
    intent.assisted,
    w.time - intent.noticedAt,
    intent.resolvedPosition ?? w.creature.position,
    intent.assistanceSource,
    intent.helpRequested,
  );
  intent.phase = 'reflect';
  setPhaseTimer(w, 12 + random(w) * 18);
  record(w, 'behavior-learned', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: 'reflect',
    outcome,
    assisted: intent.assisted,
    assistanceSource: intent.assistanceSource,
  });
}

function considerInvitation(w: World): boolean {
  const invitation = w.pendingInvitation;
  if (!invitation) return false;
  w.pendingInvitation = undefined;
  if (w.time > invitation.expiresAt) {
    recordInvitation(w, false);
    record(w, 'invitation-expired', { subject: 'player-invitation', outcome: 'deferred', assisted: true });
    return false;
  }
  const creature = w.creature;
  const acceptance = 0.18 + creature.temperament.curiosity * 0.32 + creature.temperament.sociability * 0.2;
  const accepted = random(w, 'social') < acceptance;
  recordInvitation(w, accepted);
  record(w, accepted ? 'invitation-accepted' : 'invitation-declined', {
    subject: 'player-invitation',
    activity: 'explore',
    affordance: 'investigate',
    outcome: accepted ? 'success' : 'deferred',
    assisted: true,
  });
  if (accepted) beginIntent(w, invitationOpportunity(w, invitation.position), invitation.position);
  return accepted;
}

function selectNextIntent(w: World) {
  if (!considerInvitation(w)) chooseActivity(w);
}

function cancelIntent(w: World) {
  const intent = w.creature.intent!;
  record(w, 'behavior-cancelled', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: intent.phase,
    assisted: intent.assisted,
    assistanceSource: intent.assistanceSource,
  });
  w.creature.intent = undefined;
  w.creature.target = { ...w.creature.position };
}

function moveTowardIntent(w: World) {
  const creature = w.creature;
  const intent = creature.intent!;
  const waypoint = intent.route[0] ?? intent.target;
  const dx = waypoint.x - creature.position.x;
  const dy = waypoint.y - creature.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.8) {
    creature.position = { ...waypoint };
    if (intent.route.length > 0) intent.route.shift();
    if (Math.hypot(intent.target.x - creature.position.x, intent.target.y - creature.position.y) > 0.8) {
      const route = planRoute(creature.position, intent.target);
      if (!route) { cancelIntent(w); return; }
      intent.route = route;
      creature.target = { ...(route[0] ?? intent.target) };
      return;
    }
    record(w, 'behavior-approached', {
      subject: intent.opportunityId,
      activity: intent.activity,
      affordance: intent.affordance,
      phase: 'approach',
      assisted: intent.assisted,
      assistanceSource: intent.assistanceSource,
    });
    startAttempt(w);
    return;
  }
  const speed = (intent.activity === 'rest' ? 13 : 19) * STEP;
  const amount = Math.min(speed, distance);
  const position = { x: creature.position.x + dx / distance * amount, y: creature.position.y + dy / distance * amount };
  if (!validPosition(position)) {
    cancelIntent(w);
    return;
  }
  creature.position = position;
  creature.target = { ...waypoint };
  creature.distance += amount;
  creature.facing = dx < 0 ? -1 : 1;
}

function finishTimedPhase(w: World) {
  const creature = w.creature;
  const intent = creature.intent!;
  if (intent.phase === 'notice') {
    intent.phase = 'approach';
    creature.target = { ...(intent.route[0] ?? intent.target) };
    record(w, 'behavior-approaching', {
      subject: intent.opportunityId,
      activity: intent.activity,
      affordance: intent.affordance,
      phase: 'approach',
      assisted: intent.assisted,
      assistanceSource: intent.assistanceSource,
    });
  } else if (intent.phase === 'request') {
    // An unanswered request is only a pause. It carries no failure or absence
    // penalty and the creature proceeds with an independent attempt.
    beginAttempt(w);
  } else if (intent.phase === 'attempt') {
    experienceOutcome(w);
  } else if (intent.phase === 'outcome') {
    learnFromOutcome(w);
  } else {
    creature.intent = undefined;
    creature.target = { ...creature.position };
    selectNextIntent(w);
  }
}

function processTicks(w: World, requestedTicks: number) {
  let ticks = Math.max(0, Math.floor(requestedTicks));
  while (ticks > 0) {
    const intent = w.creature.intent;
    if (!intent) {
      advanceClock(w, 1);
      selectNextIntent(w);
      ticks--;
      continue;
    }
    if (intent.phase === 'approach') {
      // Movement stays tickwise so saved positions and arrival detection retain
      // exactly the same floating-point path as live rendering.
      advanceClock(w, 1);
      moveTowardIntent(w);
      ticks--;
      continue;
    }
    const phaseTicks = remainingPhaseTicks(w);
    const consumed = Math.min(ticks, phaseTicks);
    advanceClock(w, consumed);
    consumePhaseTicks(w, consumed);
    ticks -= consumed;
    if (w.creature.intent && w.creature.intent.phaseTicksRemaining === 0) finishTimedPhase(w);
  }
}

export function step(w: World) {
  processTicks(w, 1);
}

export function interruptIntent(w: World, opportunityId: string): boolean {
  const intent = w.creature.intent;
  if (!intent || intent.opportunityId !== opportunityId || intent.phase !== 'attempt') return false;
  intent.assisted = true;
  intent.assistanceSource ??= 'environment-arranged';
  record(w, 'behavior-interrupted', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: 'attempt',
    outcome: 'deferred',
    assisted: true,
    assistanceSource: intent.assistanceSource,
  });
  experienceOutcome(w, 'deferred');
  w.creature.target = { ...w.creature.position };
  return true;
}

export function retargetOpportunity(w: World, opportunityId: string, position: Point): boolean {
  const intent = w.creature.intent;
  if (!intent || intent.opportunityId !== opportunityId) return false;
  if (intent.phase === 'attempt') return interruptIntent(w, opportunityId);
  if (intent.phase !== 'notice' && intent.phase !== 'approach') return false;
  const target = approachTarget(position);
  const route = planRoute(w.creature.position, target);
  if (!route) { cancelIntent(w); return false; }
  intent.target = target;
  intent.route = route;
  intent.assisted = true;
  intent.assistanceSource ??= 'environment-arranged';
  w.creature.target = intent.phase === 'notice' ? { ...w.creature.position } : { ...(route[0] ?? target) };
  record(w, 'behavior-retargeted', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: intent.phase,
    assisted: true,
    assistanceSource: intent.assistanceSource,
  });
  return true;
}

export function advance(w: World, seconds: number) {
  const duration = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const ticks = Math.floor((duration + 1e-9) / STEP);
  processTicks(w, ticks);
}

export function advanceOffline(w: World, seconds: number): OfflineAdvanceResult {
  const requestedSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const limitedSeconds = Math.min(OFFLINE_LIMIT_SECONDS, requestedSeconds);
  const ticks = Math.floor((limitedSeconds + 1e-9) / STEP);
  processTicks(w, ticks);
  return {
    requestedSeconds,
    simulatedSeconds: ticks * STEP,
    capped: requestedSeconds > OFFLINE_LIMIT_SECONDS,
    ticks,
  };
}

export function interact(w: World, event: PlayerEvent) {
  if (!validPosition(event.position)) return false;
  if (w.pendingInvitation) {
    recordInvitation(w, false);
    record(w, 'invitation-replaced', { subject: 'player-invitation', outcome: 'deferred', assisted: true });
  }
  w.pendingInvitation = { position: { ...event.position }, createdAt: w.time, expiresAt: w.time + 30 };
  record(w, 'invitation-offered', { subject: 'player-invitation', activity: 'explore', affordance: 'investigate', assisted: true });
  if (!w.creature.intent) considerInvitation(w);
  return true;
}
