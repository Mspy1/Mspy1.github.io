// Presentation only: combat time makes pauses and hit-stop hold attack motion.
(function(root){
 'use strict';
 const clamp=x=>Math.max(0,Math.min(1,x));
 const ease=x=>{x=clamp(x);return x*x*(3-2*x);};
 const mix=(a,b,p)=>a+(b-a)*p;
 function sample(f,reduced=false){
  const m={x:0,y:0,angle:0,sy:1};
  if(reduced)return m;
  const t=Math.max(0,f.t||0);
  if(['light','heavy','special'].includes(f.state)&&f.move){
   const {start,active,recovery}=f.move,heavy=f.state==='heavy',special=f.state==='special';
   const back=heavy?7:4,reach=heavy?12:special?10:8,lean=heavy?.028:.018;
   if(t<start){const p=ease(t/start);m.x=-back*p;m.angle=-lean*p;m.sy=1-.012*p;}
   else if(t<start+active){const p=ease((t-start)/active);m.x=mix(-back,reach,p);m.angle=mix(-lean,lean,p);m.sy=mix(.988,1,p);}
   else{const p=ease((t-start-active)/recovery);m.x=reach*(1-p);m.angle=lean*(1-p);}
   if(special&&f.id==='matisse'&&t>start){const p=clamp((t-start)/(active+recovery));m.y=-24*Math.sin(Math.PI*p)**2;}
  }else if(f.state==='idle'){
   const enter=ease(t/.18);m.sy=1+.004*Math.sin((f.walk||0)*3.6)*enter;
  }else if(f.state==='walk'){
   m.y=-2*Math.sin((f.walk||0)*Math.PI*8)**2*ease(t/.12);
  }else if(f.state==='guard'){
   const p=ease(t/.14);m.x=-2*p;m.angle=-.008*p;
  }else if(f.state==='dodge'){
   const p=clamp(t/.34),pulse=Math.sin(Math.PI*p)**2;m.angle=.025*(f.dodgeDir||f.face)*f.face*pulse;m.sy=1-.016*pulse;
  }else if(f.state==='hurt'){
   const p=clamp(t/Math.max(.01,f.stun||.21)),pulse=Math.sin(Math.PI*p)**2;m.x=-7*pulse;m.angle=-.02*pulse;
  }
  return m;
 }
 const api={sample};if(typeof module==='object'&&module.exports)module.exports=api;else root.FighterMotion=api;
})(typeof globalThis==='object'?globalThis:this);
