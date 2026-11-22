// Shared sheet corrections for the game and social animation exports.
(function(root){
 'use strict';
 function prepare(source){
  const sprites=JSON.parse(JSON.stringify(source));
  const left=(id,i,x)=>{const r=sprites[id].frames[i],d=x-r.x;r.x=x;r.w-=d;r.ax-=d;};
  const right=(id,i,x)=>{const r=sprites[id].frames[i];r.w=x-r.x;};
  // Keep weapons crossing cell boundaries, removing only neighboring artwork.
  left('hokusai',5,353);right('hokusai',10,920);
  right('klimt',4,350);left('klimt',5,355);right('klimt',10,890);left('klimt',11,905);
  right('vangogh',4,340);sprites.vangogh.frames[4].exclude=[[300,314,370,425]];
  sprites.vangogh.frames[5].exclude=[[314,410,355,490]];
  right('vangogh',6,900);right('vangogh',9,565);left('vangogh',10,560);right('vangogh',10,915);left('vangogh',11,910);
  right('rothko',4,314);right('kandinsky',4,355);
  right('rothko',5,540);left('rothko',6,600);
  right('rothko',9,550);left('rothko',10,610);right('rothko',10,865);left('rothko',11,920);
  right('rothko',14,850);left('rothko',15,895);
  left('matisse',5,365);
  left('mondrian',5,353);left('mondrian',10,620);right('mondrian',10,860);left('mondrian',11,905);
  right('mondrian',13,560);left('mondrian',14,645);left('mondrian',15,922);
  right('kandinsky',10,880);left('kandinsky',11,908);right('kandinsky',14,875);left('kandinsky',15,930);
  right('okeeffe',9,580);
  // Knockout and hit poses also straddle the grid; retain complete feet,
  // plumes and weapons without showing part of the adjacent fallen knight.
  right('klimt',14,840);left('klimt',15,908);
  left('hokusai',13,325);right('hokusai',14,915);left('hokusai',15,930);
  left('vangogh',13,325);right('vangogh',14,890);left('vangogh',15,905);
  right('okeeffe',14,897);left('okeeffe',15,900);
  left('okeeffe',5,375);left('okeeffe',10,595);right('okeeffe',10,920);left('okeeffe',11,930);
  const hammer=sprites.rothko.frames[5];hammer.h+=hammer.y-289;hammer.ay+=hammer.y-289;hammer.y=289;
  // Neighboring-row flecks must not pull the knight's feet above the floor.
  // Leave intentionally raised feet alone (including Mondrian's walk).
  for(const sp of Object.values(sprites))for(let row=0;row<3;row++){
   const group=sp.frames.slice(row*4,row*4+4),floors=group.map(r=>r.y+r.ay).sort((a,b)=>a-b),floor=(floors[1]+floors[2])/2;
   for(const r of group)if(r.y+r.ay>floor+18){r.ay=floor-r.y;r.h=Math.min(r.h,Math.ceil(floor+7-r.y));}
  }
  return sprites;
 }
 const api={prepare};if(typeof module==='object'&&module.exports)module.exports=api;else root.SpriteLayout=api;
})(typeof globalThis==='object'?globalThis:this);
