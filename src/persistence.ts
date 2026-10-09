import { createWorld, type World, validPosition } from './model';
import { advance } from './simulation';
export const STORAGE_KEY='autopet.habitat.v1';
export function decode(raw: string): World | null {
 try { const w=JSON.parse(raw) as World;
 if(w.version!==1 || !Number.isInteger(w.seed) || w.seed<=0 || !Number.isInteger(w.tick) || w.tick<0 || !Number.isFinite(w.lastSaved) || !Number.isFinite(w.time))return null;
 const c=w.creature; if(!c || !validPosition(c.position) || !validPosition(c.target) || !Number.isFinite(c.remaining) || !Number.isFinite(c.distance) || !['idle','wander','rest','explore'].includes(c.activity) || !c.anatomy || !c.temperament || !Object.values(c.temperament).every(v=>Number.isFinite(v)&&v>=0&&v<=1))return null;
 if(!Array.isArray(w.objects)||w.objects.length!==3||!w.objects.every(o=>['branch','stone','seedpod'].includes(o.kind)&&validPosition(o.position)&&Array.isArray(o.affordances)&&Number.isFinite(o.visits))||!Array.isArray(w.experiences)||!w.development)return null;
 return w;
 }catch{return null}
}
export function load(): {world:World; offline:number; available:boolean} {
 try{const raw=localStorage.getItem(STORAGE_KEY),w=raw?decode(raw):null;if(w){const offline=Math.min(21600,Math.max(0,(Date.now()-w.lastSaved)/1000));advance(w,offline);return {world:w,offline,available:true}}return {world:createWorld(),offline:0,available:true}}catch{return {world:createWorld(),offline:0,available:false}}
}
export function save(w: World): boolean { try{w.lastSaved=Date.now();localStorage.setItem(STORAGE_KEY,JSON.stringify(w));return true}catch{return false} }
