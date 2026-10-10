import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableOpportunities, beginIntent, invitationOpportunity, lineClear, planRoute } from './behavior';
import { greet, moveObject, placement, validPlacement } from './interaction';
import { assistCare, completeLearning, habituationLevel, preferenceTotal } from './learning';
import { ACTIVITIES, createWorld, STEP, validPosition, type Activity, type World } from './model';
import { decode, load, STORAGE_KEY } from './persistence';
import { advance, advanceOffline, interact, step } from './simulation';

function advanceUntil(w: World, predicate: () => boolean, limitSeconds = 180) {
  const limit = Math.floor(limitSeconds / STEP);
  for (let index = 0; index < limit && !predicate(); index++) step(w);
  assert.ok(predicate(), `condition was not reached within ${limitSeconds}s`);
}

function completed(w: World, activity: Activity): number {
  return w.development.evidence.activities[activity].attempts;
}

function assertPreferenceSimplex(w: World) {
  const activities = w.creature.learning.activityPreferences;
  const objects = w.creature.learning.objectInterests;
  assert.ok(Math.abs(preferenceTotal(activities) - 1) < 1e-9);
  assert.ok(Math.abs(preferenceTotal(objects) - 1) < 1e-9);
  assert.ok(Object.values(activities).every(value => value >= 0.035 - 1e-9 && value <= 0.48 + 1e-9));
  assert.ok(Object.values(objects).every(value => value >= 0.12 - 1e-9 && value <= 0.65 + 1e-9));
}

test('seeded simulation is reproducible across batching and a mid-intent save', () => {
  const a = createWorld(42);
  const b = createWorld(42);
  a.lastSaved = b.lastSaved = 0;
  advance(a, 600);
  for (let index = 0; index < 600 / STEP; index++) step(b);
  assert.deepEqual(a, b);

  advanceUntil(a, () => a.creature.intent?.phase === 'outcome');
  const restored = decode(JSON.stringify(a));
  assert.ok(restored);
  advance(a, 300);
  advance(restored, 300);
  assert.deepEqual(a, restored);
});

test('intentions follow ordered, environment-linked phases and learn exactly once', () => {
  const w = createWorld(73);
  const forage = availableOpportunities(w).find(item => item.activity === 'forage' && item.id === 'north-vegetation');
  assert.ok(forage);
  beginIntent(w, forage);
  const id = w.creature.intent!.id;
  advanceUntil(w, () => w.creature.intent?.id !== id, 240);
  const related = w.experiences.filter(event => event.subject === 'north-vegetation').map(event => event.kind);
  const expected = ['behavior-noticed', 'behavior-approaching', 'behavior-approached', 'behavior-attempted', 'behavior-experienced', 'behavior-outcome', 'behavior-learned'];
  let cursor = -1;
  for (const kind of expected) {
    const next = related.indexOf(kind, cursor + 1);
    assert.ok(next > cursor, `${kind} should follow the previous phase`);
    cursor = next;
  }
  assert.equal(w.development.evidence.activities.forage.attempts, 1);
  assert.equal(w.creature.learning.independence.feeding.attempts, 1);
  assert.ok(validPosition(forage.position));
});

test('blocked destinations use deterministic walkable routes without skipping action phases', () => {
  const w = createWorld(5);
  const target = { x: 297, y: 139 };
  assert.equal(validPosition(target), true);
  assert.equal(lineClear(w.creature.position, target), false);
  const route = planRoute(w.creature.position, target);
  assert.ok(route && route.length > 1);
  assert.deepEqual(planRoute(w.creature.position, target), route);
  let cursor = w.creature.position;
  for (const waypoint of route) {
    assert.equal(lineClear(cursor, waypoint), true);
    cursor = waypoint;
  }
  assert.deepEqual(cursor, target);

  beginIntent(w, invitationOpportunity(w, target), target);
  advanceUntil(w, () => w.creature.intent?.phase === 'approach' && w.creature.distance > 10);
  const restored = decode(JSON.stringify(w));
  assert.ok(restored);
  advanceUntil(w, () => w.development.evidence.opportunities['player-invitation']?.attempts === 1);
  advanceUntil(restored, () => restored.development.evidence.opportunities['player-invitation']?.attempts === 1);
  assert.deepEqual(restored, w);
  const related = w.experiences.filter(event => event.subject === 'player-invitation').map(event => event.kind);
  for (const kind of ['behavior-noticed', 'behavior-approaching', 'behavior-approached', 'behavior-attempted', 'behavior-experienced', 'behavior-outcome', 'behavior-learned']) {
    assert.ok(related.includes(kind), `${kind} should be retained for a routed intention`);
  }
  assert.equal(related.includes('behavior-cancelled'), false);
});

test('habitat opportunities expose multiple real affordances and moving objects retargets safely', () => {
  const w = createWorld(91);
  const opportunities = availableOpportunities(w);
  for (const id of ['root-shelter', 'shallow-pool', 'north-vegetation', 'south-vegetation', 'fallen-branch', 'warm-stone', 'seedpod']) {
    assert.ok(opportunities.filter(item => item.id === id).length >= 2, `${id} needs multiple affordances`);
  }
  const seedpod = opportunities.find(item => item.id === 'seedpod' && item.activity === 'forage')!;
  beginIntent(w, seedpod);
  advanceUntil(w, () => w.creature.intent?.phase === 'approach');
  const before = { ...w.creature.intent!.target };
  moveObject(w, 'seedpod', { x: 165, y: 225 });
  assert.notDeepEqual(w.creature.intent!.target, before);
  assert.ok(validPosition(w.creature.intent!.target));
  advanceUntil(w, () => w.development.evidence.opportunities.seedpod?.attempts === 1, 180);
});

test('moving an object during its attempt records a truthful interrupted outcome', () => {
  const w = createWorld(93);
  const seedpod = availableOpportunities(w).find(item => item.id === 'seedpod' && item.activity === 'forage')!;
  beginIntent(w, seedpod);
  advanceUntil(w, () => w.creature.intent?.phase === 'attempt');
  const resolvedPosition = { ...w.creature.intent!.resolvedPosition! };
  assert.equal(w.development.evidence.opportunities.seedpod, undefined);
  moveObject(w, 'seedpod', { x: 172, y: 226 });
  assert.equal(w.creature.intent?.phase, 'outcome');
  assert.equal(w.creature.intent?.outcome, 'deferred');
  assert.equal(w.creature.intent?.assisted, true);
  assert.notDeepEqual(w.objects.find(object => object.id === 'seedpod')!.position, resolvedPosition);
  advanceUntil(w, () => w.development.evidence.opportunities.seedpod?.attempts === 1);
  const outcome = w.development.evidence.outcomes.find(entry => entry.opportunityId === 'seedpod')!;
  assert.equal(outcome.outcome, 'deferred');
  assert.equal(outcome.assisted, true);
  assert.deepEqual(outcome.position, resolvedPosition);
  assert.equal(w.experiences.some(event => event.kind === 'behavior-interrupted' && event.subject === 'seedpod'), true);
  assert.deepEqual(decode(JSON.stringify(w)), w);
});

test('preference learning stays competitive, adapts to outcomes, and habituation recovers with time', () => {
  const w = createWorld(19);
  const initial = w.creature.learning.activityPreferences.explore;
  for (let index = 0; index < 180; index++) completeLearning(w, 'explore', 'investigate', 'fallen-branch', 'success', false, 5);
  const specialized = w.creature.learning.activityPreferences.explore;
  assert.ok(specialized > initial);
  assertPreferenceSimplex(w);
  assert.ok(Object.values(w.creature.learning.activityPreferences).filter(value => value > 0.04).length > 1);
  const immediateHabituation = habituationLevel(w, 'fallen-branch:investigate');
  assert.ok(immediateHabituation > 0.9);
  for (let index = 0; index < 120; index++) completeLearning(w, 'explore', 'investigate', 'fallen-branch', 'deferred', false, 5);
  assert.ok(w.creature.learning.activityPreferences.explore < specialized);
  assertPreferenceSimplex(w);
  w.time += 7200;
  assert.ok(habituationLevel(w, 'fallen-branch:investigate') < immediateHabituation / 20);
});

test('different temperament seeds develop distinct, non-saturated multi-day profiles', () => {
  const worlds = [11, 29, 47, 83].map(seed => createWorld(seed));
  for (const w of worlds) {
    advance(w, 2 * 86400);
    assertPreferenceSimplex(w);
    assert.ok(completed(w, 'forage') > 0);
    assert.ok(completed(w, 'groom') > 0);
    assert.ok(completed(w, 'rest') > 0);
    assert.ok(w.experiences.length <= 80);
    assert.ok(Math.max(...Object.values(w.creature.learning.activityPreferences)) < 0.4, 'ordinary experience should not pin a preference to its cap');
    assert.ok(Math.max(...Object.values(w.creature.learning.objectInterests)) < 0.6, 'ordinary object interest should remain adaptable');
  }
  const temperaments = new Set(worlds.map(w => Object.values(w.creature.temperament).map(value => value.toFixed(2)).join(':')));
  const profiles = new Set(worlds.map(w => ACTIVITIES
    .map(activity => `${activity}:${(completed(w, activity) / Object.values(w.development.evidence.activities).reduce((sum, item) => sum + item.attempts, 0)).toFixed(2)}`)
    .join('|')));
  assert.equal(temperaments.size, worlds.length);
  assert.ok(profiles.size >= 2, 'seeded creatures should not converge on one behavior profile');
});

test('different care histories separate capability, confidence, and reliance without absence penalties', () => {
  const passive = createWorld(131);
  const feedingHelp = createWorld(131);
  const groomingHelp = createWorld(131);
  for (let hour = 0; hour < 72; hour++) {
    if (hour % 3 === 0) assistCare(feedingHelp, 'feeding');
    if (hour % 3 === 0) assistCare(groomingHelp, 'grooming');
    advance(passive, 3600);
    advance(feedingHelp, 3600);
    advance(groomingHelp, 3600);
  }
  assert.ok(completed(passive, 'forage') > 0 && completed(passive, 'groom') > 0);
  assert.ok(feedingHelp.creature.learning.independence.feeding.assisted > 0);
  assert.ok(groomingHelp.creature.learning.independence.grooming.assisted > 0);
  assert.ok(feedingHelp.creature.learning.independence.feeding.reliance > passive.creature.learning.independence.feeding.reliance);
  assert.ok(groomingHelp.creature.learning.independence.grooming.reliance > passive.creature.learning.independence.grooming.reliance);
  assert.notEqual(feedingHelp.creature.learning.independence.feeding.capability, feedingHelp.creature.learning.independence.feeding.confidence);
  const beforeAbsence = feedingHelp.creature.learning.independence.feeding;
  const capability = beforeAbsence.capability;
  const reliance = beforeAbsence.reliance;
  advance(feedingHelp, 86400);
  assert.ok(feedingHelp.creature.learning.independence.feeding.capability >= capability);
  assert.ok(feedingHelp.creature.learning.independence.feeding.reliance <= reliance);
});

test('durable evidence outlives the short log and round-trips with reconciled outcomes', () => {
  const w = createWorld(197);
  advance(w, 8 * 3600);
  const total = Object.values(w.development.evidence.activities).reduce((sum, item) => sum + item.attempts, 0);
  assert.ok(total > 80);
  assert.equal(w.experiences.length, 80);
  for (const summary of Object.values(w.development.evidence.activities)) {
    assert.equal(summary.successes + summary.partials + summary.deferred, summary.attempts);
  }
  assert.ok(w.development.evidence.outcomes.length <= 240);
  assert.ok(w.development.evidence.outcomes.every(outcome => validPosition(outcome.position)));
  const restored = decode(JSON.stringify(w));
  assert.deepEqual(restored, w);
});

test('invitations remain voluntary, never interrupt an active attempt, and social input uses its own RNG', () => {
  const w = createWorld(31);
  const rest = availableOpportunities(w).find(item => item.id === 'root-shelter' && item.activity === 'rest')!;
  beginIntent(w, rest);
  advanceUntil(w, () => w.creature.intent?.phase === 'attempt');
  const intentId = w.creature.intent!.id;
  assert.equal(interact(w, { type: 'invite', position: { x: 205, y: 205 } }), true);
  assert.equal(w.creature.intent!.id, intentId);
  assert.equal(w.creature.intent!.activity, 'rest');

  const decisionSeed = w.seed;
  const outcomeSeed = w.outcomeSeed;
  greet(w, true, 0);
  assert.equal(w.seed, decisionSeed);
  assert.equal(w.outcomeSeed, outcomeSeed);
  advance(w, 120);
  const social = w.development.evidence.social;
  assert.equal(social.invitations, social.accepted + social.declined);
});

test('offline catch-up alone is capped at six hours and never harms the creature', () => {
  const a = createWorld(59);
  const b = createWorld(59);
  a.lastSaved = b.lastSaved = 0;
  advanceOffline(a, 999999);
  advance(b, 21600);
  assert.deepEqual(a, b);
  assert.equal(a.creature.anatomy.stage, 'juvenile');
  assert.ok(a.creature.internal.energy >= 0 && a.creature.internal.forageReadiness >= 0 && a.creature.internal.groomingReadiness >= 0);
});

test('loading anchors offline catch-up so first visibility resume cannot apply it twice', () => {
  const stored = createWorld(61);
  advance(stored, 180);
  stored.lastSaved = 1_000_000;
  const raw = JSON.stringify(stored);
  const loadAt = stored.lastSaved + 3_600_000;
  const resumeAt = loadAt + 900_000;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const nowDescriptor = Object.getOwnPropertyDescriptor(Date, 'now')!;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => key === STORAGE_KEY ? raw : null },
  });
  Object.defineProperty(Date, 'now', { configurable: true, value: () => loadAt });
  try {
    const loaded = load();
    assert.equal(loaded.available, true);
    assert.equal(loaded.offline, 3600);
    assert.equal(loaded.world.lastSaved, loadAt);
    const expected = decode(raw)!;
    advanceOffline(expected, 3600);
    expected.lastSaved = loadAt;
    assert.deepEqual(loaded.world, expected);

    advanceOffline(loaded.world, (resumeAt - loaded.world.lastSaved) / 1000);
    advanceOffline(expected, 900);
    assert.deepEqual(loaded.world, expected);
  } finally {
    Object.defineProperty(Date, 'now', nowDescriptor);
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('version-one saves migrate facts without inventing outcomes; malformed saves are rejected', () => {
  const legacy = {
    version: 1, seed: 42, time: 120, tick: 1200, lastSaved: 1000,
    creature: {
      position: { x: 190, y: 190 }, target: { x: 147, y: 213 }, facing: -1, activity: 'explore', remaining: 4,
      anatomy: { stage: 'juvenile', sprite: 'juvenile-placeholder', traits: { ears: 2, tail: 1, coat: 'slate' } },
      temperament: { curiosity: 0.7, sociability: 0.4, restfulness: 0.2 }, distance: 18,
    },
    objects: [
      { id: 'fallen-branch', kind: 'branch', position: { x: 147, y: 213 }, affordances: ['inspect'], visits: 7 },
      { id: 'warm-stone', kind: 'stone', position: { x: 245, y: 192 }, affordances: ['inspect', 'rest'], visits: 3 },
      { id: 'seedpod', kind: 'seedpod', position: { x: 212, y: 150 }, affordances: ['inspect'], visits: 5 },
    ],
    experiences: [{ time: 100, kind: 'discovered', subject: 'branch' }],
    development: { stage: 'juvenile', observations: 15 }, explorationTarget: 'fallen-branch',
  };
  const migrated = decode(JSON.stringify(legacy));
  assert.ok(migrated);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.objects[0].visits, 7);
  assert.equal(migrated.development.observations, 15);
  assert.equal(migrated.development.evidence.outcomes.length, 0);
  assert.equal(migrated.creature.intent?.opportunityId, 'fallen-branch');
  assert.equal(decode('{bad'), null);
  assert.equal(decode(JSON.stringify({ ...migrated, creature: { ...migrated.creature, temperament: {} } })), null);
  assert.equal(decode(JSON.stringify({
    ...migrated,
    development: { ...migrated.development, evidence: { ...migrated.development.evidence, social: {} } },
  })), null);

  const withOutcome = createWorld(44);
  completeLearning(withOutcome, 'explore', 'investigate', 'fallen-branch', 'success', false, 5);
  const malformedOutcome = JSON.parse(JSON.stringify(withOutcome));
  delete malformedOutcome.development.evidence.outcomes[0].position;
  assert.equal(decode(JSON.stringify(malformedOutcome)), null);

  const fabricatedEvidence = JSON.parse(JSON.stringify(createWorld(45)));
  fabricatedEvidence.development.evidence.outcomes.push({
    time: 0,
    activity: 'explore',
    affordance: 'investigate',
    opportunityId: 'fallen-branch',
    position: { x: 147, y: 213 },
    outcome: 'success',
    assisted: false,
  });
  assert.equal(decode(JSON.stringify(fabricatedEvidence)), null);
});

test('drag placement still projects pond, shelter, and overlaps onto valid ground', () => {
  const w = createWorld();
  for (const position of [{ x: 333, y: 166 }, { x: 86, y: 167 }, { x: 245, y: 192 }, { x: -200, y: 500 }]) {
    const projected = placement(w, 'seedpod', position);
    assert.ok(validPlacement(w, 'seedpod', projected));
    moveObject(w, 'seedpod', position);
    assert.deepEqual(w.objects[2].position, projected);
  }
  assert.ok(decode(JSON.stringify(w)));
});
