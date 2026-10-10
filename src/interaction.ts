import { recordSocialReaction } from './learning';
import { type Point, type World, validPosition, record, random } from './model';
import { retargetOpportunity } from './simulation';

export type ReactionKind = 'acknowledge' | 'pet' | 'sleepy';
export interface Reaction { kind: ReactionKind; until: number }
export interface InteractionView { reaction?: Reaction; drag?: { id: string; position: Point }; selected?: string }
export function hitCreature(w: World, p: Point): boolean {
  return Math.abs(p.x-w.creature.position.x)<19 && p.y>w.creature.position.y-25 && p.y<w.creature.position.y+7;
}
export function hitObject(w: World, p: Point): string | undefined {
  return [...w.objects].sort((a,b)=>b.position.y-a.position.y).find(o=>Math.abs(o.position.x-p.x)<15 && Math.abs(o.position.y-4-p.y)<12)?.id;
}
// Placement uses the same world boundary with margin for every object's silhouette,
// leaving shelter entry, creature space, and other objects unobstructed.
export function validPlacement(w: World, id: string, p: Point): boolean {
  return [{x:p.x-14,y:p.y-9},{x:p.x+14,y:p.y-9},{x:p.x-14,y:p.y+9},{x:p.x+14,y:p.y+9}].every(validPosition)
    && Math.hypot(p.x-86,(p.y-167)*1.4)>40
    && Math.hypot(p.x-w.creature.position.x,(p.y-w.creature.position.y)*1.3)>26
    && w.objects.every(o=>o.id===id || Math.hypot(p.x-o.position.x,(p.y-o.position.y)*1.3)>30);
}
export function placement(w: World, id: string, p: Point): Point {
  // Nearest valid native-grid point; finite search is inexpensive for this small scene.
  let best=w.objects.find(o=>o.id===id)?.position ?? {x:190,y:200};let distance=Infinity;
  for(let y=148;y<=230;y+=2)for(let x=68;x<=330;x+=2){const q={x,y};const d=(x-p.x)**2+(y-p.y)**2;if(d<distance&&validPlacement(w,id,q)){best=q;distance=d}}
  return {...best};
}
export function moveObject(w: World, id: string, p: Point): boolean {
 const o=w.objects.find(o=>o.id===id);if(!o)return false;
 o.position=placement(w,id,p);
 const meaningfulMove=o.lastMovedAt!==w.time;o.lastMovedAt=w.time;
 if(meaningfulMove)record(w,'object-moved',o.kind);
 retargetOpportunity(w,id,o.position);
 return true;
}
export function greet(w: World, pet: boolean, now: number): Reaction {
 const sleepy=w.creature.activity==='rest' && w.creature.intent!==undefined && !['notice','approach'].includes(w.creature.intent.phase) && Math.hypot(w.creature.target.x-w.creature.position.x,w.creature.target.y-w.creature.position.y)<1;
 const accepts=!sleepy && (!pet||random(w,'social')<0.5+w.creature.temperament.sociability*.5);
 const kind=sleepy?'sleepy':pet&&accepts?'pet':'acknowledge';
 record(w,pet?(accepts?'pet-accepted':'pet-deferred'):'acknowledged');
 recordSocialReaction(w,pet?(accepts?'pet-accepted':'pet-deferred'):'acknowledgment');
 // Acknowledgment never cancels an autonomous activity or redirects the creature.
 return {kind,until:now+(pet?2.2:1.5)};
}
