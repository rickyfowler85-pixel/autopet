import { approach } from './interaction';
import { type World, type Point, random, validPosition, record, SHELTER } from './model';
export function destination(w: World): Point { for(let i=0;i<40;i++){const p={x:70+random(w)*265,y:146+random(w)*85};if(validPosition(p))return p} return {x:190,y:190} }
export function chooseActivity(w: World) {
 const c=w.creature, roll=random(w); w.explorationTarget=undefined;
 if(roll < c.temperament.restfulness){c.activity='rest'; c.target={...SHELTER}; c.remaining=12+random(w)*14}
 else if(roll < c.temperament.restfulness+(1-c.temperament.restfulness)*(.25+c.temperament.curiosity*.45)){ c.activity='explore'; const weights=w.objects.map(o=>1/(1+o.visits)); let n=random(w)*weights.reduce((a,b)=>a+b,0); let index=0; for(;index<weights.length-1;index++){n-=weights[index];if(n<=0)break} const o=w.objects[index]; c.target=approach(o.position);w.explorationTarget=o.id;c.remaining=7+random(w)*7 }
 else if(roll < 0.9){c.activity='wander';c.target=destination(w);c.remaining=5+random(w)*6}
 else {c.activity='idle';c.target={...c.position};c.remaining=4+random(w)*6}
 record(w,'activity',c.activity);
}
