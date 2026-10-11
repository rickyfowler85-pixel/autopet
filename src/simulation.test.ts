import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableOpportunities, beginIntent, invitationOpportunity, lineClear, planRoute } from './behavior';
import { greet, moveObject, placement, validPlacement } from './interaction';
import { assistCare, completeLearning, habituationLevel, preferenceTotal } from './learning';
import {
  ACTIVITIES,
  createWorld,
  STEP,
  validPosition,
  type Activity,
  type Affordance,
  type AnatomyParameters,
  type Point,
  type World,
} from './model';
import { recentEvidence } from './evidence';
import { decode, load, STORAGE_KEY } from './persistence';
import { advance, advanceOffline, interact, step } from './simulation';
import {
  ANATOMY_BOUNDS,
  ANATOMY_PARAMETER_KEYS,
  BASELINE_ANATOMY_PARAMETERS,
  anatomyParametersCompatible,
  createAnatomy,
  updateAnatomy,
  validAnatomyParameters,
} from './anatomy';
import { anatomyVisualKey, rasterizeCreature, type CreatureRaster } from './assets';

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

const DAY_SECONDS = 86_400;

interface LifestyleExposure {
  activity: Activity;
  affordance: Affordance;
  opportunityId: string;
  position: Point;
  attempts: number;
}

const MOBILITY_LIFESTYLE: LifestyleExposure[] = [
  { activity: 'explore', affordance: 'investigate', opportunityId: 'fallen-branch', position: { x: 147, y: 213 }, attempts: 150 },
  { activity: 'wander', affordance: 'roam', opportunityId: 'open-clearing', position: { x: 202, y: 194 }, attempts: 75 },
  { activity: 'play', affordance: 'play', opportunityId: 'open-clearing', position: { x: 202, y: 194 }, attempts: 100 },
];

const AQUATIC_LIFESTYLE: LifestyleExposure[] = [
  { activity: 'wade', affordance: 'wade', opportunityId: 'shallow-pool', position: { x: 270, y: 184 }, attempts: 100 },
];

const GROUND_FORAGING_LIFESTYLE: LifestyleExposure[] = [
  { activity: 'forage', affordance: 'forage', opportunityId: 'north-vegetation', position: { x: 180, y: 146 }, attempts: 25 },
  { activity: 'rest', affordance: 'rest', opportunityId: 'root-shelter', position: { x: 86, y: 167 }, attempts: 40 },
];

function developLifestyle(w: World, days: number, lifestyle: LifestyleExposure[]) {
  let day = Math.floor(w.time / DAY_SECONDS);
  for (let elapsed = 0; elapsed < days; elapsed++) {
    day++;
    w.tick = day * DAY_SECONDS / STEP;
    w.time = w.tick * STEP;
    for (const exposure of lifestyle) {
      for (let attempt = 0; attempt < exposure.attempts; attempt++) {
        completeLearning(
          w,
          exposure.activity,
          exposure.affordance,
          exposure.opportunityId,
          (attempt + day) % 5 === 0 ? 'partial' : 'success',
          false,
          30,
          exposure.position,
        );
      }
    }
  }
  updateAnatomy(w);
  return w;
}

function normalizedAnatomyDistance(a: AnatomyParameters, b: AnatomyParameters): number {
  const squared = ANATOMY_PARAMETER_KEYS.reduce((sum, key) => {
    const bound = ANATOMY_BOUNDS[key];
    return sum + ((a[key] - b[key]) / (bound.maximum - bound.minimum)) ** 2;
  }, 0);
  return Math.sqrt(squared / ANATOMY_PARAMETER_KEYS.length);
}

function targetGap(w: World): number {
  return normalizedAnatomyDistance(w.creature.anatomy.current, w.creature.anatomy.target);
}

function assertValidAnatomy(parameters: AnatomyParameters) {
  assert.equal(validAnatomyParameters(parameters), true);
  assert.equal(anatomyParametersCompatible(parameters), true);
  for (const key of ANATOMY_PARAMETER_KEYS) {
    assert.ok(Number.isFinite(parameters[key]), `${key} must remain finite`);
    assert.ok(parameters[key] >= ANATOMY_BOUNDS[key].minimum - 1e-9, `${key} fell below its bound`);
    assert.ok(parameters[key] <= ANATOMY_BOUNDS[key].maximum + 1e-9, `${key} exceeded its bound`);
  }
  assert.ok(parameters.limbBuild + 1e-6 >= 0.93 + 0.65 * (parameters.bodyDepth - 0.9));
  assert.ok(parameters.limbLength + 1e-6 >= 0.9 + 0.45 * (parameters.bodyLength - 0.9));
  assert.ok(parameters.tailDepth + 1e-6 >= 0.88 + 0.45 * (parameters.bodyDepth - 0.9));
}

function occupiedPixels(raster: CreatureRaster): Set<string> {
  const pixels = new Set<string>();
  raster.rows.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel !== ' ') pixels.add(`${x},${y}`);
  }));
  return pixels;
}

function assertConnectedSilhouette(raster: CreatureRaster) {
  const occupied = occupiedPixels(raster);
  const first = occupied.values().next().value as string | undefined;
  assert.ok(first);
  const pending = [first];
  const visited = new Set(pending);
  while (pending.length) {
    const [x, y] = pending.shift()!.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbor = `${x + dx},${y + dy}`;
      if (occupied.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
  }
  assert.equal(visited.size, occupied.size, 'the authored body plan must remain one connected silhouette');
}

function silhouetteSimilarity(left: CreatureRaster, right: CreatureRaster): number {
  const leftPixels = occupiedPixels(left);
  const rightPixels = occupiedPixels(right);
  let intersection = 0;
  for (const pixel of leftPixels) if (rightPixels.has(pixel)) intersection++;
  return intersection / (leftPixels.size + rightPixels.size - intersection);
}

let cachedAnatomyHistories: Record<'mobility' | 'aquatic' | 'ground', World> | undefined;
function anatomyHistories(): Record<'mobility' | 'aquatic' | 'ground', World> {
  if (cachedAnatomyHistories) return cachedAnatomyHistories;
  const build = (lifestyle: LifestyleExposure[]) => {
    const w = createWorld(601);
    w.lastSaved = 0;
    return developLifestyle(w, 30, lifestyle);
  };
  cachedAnatomyHistories = {
    mobility: build(MOBILITY_LIFESTYLE),
    aquatic: build(AQUATIC_LIFESTYLE),
    ground: build(GROUND_FORAGING_LIFESTYLE),
  };
  return cachedAnatomyHistories;
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

test('identical recorded 30-day lifestyles produce identical anatomy', () => {
  const first = anatomyHistories().mobility;
  const second = createWorld(601);
  second.lastSaved = 0;
  developLifestyle(second, 30, MOBILITY_LIFESTYLE);

  assert.deepEqual(second.creature.anatomy, first.creature.anatomy);
  assert.deepEqual(first.creature.anatomy.baseline, BASELINE_ANATOMY_PARAMETERS);
  assert.ok(first.development.evidence.activities.explore.attempts > 0);
  assert.ok(first.development.evidence.activities.wander.attempts > 0);
  assert.ok(first.development.evidence.activities.play.attempts > 0);
});

test('contrasting recorded lifestyles produce distinct, plausible 30-day bodies', () => {
  const { mobility, aquatic, ground } = anatomyHistories();
  const active = mobility.creature.anatomy;
  const water = aquatic.creature.anatomy;
  const forager = ground.creature.anatomy;

  for (const anatomy of [active, water, forager]) {
    assertValidAnatomy(anatomy.current);
    assertValidAnatomy(anatomy.target);
    assert.ok(normalizedAnatomyDistance(anatomy.current, anatomy.target) < 0.03,
      'a sustained month should approach its bounded target');
  }

  assert.ok(normalizedAnatomyDistance(active.current, water.current) > 0.18);
  assert.ok(normalizedAnatomyDistance(active.current, forager.current) > 0.22);
  assert.ok(normalizedAnatomyDistance(water.current, forager.current) > 0.22);

  assert.ok(active.pressures.mobility > water.pressures.mobility + 0.25);
  assert.ok(water.pressures.aquatic > active.pressures.aquatic + 0.35);
  assert.ok(forager.pressures.groundForaging > active.pressures.groundForaging + 0.35);
  assert.ok(active.current.limbLength > water.current.limbLength + 0.08);
  assert.ok(active.current.posture > forager.current.posture + 0.1);
  assert.ok(water.current.tailDepth > active.current.tailDepth + 0.06);
  assert.ok(water.current.coatHue > forager.current.coatHue + 0.1);
  assert.ok(forager.current.bodyDepth > active.current.bodyDepth + 0.08);
  assert.ok(forager.current.limbBuild > active.current.limbBuild + 0.1);
});

test('procedural pixels preserve the juvenile body plan across developed forms and poses', () => {
  const { mobility, aquatic, ground } = anatomyHistories();
  const forms = [
    createWorld(601).creature.anatomy.current,
    mobility.creature.anatomy.current,
    aquatic.creature.anatomy.current,
    ground.creature.anatomy.current,
  ];
  const standRasters = forms.map(anatomy => rasterizeCreature(anatomy, 'stand', 0, false));
  assert.equal(new Set(standRasters.map(raster => raster.visualKey)).size, forms.length);

  for (const anatomy of forms) {
    for (const pose of ['stand', 'sleep'] as const) {
      const raster = rasterizeCreature(anatomy, pose, 0, false);
      const repeated = rasterizeCreature(structuredClone(anatomy), pose, 0, false);
      assert.equal(repeated.visualKey, raster.visualKey);
      assert.deepEqual(repeated.rows, raster.rows);
      assert.deepEqual(repeated.palette, raster.palette);
      assert.equal(raster.rows.length, raster.height);
      assert.ok(raster.rows.every(row => row.length === raster.width));
      assert.ok(raster.partRows.every(row => row.length === raster.width));
      assert.ok(raster.metrics.bounds.right - raster.metrics.bounds.left + 1 <= 38);
      assert.ok(raster.metrics.bounds.bottom - raster.metrics.bounds.top + 1 <= 27);
      assert.ok(occupiedPixels(raster).size >= 300 && occupiedPixels(raster).size <= 650);
      assertConnectedSilhouette(raster);
      const pixels = raster.rows.join('');
      assert.ok([...pixels].every(pixel => pixel === ' ' || Object.hasOwn(raster.palette, pixel)));
      const parts = raster.partRows.join('');
      for (const part of ['1', '2', '3', '4', '5', '6', 'a', 'z', 't', 'r']) {
        assert.ok(parts.includes(part), `${pose} raster lost semantic part ${part}`);
      }
    }
  }

  for (let index = 1; index < standRasters.length; index++) {
    assert.ok(silhouetteSimilarity(standRasters[0], standRasters[index]) >= 0.7,
      'development must read as the same juvenile body plan');
  }
});

test('saved anatomy restores its exact procedural pixels and future development', () => {
  const original = structuredClone(anatomyHistories().aquatic);
  assert.ok(targetGap(original) > 0);
  const before = (['stand', 'sleep'] as const).map(pose => {
    const raster = rasterizeCreature(original.creature.anatomy.current, pose, 0, false);
    return { visualKey: raster.visualKey, rows: raster.rows, palette: raster.palette };
  });
  const restored = decode(JSON.stringify(original));
  assert.ok(restored);
  assert.deepEqual(restored.creature.anatomy, original.creature.anatomy);
  for (const [index, pose] of (['stand', 'sleep'] as const).entries()) {
    const raster = rasterizeCreature(restored.creature.anatomy.current, pose, 0, false);
    assert.deepEqual({ visualKey: raster.visualKey, rows: raster.rows, palette: raster.palette }, before[index]);
  }

  developLifestyle(original, 1, AQUATIC_LIFESTYLE);
  developLifestyle(restored, 1, AQUATIC_LIFESTYLE);
  assert.deepEqual(restored, original);
});

test('anatomy stabilizes inside its bounds under sustained developmental pressure', () => {
  const stable = structuredClone(anatomyHistories().mobility);
  const targetAtThirtyDays = structuredClone(stable.creature.anatomy.target);
  const gapAtThirtyDays = targetGap(stable);
  developLifestyle(stable, 30, MOBILITY_LIFESTYLE);

  assert.deepEqual(stable.creature.anatomy.target, targetAtThirtyDays);
  assert.ok(targetGap(stable) < gapAtThirtyDays / 20);
  assertValidAnatomy(stable.creature.anatomy.current);
  assertValidAnatomy(stable.creature.anatomy.target);
  assert.ok(stable.development.evidence.rolling.days.length <= 30);
});

test('visible development can reverse direction after a sustained lifestyle change', () => {
  const w = structuredClone(anatomyHistories().mobility);
  const firstMobilityBody = structuredClone(w.creature.anatomy.current);
  const mobilityTarget = structuredClone(w.creature.anatomy.target);
  const firstVisual = anatomyVisualKey(firstMobilityBody);

  developLifestyle(w, 30, GROUND_FORAGING_LIFESTYLE);
  const groundBody = structuredClone(w.creature.anatomy.current);
  assert.ok(groundBody.bodyDepth > firstMobilityBody.bodyDepth + 0.07);
  assert.ok(groundBody.limbBuild > firstMobilityBody.limbBuild + 0.1);
  assert.ok(groundBody.posture < firstMobilityBody.posture - 0.1);
  assert.ok(groundBody.tailLength < firstMobilityBody.tailLength - 0.1);
  const groundVisual = anatomyVisualKey(groundBody);
  assert.notEqual(groundVisual, firstVisual);

  developLifestyle(w, 30, MOBILITY_LIFESTYLE);
  const returnedBody = w.creature.anatomy.current;
  assert.deepEqual(w.creature.anatomy.target, mobilityTarget);
  assert.ok(returnedBody.bodyDepth < groundBody.bodyDepth - 0.07);
  assert.ok(returnedBody.limbBuild < groundBody.limbBuild - 0.09);
  assert.ok(returnedBody.posture > groundBody.posture + 0.1);
  assert.ok(returnedBody.tailLength > groundBody.tailLength + 0.1);
  assert.notEqual(anatomyVisualKey(returnedBody), groundVisual);
  assertValidAnatomy(returnedBody);
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
  assert.equal(migrated.version, 4);
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
  oldV2.creature.anatomy = {
    stage: 'juvenile', sprite: 'juvenile-placeholder', traits: { ears: 2, tail: 1, coat: 'slate' },
  };
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
  assert.equal(migratedV2.version, 4);
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

test('Behavioral Refinement V3 saves migrate to neutral anatomy without changing recorded history', () => {
  const source = createWorld(317);
  source.lastSaved = 123_456;
  advance(source, 600);
  const legacy = JSON.parse(JSON.stringify(source));
  legacy.version = 3;
  legacy.creature.anatomy = {
    stage: 'juvenile',
    sprite: 'juvenile-placeholder',
    traits: { ears: 2, tail: 1, coat: 'slate' },
  };

  const expected = structuredClone(legacy);
  expected.version = 4;
  expected.creature.anatomy = createAnatomy(source.time);
  const migrated = decode(JSON.stringify(legacy));
  assert.deepEqual(migrated, expected);

  const wrongLegacyShape = structuredClone(legacy);
  wrongLegacyShape.creature.anatomy.traits.tail = 2;
  assert.equal(decode(JSON.stringify(wrongLegacyShape)), null);

  const invalidBound = JSON.parse(JSON.stringify(source));
  invalidBound.creature.anatomy.current.bodyLength = 20;
  assert.equal(decode(JSON.stringify(invalidBound)), null);

  const incompatible = JSON.parse(JSON.stringify(source));
  incompatible.creature.anatomy.current.bodyDepth = 1.12;
  incompatible.creature.anatomy.current.limbBuild = 0.9;
  assert.equal(decode(JSON.stringify(incompatible)), null);
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
