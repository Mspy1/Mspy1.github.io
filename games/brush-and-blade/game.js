(() => {
'use strict';
const {ROSTER,clamp,createMatch,update,pose}=Duel;
const SPRITES=SpriteLayout.prepare(window.SPRITES);
const $=id=>document.getElementById(id),canvas=$('arena'),ctx=canvas.getContext('2d');
const ids=Object.keys(ROSTER),images={},portraits={},keys=new Set(),touch=new Set(),buffered=new Map(),touchBuffered=new Map();
let match=createMatch('rothko','okeeffe',{mode:'watch'}),selection=['rothko','okeeffe'],selectSide=0,paused=false,loaded=false,last=0,eventCursor=-1,particles=[],flourishes=[],texts=[],shake=0,flash=0,specialBanner=null,soundOn=false,audioContext=null,run=null,attract=true,resultShown=false,matchDelay=0;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage=new Image();stage.src='assets/gallery.webp';
const FX_DESCRIPTION={
 klimt:'A shield rush scatters gold mosaics. Excellent against guard; punish the recovery.',
 hokusai:'A curling wave travels across the floor. Guard it or dodge through it.',
 vangogh:'A broad starry wheel sweeps the space ahead. Strong reach, slow recovery.',
 mondrian:'A red line cuts straight through the gap. Quick entry, short reach.',
 rothko:'A color field lingers ahead and crushes guard. Retreat before it settles.',
 okeeffe:'A briefly evasive lunge opens into a crimson bloom. Catch its recovery.',
 matisse:'A low-cost leaping cut throws leaves into the air. Keep the dancer at range.',
 kandinsky:'Orbiting circles fly out and return. Guard both passes or change your distance.'
};
function createCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
// The generated sheets keep their original opaque pixels. The game renderer keys
// only border-connected plum backdrop pixels; enclosed dark armor remains intact.
function frameCanvas(img,rect){
 const c=createCanvas(rect.w,rect.h),g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,rect.x,rect.y,rect.w,rect.h,0,0,rect.w,rect.h);
 const bitmap=g.getImageData(0,0,c.width,c.height),d=bitmap.data,w=c.width,h=c.height,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
 function enqueue(p){if(p<0||p>=w*h||seen[p])return;seen[p]=1;const k=p*4,r=d[k],gg=d[k+1],b=d[k+2];if(r<48&&gg<39&&b<64&&b>=gg&&r-gg<24){queue[tail++]=p;}}
 for(let x=0;x<w;x++){enqueue(x);enqueue((h-1)*w+x);}for(let y=0;y<h;y++){enqueue(y*w);enqueue(y*w+w-1);}
 while(head<tail){const p=queue[head++];d[p*4+3]=0;const x=p%w;if(x>0)enqueue(p-1);if(x<w-1)enqueue(p+1);enqueue(p-w);enqueue(p+w);}
 // Disconnected foreground islands may be blades or tassels. Keep them;
 // mask only reviewed fragments belonging to neighboring sheet cells.
 for(const box of rect.exclude||[])for(let y=Math.max(0,box[1]-rect.y);y<Math.min(h,box[3]-rect.y);y++)for(let x=Math.max(0,box[0]-rect.x);x<Math.min(w,box[2]-rect.x);x++)d[(y*w+x)*4+3]=0;
 g.putImageData(bitmap,0,0);return c;
}
async function load(){
 let count=0;
 await Promise.all(ids.map(async id=>{
  const im=new Image();im.src=SPRITES[id].file;await im.decode();
  images[id]=SPRITES[id].frames.map(r=>frameCanvas(im,r));count++;$('loadCount').textContent=count+' / 8';
 }));
 loaded=true;$('loading').hidden=true;$('loading').style.display='none';buildRoster();updateSelection();requestAnimationFrame(loop);
}
function audio(){if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();}
function tone(freq,duration,type='sine',volume=.05,slide=0){
 if(!soundOn)return;try{audio();const t=audioContext.currentTime,o=audioContext.createOscillator(),g=audioContext.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,freq+slide),t+duration);g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(audioContext.destination);o.start();o.stop(t+duration);}catch(e){soundOn=false;}
}
function sfx(type){
 if(type==='hit'){tone(110,.12,'triangle',.13,-75);tone(530,.08,'square',.025,-370);}
 if(type==='block'){tone(780,.12,'triangle',.07,-200);tone(1240,.07,'sine',.035);}
 if(type==='parry'){tone(880,.25,'sine',.09);setTimeout(()=>tone(1320,.2,'sine',.06),60);}
 if(type==='guardbreak'){tone(200,.35,'sawtooth',.08,-150);}
 if(type==='special'){tone(190,.3,'triangle',.07,650);tone(380,.5,'sine',.035,700);}
 if(type==='swing'){tone(260,.06,'triangle',.025,-100);}
 if(type==='fight'){tone(440,.14,'triangle',.08);setTimeout(()=>tone(660,.25,'triangle',.06),120);}
 if(type==='matchover'){[330,440,550,660].forEach((f,i)=>setTimeout(()=>tone(f,.45,'triangle',.045),i*100));}
}
function buildRoster(){
 $('roster').replaceChildren();
 for(const id of ids){
  const b=document.createElement('button');b.dataset.fighter=id;b.style.setProperty('--artist',ROSTER[id].color);b.setAttribute('aria-label','Choose '+ROSTER[id].name);b.innerHTML='<canvas width="220" height="200" aria-hidden="true"></canvas><span class="name">'+ROSTER[id].name+'</span><span class="marker"></span>';
  const c=b.querySelector('canvas'),g=c.getContext('2d');g.imageSmoothingEnabled=false;
  const r=SPRITES[id].frames[0],s=.70;g.drawImage(images[id][0],110-r.ax*s,197-r.ay*s,r.w*s,r.h*s);
  b.onclick=()=>{selection[selectSide]=id;updateSelection();tone(440+ids.indexOf(id)*40,.1,'triangle',.035);};$('roster').append(b);
 }
}
function updateSelection(){
 if($('modeSelect').value==='arcade')selectSide=0;
 $('chooseLeft').classList.toggle('selected',selectSide===0);$('chooseRight').classList.toggle('selected',selectSide===1);
 for(const b of $('roster').children){const id=b.dataset.fighter;b.classList.toggle('selected',selection[selectSide]===id);b.setAttribute('aria-pressed',String(selection[selectSide]===id));b.querySelector('.marker').textContent=selection[0]===id&&selection[1]===id?'1 / 2':selection[0]===id?'1':selection[1]===id?'2':'';}
 const f=ROSTER[selection[selectSide]];$('fighterTitle').textContent=f.title;$('fighterStyle').textContent=FX_DESCRIPTION[selection[selectSide]];
 $('moveNames').innerHTML=['light','heavy','special'].map((k,i)=>'<div title="'+(k==='special'?FX_DESCRIPTION[selection[selectSide]]:f[k].damage+' damage · '+f[k].range+' reach')+'"><small>'+['J · LIGHT','K · HEAVY','L · SPECIAL'][i]+'</small><b>'+f[k].name+'</b></div>').join('');
 $('chooseRight').disabled=$('modeSelect').value==='arcade';
}
function resetMatch(mode,first=selection[0],second=selection[1]){
 match=createMatch(first,second,{mode:mode==='arcade'?'play':mode,seed:Math.floor(Math.random()*1e8),difficulty:$('difficultySelect').value});
 eventCursor=-1;paused=false;resultShown=false;particles=[];flourishes=[];texts=[];specialBanner=null;shake=0;flash=0;matchDelay=0;
 $('result').hidden=true;$('pauseOverlay').hidden=true;$('pauseButton').innerHTML='Pause <kbd>Esc</kbd>';keys.clear();touch.clear();
 $('announcement').textContent=ROSTER[first].name+' versus '+ROSTER[second].name+'.';
 updateLegend();canvas.focus({preventScroll:true});
}
function start(){
 attract=false;run=null;const mode=$('modeSelect').value;
 if(mode==='arcade'){const opponents=ids.filter(id=>id!==selection[0]);for(let i=opponents.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[opponents[i],opponents[j]]=[opponents[j],opponents[i]];}run={knight:selection[0],opponents,index:0};resetMatch('play',run.knight,run.opponents[0]);}
 else resetMatch(mode);
}
function updateLegend(){
 if(match.mode==='watch')$('controlLegend').innerHTML='<span>Watching AI opponents. Choose your knight and enter the arena to take control.</span>';
 else if(match.mode==='local')$('controlLegend').innerHTML='<span>P1: A/D · J/K/L · S guard · Space dodge</span><span>P2: ←/→ · 1/2/3 · ↓ guard · 0 dodge</span>';
 else $('controlLegend').innerHTML='<span><kbd>A</kbd><kbd>D</kbd> move</span><span><kbd>J</kbd> light</span><span><kbd>K</kbd> heavy</span><span><kbd>L</kbd> special</span><span><kbd>S</kbd> guard / tap to parry</span><span><kbd>Space</kbd> dodge</span>';
 $('touchControls').style.opacity=match.mode==='watch'?'.45':'1';
}
function pause(value=!paused){if(!loaded)return;paused=value;$('pauseOverlay').hidden=!paused;$('pauseButton').innerHTML=paused?'Resume <kbd>Esc</kbd>':'Pause <kbd>Esc</kbd>';keys.clear();touch.clear();$('pauseOverlay').querySelector('button').focus({preventScroll:true});if(!paused)canvas.focus({preventScroll:true});}
function input(side){
 const down=k=>keys.has(k)||(buffered.get(k)||0)>performance.now();
 const tap=k=>touch.has(k)||(touchBuffered.get(k)||0)>performance.now();
 if(side===0)return{move:(keys.has('KeyD')||touch.has('right')?1:0)-(keys.has('KeyA')||touch.has('left')?1:0),light:down('KeyJ')||tap('light'),heavy:down('KeyK')||tap('heavy'),special:down('KeyL')||tap('special'),guard:keys.has('KeyS')||touch.has('guard'),dodge:down('Space')||tap('dodge')};
 return{move:(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),light:down('Digit1')||down('Numpad1'),heavy:down('Digit2')||down('Numpad2'),special:down('Digit3')||down('Numpad3'),guard:keys.has('ArrowDown'),dodge:down('Digit0')||down('Numpad0')};
}
function burst(x,y,color,n=18,power=160){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,v=power*(.3+Math.random());particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-30,life:.35+Math.random()*.3,max:.65,size:2+Math.random()*5,color});}}
function handleEvents(){
 for(const e of match.events){if(e.id<=eventCursor)continue;eventCursor=e.id;sfx(e.type);
  if(e.type==='hit'){const f=match.fighters[e.attacker];burst(e.x,390,ROSTER[f.id].color,e.heavy?28:15,e.heavy?240:130);shake=e.heavy?9:4;flash=e.heavy?.06:0;texts.push({x:e.x,y:320,text:String(e.damage),color:'#fff0cf',life:.7});if(e.combo>1)texts.push({x:e.x+f.face*50,y:284,text:e.combo+' HITS',color:ROSTER[f.id].color,life:.8});}
  if(e.type==='block'||e.type==='parry'){burst(e.x,390,e.type==='parry'?'#fff6d0':'#b2d2de',20,180);texts.push({x:e.x,y:310,text:e.type==='parry'?'PARRY':'BLOCK',color:e.type==='parry'?'#ffe4a5':'#b1cfdf',life:.55});match.fighters[e.side].blockVisual=.15;}
  if(e.type==='guardbreak'){burst(e.x,400,'#eab17d',38,210);texts.push({x:e.x,y:285,text:'GUARD BROKEN',color:'#f4a576',life:1});shake=8;}
  if(e.type==='special'){specialBanner={name:ROSTER[e.artist].special.name,artist:ROSTER[e.artist].name,color:ROSTER[e.artist].color,side:e.side,life:1.1};flourishes.push({id:e.artist,x:e.x,face:e.face,age:0,life:.7});shake=4;}
  if(e.type==='matchover'&&!attract)showResult();
 }
}
function showResult(){
 resultShown=true;const winner=match.winner;const won=winner===0;let title=winner===-1?'A draw':ROSTER[match.fighters[winner].id].name+' wins';let detail='';let label='Fight again';
 if(run){if(won){title=run.index===6?'The gallery is yours.':'Room '+(run.index+1)+' cleared.';detail=run.index===6?'Seven opponents defeated with '+ROSTER[run.knight].name+'.':ROSTER[run.opponents[run.index+1]].name+' waits in the next room.';label=run.index===6?'New gallery run':'Next opponent';}else{title='Stopped by '+ROSTER[match.fighters[1].id].name;detail='Retry room '+(run.index+1)+' with full health.';label='Try this opponent again';}}
 else detail=match.mode==='watch'?'Choose another pairing, or enter the arena yourself.':won?'A well-placed brushstroke. Another duel?':'Watch the wind-up. Guard, create space, then answer.';
 $('resultTitle').textContent=title;$('resultDetail').textContent=detail;$('rematchButton').textContent=label;$('resultEyebrow').textContent=run?'GALLERY RUN · '+(run.index+1)+' / 7':'MATCH COMPLETE';
 setTimeout(()=>{if(resultShown&&match.phase==='matchover'){$('result').hidden=false;$('rematchButton').focus({preventScroll:true});}},950);
 $('announcement').textContent=title;
}
function rematch(){if(run){if(match.winner===0){run.index++;if(run.index>=7){start();return;}}resetMatch('play',run.knight,run.opponents[run.index]);}else resetMatch($('modeSelect').value==='arcade'?'play':$('modeSelect').value);}
function drawStage(t){
 ctx.fillStyle='#191722';ctx.fillRect(0,0,1280,620);
 if(stage.complete&&stage.naturalWidth){ctx.drawImage(stage,0,0,1280,620);ctx.fillStyle='#0b081620';ctx.fillRect(0,0,1280,620);}
 else {for(let i=0;i<5;i++){ctx.fillStyle='#282331';ctx.fillRect(40+i*270,90,200,365);ctx.fillStyle='#14121e';ctx.fillRect(50+i*270,110,180,335);}ctx.fillStyle='#3c3337';ctx.fillRect(0,520,1280,100);}
 const dark=ctx.createLinearGradient(0,0,0,190);dark.addColorStop(0,'#0d0a14dd');dark.addColorStop(1,'#0d0a1400');ctx.fillStyle=dark;ctx.fillRect(0,0,1280,190);
 ctx.fillStyle='#20172580';ctx.fillRect(0,522,1280,98);ctx.fillStyle='#d1af7b55';ctx.fillRect(0,522,1280,2);
 for(let i=0;i<24;i++){const x=(i*97+Math.sin(t*.2+i)*12)%1280,y=180+(i*53)%310+Math.sin(t*.3+i)*8;ctx.fillStyle='rgba(239,205,147,'+(.08+.05*Math.sin(t+i))+')';ctx.fillRect(x,y,2,2);}
}
function paintWave(x,y,face,age){
 ctx.save();ctx.translate(x,y);ctx.scale(face,1);const s=1+.05*Math.sin(age*12);ctx.scale(s,s);
 for(let l=0;l<4;l++){ctx.fillStyle=['#173569','#265886','#3c8fa6','#9fd4d6'][l];ctx.beginPath();ctx.moveTo(-95,70);ctx.bezierCurveTo(-36,47,-52,-100,40,-117+l*12);ctx.bezierCurveTo(116,-121,104,-32,40,-36);ctx.bezierCurveTo(87,-57,58,-105,33,-67);ctx.bezierCurveTo(-3,-30,28,19,90,70);ctx.closePath();ctx.fill();ctx.translate(-3,4);}
 ctx.strokeStyle='#eee8cd';ctx.lineWidth=4;for(let j=0;j<9;j++){const a=-2.8+j*.25;ctx.beginPath();const sx=40+48*Math.cos(a),sy=-59+46*Math.sin(a);ctx.moveTo(sx,sy);ctx.quadraticCurveTo(sx-8,sy-21,sx+2,sy-17);ctx.stroke();}
 ctx.restore();
}
function paintCircles(p){ctx.save();ctx.translate(p.x,403);const colors=['#edd151','#ee6751','#6c9ece'];for(let i=0;i<3;i++){const a=p.age*5+i*Math.PI*2/3,x=Math.cos(a)*31,y=Math.sin(a)*35;ctx.strokeStyle=colors[i];ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,19+i*4,0,Math.PI*2);ctx.stroke();ctx.fillStyle=colors[i];ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff1c9';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(-x*.5,-y*.5);ctx.stroke();}ctx.restore();}
function paintField(f){const fade=Math.min(1,f.age*7,f.life*3);ctx.save();ctx.translate(f.x,405);ctx.globalAlpha=fade*.65;ctx.shadowBlur=28;ctx.shadowColor='#d4542b';for(let i=0;i<3;i++){ctx.fillStyle=['#842a33','#d56232','#c58a51'][i];ctx.fillRect(-101+i*4,-105+i*65,202-i*8,64);}ctx.shadowBlur=0;ctx.strokeStyle=f.age<.18?'#e9bb81':'#bc6c49';ctx.lineWidth=2;ctx.strokeRect(-105,-109,210,198);ctx.restore();}
function petal(x,y,angle,length,color,width=.35){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,0);ctx.bezierCurveTo(length*.2,-length*width,length*.8,-length*width,length,0);ctx.bezierCurveTo(length*.7,length*width,length*.2,length*width,0,0);ctx.fill();ctx.restore();}
function paintFlourish(f){
 const p=clamp(f.age/.7,0,1),alpha=Math.sin(p*Math.PI);if(alpha<=0)return;const c=ROSTER[f.id];ctx.save();ctx.translate(f.x,395);ctx.scale(f.face,1);ctx.globalAlpha=alpha*.85;
 if(f.id==='klimt'){for(let i=0;i<27;i++){const x=70+p*210+Math.cos(i*2.4)*p*90,y=Math.sin(i*2.4)*p*120;ctx.save();ctx.translate(x,y);ctx.rotate(i+p*2);ctx.fillStyle=i%4===0?'#65bfc0':i%3?'#e6b952':'#fbebae';ctx.fillRect(-5,-5,10,10);ctx.restore();}}
 if(f.id==='vangogh'){
  for(let i=0;i<15;i++){const radius=45+i*8;ctx.strokeStyle=i%3===0?'#7aa1e8':i%2?'#ead279':'#e2a846';ctx.lineWidth=3+i%3;ctx.beginPath();ctx.arc(80,0,radius,p*8+i*.5,p*8+i*.5+2.6);ctx.stroke();}
  for(let i=0;i<7;i++){const a=i*.9+p*3;ctx.fillStyle='#fff1aa';ctx.beginPath();ctx.arc(80+Math.cos(a)*170,Math.sin(a)*140,3+i%3,0,Math.PI*2);ctx.fill();}
 }
 if(f.id==='mondrian'){ctx.fillStyle='#dd4437';ctx.fillRect(10,-10,250*p+85,13);ctx.fillStyle='#f0d569';ctx.fillRect(50,-70,12,125);ctx.fillStyle='#4e81c4';ctx.fillRect(120,-43,185*p,17);ctx.strokeStyle='#f1ede2';ctx.lineWidth=3;ctx.strokeRect(10,-73,300*p+70,145);}
 if(f.id==='okeeffe'){for(let i=0;i<10;i++){const a=i*Math.PI/5;petal(90+p*60,0,a,40+p*96,['#efb3ae','#c95065','#f4dccc'][i%3],.32);}ctx.fillStyle='#471f3a';ctx.beginPath();ctx.arc(90+p*60,0,13,0,Math.PI*2);ctx.fill();}
 if(f.id==='matisse'){for(let i=0;i<18;i++){const a=i*2.4,x=70+p*200+Math.cos(a)*p*90,y=Math.sin(a)*p*110;petal(x,y,a+p*5,22+i%4*7,['#ee8556','#69bf94','#eed971','#6697e2'][i%4],.5);}}
 ctx.restore();
}
function drawFighter(f,dt){
 const config=ROSTER[f.id];let index=f.blockVisual>0?9:pose(f);f.blockVisual=Math.max(0,(f.blockVisual||0)-dt);
 const r=SPRITES[f.id].frames[index],img=images[f.id][index];
 // Match visual stature across sheets while retaining deliberately different builds.
 const stature={klimt:1.05,hokusai:1.00,vangogh:1.14,mondrian:1.02,rothko:1.17,okeeffe:1.01,matisse:1.03,kandinsky:1.04}[f.id];
 const idleHeight=SPRITES[f.id].frames[0].h,s=255/idleHeight*stature;
 ctx.save();ctx.translate(f.x,522);ctx.fillStyle='#0a071666';ctx.beginPath();ctx.ellipse(0,0,55,10,0,0,Math.PI*2);ctx.fill();
 const motion=FighterMotion.sample(f,reduceMotion);
 ctx.scale(f.face,1);ctx.translate(motion.x,motion.y);ctx.rotate(motion.angle);ctx.scale(1,motion.sy);ctx.imageSmoothingEnabled=false;
 if(f.state==='dodge'&&!reduceMotion){ctx.globalAlpha=.32;ctx.drawImage(img,-r.ax*s-f.dodgeDir*f.face*35,-r.ay*s,r.w*s,r.h*s);ctx.globalAlpha=.92;}
 if(f.state==='hurt'&&Math.floor(f.t*35)%2===0)ctx.filter='brightness(1.65)';
 ctx.imageSmoothingEnabled=false;ctx.drawImage(img,-r.ax*s,-r.ay*s,r.w*s,r.h*s);ctx.filter='none';
 if(['heavy','special'].includes(f.state)&&f.move&&f.t<f.move.start){ctx.globalAlpha=.3+Math.sin(f.t*30)*.2;ctx.strokeStyle=f.state==='special'?config.color:'#fff0c9';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-110,42+f.t*40,-1.6,1.6);ctx.stroke();}
 ctx.restore();
}
function render(dt){
 const t=match.elapsed;ctx.save();if(shake>0&&!reduceMotion){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake=Math.max(0,shake-dt*48);}drawStage(t);
 for(const f of match.fields)paintField(f);
 for(const f of match.fighters)drawFighter(f,dt);
 for(const p of match.projectiles){if(p.kind==='hokusai')paintWave(p.x,438,p.face,p.age);else paintCircles(p);}
 for(const f of flourishes){f.age+=dt;f.life-=dt;paintFlourish(f);}flourishes=flourishes.filter(f=>f.life>0);
 for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=dt*230;p.life-=dt;ctx.globalAlpha=clamp(p.life/.35,0,1);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}particles=particles.filter(p=>p.life>0);ctx.globalAlpha=1;
 for(const text of texts){text.life-=dt;text.y-=dt*28;ctx.globalAlpha=clamp(text.life*3,0,1);ctx.fillStyle=text.color;ctx.textAlign='center';ctx.font=/^\d+$/.test(text.text)?'bold 25px Georgia':'bold 15px Arial';ctx.shadowBlur=6;ctx.shadowColor='#000';ctx.fillText(text.text,text.x,text.y);ctx.shadowBlur=0;}texts=texts.filter(p=>p.life>0);ctx.globalAlpha=1;
 if(specialBanner){specialBanner.life-=dt;ctx.globalAlpha=Math.min(1,specialBanner.life*3);ctx.textAlign=specialBanner.side===0?'left':'right';ctx.fillStyle=specialBanner.color;ctx.font='italic 28px Georgia';ctx.fillText(specialBanner.name,specialBanner.side===0?65:1215,194);ctx.font='10px Consolas';ctx.fillStyle='#f0e3cb';ctx.fillText(specialBanner.artist.toUpperCase(),specialBanner.side===0?66:1214,214);ctx.globalAlpha=1;if(specialBanner.life<=0)specialBanner=null;}
 if(match.phase==='intro'||match.phase==='roundover'){
  const label=match.phase==='intro'?(match.phaseTime>.45?'Round '+match.round:'Fight'):match.roundWinner===-1?'Draw':ROSTER[match.fighters[match.roundWinner].id].name+' takes the round';
  ctx.textAlign='center';ctx.fillStyle='#16101c99';ctx.fillRect(0,241,1280,93);ctx.fillStyle='#f3e2be';ctx.font=match.phase==='intro'?'italic 56px Georgia':'italic 40px Georgia';ctx.fillText(label,640,302);
 }
 if(flash>0&&!reduceMotion){ctx.globalAlpha=flash*1.5;ctx.fillStyle='#f4d08a';ctx.fillRect(0,0,1280,620);ctx.globalAlpha=1;flash-=dt;}
 ctx.restore();updateHud();
}
function updateHud(){
 canvas.setAttribute('aria-label',match.fighters.map((f,i)=>'Player '+(i+1)+': '+ROSTER[f.id].name+', '+Math.ceil(f.hp)+' health, '+f.state).join('. ')+'. Round '+match.round+'. '+match.phase+'.');
 match.fighters.forEach((f,i)=>{const p=i===0?'left':'right',c=ROSTER[f.id];$(p+'Name').textContent=c.name.toUpperCase();$(p+'Name').closest('.health').style.setProperty('--fighter-color',c.color);$(p+'HP').style.width=f.hp/c.hp*100+'%';$(p+'Stamina').style.width=f.stamina+'%';$(p+'Guard').style.width=f.guard/c.guard*100+'%';$(p+'Meter').style.width=f.meter+'%';$(p+'Meter').parentElement.classList.toggle('ready',f.meter>=60);$(p+'Special').textContent=f.meter>=60?c.special.name.toUpperCase()+' · READY':c.special.name.toUpperCase();$(p+'Score').textContent=[0,1].map(n=>match.wins[i]>n?'●':'○').join(' ');});
 $('clock').textContent=Math.ceil(match.time);$('roundLabel').textContent='ROUND '+match.round;$('modeLabel').textContent=run?'ROOM '+(run.index+1)+' / 7':attract?'EXHIBITION':match.mode==='watch'?'AI DUEL':match.mode==='local'?'LOCAL DUEL':'SOLO DUEL';
}
function loop(now){
 const dt=Math.min((now-last)/1000||.016,.04);last=now;
 if(!paused&&!$('helpDialog').open){update(match,dt,[input(0),input(1)]);handleEvents();render(dt);if(attract&&match.phase==='matchover'){matchDelay+=dt;if(matchDelay>3){const a=Math.floor(Math.random()*ids.length),b=(a+1+Math.floor(Math.random()*7))%ids.length;resetMatch('watch',ids[a],ids[b]);}}}
 else render(0);
 requestAnimationFrame(loop);
}
const gameCodes=new Set(['KeyA','KeyD','KeyS','KeyJ','KeyK','KeyL','Space','ArrowLeft','ArrowRight','ArrowDown','Digit0','Digit1','Digit2','Digit3','Numpad0','Numpad1','Numpad2','Numpad3']);
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!$('helpDialog').open){e.preventDefault();pause();return;}if(['SELECT','INPUT','TEXTAREA'].includes(e.target.tagName)||$('helpDialog').open||!$('result').hidden)return;if(gameCodes.has(e.code)){e.preventDefault();keys.add(e.code);if(!['KeyA','KeyD','KeyS','ArrowLeft','ArrowRight','ArrowDown'].includes(e.code))buffered.set(e.code,performance.now()+150);}});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();touch.clear();});
document.addEventListener('visibilitychange',()=>{keys.clear();touch.clear();if(document.hidden&&!attract&&match.phase==='fight')pause(true);});
for(const b of $('touchControls').querySelectorAll('button')){b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touch.add(b.dataset.action);if(!['left','right','guard'].includes(b.dataset.action))touchBuffered.set(b.dataset.action,performance.now()+150);b.classList.add('pressed');});const release=()=>{touch.delete(b.dataset.action);b.classList.remove('pressed');};b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);}
$('fightButton').onclick=start;$('chooseLeft').onclick=()=>{selectSide=0;updateSelection();};$('chooseRight').onclick=()=>{selectSide=1;updateSelection();};$('modeSelect').onchange=updateSelection;
$('pauseButton').onclick=()=>pause();$('resumeButton').onclick=()=>pause(false);$('rematchButton').onclick=rematch;
$('rosterButton').onclick=()=>{$('result').hidden=true;resultShown=false;$('roster').scrollIntoView({behavior:reduceMotion?'instant':'smooth',block:'nearest'});$('roster').querySelector('button').focus({preventScroll:true});};
$('helpButton').onclick=()=>{keys.clear();touch.clear();$('helpDialog').showModal();};$('closeHelp').onclick=()=>$('helpDialog').close();
$('helpDialog').addEventListener('click',e=>{if(e.target===$('helpDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('soundButton').onclick=()=>{soundOn=!soundOn;$('soundButton').textContent=soundOn?'Sound on':'Sound off';$('soundButton').setAttribute('aria-pressed',String(soundOn));if(soundOn){audio();tone(660,.15,'sine',.03);}};
$('fullscreenButton').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else $('game').requestFullscreen?.();};
// Read-only state is useful for accessibility and automated validation.
window.BrushBlade={getState:()=>({loaded,paused,selection:[...selection],mode:match.mode,phase:match.phase,round:match.round,wins:[...match.wins],time:match.time,fighters:match.fighters.map(f=>({...f,move:f.move?{...f.move}:null})),projectiles:match.projectiles.map(p=>({...p})),fields:match.fields.map(f=>({...f})),events:match.events.map(e=>({...e})),run:run?{...run}:null}),getRoster:()=>ROSTER};
updateLegend();load().catch(e=>{$('loading').textContent='A painting could not load. Please refresh to try again.';console.error(e);});
})();
