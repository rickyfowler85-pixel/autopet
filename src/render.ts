import { type World, type HabitatObject } from './model';
import { juvenile, sleeping, paintAsset } from './assets';
import { type InteractionView } from './interaction';
export const WIDTH=400,HEIGHT=280;
const C={ink:'#263f3b',leaf:'#3e6046',dark:'#233e38',moss:'#6b824b',grass:'#90955a',light:'#bac177',soil:'#c4aa75',root:'#856744',water:'#639f9c'};
function rect(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,color:string){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),w,h)}
// Scanline ellipses ensure every edge is a true pixel cluster, without antialiasing.
function ellipse(c:CanvasRenderingContext2D,x:number,y:number,rx:number,ry:number,color:string){for(let dy=-ry;dy<=ry;dy++){const dx=Math.floor(rx*Math.sqrt(Math.max(0,1-(dy/ry)**2)));rect(c,x-dx,y+dy,dx*2+1,1,color)}}
function line(c:CanvasRenderingContext2D,x:number,y:number,xx:number,yy:number,width:number,color:string){const steps=Math.max(Math.abs(xx-x),Math.abs(yy-y));for(let i=0;i<=steps;i++)rect(c,x+(xx-x)*i/(steps||1),y+(yy-y)*i/(steps||1),width,width,color)}
function tuft(c:CanvasRenderingContext2D,x:number,y:number,color:string){line(c,x,y,x-2,y-7,1,color);line(c,x+1,y,x+4,y-5,1,color);line(c,x-1,y,x-5,y-3,1,color)}
function rock(c:CanvasRenderingContext2D,x:number,y:number,rx:number,ry:number){ellipse(c,x,y+3,rx+2,ry,'#687452');ellipse(c,x,y,rx,ry,'#777e70');ellipse(c,x-2,y-3,rx-2,ry-2,'#a6a48a');for(let i=0;i<rx*3;i++){const dx=(i*13)%Math.max(1,rx*2)-rx,dy=(i*7)%Math.max(1,ry*2)-ry;if((dx/rx)**2+(dy/ry)**2<.8)rect(c,x+dx,y+dy,2,1,i%3?'#939780':'#b9b598')}ellipse(c,x-2,y-ry+2,rx-3,2,C.moss)}
function flower(c:CanvasRenderingContext2D,x:number,y:number){line(c,x,y,x,y-5,1,C.leaf);rect(c,x-2,y-7,5,1,'#f1e6b6');rect(c,x,y-9,1,5,'#f1e6b6');rect(c,x,y-7,1,1,'#d7a358')}
export class Renderer {
 private background=document.createElement('canvas');
 constructor(){this.background.width=WIDTH;this.background.height=HEIGHT;this.build(this.background.getContext('2d')!)}
 private build(c:CanvasRenderingContext2D){
 rect(c,0,0,400,280,'#6d9286');
 for(let i=0;i<18;i++){const x=i*29-9;line(c,x,0,x-12,142,6,i%2?'#537e71':'#426b60');for(let j=0;j<5;j++)ellipse(c,x+(j*19)%37-13,25+j*20,24,14,j%2?'#5b8070':'#648c72')}
 ellipse(c,218,161,251,93,'#71864e');ellipse(c,212,208,177,65,C.grass);ellipse(c,211,196,140,47,C.soil);ellipse(c,205,183,116,27,'#c9b17b');
 // Tiny sparse patches leave the central movement space legible.
 for(let i=0;i<490;i++){const x=(i*73+23)%400,y=105+(i*47)%160;const clearing=((x-211)/144)**2+((y-196)/48)**2<1;rect(c,x,y,i%3+1,1,clearing?(i%3?'#b89d6b':'#d6be88'):(i%2?'#829655':'#a1a762'))}
 // Shallow bank: clear open near shore, stones and reeds toward the back.
 ellipse(c,337,167,72,35,'#5b7551');ellipse(c,337,164,66,31,'#b9ba82');ellipse(c,337,164,59,26,C.water);ellipse(c,341,163,51,21,'#74b1aa');ellipse(c,312,175,18,10,'#99bba7');
 for(let i=0;i<88;i++){const x=280+(i*29)%114,y=142+(i*17)%43;if(((x-337)/58)**2+((y-164)/24)**2<.9)rect(c,x,y,2+i%4,1,i%3?'#89beb0':'#4e908e')}
 rock(c,366,113,25,20);rock(c,327,124,20,14);rock(c,391,136,17,19);rock(c,359,169,9,5);
 for(let i=0;i<15;i++){const x=302+i*5,y=131+(i*7)%13;line(c,x,y,x-3+(i%4),y-19-(i%3)*6,1,i%2?'#8b9d50':'#3d6246')}
 // Mature tree and roots, arching around a dark shelter entrance.
 line(c,73,0,77,88,29,'#4e5038');line(c,79,0,85,104,17,C.root);line(c,85,5,86,105,6,'#ad8752');
 for(let i=0;i<28;i++){const y=i*4,x=78+(i*7)%23;line(c,x,y,x-2,y+6,1,i%2?'#645039':'#be985f')}
 ellipse(c,85,146,32,28,'#6a593c');ellipse(c,86,150,24,23,'#283d33');ellipse(c,88,166,24,6,'#526047');ellipse(c,86,170,24,4,'#a39568');
 const roots=[[82,83,49,120,33,169],[89,90,117,117,131,166],[96,94,140,115,171,135],[78,106,58,145,37,188],[112,140,134,165,165,174]];
 for(const [x,y,mx,my,xx,yy]of roots){line(c,x,y,mx,my,12,'#534f36');line(c,mx,my,xx,yy,9,'#534f36');line(c,x+1,y,mx+1,my,8,C.root);line(c,mx+1,my,xx+1,yy,5,C.root);line(c,x+2,y,mx+2,my,2,'#be985b');line(c,mx+2,my,xx+2,yy,1,'#be985b');for(let i=0;i<9;i++){const t=i/9;rect(c,mx+(xx-mx)*t,my+(yy-my)*t,2,2,'#655239')}}
 // Vines and moss soften root joints rather than becoming a constructed hut.
 line(c,103,47,103,132,1,'#4b6b40');for(let i=0;i<16;i++){const y=49+i*5;ellipse(c,103+(i%2?3:-2),y,3,2,i%3?'#88a153':'#b3b968')}
 for(let i=0;i<20;i++){const x=45+(i*17)%116,y=93+(i*13)%46;if(x<62||x>118)ellipse(c,x,y,4,2,C.moss)}
 // Framing vegetation stays outside the walkable clearing.
 for(let i=0;i<105;i++){const x=(i*67+8)%400,y=100+(i*31)%176;if((x<48||x>363||y<135||y>242)&&!(x>276&&y<194)){ellipse(c,x,y,6,3,i%2?C.leaf:C.moss);tuft(c,x,y,i%3?C.leaf:'#a2b361')}}
 rock(c,34,211,17,12);rock(c,272,126,13,10);rock(c,296,205,11,7);rock(c,128,245,12,7);
 for(const [x,y]of [[24,190],[45,200],[151,136],[166,131],[286,127],[282,218],[368,233]])flower(c,x,y);
 // Overhanging canopy with a light opening over the companion.
 for(let i=0;i<43;i++){const x=(i*37)%430-15,y=(i*23)%53-8;if(x<153||x>315||y<12){ellipse(c,x,y,22,13,i%2?C.dark:C.leaf);for(let j=0;j<8;j++)rect(c,x-15+(j*11)%29,y-8+(j*7)%17,4,2,i%3?'#527447':'#7c9554')}}
 }
 render(c:CanvasRenderingContext2D,w:World,t:number,view:InteractionView={}){c.clearRect(0,0,WIDTH,HEIGHT);c.drawImage(this.background,0,0);c.imageSmoothingEnabled=false;
 for(let i=0;i<5;i++)rect(c,177+i*35+Math.sin(t*.3+i)*14,100+Math.sin(t*.5+i*2)*13,1,1,'#ece2b2');
 const ripple=t%4;for(let i=0;i<12;i++){const a=i/12*Math.PI*2;rect(c,339+Math.cos(a)*(9+ripple*4),167+Math.sin(a)*(2+ripple),2,1,'#b6d2bd')}
 const entities=w.objects.map(o=>({y:o.position.y,draw:()=>{if(view.drag?.id!==o.id)this.object(c,o,view.selected===o.id)}}));entities.push({y:w.creature.position.y,draw:()=>this.creature(c,w,t,view)});entities.sort((a,b)=>a.y-b.y).forEach(e=>e.draw());
 if(view.drag){const o=w.objects.find(o=>o.id===view.drag!.id)!;this.object(c,{...o,position:view.drag.position},true)}
 for(let i=0;i<18;i++){const x=i*24-9;ellipse(c,x,281,18,10,i%2?C.dark:C.leaf);tuft(c,x,273,C.moss)}
 }
 private object(c:CanvasRenderingContext2D,o:HabitatObject,selected:boolean){const{x,y}=o.position;ellipse(c,x,y+2,11,3,'#998957');if(selected){for(let i=-12;i<=12;i+=4){rect(c,x+i,y+6,2,1,'#f5e6ac')}}
 if(o.kind==='branch'){line(c,x-12,y+1,x+10,y-4,3,'#614e35');line(c,x-10,y,x+10,y-4,1,'#b58e57');line(c,x-1,y-2,x+1,y-8,2,'#775a37');rect(c,x-11,y+1,2,2,'#d1ae71')}
 else if(o.kind==='stone')rock(c,x,y-3,9,6);
 else{ellipse(c,x,y-4,6,6,'#745332');ellipse(c,x-1,y-5,4,4,'#b08a4e');line(c,x,y-10,x,y,1,'#d4af66');for(let i=0;i<6;i++)rect(c,x-4+(i*3)%9,y-8+(i*5)%8,2,1,'#8e673b')}
 }
 private creature(c:CanvasRenderingContext2D,w:World,t:number,view:InteractionView){const a=w.creature;const moving=Math.hypot(a.target.x-a.position.x,a.target.y-a.position.y)>.8,resting=a.activity==='rest'&&!moving;
 const reaction=view.reaction&&view.reaction.until>t?view.reaction.kind:undefined;const pet= reaction==='pet';
 const bob=moving?Math.round(Math.sin(t*9)):Math.round(Math.sin(t*2)*.5);ellipse(c,a.position.x,a.position.y+1,14,3,'#9b895b');paintAsset(c,resting?sleeping:juvenile,a.position.x,a.position.y+(pet?-1:bob),a.facing>0,pet||t%5>4.8,moving?t*9:0);
 if(resting){const x=a.position.x+15,y=a.position.y-16-Math.floor(t%3);rect(c,x,y,3,1,'#dfdfbd');rect(c,x+2,y+1,1,1,'#dfdfbd');rect(c,x,y+2,3,1,'#dfdfbd')}
 if(reaction&&!resting){const x=a.position.x,y=a.position.y-28-Math.floor(t%1*2);if(pet){rect(c,x-3,y,2,2,'#daaa92');rect(c,x+1,y,2,2,'#daaa92');rect(c,x-2,y+2,4,1,'#daaa92');rect(c,x-1,y+3,2,1,'#daaa92')}else{rect(c,x,y,1,3,'#f5e6ac');rect(c,x,y+4,1,1,'#f5e6ac')}}
 }
}
