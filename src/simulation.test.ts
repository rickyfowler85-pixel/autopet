import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableOpportunities, beginIntent, invitationOpportunity, lineClear, planRoute } from './behavior';
import { greet, moveObject, placement, validPlacement } from './interaction';
import { assistCare, completeLearning, habituationLevel, preferenceTotal } from './learning';
import { ACTIVITIES, createWorld, STEP, validPosition, type Activity, type World } from './model';
import { recentEvidence } from './evidence';
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

type CarePattern = 'feeding' | 'grooming' | 'balanced';
type IndependenceSnapshot = World['creature']['learning']['independence'];
interface HistoryResult {
  world: World;
  day7: IndependenceSnapshot;
  afterAbsence?: IndependenceSnapshot;
}

function advanceWithCarePattern(w: World, seconds: number, pattern: CarePattern) {
  const end = w.time + seconds;
  const handled = new Set<number>();
  while (w.time < end - STEP / 2) {
    const intent = w.creature.intent;
    if (intent && !handled.has(intent.id)
      && (intent.phase === 'request' || intent.phase === 'attempt')
      && (intent.activity === 'forage' || intent.activity === 'groom')) {
      handled.add(intent.id);
      const matchingDomain = intent.activity === 'forage' ? 'feeding' : 'grooming';
      const shouldOffer = pattern === matchingDomain || (pattern === 'balanced' && intent.id % 3 === 0);
      if (shouldOffer) assistCare(w, matchingDomain);
    }
    // Care attempts last at least 28 seconds, so ten-second observation slices
    // cannot skip an entire contextual offer window.
    advance(w, Math.min(10, end - w.time));
  }
}

let cachedHistories: Record<string, HistoryResult> | undefined;
function longTermHistories(): Record<string, HistoryResult> {
  if (cachedHistories) return cachedHistories;
  const autonomous = createWorld(131);
  autonomous.lastSaved = 0;
  advance(autonomous, 7 * 86400);
  const autonomousDay7 = structuredClone(autonomous.creature.learning.independence);
  advance(autonomous, 23 * 86400);

  const buildInteractive = (pattern: CarePattern): HistoryResult => {
    const world = createWorld(131);
    world.lastSaved = 0;
    advanceWithCarePattern(world, 7 * 86400, pattern);
    const day7 = structuredClone(world.creature.learning.independence);
    advanceWithCarePattern(world, 23 * 86400, pattern);
    return { world, day7 };
  };

  const absenceReturn = createWorld(131);
  absenceReturn.lastSaved = 0;
  advanceOffline(absenceReturn, 7 * 86400);
  const absenceDay7 = structuredClone(absenceReturn.creature.learning.independence);
  advanceOffline(absenceReturn, 8 * 86400);
  const afterAbsence = structuredClone(absenceReturn.creature.learning.independence);
  advanceWithCarePattern(absenceReturn, 15 * 86400, 'balanced');

  cachedHistories = {
    autonomous: { world: autonomous, day7: autonomousDay7 },
    feeding: buildInteractive('feeding'),
    grooming: buildInteractive('grooming'),
    balanced: buildInteractive('balanced'),
    absenceReturn: { world: absenceReturn, day7: absenceDay7, afterAbsence },
  };
  return cachedHistories;
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
  assert.equal(outcome.assistanceSource, 'environment-arranged');
  assert.equal(w.creature.learning.independence.feeding.assistedAttempts, 0);
  assert.equal(w.development.evidence.rolling.days[0].care.feeding.playerAssisted.attempts, 0);
  assert.equal(w.development.evidence.rolling.days[0].care.feeding.playerInfluenced.attempts, 1);
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

test('contrasting 7- and 30-day upbringing histories remain distinct and domain-specific', () => {
  const histories = longTermHistories();
  const autonomous7 = histories.autonomous.day7;
  const feeding7 = histories.feeding.day7;
  const grooming7 = histories.grooming.day7;
  assert.ok(feeding7.feeding.reliance > autonomous7.feeding.reliance + 0.08);
  assert.ok(autonomous7.feeding.capability > feeding7.feeding.capability + 0.04);
  assert.ok(grooming7.grooming.reliance > autonomous7.grooming.reliance + 0.05);
  assert.ok(autonomous7.grooming.capability > grooming7.grooming.capability + 0.03);

  const autonomous = histories.autonomous.world.creature.learning.independence;
  const feeding = histories.feeding.world.creature.learning.independence;
  const grooming = histories.grooming.world.creature.learning.independence;
  const balanced = histories.balanced.world.creature.learning.independence;
  assert.ok(feeding.feeding.reliance > autonomous.feeding.reliance + 0.2);
  assert.ok(autonomous.feeding.capability > feeding.feeding.capability + 0.1);
  assert.ok(feeding.feeding.helpRequests > autonomous.feeding.helpRequests * 2);
  assert.ok(grooming.grooming.reliance > autonomous.grooming.reliance + 0.16);
  assert.ok(autonomous.grooming.capability > grooming.grooming.capability + 0.08);
  assert.equal(feeding.grooming.assistedAttempts, 0);
  assert.equal(grooming.feeding.assistedAttempts, 0);
  assert.ok(balanced.feeding.assistedAttempts > 0 && balanced.feeding.autonomousAttempts > 0);
  assert.ok(balanced.grooming.assistedAttempts > 0 && balanced.grooming.autonomousAttempts > 0);

  const returned = histories.absenceReturn.world.creature.learning.independence;
  const afterAbsence = histories.absenceReturn.afterAbsence!;
  assert.equal(afterAbsence.feeding.assistedAttempts, 0);
  assert.equal(afterAbsence.grooming.assistedAttempts, 0);
  assert.ok(afterAbsence.feeding.capability > 0.3 && afterAbsence.grooming.capability > 0.25);
  assert.ok(returned.feeding.assistedAttempts > 0 && returned.feeding.autonomousAttempts > 0);
  assert.ok(returned.grooming.assistedAttempts > 0 && returned.grooming.autonomousAttempts > 0);
  assert.ok(returned.feeding.reliance > afterAbsence.feeding.reliance);
});

test('a creature that received frequent help can develop independence later', () => {
  const w = createWorld(131);
  w.lastSaved = 0;
  advanceWithCarePattern(w, 15 * 86400, 'feeding');
  const before = structuredClone(w.creature.learning.independence.feeding);
  advance(w, 15 * 86400);
  const after = w.creature.learning.independence.feeding;
  assert.ok(after.capability > before.capability + 0.15);
  assert.ok(after.confidence > before.confidence);
  assert.ok(after.reliance < before.reliance - 0.15);
  assert.equal(after.assistedAttempts, before.assistedAttempts);
  assert.ok(after.autonomousAttempts > before.autonomousAttempts);
});

test('reliance changes observable help-seeking without blocking autonomous care', () => {
  const low = createWorld(313);
  const high = createWorld(313);
  low.lastSaved = high.lastSaved = 0;
  low.creature.learning.independence.feeding.reliance = 0;
  low.creature.learning.independence.grooming.reliance = 0;
  high.creature.learning.independence.feeding.reliance = 0.8;
  high.creature.learning.independence.grooming.reliance = 0.8;
  advance(low, 7 * 86400);
  advance(high, 7 * 86400);
  assert.ok(high.creature.learning.independence.feeding.helpRequests > low.creature.learning.independence.feeding.helpRequests * 3);
  assert.ok(high.creature.learning.independence.grooming.helpRequests > low.creature.learning.independence.grooming.helpRequests * 3);
  assert.ok(high.creature.learning.independence.feeding.autonomousAttempts > 0);
  assert.ok(high.creature.learning.independence.grooming.autonomousAttempts > 0);
});

test('contextual care joins the normal sequence and ordinary affection remains independent', () => {
  const w = createWorld(131);
  const forage = availableOpportunities(w).find(item => item.activity === 'forage' && item.id === 'seedpod')!;
  w.creature.learning.independence.feeding.reliance = 0.9;
  w.socialSeed = 1; // Deterministically chooses the optional request phase.
  beginIntent(w, forage);
  advanceUntil(w, () => w.creature.intent?.phase === 'request');
  const intentId = w.creature.intent!.id;
  const beforeAttempts = w.creature.learning.independence.feeding.attempts;
  assert.equal(assistCare(w, 'feeding'), true);
  assert.equal(assistCare(w, 'feeding'), false, 'one intention accepts at most one offer');
  assert.equal(w.creature.intent?.id, intentId);
  assert.equal(w.creature.intent?.assistanceSource, 'player-feeding');
  assert.equal(w.creature.learning.independence.feeding.attempts, beforeAttempts, 'the offer does not fabricate an outcome');
  advanceUntil(w, () => w.creature.intent?.id !== intentId, 180);
  const feeding = w.creature.learning.independence.feeding;
  assert.equal(feeding.assistedAttempts, 1);
  assert.equal(feeding.helpOffers, 1);
  assert.equal(feeding.helpAccepted, 1);
  assert.equal(w.development.evidence.rolling.days[0].care.feeding.playerAssisted.attempts, 1);

  const reliance = feeding.reliance;
  for (let index = 0; index < 12; index++) greet(w, true, index);
  assert.equal(feeding.reliance, reliance, 'attachment is separate from care reliance');
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

test('rolling evidence retains compact 7- and 30-day developmental windows', () => {
  const w = createWorld(211);
  w.lastSaved = 0;
  for (let day = 0; day < 35; day++) {
    w.tick = day * 86400 / STEP;
    w.time = w.tick * STEP;
    completeLearning(w, 'explore', 'investigate', 'fallen-branch', day % 4 === 0 ? 'partial' : 'success', false, 12);
  }
  assert.equal(w.development.evidence.activities.explore.attempts, 35);
  assert.equal(w.development.evidence.rolling.days.length, 30);
  assert.equal(w.development.evidence.rolling.days[0].day, 5);
  assert.equal(recentEvidence(w, 7).activities.explore?.attempts, 7);
  assert.equal(recentEvidence(w, 30).activities.explore?.attempts, 30);
  assert.equal(recentEvidence(w, 7).complete, true);
  assert.equal(recentEvidence(w, 30).complete, true);
  assert.deepEqual(decode(JSON.stringify(w)), w);

  const malformed = JSON.parse(JSON.stringify(w));
  malformed.development.evidence.rolling.days[1].day = malformed.development.evidence.rolling.days[0].day;
  assert.equal(decode(JSON.stringify(malformed)), null);
});

test('long-term autonomous behavior remains calm, varied, and bounded', () => {
  const histories = longTermHistories();
  const profiles = new Set<string>();
  for (const [name, history] of Object.entries(histories)) {
    const w = history.world;
    const counts = ACTIVITIES.map(activity => completed(w, activity));
    const total = counts.reduce((sum, value) => sum + value, 0);
    const perHour = total / (w.time / 3600);
    assert.ok(perHour >= 6 && perHour <= 60, `${name} completed ${perHour.toFixed(1)} intentions/hour`);
    assert.ok(counts.every(value => value > 0), `${name} should retain every activity over a month`);
    assert.ok(w.development.evidence.rolling.days.length <= 30);
    assert.ok(w.development.evidence.outcomes.length <= 240);
    assert.ok(w.experiences.length <= 80);
    assert.ok(Math.max(...Object.values(w.creature.learning.activityPreferences)) < 0.4);
    assert.ok(Math.max(...Object.values(w.creature.learning.objectInterests)) < 0.6);
    assert.equal(recentEvidence(w, 7).complete, true);
    assert.equal(recentEvidence(w, 30).complete, true);
    profiles.add(counts.map(value => Math.round(value / total * 100)).join(':'));
  }
  assert.ok(profiles.size >= 3, 'contrasting histories should retain observably different habits');
  assert.ok(recentEvidence(histories.feeding.world, 30).care.feeding.playerAssisted.attempts > 0);
  assert.equal(recentEvidence(histories.feeding.world, 30).care.grooming.playerAssisted.attempts, 0);
  assert.ok(recentEvidence(histories.grooming.world, 30).care.grooming.playerAssisted.attempts > 0);
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

test('offline catch-up advances deterministically for a month and reports longer caps', () => {
  const a = createWorld(59);
  const b = createWorld(59);
  const c = createWorld(59);
  a.lastSaved = b.lastSaved = c.lastSaved = 0;
  const result = advanceOffline(a, 90 * 86400);
  advance(b, 30 * 86400);
  for (let day = 0; day < 30; day++) advanceOffline(c, 86400);
  assert.deepEqual(a, b);
  assert.deepEqual(c, b);
  assert.equal(result.capped, true);
  assert.equal(result.simulatedSeconds, 30 * 86400);
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
  assert.equal(migrated.version, 3);
  assert.equal(migrated.objects[0].visits, 7);
  assert.equal(migrated.development.observations, 15);
  assert.equal(migrated.development.evidence.outcomes.length, 0);
  assert.equal(migrated.development.evidence.rolling.coverageStartedAt, migrated.time);
  assert.equal(migrated.creature.intent?.opportunityId, 'fallen-branch');
  assert.equal(decode('{bad'), null);
  assert.equal(decode(JSON.stringify({ ...migrated, creature: { ...migrated.creature, temperament: {} } })), null);
  assert.equal(decode(JSON.stringify({
    ...migrated,
    development: { ...migrated.development, evidence: { ...migrated.development.evidence, social: {} } },
  })), null);

  const oldV2World = createWorld(46);
  completeLearning(oldV2World, 'forage', 'forage', 'player-feeding-assistance', 'success', true, 4);
  const oldV2 = JSON.parse(JSON.stringify(oldV2World));
  oldV2.version = 2;
  delete oldV2.development.evidence.rolling;
  oldV2.creature.learning.independence.feeding.assisted = 1;
  for (const domain of ['feeding', 'grooming']) {
    for (const key of ['autonomousAttempts', 'autonomousSuccesses', 'assistedAttempts', 'assistedSuccesses', 'helpRequests', 'helpOffers', 'helpAccepted', 'helpDeclined']) {
      delete oldV2.creature.learning.independence[domain][key];
    }
  }
  for (const outcome of oldV2.development.evidence.outcomes) delete outcome.assistanceSource;
  const migratedV2 = decode(JSON.stringify(oldV2));
  assert.ok(migratedV2);
  assert.equal(migratedV2.version, 3);
  assert.equal(migratedV2.development.evidence.activities.forage.attempts, 1);
  assert.equal(migratedV2.development.evidence.outcomes[0].assistanceSource, 'player-feeding');
  assert.equal(migratedV2.development.evidence.rolling.coverageStartedAt, migratedV2.time);

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
