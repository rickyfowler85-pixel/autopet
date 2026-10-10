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
import { approachTarget, beginIntent, chooseActivity, invitationOpportunity, planRoute, resolveOpportunity } from './behavior';
import { completeLearning, recordInvitation } from './learning';

function phaseDuration(w: World, activity: Activity): number {
  const variation = random(w) * 0.35 + 0.85;
  const durations: Record<Activity, number> = {
    idle: 5.5,
    wander: 3.5,
    rest: 15,
    explore: 5,
    forage: 7,
    groom: 7,
    wade: 6,
    play: 7,
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

function updateInternalState(w: World) {
  const creature = w.creature;
  const resting = creature.activity === 'rest' && creature.intent?.phase === 'attempt';
  creature.internal.energy = clamp(creature.internal.energy + (resting ? 0.00055 : -0.00008) * STEP);
  creature.internal.forageReadiness = clamp(creature.internal.forageReadiness + 0.000075 * STEP);
  creature.internal.groomingReadiness = clamp(creature.internal.groomingReadiness + 0.000045 * STEP);
}

function applyOutcomeEffects(w: World, activity: Activity, outcome: Outcome) {
  const amount = outcome === 'success' ? 1 : outcome === 'partial' ? 0.5 : 0.15;
  if (activity === 'rest') w.creature.internal.energy = clamp(w.creature.internal.energy + 0.32 * amount);
  if (activity === 'forage') w.creature.internal.forageReadiness = clamp(0.12 + (1 - amount) * 0.42);
  if (activity === 'groom') w.creature.internal.groomingReadiness = clamp(0.1 + (1 - amount) * 0.45);
}

function startAttempt(w: World) {
  const intent = w.creature.intent!;
  const source = resolveOpportunity(w, intent.opportunityId);
  intent.resolvedPosition = intent.activity === 'idle' || intent.activity === 'wander' || intent.opportunityId === 'player-invitation'
    ? { ...intent.target }
    : { ...(source?.position ?? intent.target) };
  intent.phase = 'attempt';
  intent.phaseRemaining = phaseDuration(w, intent.activity);
  w.creature.target = { ...w.creature.position };
  record(w, 'behavior-attempted', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: 'attempt',
    assisted: intent.assisted,
  });
}

function experienceOutcome(w: World, forced?: Outcome) {
  const intent = w.creature.intent!;
  intent.phase = 'outcome';
  intent.outcome = forced ?? outcomeFor(w, intent.activity, intent.assisted);
  intent.phaseRemaining = 0.6;
  applyOutcomeEffects(w, intent.activity, intent.outcome);
  record(w, 'behavior-experienced', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: 'outcome',
    outcome: intent.outcome,
    assisted: intent.assisted,
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
  );
  intent.phase = 'reflect';
  intent.phaseRemaining = 0.8 + random(w) * 1.8;
  record(w, 'behavior-learned', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: 'reflect',
    outcome,
    assisted: intent.assisted,
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

export function step(w: World) {
  w.tick++;
  w.time = w.tick * STEP;
  updateInternalState(w);
  const creature = w.creature;
  if (!creature.intent) {
    selectNextIntent(w);
    return;
  }
  const intent = creature.intent;
  if (intent.phase === 'notice') {
    intent.phaseRemaining -= STEP;
    if (intent.phaseRemaining <= 0) {
      intent.phase = 'approach';
      creature.target = { ...(intent.route[0] ?? intent.target) };
      record(w, 'behavior-approaching', {
        subject: intent.opportunityId,
        activity: intent.activity,
        affordance: intent.affordance,
        phase: 'approach',
        assisted: intent.assisted,
      });
    }
  } else if (intent.phase === 'approach') {
    moveTowardIntent(w);
  } else if (intent.phase === 'attempt') {
    intent.phaseRemaining -= STEP;
    if (intent.phaseRemaining <= 0) experienceOutcome(w);
  } else if (intent.phase === 'outcome') {
    intent.phaseRemaining -= STEP;
    if (intent.phaseRemaining <= 0) learnFromOutcome(w);
  } else {
    intent.phaseRemaining -= STEP;
    if (intent.phaseRemaining <= 0) {
      creature.intent = undefined;
      creature.target = { ...creature.position };
      selectNextIntent(w);
    }
  }
}

export function interruptIntent(w: World, opportunityId: string): boolean {
  const intent = w.creature.intent;
  if (!intent || intent.opportunityId !== opportunityId || intent.phase !== 'attempt') return false;
  intent.assisted = true;
  record(w, 'behavior-interrupted', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: 'attempt',
    outcome: 'deferred',
    assisted: true,
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
  w.creature.target = intent.phase === 'notice' ? { ...w.creature.position } : { ...(route[0] ?? target) };
  record(w, 'behavior-retargeted', {
    subject: intent.opportunityId,
    activity: intent.activity,
    affordance: intent.affordance,
    phase: intent.phase,
    assisted: true,
  });
  return true;
}

export function advance(w: World, seconds: number) {
  const ticks = Math.floor(Math.max(0, seconds) / STEP);
  for (let index = 0; index < ticks; index++) step(w);
}

export function advanceOffline(w: World, seconds: number) {
  advance(w, Math.min(21600, Math.max(0, seconds)));
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
