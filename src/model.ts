export interface Point { x: number; y: number }
export type Activity = 'idle' | 'wander' | 'rest' | 'explore';
export interface Anatomy { stage: 'juvenile'; sprite: string; traits: { ears: number; tail: number; coat: string } }
export interface Temperament { curiosity: number; sociability: number; restfulness: number }
export interface Creature { position: Point; target: Point; facing: number; activity: Activity; remaining: number; anatomy: Anatomy; temperament: Temperament; distance: number }
export interface HabitatObject { id: string; kind: 'branch' | 'stone' | 'seedpod'; position: Point; affordances: ('inspect' | 'rest')[]; visits: number }
export interface Experience { time: number; kind: string; subject?: string }
export interface PlayerEvent { type: 'invite'; position: Point }
export interface DevelopmentState { stage: 'juvenile'; observations: number }
export interface World { version: 1; seed: number; time: number; tick: number; creature: Creature; objects: HabitatObject[]; experiences: Experience[]; development: DevelopmentState; lastSaved: number; explorationTarget?: string }
export const STEP = 0.1;
export const SHELTER = { x: 86, y: 167 };
export function validPosition(p: Point): boolean {
  return p.x >= 54 && p.x <= 345 && p.y >= 139 && p.y <= 239 && !(((p.x - 333) / 66) ** 2 + ((p.y - 166) / 31) ** 2 < 1);
}
export function random(w: World): number { let x = w.seed | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; w.seed = x >>> 0; return w.seed / 4294967296 }
export function record(w: World, kind: string, subject?: string) { w.experiences.push({time: w.time, kind, subject}); if(w.experiences.length > 80) w.experiences.shift() }
export function createWorld(seed = 42891): World {
 return { version: 1, seed: seed || 1, time: 0, tick: 0, lastSaved: Date.now(), creature: { position: {x: 191,y: 190}, target: {x:191,y:190}, facing: 1, activity:'idle', remaining: 3, anatomy:{stage:'juvenile',sprite:'juvenile-placeholder',traits:{ears:2,tail:1,coat:'slate'}}, temperament:{curiosity:0.65,sociability:0.4,restfulness:0.25},distance:0 }, objects:[{id:'fallen-branch',kind:'branch',position:{x:147,y:213},affordances:['inspect'],visits:0},{id:'warm-stone',kind:'stone',position:{x:245,y:192},affordances:['inspect','rest'],visits:0},{id:'seedpod',kind:'seedpod',position:{x:212,y:150},affordances:['inspect'],visits:0}],experiences:[],development:{stage:'juvenile',observations:0} };
}
