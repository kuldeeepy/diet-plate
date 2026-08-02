/* Plate — runtime.
   Deterministic: the calendar date is the only seed, so the app always shows the
   same answer for a given day. Nothing here is random. */

// ---------- storage ----------
// Factory, not a literal: Object.assign copies nested references, so a shared DEF
// would get poisoned by writes and "reset" would silently clear nothing.
const DEF = () => ({ picks:{}, done:{}, swaps:{}, shop:{}, prep:{}, anchors:{}, noPrep:false });
let S = Object.assign(DEF(), JSON.parse(localStorage.getItem('plate') || '{}'));
const save = () => { localStorage.setItem('plate', JSON.stringify(S)); if (typeof refreshUser === 'function') refreshUser(); };

// ---------- dates ----------
const DAY = 864e5;
const key    = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dayNum = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
const today  = () => new Date();
const plus   = (d,n) => new Date(d.getFullYear(), d.getMonth(), d.getDate()+n);
const dow    = d => (d.getDay()+6) % 7;                 // 0 = Monday
const monday = d => plus(d, -dow(d));
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MON    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt    = d => `${DAYS[dow(d)]} ${d.getDate()} ${MON[d.getMonth()]}`;
const clock  = t => { const h=Math.floor(t), m=Math.round((t-h)*60);
  const ap=h>=12?'pm':'am', hh=h%12===0?12:h%12;
  return `${hh}${m?':'+String(m).padStart(2,'0'):''} ${ap}`; };

// ---------- profile & personalised targets ----------
// Mifflin–St Jeor: unbiased with the narrowest error range across non-obese and
// obese adults. Protein plateaus at ~1.6 g/kg (Morton 2018 meta-analysis); adults
// 60+ sit lower at 1.2–1.6, so we use 1.4 there.
const DIETS = { veg:['veg'], egg:['veg','egg'], nonveg:['veg','egg','nonveg'] };

// Activity multiplier derived from how many days they actually train — not assumed.
// Standard activity factors: sedentary 1.2, light 1-2/wk 1.375, moderate 3-5/wk 1.55,
// very active 6-7/wk 1.725, extra (physical job + training) 1.9.
const ACT = n => n <= 0 ? 1.2 : n <= 2 ? 1.375 : n <= 5 ? 1.55 : n <= 7 ? 1.725 : 1.9;

// Type matters: a protein shake is worth it after resistance work, not after yoga,
// and the same hour of effort does not cost the same.
const TRAIN_TYPES = {
  weights: { label:'Weights',            sub:'Resistance training',      w:1.0,  shake:true,  gkg:1.8 },
  mixed:   { label:'Weights + cardio',   sub:'A bit of both',            w:1.1,  shake:true,  gkg:1.8 },
  sport:   { label:'A sport',            sub:'Football, badminton, swim',w:1.05, shake:true,  gkg:1.7 },
  cardio:  { label:'Running / cycling',  sub:'Mostly steady cardio',     w:1.0,  shake:false, gkg:1.6 },
  yoga:    { label:'Yoga / walking',     sub:'Low intensity',            w:0.6,  shake:false, gkg:1.4 }
};

/* Everything that depends on WHO the user is lives here, and nowhere else.
   The rest of the app asks this object questions; it never inspects the profile
   directly. Construct it fresh whenever the profile changes. */
class UserAlgorithm {
  constructor(profile){ this.p = profile || {}; }

  // ---- identity -----------------------------------------------------------
  get known()      { return !!this.p.kg; }
  get name()       { return this.p.name || ''; }
  get trainDays()  { return (this.p.train && this.p.train.days) || []; }
  get workDays()   { return (this.p.work  && this.p.work.days)  || []; }
  get trainType()  { return TRAIN_TYPES[(this.p.train && this.p.train.type) || 'weights']; }

  // ---- body ---------------------------------------------------------------
  get bmi()  { const h = this.p.cm/100; return this.p.kg/(h*h); }
  get band() { const b = this.bmi;
               return b < 18.5 ? 'under' : b < 25 ? 'normal' : b < 30 ? 'over' : 'obese'; }
  // Mifflin–St Jeor: unbiased, narrowest error range in validation studies.
  get bmr()  { return 10*this.p.kg + 6.25*this.p.cm - 5*this.p.age
                    + (this.p.gender === 'm' ? 5 : -161); }
  get activity(){ return ACT(this.trainDays.length * this.trainType.w); }
  get tdee()    { return this.bmr * this.activity; }
  // Never call it a "gym week" for someone who does yoga, runs, or trains not at all.
  get activityLabel(){
    if (!this.trainDays.length) return 'Everyday activity';
    return { weights:'With your gym week',   mixed:'With your training week',
             sport:'With your sport week',   cardio:'With your cardio week',
             yoga:'With your yoga week' }[(this.p.train && this.p.train.type) || 'weights'];
  }

  // ---- goal ---------------------------------------------------------------
  // Goal drives the adjustment, but an underweight person is never put into a
  // deficit and someone obese is never put into a surplus, whatever they chose.
  get goal()   { return this.p.goal || 'lean'; }
  get adjust() {
    if (this.band === 'under')      return 0.12;
    if (this.goal === 'build')      return this.band === 'obese' ? -0.05 : 0.10;
    if (this.goal === 'maintain')   return 0;
    return { normal:-0.08, over:-0.17, obese:-0.22 }[this.band];
  }
  get floor()   { return Math.max(this.bmr, this.p.gender === 'm' ? 1500 : 1200); }
  get calories(){
    return Math.max(Math.round(this.tdee*(1+this.adjust)/10)*10, Math.round(this.floor/10)*10);
  }
  // 1.6 g/kg is where gains plateau; a deficit earns more because it spares muscle,
  // and the ceiling drops with age and with lower-intensity training.
  get proteinPerKg(){
    if (this.p.age >= 60) return 1.4;
    return Math.min(this.trainType.gkg, this.adjust < 0 ? 1.8 : 1.6);
  }
  get protein(){
    const h = this.p.cm/100;
    const refKg = this.bmi > 27 ? 24*h*h : this.p.kg;   // scale off a reference weight
    return Math.round(refKg * this.proteinPerKg);
  }
  get targets(){
    if (!this.known) return { kcal:TARGETS.kcal, p:TARGETS.p, bmi:null, band:'normal' };
    return { kcal:this.calories, p:this.protein, bmi:+this.bmi.toFixed(1),
             band:this.band, goal:this.goal, gkg:this.proteinPerKg,
             act:+this.activity.toFixed(3), bmr:Math.round(this.bmr), tdee:Math.round(this.tdee) };
  }

  // ---- diet ---------------------------------------------------------------
  get allowed(){ return DIETS[this.p.diet || 'nonveg']; }
  eats(meal)   { return this.allowed.includes(meal.diet); }
  filter(list) { const ok = list.filter(m => this.eats(m)); return ok.length ? ok : list; }

  // ---- schedule -----------------------------------------------------------
  worksOn(d)   { return this.workDays.includes(dow(d)); }
  trainsOn(d)  { return this.trainDays.includes(dow(d)); }
  get wantsShake(){ return this.trainDays.length > 0 && this.trainType.shake; }
  get shopDay(){
    const free = [6,5,0,1,2,3,4].find(x => !this.workDays.includes(x));
    return free === undefined ? 6 : free;
  }
  // Every meal time derived from the hours they gave us. Nothing assumed.
  clockFor(d){
    const w = this.p.work || {}, work = this.worksOn(d) && w.out != null;
    const out = work ? w.out : null, back = work ? w.back : null;
    const wake = work ? Math.max(5.5, out - 2.5) : 8;
    const start = this.trainsOn(d) ? (work ? back + 0.75 : 18) : null;
    return { work, out, back, wake,
      sun:    Math.max(6.5, wake + 0.25),
      bf:     wake + 0.75,
      grab:   work ? out - 0.5 : null,
      lunch:  work ? out + 2.5 : 13.5,
      snack:  work ? out + 6   : 17,
      gym:    (start != null && this.trainType.shake) ? start + 1 : null,
      dinner: work ? back + (start != null ? 2 : 1) : (start != null ? 20.5 : 20) };
  }

  // ---- breakfast ----------------------------------------------------------
  get eatsBreakfast(){ return (this.p.bf || 'fixed') !== 'none'; }
  breakfastFor(d){
    const list = this.filter(BREAKFASTS);
    if ((this.p.bf || 'fixed') === 'vary') return list[dayNum(d) % list.length];
    return list.find(b => b.id === (this.p.bfId || 'bf')) || list[0];
  }
}

let U = new UserAlgorithm(S.profile);
const refreshUser = () => { U = new UserAlgorithm(S.profile); };

// thin wrappers so the rest of the app reads naturally
const hasProfile = () => U.known;
const allowed    = () => U.allowed;
const targets    = p => new UserAlgorithm(p).targets;
const TG         = () => U.targets;
const clockOf    = d => U.clockFor(d);
const bfFor      = d => U.breakfastFor(d);

// ---------- RULE 2: swap-learning + RULE 3: no-prep fallback ----------
// RULE 4: diet type filters the library before anything else touches it.
function available(kind){
  const lib = U.filter(kind === 'lunch' ? LUNCH : DINNER);
  let a = lib.filter(m => (S.swaps[m.id]||0) < 3);       // you rejected it 3× → gone
  if (a.length < 3) a = lib.slice();                      // never starve the rotation
  if (S.noPrep){
    const n = a.filter(m => m.noprep);
    if (n.length >= 2) a = n;
  }
  return a;
}

// ---------- RULE 1: perishables land Mon–Wed ----------
function weekPlan(anyDay, kind){
  const lib = available(kind);
  const w   = Math.floor(dayNum(monday(anyDay)) / 7);
  const off = kind === 'lunch' ? 0 : 2;                   // so lunch & dinner don't move in lockstep
  const seq = [];
  for (let i = 0; i < 7; i++) seq.push(lib[(w*7 + i + off) % lib.length]);

  for (let i = 3; i < 7; i++){                            // anything perishable after Wed…
    if (seq[i].perish === 2){
      for (let j = 0; j < 3; j++){                        // …swap into the first non-perishable early slot
        if (seq[j].perish !== 2){ const t = seq[j]; seq[j] = seq[i]; seq[i] = t; break; }
      }
    }
  }
  return seq;
}

function planFor(d, kind){
  const p = S.picks[key(d)];
  if (p && p[kind]){
    const hit = (kind==='lunch'?LUNCH:DINNER).find(m => m.id === p[kind]);
    // a pick saved before a diet change may no longer be edible — ignore it
    if (hit && U.eats(hit)) return hit;
  }
  return weekPlan(d, kind)[dow(d)];
}

const snackFor = d => { const l = U.filter(SNACK); return l[dayNum(d) % l.length]; };
const fruitFor = d => { const b = U.breakfastFor(d); return b.rotate[dayNum(d) % b.rotate.length]; };
const mealAt   = (d,s) => s==='bf' ? bfFor(d) : s==='snack' ? snackFor(d)
                        : s==='gym' ? POSTGYM  : planFor(d, s);

// ---------- the day as a list of ACTIONS ----------
// Walking a real day exposed that the things which break this system are not meals:
// forgetting the packed lunch, frozen chicken, and Sunday prep never surfacing.
// So Now is a timeline of actions, and meals are only one kind of action.
const WORKDAY  = d => U.worksOn(d);
const TRAINDAY = d => U.trainsOn(d);
const thawNeeded = d => !!(planFor(d,'lunch').thaw || planFor(d,'dinner').thaw);

function agenda(d){
  const tm = plus(d,1), a = [];
  const c = U.clockFor(d), ct = U.clockFor(tm), wd = dow(d);

  a.push({t:c.sun, id:'sun', kind:'task', badge:'y', title:'15 minutes of sun',
          sub:'Vitamin D. No Indian diet realistically covers it — this is the free fix.'});

  if (U.eatsBreakfast) a.push({t:c.bf, id:'bf', kind:'meal', slot:'bf'});

  if (c.grab != null)
    a.push({t:c.grab, id:'takelunch', kind:'task', badge:'o', title:'Take your lunch',
            sub:'It is packed, in the fridge. This is the step that gets forgotten.'});

  a.push({t:c.lunch, id:'lunch', kind:'meal', slot:'lunch'});
  a.push({t:c.snack, id:'snack', kind:'meal', slot:'snack'});
  if (c.gym != null) a.push({t:c.gym, id:'gym', kind:'meal', slot:'gym'});
  a.push({t:c.dinner, id:'dinner', kind:'meal', slot:'dinner'});

  // Shop and prep land on their first free day, not a hardcoded Sunday.
  const shopDay = U.shopDay;
  if (wd === shopDay){
    a.push({t:10, id:'shop', kind:'task', badge:'t', go:'shop', title:'Big shop',
            sub:'The whole week depends on this one trip.'});
    a.push({t:12, id:'prep', kind:'task', badge:'t', go:'shop', title:'Batch prep',
            sub:`${PREP.reduce((x,y)=>x+y.m,0)} minutes now buys you five short weeknights.`});
  }
  if (wd === (shopDay + 3) % 7)
    a.push({t:c.work ? c.back + 0.5 : 18, id:'topup', kind:'task', badge:'t', go:'shop',
            title:'Mid-week top-up', sub:'Milk, curd, rotis, greens. Ten minutes.'});

  const night = Math.max(21.5, c.dinner + 1);
  if (thawNeeded(tm))
    a.push({t:night, id:'thaw', kind:'task', badge:'p', title:'Chicken into the fridge',
            sub:'Tomorrow needs it defrosted. Frozen chicken at dinner time is a takeaway order.'});
  if (ct.grab != null)
    a.push({t:night+0.2, id:'pack', kind:'task', badge:'o', title:"Pack tomorrow's lunch",
            sub:`${planFor(tm,'lunch').name} — box it now while the kitchen is already open.`});
  if (U.eatsBreakfast && U.breakfastFor(tm).id === 'bf')
    a.push({t:night+0.4, id:'soak', kind:'task', badge:'y', title:'Soak your oats',
            sub:`${U.breakfastFor(tm).base}<br>${fruitFor(tm)} in the morning.`});

  return a.sort((x,y) => x.t - y.t);
}

const nowH   = () => new Date().getHours() + new Date().getMinutes()/60;
const doneId = (d,id) => !!(S.done[key(d)]||{})[id];

// Show the most recent thing that is due and still undone; otherwise what's next.
function current(d, h){
  const pend = agenda(d).filter(x => !doneId(d, x.id));
  const due  = pend.filter(x => x.t <= h);
  return due.length ? due[due.length-1] : (pend[0] || null);
}

function tick(d, id){
  const k = key(d);
  S.done[k] = S.done[k] || {};
  S.done[k][id] = !S.done[k][id];
  save(); render();
}

// ---------- NOW ----------
const LABEL = { bf:'Breakfast', lunch:'Lunch', snack:'Snack', gym:'Post-gym', dinner:'Dinner' };
const SWAPICO = `<svg><use href="#i-swap"/></svg>`;
const CHEV = `<span class="chev">›</span>`;

const mealById = id => id==='bf' ? BREAKFAST : id==='gym' ? POSTGYM
                     : [...LUNCH, ...DINNER, ...SNACK].find(m => m.id === id);
const recipeId = (d, slot) => slot==='bf' ? 'bf' : slot==='gym' ? 'gym' : mealAt(d, slot).id;

// Swapping is an explicit control, never a side effect of tapping the meal.
function swapMeal(offset, kind){
  const d = plus(today(), offset), k = key(d);
  const cur = planFor(d, kind), lib = available(kind);
  S.swaps[cur.id] = (S.swaps[cur.id]||0) + 1;      // RULE 2: 3 rejections and it's gone
  const i = lib.findIndex(m => m.id === cur.id);
  S.picks[k] = S.picks[k] || {};
  S.picks[k][kind] = lib[(i+1) % lib.length].id;
  save(); render();
}

const sumcard = (to, t1, t2, pill, ok) =>
  `<button class="sumcard" data-sheet="${to}">
     <span class="scb"><span class="sc1">${t1}</span><span class="sc2">${t2}</span></span>
     ${pill ? `<span class="scr${ok?' ok':''}">${pill}</span>` : ''}${CHEV}</button>`;

function agendaRows(d, list){
  return list.map(x => {
    const isMeal = x.kind === 'meal';
    const t = isMeal ? mealAt(d,x.slot).name : x.title;
    const w = isMeal ? LABEL[x.slot] : 'Task';
    const tap = isMeal ? ` data-recipe="${recipeId(d,x.slot)}" style="cursor:pointer"` : '';
    return `<li${tap}><span class="t">${clock(x.t).replace(/ ?[ap]m/,'')}</span>
            <div class="b"><span class="n">${t}</span><span class="w">${w}</span></div>
            ${isMeal ? '<span class="r">›</span>' : ''}</li>`;
  }).join('');
}

// ---------- drawer ----------
// Working memory holds ~4–7 chunks. Anything longer than that lives in here,
// behind one summary card, instead of on the screen.
let sheetState = null;
// Edits are staged here, so abandoning the drawer never half-writes the profile.
let pedit = {};

function readProfile(){
  const g = id => document.getElementById(id);
  if (g('pf-kg'))   pedit.kg   = +g('pf-kg').value   || 0;
  if (g('pf-cm'))   pedit.cm   = +g('pf-cm').value   || 0;
  if (g('pf-age'))  pedit.age  = +g('pf-age').value  || 0;
  if (g('pf-name')) pedit.name = g('pf-name').value.trim();
}

function openSheet(type, arg){
  if (type === 'profile') pedit = { ...(S.profile || {}) };
  sheetState = { type, arg };
  drawSheet();
  document.getElementById('sheet').classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closeSheet(){
  sheetState = null;
  document.getElementById('sheet').classList.remove('on');
  document.body.style.overflow = '';
}

function drawSheet(){
  if (!sheetState) return;
  const d = today(), { type, arg } = sheetState;
  let h = '';

  if (type === 'recipe'){
    const r = RECIPES[arg], m = mealById(arg);
    if (!r || !m) return closeSheet();
    const bits = [];
    if (m.p)    bits.push(`${m.p}g protein`);
    if (m.kcal) bits.push(`${m.kcal} kcal`);
    if (m.mins) bits.push(`${m.mins} min`);
    if (m.cost) bits.push(`₹${m.cost}`);
    h = `<h3>${m.name}</h3>
         <div class="metarow">${bits.map(b=>`<span class="badge w">${b}</span>`).join('')}</div>
         <h2>What you need</h2>
         <ul class="ing">${r.ing.map(i=>`<li>${i}</li>`).join('')}</ul>
         <h2>Method</h2>
         <ol class="stp">${r.steps.map(s=>`<li>${s}</li>`).join('')}</ol>
         ${r.note ? `<div class="tip">${r.note}</div>` : ''}`;
  }

  else if (type === 'list'){
    const [title, list, attr] = arg === 'sunday' ? ['Sunday shop', SHOP_SUNDAY, 'shop']
                              : arg === 'wed'    ? ['Wednesday top-up', SHOP_WED, 'shop']
                              :                    ['Sunday prep', null, 'prep'];
    if (list){
      const got = list.filter(([t]) => S.shop[t]).length;
      h = `<h3>${title}</h3>
           <div class="metarow"><span class="badge w">${got}/${list.length} done</span>
             <span class="badge w">₹${list.reduce((a,x)=>a+x[1],0)}</span></div>
           <ul class="ing" style="padding:2px 16px">${list.map(([t,c,st]) => {
             const on = !!S.shop[t];
             return `<li class="${on?'off':''}" style="align-items:center">
               <button class="chk${on?' on':''}" data-${attr}="${t}"></button>
               <span class="b" style="flex:1"><span class="n">${t}</span>
               ${st ? `<span class="w">Lasts 3–4 weeks — skip if you still have it</span>` : ''}</span>
               <span class="r">₹${c}</span></li>`;
           }).join('')}</ul>`;
    } else {
      const done = PREP.filter((_,i)=>S.prep[i]).length;
      h = `<h3>Sunday prep</h3>
           <div class="metarow"><span class="badge w">${done}/${PREP.length} done</span>
             <span class="badge w">${PREP.reduce((a,x)=>a+x.m,0)} min</span></div>
           <ul class="ing" style="padding:2px 16px">${PREP.map((p,i) => {
             const on = !!S.prep[i];
             return `<li class="${on?'off':''}">
               <button class="chk${on?' on':''}" data-prep="${i}"></button>
               <span class="b" style="flex:1"><span class="n">${p.t}</span>
               <span class="w">${p.n}</span></span>
               <span class="r">${p.m}m</span></li>`;
           }).join('')}</ul>`;
    }
  }

  else if (type === 'week'){
    const mon = monday(d);
    h = `<h3>This week</h3><p class="lede">Tap any day to see what it takes.</p><ul class="ing">`;
    for (let i = 0; i < 7; i++){
      const day = plus(mon,i), me = key(day)===key(d);
      h += `<li style="display:block;${me?'font-weight:700':''}">
              <span class="w" style="margin:0 0 4px">${DAYS[i]}${me?' — today':''}</span>
              <span style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="badge w" data-recipe="${planFor(day,'lunch').id}">${planFor(day,'lunch').name}</button>
                <button class="badge w" data-recipe="${planFor(day,'dinner').id}">${planFor(day,'dinner').name}</button>
              </span></li>`;
    }
    h += `</ul>`;
  }

  else if (type === 'profile'){
    const p = pedit, t = targets(p);
    const BAND = { under:'underweight', normal:'a healthy range', over:'overweight', obese:'obese' };
    const dbtn = (v,l) => `<button class="optbtn${p.diet===v?' on':''}" data-pdiet="${v}">${l}</button>`;
    h = `<div style="display:flex;gap:14px;align-items:center">
           ${p.avatar?`<img class="ava" src="${p.avatar}" alt="">`:''}
           <span><h3 style="margin:0">${p.name||'You'}</h3>
           <p class="lede" style="margin-top:4px">${p.age} · ${p.cm}cm · ${p.kg}kg</p></span>
         </div>
         <div class="panel" style="margin-top:18px;padding:4px 17px">
           <div class="statline"><span>BMI</span><b>${t.bmi} — ${BAND[t.band]}</b></div>
           <div class="statline"><span>Resting burn</span><b>${t.bmr} kcal</b></div>
           <div class="statline"><span>${new UserAlgorithm(p).activityLabel}</span><b>${t.tdee} kcal</b></div>
           <div class="statline"><span>Daily target</span><b>${t.kcal} kcal</b></div>
           <div class="statline"><span>Protein</span><b>${t.p} g @ ${t.gkg}g/kg</b></div>
         </div>
         <h2>Update</h2>
         <div class="two">
           <span class="fw"><span class="unit">Weight (kg)</span>
             <input class="field" id="pf-kg" type="number" inputmode="numeric" value="${p.kg||''}"></span>
           <span class="fw"><span class="unit">Height (cm)</span>
             <input class="field" id="pf-cm" type="number" inputmode="numeric" value="${p.cm||''}"></span>
         </div>
         <span class="unit">Age</span>
         <input class="field" id="pf-age" type="number" inputmode="numeric" value="${p.age||''}">
         <span class="unit">Name</span>
         <input class="field" id="pf-name" value="${p.name||''}" maxlength="24">
         <span class="unit">What you eat</span>
         <div class="opts" style="flex-direction:column">
           ${dbtn('nonveg','Non-vegetarian')}${dbtn('egg','Eggetarian')}${dbtn('veg','Vegetarian')}
         </div>
         <div class="tip">Change your weight and every number above recalculates.
           Changing what you eat re-filters the whole meal library.</div>
         <div class="acts"><button class="btn primary" data-psave="1">Save changes</button></div>
         <h2>Start again</h2>
         <ul class="rows panel">
           <li><div class="b"><span class="n">Redo the setup</span>
             <span class="w">Walks you through the questions again. Your ticks,
             shopping list and learned swaps are kept.</span></div></li>
           <li><div class="b"><span class="n">Delete everything</span>
             <span class="w">Wipes your profile, every tick, the shopping list and
             what the app has learned. Cannot be undone.</span></div></li>
         </ul>
         <div class="acts">
           <button class="btn" data-redo="1">Redo setup</button>
           <button class="btn danger" data-wipe="1">Delete everything</button>
         </div>`;
  }

  else if (type === 'micro'){
    const mon = monday(d), count = {};
    for (let i = 0; i < 7; i++){
      const day = plus(mon,i);
      new Set([...BREAKFAST.micros, ...planFor(day,'lunch').micros,
               ...planFor(day,'dinner').micros, ...snackFor(day).micros])
        .forEach(k => count[k] = (count[k]||0)+1);
    }
    h = `<h3>Micronutrients</h3>
         <p class="lede">Days per week each one is covered. You do not manage this —
           it is built into which meals are in the rotation.</p>
         <div class="chips">${Object.keys(MICROS).map(k =>
           `<span class="chip${(count[k]||0)>=3?' hit':''}">${MICROS[k]}${count[k]?' '+count[k]:''}</span>`
         ).join('')}</div>
         <div class="tip">Vit D stays grey on purpose. No Indian diet realistically covers it —
           that is what the morning sun task is for, and why the blood test matters.</div>`;
  }

  else if (type === 'missed'){
    const ag = agenda(d).filter(x => !doneId(d,x.id) && x.t <= nowH());
    h = `<h3>Still open from earlier</h3>
         <p class="lede">Not a scolding. Tick anything you actually did.</p>
         <ul class="rows panel">${agendaRows(d, ag)}</ul>`;
  }

  else if (type === 'later'){
    const ag = agenda(d).filter(x => !doneId(d,x.id) && x.t > nowH());
    h = `<h3>Rest of today</h3><ul class="rows panel">${agendaRows(d, ag)}</ul>`;
  }

  document.getElementById('sheetin').innerHTML =
    h + `<div class="acts"><button class="btn" data-close="1">Close</button></div>`;
}

// ---------- NOW ----------
function renderNow(){
  const d = today(), h = nowH(), ag = agenda(d), cur = current(d, h);
  const pr = S.profile || {};
  const hello = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  let out = `<div class="phead">
      <span class="hi">${hello}${pr.name ? ', ' + pr.name : ''}</span>
      <button class="pav" data-sheet="profile" aria-label="Your profile">
        ${pr.avatar ? `<img src="${pr.avatar}" alt="">` : (pr.name||'?')[0].toUpperCase()}
      </button></div>`;

  if (!cur){
    const tm = plus(d,1);
    out += `<span class="badge t">Done for today</span>
           <h1 class="display">Everything ticked</h1>
           <p class="lede">Tomorrow: ${planFor(tm,'lunch').name} for lunch,
             ${planFor(tm,'dinner').name} for dinner.</p>
           <div class="acts"><button class="btn" data-go="plan">See tomorrow</button></div>`;
  } else if (cur.kind === 'meal'){
    const m = mealAt(d, cur.slot), late = cur.t <= h;
    const lede = cur.slot==='bf' ? `${BREAKFAST.base}<br>${fruitFor(d)}`
               : cur.slot==='gym' ? POSTGYM.note
               : cur.slot==='snack' ? `${m.kcal} kcal · ${m.p}g protein`
               : m.how;
    const canSwap = cur.slot==='lunch' || cur.slot==='dinner';
    out += `<div class="toprow">
             <span class="badge">${LABEL[cur.slot]} <em style="font-style:normal;opacity:.55">${clock(cur.t)}</em></span>
             ${canSwap ? `<button class="swap" data-swapd="${cur.slot}:0" aria-label="Swap this meal">${SWAPICO}</button>` : ''}
           </div>
           <button class="hero" data-recipe="${recipeId(d, cur.slot)}">
             <h1 class="display">${m.name}</h1>
             <p class="lede">${lede}</p>
             <span class="hint">What you need &amp; how →</span>
           </button>`;
    if (m.tip) out += `<div class="tip">${m.tip}</div>`;
    out += `<div class="acts">
              <button class="btn primary" data-tick="${cur.id}">${late?'Ate it':'Mark done'}</button>
            </div>`;
  } else {
    out += `<span class="badge ${cur.badge||'w'}">${clock(cur.t)}</span>
           <h1 class="display">${cur.title}</h1>
           <p class="lede">${cur.sub}</p>
           <div class="acts">
             <button class="btn primary" data-tick="${cur.id}">Done</button>
             ${cur.go ? `<button class="btn narrow" data-go="${cur.go}">Open list</button>` : ''}
           </div>`;
  }

  const notCur = x => !doneId(d,x.id) && (!cur || x.id !== cur.id);
  const ahead  = ag.filter(x => notCur(x) && x.t >  h);
  const behind = ag.filter(x => notCur(x) && x.t <= h);

  // Only the next two are on screen. The tail goes in the drawer.
  if (ahead.length){
    out += `<h2>Next</h2><ul class="rows panel">${agendaRows(d, ahead.slice(0,2))}</ul>`;
    if (ahead.length > 2)
      out += sumcard('later', 'Rest of today', `${ahead.length - 2} more after that`, `${ahead.length}`);
  }
  if (behind.length)
    out += sumcard('missed', 'Still open from earlier', 'Tick anything you did', `${behind.length}`);

  const ak = S.anchors[key(d)] || {};
  const anch = ANCHORS.filter(a => a.id !== 'a1');   // sun lives on the timeline now
  const got  = anch.filter(a => ak[a.id]).length;
  out += `<div class="hdr"><h2>All day</h2><span>${got}/${anch.length}</span></div>
          <ul class="rows panel">${anch.map(a =>
            `<li class="${ak[a.id]?'off':''}" style="align-items:center">
               <button class="chk${ak[a.id]?' on':''}" data-anchor="${a.id}"></button>
               <span class="n" style="flex:1">${a.text}</span></li>`).join('')}</ul>`;

  document.getElementById('now').innerHTML = out;
}

// ---------- PLAN ----------
function renderPlan(){
  const d = today(), tm = plus(d,1);
  const row = (label, m, kind) => `
    <div class="pick">
      <button class="pickmain" data-recipe="${m.id}">
        <span class="on1">${m.name}</span>
        <span class="on2">${label} · ${m.kcal} kcal · ${m.p}g protein</span>
      </button>
      ${kind ? `<button class="swap" data-swapd="${kind}:1" aria-label="Swap ${kind}">${SWAPICO}</button>` : ''}
    </div>`;

  const L = planFor(tm,'lunch'), D = planFor(tm,'dinner'), SN = snackFor(tm);
  const kcal = BREAKFAST.kcal + L.kcal + SN.kcal + POSTGYM.kcal + D.kcal;
  const prot = BREAKFAST.p    + L.p    + SN.p    + POSTGYM.p    + D.p;

  let h = `<span class="badge o">Decide tonight</span>
           <h1 class="display">${fmt(tm)}</h1>
           <p class="lede">Everything you will eat tomorrow, in order.</p>
           ${row('Breakfast', BREAKFAST, null)}
           ${row('Lunch', L, 'lunch')}
           ${row('Snack · 5pm', SN, null)}
           ${row('Post-gym', POSTGYM, null)}
           ${row('Dinner', D, 'dinner')}
           <div class="sum"><span>Whole day</span><b>${kcal} kcal · ${prot}g</b></div>`;

  const t = TG();
  const gymKcal = BREAKFAST.kcal + L.kcal + POSTGYM.kcal + D.kcal;   // smoothie instead of snack
  const gap = t.kcal - gymKcal;
  h += `<div class="sum"><span>Your target</span><b>${t.kcal} kcal · ${t.p}g</b></div>
        <p class="note"><b>On gym days, skip the 5pm snack</b> — the smoothie replaces it,
        leaving ${gymKcal} kcal.
        ${Math.abs(gap) < 120 ? 'That lands on your target.'
          : gap > 0 ? `That is ${gap} kcal under target — add a glass of milk or an extra roti.`
                    : `That is ${-gap} kcal over target — drop the peanut butter at breakfast.`}
        Protein clears your ${t.p}g either way.</p>`;

  h += `<h2>Zoom out</h2>
        ${sumcard('week', 'This week', 'All 7 days, lunch and dinner', '7')}
        ${sumcard('micro', 'Micronutrients', 'Covered automatically by the rotation', '11/12', true)}`;

  document.getElementById('plan').innerHTML = h;
}

// ---------- SHOP ----------
function renderShop(){
  const sum = l => l.reduce((a,x)=>a+x[1],0);
  const sunGot = SHOP_SUNDAY.filter(([t]) => S.shop[t]).length;
  const wedGot = SHOP_WED.filter(([t]) => S.shop[t]).length;
  const prpGot = PREP.filter((_,i) => S.prep[i]).length;

  let h = `<span class="badge t">Groceries</span>
           <h1 class="display">Two trips a week</h1>
           <p class="lede">Big shop Sunday, perishables Wednesday. Tap one to open the list.</p>
           ${sumcard('list:sunday', 'Sunday shop',
             `${SHOP_SUNDAY.length} items · ₹${sum(SHOP_SUNDAY)}`,
             `${sunGot}/${SHOP_SUNDAY.length}`, sunGot===SHOP_SUNDAY.length)}
           ${sumcard('list:wed', 'Wednesday top-up',
             `${SHOP_WED.length} items · ₹${sum(SHOP_WED)}`,
             `${wedGot}/${SHOP_WED.length}`, wedGot===SHOP_WED.length)}
           ${sumcard('list:prep', 'Sunday prep',
             `${PREP.reduce((a,x)=>a+x.m,0)} min of batch cooking`,
             `${prpGot}/${PREP.length}`, prpGot===PREP.length)}`;

  h += `<h2>If Sunday didn't happen</h2>
        <ul class="rows panel"><li style="align-items:center">
          <button class="chk${S.noPrep?' on':''}" data-noprep="1"></button>
          <span class="b"><span class="n">No-prep mode</span>
          <span class="w">Only meals you can cook from shelf-stable ingredients in
          under 20 minutes.</span></span></li></ul>`;

  // The list total double-counts: 8 of the Sunday items last 3–4 weeks, so summing
  // the whole list every week roughly doubles the real figure.
  const staples = SHOP_SUNDAY.filter(x => x[2]).reduce((a,x) => a+x[1], 0);
  const perish  = sum(SHOP_SUNDAY) - staples + sum(SHOP_WED);
  const steady  = Math.round(perish + staples/4);
  h += `<p class="note">First Sunday is the expensive one — <b>₹${staples}</b> of that list
        (rice, oats, peanut butter, flaxseed, dal, soya, peanuts, oil) lasts 3–4 weeks.
        After that a normal week is about <b>₹${steady}</b>
        (~₹${Math.round(steady*4.3).toLocaleString('en-IN')}/month), plus ₹2,500 whey.
        You were spending closer to ₹11,000 eating out.</p>
        <div class="acts"><button class="btn" data-reset="1">Reset all ticks</button></div>`;

  document.getElementById('shop').innerHTML = h;
}

// ---------- onboarding ----------
// One question per screen. Typeform's pattern: low cognitive load, obvious progress.
let ob = { step:0, draft:{ gender:'m', diet:'nonveg', goal:'lean', bf:'fixed',
                           work:{ days:[0,1,2,3,4], out:10, back:18 },
                           train:{ days:[0,1,2,3,4], type:'weights' } } };
const OB_STEPS = 10;   // 9 questions + the summary
const DAYLBL = ['M','T','W','T','F','S','S'];

// Day pickers for work and training — a count can't tell us whether TODAY is a gym day.
const dayRow = (scope, sel) => `<div class="days">${DAYLBL.map((l,i)=>
  `<button class="day${sel.includes(i)?' on':''}" data-obday="${scope}:${i}">${l}</button>`).join('')}</div>`;

/* A fresh cartoon avatar every time the app opens.
   Licensed characters (Pokemon, Scooby-Doo, Simpsons and friends) are owned by their
   studios, so these are generated instead — twelve distinct cartoon art styles, which
   gives the same "who am I today" feeling without shipping someone else's artwork. */
const AV_STYLES = {
  m: ['adventurer','avataaars','big-smile','micah','open-peeps','personas',
      'notionists','croodles','miniavs','pixel-art','fun-emoji','bottts'],
  f: ['adventurer','avataaars','big-smile','lorelei','open-peeps','personas',
      'notionists','croodles','miniavs','pixel-art','fun-emoji','bottts']
};
const AV_BG = 'ffe711,ff7f4a,c994ff,45ad94,f6e1a8';

async function fetchAvatar(name, gender, roll){
  const pool  = AV_STYLES[gender === 'f' ? 'f' : 'm'];
  const style = pool[Math.floor(Math.random() * pool.length)];
  // gender is baked into the seed so a given style stays consistent per person
  const seed  = `${name || 'plate'}-${gender || 'm'}-${roll != null ? roll : Math.floor(Math.random()*1e6)}`;
  try {
    const r = await fetch(`https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${AV_BG}`);
    if (!r.ok) return '';
    const svg = await r.text();
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  } catch { return ''; }        // offline: keep whatever we already had
}

// Re-roll on every launch, but only replace the stored one once the new art arrives,
// so an offline start still shows yesterday's face instead of an empty circle.
async function rerollAvatar(){
  if (!hasProfile()) return;
  const next = await fetchAvatar(S.profile.name, S.profile.gender);
  if (!next) return;
  S.profile.avatar = next;
  save();
  if (tab === 'now') renderNow();
}

// Original motifs in the house style — quill, hourglass, scales, cauldron, owl.
const MOTIF = {
  quill:`<svg class="motif" viewBox="0 0 48 48"><path class="fill3" d="M10 38c6-20 18-27 28-28-1 14-9 24-22 27z"/><path d="M10 38c6-20 18-27 28-28-1 14-9 24-22 27z"/><path d="M8 40l10-9"/><path d="M22 22c-4 3-7 7-9 12"/></svg>`,
  hourglass:`<svg class="motif" viewBox="0 0 48 48"><path d="M14 6h20M14 42h20"/><path class="fill" d="M16 6c0 10 8 12 8 18s-8 8-8 18h16c0-10-8-12-8-18s8-8 8-18z"/><path d="M16 6c0 10 8 12 8 18s-8 8-8 18h16c0-10-8-12-8-18s8-8 8-18z"/></svg>`,
  scales:`<svg class="motif" viewBox="0 0 48 48"><path d="M24 10v30M14 40h20M10 18h28"/><circle cx="24" cy="12" r="3" class="fill2"/><path class="fill4" d="M4 18l6 12h-12z" transform="translate(6 0)"/><path class="fill4" d="M32 18l6 12h-12z"/></svg>`,
  cauldron:`<svg class="motif" viewBox="0 0 48 48"><path class="fill4" d="M9 22h30c0 11-6 17-15 17s-15-6-15-17z"/><path d="M9 22h30c0 11-6 17-15 17s-15-6-15-17z"/><path d="M6 22h36"/><path d="M18 15c0-4 4-3 4-7M27 16c0-3 3-3 3-6"/></svg>`,
  owl:`<svg class="motif" viewBox="0 0 48 48"><path class="fill" d="M24 8c9 0 15 7 15 16s-6 17-15 17S9 33 9 24 15 8 24 8z"/><path d="M24 8c9 0 15 7 15 16s-6 17-15 17S9 33 9 24 15 8 24 8z"/><circle cx="18" cy="21" r="4"/><circle cx="30" cy="21" r="4"/><path class="fill2" d="M24 26l-3 4h6z"/><path d="M12 10l4 5M36 10l-4 5"/></svg>`
};
const SPARK_POS = [[78,5],[12,14],[89,24],[6,36],[70,44],[22,58],[84,63],[9,72],[52,8],[38,80],[93,46],[16,92]];
const SPARKS = `<div class="sparks">${SPARK_POS.map(([x,y],i)=>
  `<span class="sp" style="left:${x}%;top:${y}%;animation-delay:${(i*0.42).toFixed(2)}s"></span>`).join('')}</div>`;

/* The onigiri from the app icon, as a companion through onboarding. Same character
   every step, different face — so the flow feels like someone is walking you through
   it rather than a form paginating. */
const FACES = {
  hi:      { eyes:'<ellipse cx="86" cy="96" rx="7" ry="10"/><ellipse cx="128" cy="96" rx="7" ry="10"/>',
             mouth:'<path d="M97 116c5 5 12 5 17 0"/>' },
  think:   { eyes:'<path d="M79 96h14"/><ellipse cx="128" cy="96" rx="7" ry="10"/>',
             mouth:'<path d="M98 118h16"/>' },
  measure: { eyes:'<ellipse cx="86" cy="94" rx="8" ry="11"/><ellipse cx="128" cy="94" rx="8" ry="11"/>',
             mouth:'<path d="M99 116c4 6 11 6 15 0"/>' },
  happy:   { eyes:'<path d="M78 98c5-8 13-8 17 0"/><path d="M119 98c5-8 13-8 17 0"/>',
             mouth:'<path d="M94 112c8 11 22 11 27 0"/>' },
  hungry:  { eyes:'<ellipse cx="86" cy="94" rx="8" ry="11"/><ellipse cx="128" cy="94" rx="8" ry="11"/>',
             mouth:'<ellipse cx="107" cy="118" rx="11" ry="9" fill="#111827"/>' },
  strong:  { eyes:'<path d="M78 92l16 6" /><path d="M136 92l-16 6"/>',
             mouth:'<path d="M95 114c8 9 20 9 26 0"/>' },
  sleepy:  { eyes:'<path d="M78 97h15"/><path d="M120 97h15"/>',
             mouth:'<ellipse cx="107" cy="117" rx="6" ry="8" fill="#111827"/>' }
};
const MASCOT = (face='hi', fill='var(--yellow)') => {
  const f = FACES[face] || FACES.hi;
  return `<svg class="mascot" viewBox="0 0 214 190" aria-hidden="true">
    <path d="M107 14c9 0 17 5 21 13l64 120c6 11-2 25-15 25H37c-13 0-21-14-15-25L86 27c4-8 12-13 21-13z"
          fill="${fill}" stroke="#000" stroke-width="7" stroke-linejoin="round"/>
    <path d="M62 132h90l14 26c3 6-1 14-9 14H57c-8 0-12-8-9-14z"
          fill="#111827" stroke="#000" stroke-width="7" stroke-linejoin="round"/>
    <g fill="#111827" stroke="#111827" stroke-width="5" stroke-linecap="round">${f.eyes}</g>
    <g fill="none" stroke="#111827" stroke-width="5" stroke-linecap="round">${f.mouth}</g>
    <ellipse cx="62" cy="112" rx="9" ry="6" fill="#ff7f4a" opacity=".9"/>
    <ellipse cx="152" cy="112" rx="9" ry="6" fill="#ff7f4a" opacity=".9"/>
  </svg>`;
};
// Each step owns a colour, so progress is felt and not just counted.
const STEP_LOOK = [
  { face:'hi',      tint:'#ffe711' }, { face:'think',   tint:'#c994ff' },
  { face:'measure', tint:'#45ad94' }, { face:'happy',   tint:'#ff7f4a' },
  { face:'hungry',  tint:'#ffe711' }, { face:'strong',  tint:'#c994ff' },
  { face:'think',   tint:'#45ad94' }, { face:'strong',  tint:'#ff7f4a' },
  { face:'sleepy',  tint:'#ffe711' }, { face:'happy',   tint:'#45ad94' }
];

function renderOb(){
  const d = ob.draft, s = ob.step;
  const dots = `<div class="obtop">
      <div class="dots">${[...Array(OB_STEPS)].map((_,i)=>
        `<span class="dot${i<=s?' on':''}"></span>`).join('')}</div>
      <span class="stepno">${s+1} of ${OB_STEPS}</span></div>`;
  // echo back what's already known so the flow reads as cumulative, not a form
  const known = [];
  if (s > 0 && d.name) known.push(d.name);
  if (s > 1) known.push(d.gender === 'm' ? 'Male' : 'Female');
  if (s > 2 && d.age) known.push(d.age + ' yrs');
  if (s > 3 && d.cm)  known.push(`${d.cm}cm · ${d.kg}kg`);
  if (s > 4) known.push({nonveg:'Non-veg', egg:'Eggetarian', veg:'Vegetarian'}[d.diet]);
  if (s > 5) known.push({lean:'Leaning out', maintain:'Maintaining', build:'Building'}[d.goal]);
  if (s > 6) known.push(d.work.days.length ? `Out ${d.work.days.length}d/wk` : 'No fixed hours');
  if (s > 7) known.push(d.train.days.length
      ? `${d.train.days.length}× ${TRAIN_TYPES[d.train.type].label.toLowerCase()}` : 'No training');
  const sofar = known.length && s < OB_STEPS - 1
    ? `<div class="sofar">${known.map(k=>`<span>${k}</span>`).join('')}</div>` : '';
  const pick = (field, val, label, sub) =>
    `<button class="optbtn${d[field]===val?' on':''}" data-ob="${field}:${val}">${label}
       ${sub?`<small>${sub}</small>`:''}</button>`;
  let h = '', next = 'Continue', can = true;

  if (s === 0){
    h += `<h1 class="display">Every recipe starts with a name.</h1>
          <p class="lede">Yours goes on the front of the book.</p>
          <input class="field" id="obname" placeholder="Write it here" value="${d.name||''}"
                 autocomplete="off" maxlength="24">`;
    can = true;
  }
  else if (s === 1){
    h += `<h1 class="display">${d.name ? d.name + ', a quick sorting.' : 'A quick sorting.'}</h1>
          <p class="lede">This changes the arithmetic behind your numbers, not the food on your plate.</p>
          <div class="opts">${pick('gender','m','Male')}${pick('gender','f','Female')}</div>`;
  }
  else if (s === 2){
    h += `<h1 class="display">How many years have you got?</h1>
          <p class="lede">The sand runs a little slower each year — so the maths adjusts,
            and the protein target shifts again after sixty.</p>
          <input class="field" id="obage" type="number" inputmode="numeric"
                 placeholder="24" value="${d.age||''}" min="14" max="99">`;
    can = !!d.age;
  }
  else if (s === 3){
    h += `<h1 class="display">Two measurements.</h1>
          <p class="lede">Everything else — your burn, your target, your portions — is conjured from these.</p>
          <div class="two">
            <span class="fw"><span class="unit">Height (cm)</span>
              <input class="field" id="obcm" type="number" inputmode="numeric"
                     placeholder="157" value="${d.cm||''}" min="120" max="220"></span>
            <span class="fw"><span class="unit">Weight (kg)</span>
              <input class="field" id="obkg" type="number" inputmode="numeric"
                     placeholder="60" value="${d.kg||''}" min="30" max="200"></span>
          </div>`;
    can = !!(d.cm && d.kg);
  }
  else if (s === 4){
    h += `<h1 class="display">What goes in the pot?</h1>
          <p class="lede">This filters the entire library — not a label, an actual change
            to which meals exist for you.</p>
          <div class="opts" style="flex-direction:column">
            ${pick('diet','nonveg','Non-vegetarian','Chicken, eggs, dairy — the full rotation')}
            ${pick('diet','egg','Eggetarian','Eggs and dairy, no meat')}
            ${pick('diet','veg','Vegetarian','Paneer, soya, dal, curd')}
          </div>`;
  }
  else if (s === 5){
    h += `<h1 class="display">What are you actually after?</h1>
          <p class="lede">This sets the direction of the whole plan.</p>
          <div class="opts" style="flex-direction:column">
            ${pick('goal','lean','Lean out','Hold muscle, lose fat')}
            ${pick('goal','maintain','Stay as I am','Eat well, no change')}
            ${pick('goal','build','Build muscle','A deliberate surplus')}
          </div>`;
  }
  else if (s === 6){
    const w = d.work;
    h += `<h1 class="display">When are you out of the house?</h1>
          <p class="lede">Meal times are built from this. Leave every day off if you
            are not on a fixed schedule.</p>
          <span class="unit">Days you go out</span>
          ${dayRow('work', w.days)}
          <div class="two" style="margin-top:14px">
            <span class="fw"><span class="unit">Leave at</span>
              <input class="field" id="ob-out" type="number" step="0.5" inputmode="decimal"
                     value="${w.out}" min="0" max="23"></span>
            <span class="fw"><span class="unit">Home by</span>
              <input class="field" id="ob-back" type="number" step="0.5" inputmode="decimal"
                     value="${w.back}" min="1" max="24"></span>
          </div>`;
  }
  else if (s === 7){
    const t = d.train;
    h += `<h1 class="display">Do you train?</h1>
          <p class="lede">Tap none if you don't — nothing here assumes you do.</p>
          <span class="unit">Days you train</span>
          ${dayRow('train', t.days)}
          ${t.days.length ? `<span class="unit">What kind</span>
          <div class="opts" style="flex-direction:column">
            ${Object.entries(TRAIN_TYPES).map(([k,v]) =>
              `<button class="optbtn${t.type===k?' on':''}" data-obtype="${k}">${v.label}
                 <small>${v.sub}</small></button>`).join('')}
          </div>` : ''}`;
  }
  else if (s === 8){
    h += `<h1 class="display">Breakfast?</h1>
          <p class="lede">Plenty of people skip it. That is a valid answer.</p>
          <div class="opts" style="flex-direction:column">
            ${pick('bf','fixed','The same thing daily','Least thinking. Overnight oats by default')}
            ${pick('bf','vary','Mix it up','Rotates through what your diet allows')}
            ${pick('bf','none','I skip breakfast','The day starts at lunch')}
          </div>`;
    next = 'Read my numbers';
  }
  else {
    const t = targets(d);
    const BAND = { under:'underweight', normal:'a healthy range', over:'overweight', obese:'obese' };
    const GOAL = { under:'a small surplus to gain', normal:'a mild deficit to lean out while holding muscle',
                   over:'a moderate deficit', obese:'a firm deficit' };
    h += `<div style="display:flex;gap:15px;align-items:center">
            ${d.avatar?`<img class="ava" src="${d.avatar}" alt="">`:''}
            <span><h1 class="display" style="margin:0">${d.name||'You'}</h1>
            <p class="lede" style="margin-top:6px">${d.age} · ${d.cm}cm · ${d.kg}kg</p></span>
          </div>
          <p class="lede" style="margin-top:16px">The owl's been. Here is what it brought.</p>
          <div class="panel" style="margin-top:20px;padding:4px 17px">
            <div class="statline"><span>BMI</span><b>${t.bmi} — ${BAND[t.band]}</b></div>
            <div class="statline"><span>Resting burn (BMR)</span><b>${t.bmr} kcal</b></div>
            <div class="statline"><span>${new UserAlgorithm(d).activityLabel}</span><b>${t.tdee} kcal</b></div>
            <div class="statline"><span>Your daily target</span><b>${t.kcal} kcal</b></div>
            <div class="statline"><span>Protein</span><b>${t.p} g</b></div>
          </div>
          <div class="tip">That target is ${GOAL[t.band]}. Protein is ${t.gkg} g/kg — research
            shows gains plateau above ~1.6, so more is not better. Estimates, not medical advice.</div>`;
    next = 'Start';
  }

  const acts = `<div class="acts">
          ${s>0?`<button class="btn narrow" data-obback="1">Back</button>`:''}
          <button class="btn primary" data-obnext="1"${can?'':' disabled style="opacity:.45"'}>${next}</button>
        </div>`;
  // dots pinned top, question block centred, action anchored bottom
  const look = STEP_LOOK[s] || STEP_LOOK[0];
  document.getElementById('ob').innerHTML =
    `<div class="wash" style="background:${look.tint}"></div>` + SPARKS + dots +
    `<div class="obmid">${MASCOT(look.face, look.tint)}${sofar}${h}</div>` + acts;
}

function obRead(){
  const g = id => document.getElementById(id);
  if (g('obname')) ob.draft.name = g('obname').value.trim();
  if (g('obage'))  ob.draft.age  = +g('obage').value || 0;
  if (g('obcm'))   ob.draft.cm   = +g('obcm').value  || 0;
  if (g('obkg'))   ob.draft.kg   = +g('obkg').value  || 0;
  if (g('ob-out')) ob.draft.work.out  = +g('ob-out').value;
  if (g('ob-back'))ob.draft.work.back = +g('ob-back').value;
}

async function obNext(){
  obRead();
  if (ob.step === OB_STEPS - 2){             // fetch the avatar before the summary
    ob.step = OB_STEPS - 1; renderOb();
    ob.draft.avatar = await fetchAvatar(ob.draft.name, ob.draft.gender);
    return renderOb();
  }
  if (ob.step === OB_STEPS - 1){
    S.profile = { ...ob.draft };
    save();
    document.getElementById('s-ob').classList.remove('on');
    document.querySelector('nav').style.display = '';
    document.body.classList.remove('ob');
    return show('now');
  }
  ob.step++; renderOb();
}

function startOnboarding(){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  document.getElementById('s-ob').classList.add('on');
  document.querySelector('nav').style.display = 'none';
  document.body.classList.add('ob');       // nav is hidden, so drop its bottom padding
  renderOb();
}

// ---------- events ----------
// Single source of truth for every clickable data-attribute. Add a handler below,
// add its key here, or it will never fire.
const ACTIONS = ['ob','obnext','obback','obday','obtype','pdiet','psave','redo','wipe','tick','swapd','recipe','sheet',
                 'close','anchor','shop','prep','noprep','reset','go','t'];
const ACTION_SEL = ACTIONS.map(k => `[data-${k}]`).join(',');

document.addEventListener('click', e => {
  // Generated from ACTIONS, not hand-written: twice now I added a handler and forgot
  // to extend a hand-maintained selector string, so the button silently did nothing.
  const t = e.target.closest(ACTION_SEL);
  if (!t) return;
  const d = today(), k = key(d);

  if (t.dataset.ob){
    const [f, v] = t.dataset.ob.split(':');
    obRead(); ob.draft[f] = v; renderOb();
    return;
  }
  if (t.dataset.obday){
    const [scope, i] = t.dataset.obday.split(':'), n = +i;
    obRead();
    const days = ob.draft[scope].days;
    const at = days.indexOf(n);
    if (at === -1) days.push(n); else days.splice(at, 1);
    days.sort((a,b) => a-b);
    return renderOb();
  }
  if (t.dataset.obtype){ obRead(); ob.draft.train.type = t.dataset.obtype; return renderOb(); }
  if (t.dataset.obnext) return obNext();
  if (t.dataset.obback){ obRead(); ob.step = Math.max(0, ob.step-1); return renderOb(); }

  // Capture typed values first — changing diet redraws the drawer and would
  // otherwise discard whatever weight you had just entered.
  if (t.dataset.pdiet){ readProfile(); pedit.diet = t.dataset.pdiet; return drawSheet(); }
  if (t.dataset.psave){
    readProfile();
    if (!pedit.kg || !pedit.cm || !pedit.age) return;   // ignore an incomplete save
    S.profile = { ...S.profile, ...pedit };
    save(); closeSheet(); return render();
  }

  if (t.dataset.redo){
    if (!confirm('Go through the setup questions again? Your ticks and lists are kept.')) return;
    ob = { step:0, draft:{ ...(S.profile || {}) } };
    closeSheet(); return startOnboarding();
  }
  if (t.dataset.wipe){
    if (!confirm('Delete your profile and everything the app has stored? This cannot be undone.')) return;
    if (!confirm('Really delete everything? There is no way back.')) return;
    localStorage.removeItem('plate');
    S = DEF(); refreshUser();
    ob = { step:0, draft:{ gender:'m', diet:'nonveg', goal:'lean', bf:'fixed',
                           work:{ days:[0,1,2,3,4], out:10, back:18 },
                           train:{ days:[0,1,2,3,4], type:'weights' } } };
    closeSheet(); return startOnboarding();
  }

  if (t.dataset.close)  return closeSheet();
  if (t.dataset.recipe) return openSheet('recipe', t.dataset.recipe);
  if (t.dataset.sheet){
    const [type, arg] = t.dataset.sheet.split(':');
    return openSheet(type, arg);
  }
  if (t.dataset.swapd){
    const [kind, off] = t.dataset.swapd.split(':');
    return swapMeal(+off, kind);
  }
  if (t.dataset.t || t.dataset.go){ closeSheet(); return show(t.dataset.t || t.dataset.go); }
  if (t.dataset.tick) return tick(d, t.dataset.tick);

  if (t.dataset.anchor){
    S.anchors[k] = S.anchors[k] || {};
    S.anchors[k][t.dataset.anchor] = !S.anchors[k][t.dataset.anchor];
    save(); return render();
  }
  if (t.dataset.shop){ S.shop[t.dataset.shop] = !S.shop[t.dataset.shop]; save(); return render(); }
  if (t.dataset.prep){ S.prep[t.dataset.prep] = !S.prep[t.dataset.prep]; save(); return render(); }
  if (t.dataset.noprep){ S.noPrep = !S.noPrep; save(); return render(); }
  if (t.dataset.reset && confirm('Clear all ticks and learned swaps?')){ S = DEF(); save(); render(); }
});

// ---------- shell ----------
let tab = 'now';
function show(n){
  tab = n;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 's-'+n));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === n));
  window.scrollTo(0,0);
  render();
}
function render(){
  if (tab === 'now')  renderNow();
  if (tab === 'plan') renderPlan();
  if (tab === 'shop') renderShop();
  drawSheet();          // ticking a box inside the drawer must update the drawer too
}

// Re-enable Continue as you type. A full re-render here would steal focus mid-word,
// so only the button's state is touched.
document.addEventListener('input', e => {
  if (!e.target.closest('#ob')) return;
  obRead();
  const d = ob.draft, s = ob.step;
  const okNow = s === 2 ? !!d.age : s === 3 ? !!(d.cm && d.kg) : true;
  const btn = document.querySelector('[data-obnext]');
  if (btn){ btn.disabled = !okNow; btn.style.opacity = okNow ? '' : '.45'; }
});

// Enter key advances the flow — typing a name then reaching for a button is friction.
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('s-ob').classList.contains('on')) obNext();
  if (e.key === 'Escape') closeSheet();
});
// First install goes straight to onboarding; everyone else lands on Now.
if (hasProfile()){ render(); rerollAvatar(); } else startOnboarding();

setInterval(() => { if (tab === 'now') renderNow(); }, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
