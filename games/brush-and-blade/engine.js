(function(root){
  'use strict';
  const ROSTER={
    klimt:{name:'Klimt',title:'The Gilded Guard',artist:'Gustav Klimt',color:'#e6b951',secondary:'#50b3ae',hp:120,speed:174,guard:120,style:'Patient defense. Punishing shield rush.',
      light:{name:'Gilt thrust',damage:9,range:143,start:.13,active:.11,recovery:.22,cost:10,knock:17},
      heavy:{name:'Golden cleave',damage:21,range:164,start:.34,active:.15,recovery:.37,cost:23,knock:38,guardDamage:44},
      special:{name:'Mosaic rush',damage:23,range:126,start:.24,active:.30,recovery:.42,cost:20,knock:76,dash:470,guardDamage:75}},
    hokusai:{name:'Hokusai',title:'The Wave Lancer',artist:'Katsushika Hokusai',color:'#71c9db',secondary:'#f3e2b3',hp:108,speed:205,guard:95,style:'Keep your distance. Let the wave close in.',
      light:{name:'Reed thrust',damage:9,range:202,start:.12,active:.10,recovery:.19,cost:10,knock:26},
      heavy:{name:'Breaking crest',damage:19,range:212,start:.32,active:.18,recovery:.32,cost:23,knock:43,guardDamage:38},
      special:{name:'Great wave',damage:22,range:190,start:.44,active:.14,recovery:.42,cost:18,knock:65,projectile:true,guardDamage:45}},
    vangogh:{name:'Van Gogh',title:'The Star Reaper',artist:'Vincent van Gogh',color:'#f5d568',secondary:'#6784ea',hp:120,speed:157,guard:105,style:'Commit to the swing. Make every hit count.',
      light:{name:'Ochre cut',damage:11,range:157,start:.20,active:.13,recovery:.28,cost:12,knock:25},
      heavy:{name:'Starfall',damage:27,range:193,start:.48,active:.19,recovery:.45,cost:29,knock:65,guardDamage:55},
      special:{name:'Sunflower wheel',damage:29,range:232,start:.40,active:.30,recovery:.48,cost:22,knock:75,guardDamage:65}},
    mondrian:{name:'Mondrian',title:'The Red Duelist',artist:'Piet Mondrian',color:'#f26a55',secondary:'#407aca',hp:96,speed:227,guard:90,style:'Quick cuts. Exact spacing. A sudden red line.',
      light:{name:'First line',damage:6,range:132,start:.09,active:.08,recovery:.16,cost:8,knock:12},
      heavy:{name:'Cross section',damage:15,range:159,start:.25,active:.12,recovery:.29,cost:19,knock:35,guardDamage:34},
      special:{name:'Red line',damage:20,range:146,start:.17,active:.23,recovery:.30,cost:18,knock:52,dash:640,guardDamage:48}}
  };
  Object.assign(ROSTER,{
    rothko:{name:'Rothko',title:'The Colorfield',artist:'Mark Rothko',color:'#dd7949',secondary:'#762f46',hp:124,speed:136,guard:130,style:'Hold your ground. Break theirs.',
      light:{name:'Burnt-orange jab',damage:11,range:137,start:.24,active:.13,recovery:.29,cost:13,knock:35},
      heavy:{name:'Oxblood hammer',damage:25,range:165,start:.57,active:.18,recovery:.47,cost:30,knock:75,guardDamage:65},
      special:{name:'Colorfield',damage:25,range:210,start:.48,active:.35,recovery:.46,cost:22,knock:85,guardDamage:95}},
    okeeffe:{name:'O’Keeffe',title:'The Bone Blossom',artist:'Georgia O’Keeffe',color:'#efaaa9',secondary:'#dce2c9',hp:110,speed:214,guard:92,style:'Slip past the blade. Answer with a lunge.',
      light:{name:'Ivory point',damage:9,range:175,start:.10,active:.10,recovery:.19,cost:9,knock:20},
      heavy:{name:'Petal arc',damage:19,range:190,start:.26,active:.16,recovery:.30,cost:21,knock:37,guardDamage:35},
      special:{name:'Desert bloom',damage:23,range:172,start:.23,active:.25,recovery:.32,cost:18,knock:62,dash:420,guardDamage:46}},
    matisse:{name:'Matisse',title:'The Paper Dancer',artist:'Henri Matisse',color:'#7cc59a',secondary:'#f1a44f',hp:94,speed:240,guard:85,style:'Get close. Cut fast. Leave before the answer.',
      light:{name:'Paper cut',damage:5,range:123,start:.12,active:.10,recovery:.21,cost:9,knock:12},
      heavy:{name:'Crossed leaves',damage:15,range:148,start:.26,active:.17,recovery:.25,cost:18,knock:27,guardDamage:30},
      special:{name:'Cutout flurry',damage:22,range:166,start:.19,active:.29,recovery:.26,cost:18,knock:42,dash:300,guardDamage:43}},
    kandinsky:{name:'Kandinsky',title:'The Circle Keeper',artist:'Wassily Kandinsky',color:'#eabc56',secondary:'#91b8d5',hp:110,speed:182,guard:100,style:'A measured swing. A circle that keeps going.',
      light:{name:'Yellow point',damage:9,range:151,start:.13,active:.12,recovery:.22,cost:10,knock:20},
      heavy:{name:'Diagonal blow',damage:21,range:177,start:.30,active:.16,recovery:.34,cost:23,knock:46,guardDamage:42},
      special:{name:'Composition',damage:21,range:185,start:.36,active:.14,recovery:.40,cost:19,knock:55,projectile:true,guardDamage:48}}
  });
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function rng(seed){let v=seed>>>0;return()=>{v=(Math.imul(v,1664525)+1013904223)>>>0;return v/4294967296;};}
  function fighter(id,side){const c=ROSTER[id];return {id,side,x:side===0?350:930,face:side===0?1:-1,hp:c.hp,stamina:100,guard:c.guard,meter:60,state:'idle',t:0,move:null,hit:false,walk:0,guardHeld:0,parryReady:true,invincible:0,cooldown:0,stun:0,combo:0,comboTimer:0,aiTimer:0,aiAction:null,lastDamage:0};}
  function createMatch(left='klimt',right='hokusai',options={}){return {fighters:[fighter(left,0),fighter(right,1)],projectiles:[],fields:[],effects:[],events:[],time:75,elapsed:0,phase:options.instant?'fight':'intro',phaseTime:options.instant?0:1.6,round:1,wins:[0,0],winner:null,roundWinner:null,freeze:0,rng:rng(options.seed||417),mode:options.mode||'watch',difficulty:options.difficulty||'standard',serial:0};}
  function emit(m,type,data={}){const e={type,id:m.serial++,...data};m.events.push(e);if(m.events.length>80)m.events.shift();return e;}
  function begin(m,f,kind){
    if(m.phase!=='fight'||!['idle','walk','guard'].includes(f.state))return false;
    if(kind==='dodge'){
      if(f.stamina<22||f.cooldown>0)return false;
      f.stamina-=22;f.state='dodge';f.t=0;f.invincible=.27;f.cooldown=.65;f.dodgeDir=f.face*(f.retreat?-1:1);emit(m,'dodge',{side:f.side});return true;
    }
    const move=ROSTER[f.id][kind];if(!move||f.stamina<move.cost||(kind==='special'&&f.meter<60))return false;
    f.stamina-=move.cost;if(kind==='special')f.meter-=60;
    f.state=kind;f.t=0;f.move=move;f.hit=false;f.spawned=false;if(kind==='special'&&f.id==='okeeffe')f.invincible=.16;emit(m,'swing',{side:f.side,kind});return true;
  }
  function hurt(m,attacker,target,move,projectile=false){
    if(target.hp<=0||target.invincible>0)return 'evade';
    const front=(attacker.x-target.x)*target.face>=-6;
    if(target.state==='guard'&&front){
      if(target.guardHeld<.12&&target.parryReady){
        target.parryReady=false;target.meter=clamp(target.meter+18,0,100);target.stamina=clamp(target.stamina+9,0,100);
        if(!projectile){attacker.state='hurt';attacker.stun=.42;attacker.t=0;}
        emit(m,'parry',{side:target.side,x:target.x+target.face*50});m.freeze=.075;return 'parry';
      }
      target.guard-=move.guardDamage||move.damage*1.8;target.stamina=clamp(target.stamina-7,0,100);target.x=clamp(target.x+attacker.face*(move.knock||20)*.3,75,1205);
      target.meter=clamp(target.meter+7,0,100);attacker.meter=clamp(attacker.meter+4,0,100);
      if(target.guard<=0){target.guard=0;target.state='hurt';target.t=0;target.stun=.9;emit(m,'guardbreak',{side:target.side,x:target.x});}
      else emit(m,'block',{side:target.side,x:target.x+target.face*52});
      m.freeze=.045;return 'block';
    }
    const armored=target.state==='heavy'&&['vangogh','rothko'].includes(target.id)&&target.t>.15&&target.move&&target.t<target.move.start;
    target.hp=clamp(target.hp-move.damage,0,ROSTER[target.id].hp);if(!armored||target.hp===0){target.state=target.hp>0?'hurt':'ko';target.t=0;target.stun=move.damage>20?.34:.21;}
    target.x=clamp(target.x+attacker.face*(move.knock||20),75,1205);target.lastDamage=move.damage;
    attacker.meter=clamp(attacker.meter+move.damage*.9+5,0,100);target.meter=clamp(target.meter+move.damage*.4,0,100);
    attacker.combo=attacker.comboTimer>0?attacker.combo+1:1;attacker.comboTimer=1.35;
    m.freeze=move.damage>=19?.09:.055;emit(m,'hit',{side:target.side,attacker:attacker.side,damage:move.damage,x:target.x,heavy:move.damage>=19,combo:attacker.combo});
    return 'hit';
  }
  function ai(m,f,o,dt){
    const c=ROSTER[f.id],distance=Math.abs(o.x-f.x),sign=Math.sign(o.x-f.x),toward=sign||f.face;
    f.aiTimer-=dt;
    if(f.aiTimer>0)return f.aiAction||{};
    const r=m.rng();f.aiTimer=.075+m.rng()*.11;
    const incoming=(['light','heavy','special'].includes(o.state)&&o.move&&o.t<o.move.start+.08&&distance<o.move.range+50)||m.projectiles.some(p=>p.owner!==f.side&&Math.abs(p.x-f.x)<180)||m.fields.some(p=>p.owner!==f.side&&Math.abs(p.x-f.x)<125);
    let a={};
    if(incoming&&r<(m.difficulty==='easy'?.25:m.difficulty==='hard'?.83:.58)){
      a=m.rng()<.78?{guard:true}:{move:-toward,dodge:true};f.aiTimer=.18+m.rng()*.22;
    } else if(distance>c.light.range*.84){a={move:toward};if(distance>290&&f.meter>=60&&f.id==='hokusai'&&r<.3)a.special=true;}
    else if(f.id==='hokusai'&&distance<155&&r<.55){a={move:-toward};if(f.meter>=60&&r>.32)a.special=true;}
    else if(f.stamina<20){a={move:-toward,guard:r<.5};}
    else if(r<.16){a={move:-toward};}
    else if(r<.29){a={guard:true};f.aiTimer=.3;}
    else {a={};if(f.meter>=60&&r>.76)a.special=true;else if(r>.52)a.heavy=true;else a.light=true;f.aiTimer=m.difficulty==='easy'?.28:.15;}
    f.aiAction=a;return a;
  }
  function resolveRound(m){
    const [a,b]=m.fighters;let winner=null;
    if(a.hp===0&&b.hp===0)winner=-1;else if(a.hp===0)winner=1;else if(b.hp===0)winner=0;
    else if(m.time<=0){const p=a.hp/ROSTER[a.id].hp,q=b.hp/ROSTER[b.id].hp;winner=Math.abs(p-q)<.00001?-1:p>q?0:1;}
    if(winner===null)return;
    m.roundWinner=winner;if(winner>=0)m.wins[winner]++;
    for(const f of m.fighters)if(f.hp>0){f.state='idle';f.move=null;f.t=0;}
    m.phase='roundover';m.phaseTime=2.7;m.projectiles=[];m.fields=[];emit(m,'roundover',{winner});
    if(m.wins.some(w=>w===2)){m.phase='matchover';m.winner=winner;emit(m,'matchover',{winner});}
  }
  function update(m,dt,inputs=[{},{}]){
    dt=clamp(dt,0,.05);m.elapsed+=dt;
    for(const f of m.fighters){f.walk+=dt;f.comboTimer=Math.max(0,f.comboTimer-dt);}
    if(m.phase==='intro'){m.phaseTime-=dt;if(m.phaseTime<=0){m.phase='fight';emit(m,'fight');}return;}
    if(m.phase==='roundover'){
      m.phaseTime-=dt;for(const f of m.fighters)f.t+=dt;
      if(m.phaseTime<=0){const ids=m.fighters.map(f=>f.id);m.fighters=ids.map(fighter);m.round++;m.time=75;m.phase='intro';m.phaseTime=1.3;}
      return;
    }
    if(m.phase==='matchover'){for(const f of m.fighters)f.t+=dt;return;}
    if(m.freeze>0){m.freeze-=dt;return;}
    m.time=Math.max(0,m.time-dt);
    const actual=m.fighters.map((f,i)=>((m.mode==='watch')||(m.mode==='play'&&i===1))?ai(m,f,m.fighters[1-i],dt):(inputs[i]||{}));
    m.fighters.forEach((f,i)=>{
      const c=ROSTER[f.id],o=m.fighters[1-i],a=actual[i];
      f.cooldown=Math.max(0,f.cooldown-dt);f.invincible=Math.max(0,f.invincible-dt);f.t+=dt;
      if(['idle','walk','guard'].includes(f.state))f.face=o.x>=f.x?1:-1;
      const resting=['idle','walk'].includes(f.state);
      if(resting){f.stamina=clamp(f.stamina+dt*23,0,100);f.guard=clamp(f.guard+dt*21,0,c.guard);}
      if(f.state==='hurt'){if(f.t>=f.stun){f.state='idle';f.t=0;f.invincible=Math.max(f.invincible,.11);}return;}
      if(f.state==='ko')return;
      if(f.state==='dodge'){f.x=clamp(f.x+f.dodgeDir*440*dt,75,1205);if(f.t>.34){f.state='idle';f.t=0;}return;}
      if(['light','heavy','special'].includes(f.state)){
        const move=f.move;
        if(f.t>=move.start&&f.t<=move.start+move.active){
          if(move.dash)f.x=clamp(f.x+f.face*move.dash*dt,75,1205);
          if(f.state==='special'&&!f.spawned){
            f.spawned=true;emit(m,'special',{side:i,artist:f.id,x:f.x,face:f.face});
            if(move.projectile)m.projectiles.push({x:f.x+f.face*65,face:f.face,owner:i,life:1.65,age:0,hitCooldown:0,kind:f.id,move:f.id==='kandinsky'?{...move,damage:12,guardDamage:26}:move});
            if(f.id==='rothko')m.fields.push({x:clamp(f.x+f.face*175,70,1210),owner:i,age:0,life:1.2,hit:false,move});
          }
        }
        if(f.t>move.start+move.active+move.recovery){f.state='idle';f.move=null;f.t=0;}
        return;
      }
      f.retreat=(a.move||0)*f.face<0;
      if(a.dodge&&begin(m,f,'dodge'))return;
      if(a.special&&begin(m,f,'special'))return;
      if(a.heavy&&begin(m,f,'heavy'))return;
      if(a.light&&begin(m,f,'light'))return;
      if(a.guard&&f.guard>0&&f.stamina>0){
        if(f.state!=='guard'){f.t=0;f.guardHeld=0;}f.state='guard';f.guardHeld+=dt;f.stamina=Math.max(0,f.stamina-dt*4);return;
      }
      if(f.state==='guard'){f.parryReady=f.guardHeld>.3;f.guardHeld=0;}
      f.state=a.move?'walk':'idle';if(a.move)f.x=clamp(f.x+clamp(a.move,-1,1)*c.speed*dt,75,1205);
    });
    const [a,b]=m.fighters;
    if(Math.abs(a.x-b.x)<86){const mid=(a.x+b.x)/2;const order=a.x<=b.x?1:-1;a.x=clamp(mid-43*order,75,1205);b.x=clamp(mid+43*order,75,1205);}
    const impacts=[];
    for(let i=0;i<2;i++){
      const f=m.fighters[i],o=m.fighters[1-i];
      if(!['light','heavy','special'].includes(f.state)||f.hit||!f.move)continue;
      const move=f.move;
      if(move.projectile||(f.state==='special'&&f.id==='rothko')||f.t<move.start||f.t>move.start+move.active)continue;
      if((o.x-f.x)*f.face>=0&&Math.abs(o.x-f.x)<=move.range){f.hit=true;impacts.push([f,o,move]);}
    }
    for(const [f,o,move] of impacts)hurt(m,f,o,move);
    for(const p of m.projectiles){
      const old=p.x;p.age+=dt;p.hitCooldown=Math.max(0,p.hitCooldown-dt);
      const reverse=p.kind==='kandinsky'&&p.age>.82?-1:1;
      p.x+=p.face*(p.kind==='kandinsky'?350:430)*reverse*dt;p.life-=dt;const o=m.fighters[1-p.owner];
      if(p.hitCooldown<=0&&o.x>=Math.min(old,p.x)-40&&o.x<=Math.max(old,p.x)+40){hurt(m,m.fighters[p.owner],o,p.move,true);if(p.kind==='kandinsky')p.hitCooldown=.55;else p.life=0;}
    }
    m.projectiles=m.projectiles.filter(p=>p.life>0&&p.x>0&&p.x<1280);
    for(const field of m.fields){field.age+=dt;field.life-=dt;const o=m.fighters[1-field.owner];if(field.age>.18&&!field.hit&&Math.abs(o.x-field.x)<105){const result=hurt(m,m.fighters[field.owner],o,field.move,true);if(result!=='evade')field.hit=true;}}
    m.fields=m.fields.filter(p=>p.life>0);
    resolveRound(m);
  }
  function pose(f){
    if(f.state==='idle')return 0;
    if(f.state==='walk')return Math.floor(f.walk*8)%2+1;
    if(f.state==='guard')return 8;
    if(f.state==='dodge')return 12;
    if(f.state==='hurt')return 13;
    if(f.state==='ko')return f.t<.55?14:15;
    const move=f.move;if(!move)return 0;
    if(f.state==='light')return f.t<move.start?3:f.t<move.start+move.active?4:7;
    if(f.state==='heavy')return f.t<move.start?5:f.t<move.start+move.active?6:7;
    if(f.state==='special')return f.t<move.start?10:f.t<move.start+move.active?11:7;
    return 0;
  }
  const api={ROSTER,clamp,rng,createMatch,update,begin,hurt,pose};
  if(typeof module!=='undefined')module.exports=api;else root.Duel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
