import { type World, type PlayerEvent, STEP, validPosition, record, random } from './model';
import { chooseActivity } from './behavior';
export function step(w: World) {
 w.tick++; w.time=w.tick*STEP; const c=w.creature; const dx=c.target.x-c.position.x,dy=c.target.y-c.position.y,d=Math.hypot(dx,dy);
 if(d>0.8){const speed=(c.activity==='rest'?13:19)*STEP;const amount=Math.min(speed,d);const p={x:c.position.x+dx/d*amount,y:c.position.y+dy/d*amount};if(validPosition(p)){c.position=p;c.distance+=amount;c.facing=dx<0?-1:1}else{c.target={...c.position};c.remaining=0}}
 else {c.remaining-=STEP;if(w.explorationTarget){const o=w.objects.find(o=>o.id===w.explorationTarget);if(o){o.visits++;w.development.observations++;record(w,'discovered',o.kind)}w.explorationTarget=undefined}if(c.remaining<=0)chooseActivity(w)}
}
export function advance(w: World, seconds: number) { const ticks=Math.floor(Math.max(0,Math.min(seconds,21600))/STEP);for(let i=0;i<ticks;i++)step(w) }
export function interact(w: World, event: PlayerEvent) { if(!validPosition(event.position))return false; record(w,'invitation');if(curious(w)&&random(w)<.35+w.creature.temperament.curiosity*.5){w.creature.activity='explore';w.creature.target={...event.position};w.creature.remaining=5;w.explorationTarget=undefined}return true }
function curious(w: World){return w.creature.activity!=='rest'}
