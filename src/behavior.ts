import {
  type Activity,
  type Affordance,
  type AssistanceSource,
  type CareDomain,
  type HabitatFeature,
  type HabitatObject,
  type Point,
  type World,
  HABITAT_FEATURES,
  STEP,
  clamp,
  random,
  record,
  validPosition,
} from './model';
import { habituationLevel, objectInterest } from './learning';

export interface Opportunity {
  id: string;
  activity: Activity;
  affordance: Affordance;
  position: Point;
  score: number;
  assisted: boolean;
  assistanceSource?: AssistanceSource;
  object?: HabitatObject;
  feature?: HabitatFeature;
}

const ACTIVITY_FOR_AFFORDANCE: Record<Affordance, Activity> = {
  observe: 'idle',
  roam: 'wander',
  rest: 'rest',
  investigate: 'explore',
  forage: 'forage',
  groom: 'groom',
  wade: 'wade',
  play: 'play',
};

export function destination(w: World): Point {
  for (let index = 0; index < 40; index++) {
    const point = { x: 70 + random(w) * 265, y: 146 + random(w) * 85 };
    if (validPosition(point)) return point;
  }
  return { x: 190, y: 190 };
}

export function approachTarget(position: Point): Point {
  const offsets = [
    { x: -18, y: 8 }, { x: 18, y: 8 }, { x: 0, y: 18 }, { x: 0, y: -15 },
    { x: -12, y: 14 }, { x: 12, y: 14 },
  ];
  return offsets.map(offset => ({ x: position.x + offset.x, y: position.y + offset.y })).find(validPosition)
    ?? (validPosition(position) ? { ...position } : { x: 202, y: 194 });
}

const ROUTE_GRID = 5;
const ROUTE_NEIGHBORS = [
  { x: -ROUTE_GRID, y: 0 }, { x: ROUTE_GRID, y: 0 },
  { x: 0, y: -ROUTE_GRID }, { x: 0, y: ROUTE_GRID },
  { x: -ROUTE_GRID, y: -ROUTE_GRID }, { x: ROUTE_GRID, y: -ROUTE_GRID },
  { x: -ROUTE_GRID, y: ROUTE_GRID }, { x: ROUTE_GRID, y: ROUTE_GRID },
];

export function lineClear(from: Point, to: Point): boolean {
  if (!validPosition(from) || !validPosition(to)) return false;
  // The world bounds are convex. In normalized pond space, the remaining
  // obstacle is a unit circle, so the closest point on the segment is exact.
  const ax = (from.x - 333) / 66;
  const ay = (from.y - 166) / 31;
  const bx = (to.x - 333) / 66;
  const by = (to.y - 166) / 31;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const amount = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator));
  const closestX = ax + dx * amount;
  const closestY = ay + dy * amount;
  return closestX * closestX + closestY * closestY >= 1;
}

function routeKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function gridPoint(key: string): Point {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

function nearestVisibleGridPoint(point: Point): Point | undefined {
  let nearest: Point | undefined;
  let nearestDistance = Infinity;
  for (let y = 139; y <= 239; y += ROUTE_GRID) {
    for (let x = 54; x <= 344; x += ROUTE_GRID) {
      const candidate = { x, y };
      const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
      if (distance < nearestDistance && validPosition(candidate) && lineClear(point, candidate)) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
  }
  return nearest;
}

function compressRoute(start: Point, points: Point[]): Point[] {
  const route: Point[] = [];
  let cursor = { ...start };
  let index = 0;
  while (index < points.length) {
    let furthest = index;
    for (let candidate = points.length - 1; candidate >= index; candidate--) {
      if (lineClear(cursor, points[candidate])) {
        furthest = candidate;
        break;
      }
    }
    route.push({ ...points[furthest] });
    cursor = points[furthest];
    index = furthest + 1;
  }
  return route;
}

/** Returns deterministic, remaining waypoints including the exact destination. */
export function planRoute(start: Point, target: Point): Point[] | null {
  if (!validPosition(start) || !validPosition(target)) return null;
  if (Math.hypot(target.x - start.x, target.y - start.y) <= 0.8) return [];
  if (lineClear(start, target)) return [{ ...target }];

  const first = nearestVisibleGridPoint(start);
  const last = nearestVisibleGridPoint(target);
  if (!first || !last) return null;
  const firstKey = routeKey(first);
  const lastKey = routeKey(last);
  const frontier = new Set([firstKey]);
  const previous = new Map<string, string>();
  const distance = new Map<string, number>([[firstKey, 0]]);

  while (frontier.size > 0) {
    let currentKey = '';
    let currentScore = Infinity;
    for (const key of frontier) {
      const point = gridPoint(key);
      const score = (distance.get(key) ?? Infinity) + Math.hypot(last.x - point.x, last.y - point.y);
      if (score < currentScore || (score === currentScore && key < currentKey)) {
        currentKey = key;
        currentScore = score;
      }
    }
    if (currentKey === lastKey) break;
    frontier.delete(currentKey);
    const current = gridPoint(currentKey);
    for (const offset of ROUTE_NEIGHBORS) {
      const neighbor = { x: current.x + offset.x, y: current.y + offset.y };
      if (neighbor.x < 54 || neighbor.x > 344 || neighbor.y < 139 || neighbor.y > 239
        || !validPosition(neighbor) || !lineClear(current, neighbor)) continue;
      const neighborKey = routeKey(neighbor);
      const candidateDistance = (distance.get(currentKey) ?? 0) + Math.hypot(offset.x, offset.y);
      if (candidateDistance < (distance.get(neighborKey) ?? Infinity)) {
        distance.set(neighborKey, candidateDistance);
        previous.set(neighborKey, currentKey);
        frontier.add(neighborKey);
      }
    }
  }
  if (!distance.has(lastKey)) return null;
  const reversed = [last];
  let cursor = lastKey;
  while (cursor !== firstKey) {
    cursor = previous.get(cursor)!;
    reversed.push(gridPoint(cursor));
  }
  reversed.reverse();
  const points = [...reversed, { ...target }];
  return compressRoute(start, points);
}

export function resolveOpportunity(w: World, id: string): HabitatObject | HabitatFeature | undefined {
  return w.objects.find(object => object.id === id) ?? HABITAT_FEATURES.find(feature => feature.id === id);
}

function readinessDrive(readiness: number): number {
  const activeReadiness = clamp((readiness - 0.45) / 0.55);
  return 0.015 + 3 * activeReadiness * activeReadiness;
}

export function careDomainForActivity(activity: Activity): CareDomain | undefined {
  if (activity === 'forage') return 'feeding';
  if (activity === 'groom') return 'grooming';
  return undefined;
}

/**
 * A request is a temperament-shaped choice, rather than a need or a failure.
 * Reliance raises its likelihood while proficiency, confidence, and persistence
 * make an independent attempt more likely. Ignoring a request never changes the
 * skill; the normal autonomous attempt follows after the short request phase.
 */
export function helpRequestProbability(w: World, domain: CareDomain): number {
  const skill = w.creature.learning.independence[domain];
  const agency = skill.capability * 0.45 + skill.confidence * 0.55;
  return clamp(
    0.05
      + skill.reliance * 0.62
      + (1 - agency) * 0.18
      - w.creature.temperament.persistence * 0.12,
    0.03,
    0.78,
  );
}

export function shouldRequestHelp(w: World, activity: Activity): boolean {
  const domain = careDomainForActivity(activity);
  return domain !== undefined && random(w, 'social') < helpRequestProbability(w, domain);
}

function motivation(w: World, activity: Activity): number {
  const creature = w.creature;
  const state = creature.internal;
  const temperament = creature.temperament;
  switch (activity) {
    case 'idle': return 0.9 + (1 - temperament.curiosity) * 0.45;
    case 'wander': return 0.75 + temperament.curiosity * 0.55;
    case 'rest': return 0.5 + (1 - state.energy) * 3.5 + temperament.restfulness;
    case 'explore': return 0.6 + temperament.curiosity * 1.5;
    case 'forage': return readinessDrive(state.forageReadiness);
    case 'groom': return readinessDrive(state.groomingReadiness);
    case 'wade': return 0.35 + temperament.curiosity * 0.9;
    case 'play': return 0.35 + temperament.sociability * 1.15 + state.energy * 0.35;
  }
}

function scoreOpportunity(
  w: World,
  activity: Activity,
  affordance: Affordance,
  id: string,
  object?: HabitatObject,
  feature?: HabitatFeature,
): number {
  const creature = w.creature;
  let score = creature.learning.activityPreferences[activity] * motivation(w, activity);
  score *= 1 - habituationLevel(w, `activity:${activity}`) * 0.55;
  score *= 1 - habituationLevel(w, `${id}:${affordance}`) * 0.68;
  if (object) score *= 0.6 + objectInterest(w, object.kind) * 2.3;
  if (activity === 'rest') score *= 0.75 + (feature?.comfort ?? (object?.kind === 'stone' ? 0.55 : 0.2));
  if (activity === 'forage') {
    const skill = creature.learning.independence.feeding;
    const agency = skill.capability * 0.45 + skill.confidence * 0.55;
    score *= 0.72 + agency * 0.28 - skill.reliance * 0.08;
    if (object?.kind === 'seedpod') score *= 1.12;
    if (feature?.kind === 'vegetation') score *= 0.96 + creature.temperament.curiosity * 0.12;
    // The survival safeguard eventually outweighs learned hesitation.
    if (creature.internal.forageReadiness > 0.9) score *= 2.5;
  }
  if (activity === 'groom') {
    const skill = creature.learning.independence.grooming;
    const agency = skill.capability * 0.45 + skill.confidence * 0.55;
    score *= 0.72 + agency * 0.28 - skill.reliance * 0.08;
    if (feature?.kind === 'pool') score *= 1.08;
    if (feature?.kind === 'vegetation') score *= 0.92 + creature.temperament.curiosity * 0.12;
    if (object?.kind === 'branch') score *= 0.95 + creature.temperament.persistence * 0.16;
  }
  if (creature.internal.energy < 0.2 && activity === 'rest') score *= 3;
  if (creature.internal.energy < 0.2 && (activity === 'play' || activity === 'wander')) score *= 0.2;
  return Math.max(0.0001, score);
}

export function availableOpportunities(w: World): Opportunity[] {
  const opportunities: Opportunity[] = [];
  for (const feature of HABITAT_FEATURES) {
    for (const affordance of feature.affordances) {
      const activity = ACTIVITY_FOR_AFFORDANCE[affordance];
      opportunities.push({
        id: feature.id,
        activity,
        affordance,
        position: feature.position,
        score: scoreOpportunity(w, activity, affordance, feature.id, undefined, feature),
        assisted: false,
        feature,
      });
    }
  }
  for (const object of w.objects) {
    for (const affordance of object.affordances) {
      const activity = ACTIVITY_FOR_AFFORDANCE[affordance];
      const recentlyMoved = object.lastMovedAt !== undefined && w.time - object.lastMovedAt < 600;
      opportunities.push({
        id: object.id,
        activity,
        affordance,
        position: object.position,
        score: scoreOpportunity(w, activity, affordance, object.id, object),
        assisted: recentlyMoved,
        assistanceSource: recentlyMoved ? 'environment-arranged' : undefined,
        object,
      });
    }
  }
  return opportunities;
}

function selectOpportunity(w: World): Opportunity {
  const opportunities = availableOpportunities(w);
  const groups = new Map<Activity, Opportunity[]>();
  for (const opportunity of opportunities) {
    const group = groups.get(opportunity.activity) ?? [];
    group.push(opportunity);
    groups.set(opportunity.activity, group);
  }
  const activityGroups = [...groups.entries()].map(([activity, entries]) => ({
    activity,
    entries,
    score: entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length,
  }));
  let activityRoll = random(w) * activityGroups.reduce((sum, group) => sum + group.score, 0);
  let selectedGroup = activityGroups[activityGroups.length - 1];
  for (const group of activityGroups) {
    activityRoll -= group.score;
    if (activityRoll <= 0) { selectedGroup = group; break; }
  }
  let opportunityRoll = random(w) * selectedGroup.entries.reduce((sum, entry) => sum + entry.score, 0);
  for (const opportunity of selectedGroup.entries) {
    opportunityRoll -= opportunity.score;
    if (opportunityRoll <= 0) return opportunity;
  }
  return selectedGroup.entries[selectedGroup.entries.length - 1];
}

export function beginIntent(w: World, opportunity: Opportunity, invitedTarget?: Point) {
  const creature = w.creature;
  const target = invitedTarget
    ? { ...invitedTarget }
    : opportunity.activity === 'idle' ? { ...creature.position }
    : opportunity.activity === 'wander' ? destination(w)
    : opportunity.feature ? { ...opportunity.position }
    : approachTarget(opportunity.position);
  const route = planRoute(creature.position, target);
  if (!route) {
    record(w, 'behavior-unreachable', {
      subject: opportunity.id,
      activity: opportunity.activity,
      affordance: opportunity.affordance,
      assisted: opportunity.assisted,
    });
    return false;
  }
  creature.activity = opportunity.activity;
  creature.target = { ...creature.position };
  creature.remaining = 0;
  const noticeDuration = 2.4 + random(w) * 3.6;
  creature.intent = {
    id: w.nextIntentId++,
    activity: opportunity.activity,
    phase: 'notice',
    opportunityId: opportunity.id,
    affordance: opportunity.affordance,
    target,
    route,
    noticedAt: w.time,
    phaseRemaining: noticeDuration,
    phaseTicksRemaining: Math.ceil(noticeDuration / STEP),
    assisted: opportunity.assisted,
    ...(opportunity.assistanceSource ? { assistanceSource: opportunity.assistanceSource } : {}),
    helpRequested: false,
  };
  record(w, 'behavior-noticed', {
    subject: opportunity.id,
    activity: opportunity.activity,
    affordance: opportunity.affordance,
    phase: 'notice',
    assisted: opportunity.assisted,
    assistanceSource: opportunity.assistanceSource,
  });
  return true;
}

export function chooseActivity(w: World) {
  if (w.creature.intent) return;
  beginIntent(w, selectOpportunity(w));
}

export function invitationOpportunity(w: World, target: Point): Opportunity {
  return {
    id: 'player-invitation',
    activity: 'explore',
    affordance: 'investigate',
    position: target,
    score: 1,
    assisted: true,
  };
}
