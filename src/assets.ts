// Original authored 32-column native-grid placeholder: no concept-image crops.
export interface PixelAsset { rows: string[]; palette: Record<string,string> }
export const juvenile: PixelAsset={palette:{o:'#263c4d',b:'#60849b',s:'#87a7b4',c:'#f2dfb6',p:'#d9a293',e:'#172d3c',w:'#fff5dd'},rows:[
'       oo       oo              ',
'      obbo     obbo             ',
'      obppo   oppbo             ',
'      obppbo obppbo             ',
'       obsboobsbo     oo        ',
'      obsssssssbo  ooobbo       ',
'     obbbbbbbbbbboobbbbbo       ',
'    obccccccbbbbbbbbbbbbbo      ',
'   obccccccccbbbbbbbbbbbbo oo   ',
'   occoeocccoeocbbbbbbbbbboobo  ',
'  occcewecccewecccbbbbbbbbbbbo  ',
'  occceecccceeecccbbbbbbbbbbo   ',
'  occcccccccccccccbbbbbbbbbbo   ',
'   occcccooccccccccbbbbbbbbo    ',
'    occcccccccccccccccccbo      ',
'     ooccccccccccccccccoo       ',
'      obbboobbo  obboobbo       ',
'      occo occo  occo occo      ',
'      oooo oooo  oooo oooo      ']};
export const sleeping:PixelAsset={palette:juvenile.palette,rows:[
'          oo   oo               ',
'         obbo obbo              ',
'        obppbobpbo  oooooo      ',
'       obbbbbbbboooobbbbbbo     ',
'      obccccccbbbbbbbbbbbbbo    ',
'     occcccccccbbbbbbbbbbbbo    ',
'    occoocccooccbbbbbbbbbbbo    ',
'    occccccccccccbbbbbbbbbbo    ',
'     occcccccccccccccccbbbo     ',
'      ooccccccccccccccccoo      ',
'      ooooooooooooooooooo      ']};
export function paintAsset(ctx:CanvasRenderingContext2D,asset:PixelAsset,x:number,y:number,flip:boolean,blink:boolean,phase:number){
 ctx.save();ctx.translate(Math.round(x),Math.round(y));if(flip)ctx.scale(-1,1);
 const ox=-16, height=asset.rows.length;
 asset.rows.forEach((row,j)=>[...row].forEach((v,i)=>{if(v===' ')return;ctx.fillStyle=blink&&(v==='e'||v==='w')?asset.palette.c:asset.palette[v];const foot=j>=height-3?Math.round(Math.sin(phase+(i<16?0:Math.PI))):0;ctx.fillRect(ox+i,j-height+foot,1,1)}));
 if(blink&&asset===juvenile){ctx.fillStyle=asset.palette.o;ctx.fillRect(ox+6,-9,3,1);ctx.fillRect(ox+12,-9,3,1)}ctx.restore();
}
