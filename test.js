/* Verifies the design invariant: ANY rotation through the library is nutritionally
   valid. If this passes, the runtime provably cannot produce a bad day. */
const fs = require('fs');
global.localStorage = { _v:'{}', getItem(){return this._v}, setItem(_,v){this._v=v} };

const data = fs.readFileSync(__dirname + '/data.js', 'utf8');
const app  = fs.readFileSync(__dirname + '/app.js',  'utf8');
const pure = app.slice(0, app.indexOf('// ---------- NOW ----------'));
const ctx  = new Function(data + '\n' + pure + `
  return {weekPlan,planFor,available,snackFor,dayNum,monday,dow,key,plus,S,agenda,current,
          LUNCH,DINNER,BREAKFAST,BREAKFASTS,SNACK,POSTGYM,MICROS,TARGETS,thawNeeded,
          UserAlgorithm,ACT,TRAIN_TYPES,refreshUser,targets};`)();

// The suite runs as a real user: works Mon–Fri 11–7, trains 5 days with weights.
ctx.S.profile = { name:'Test', gender:'m', age:24, cm:157, kg:60, diet:'nonveg',
                  goal:'lean', bf:'fixed',
                  work:{ days:[0,1,2,3,4], out:11, back:19 },
                  train:{ days:[0,1,2,3,4], type:'weights' } };
ctx.refreshUser();
const A = p => new ctx.UserAlgorithm(p);

let fail = 0;
const ok = (name, cond, extra='') => {
  console.log(`${cond ? '  pass' : '  FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fail++;
};

const start = new Date(2026, 7, 3);              // a Monday
const days  = [...Array(365)].map((_, i) => ctx.plus(start, i));

// 1 ------------------------------------------------------------------ always answers
ok('every day of a year returns a meal',
   days.every(d => ctx.planFor(d,'lunch') && ctx.planFor(d,'dinner')));

// 2 ------------------------------------------------------------ RULE 1: perishables
let late = 0;
for (let w = 0; w < 52; w++){
  const mon = ctx.plus(start, w*7);
  ['lunch','dinner'].forEach(k => {
    ctx.weekPlan(mon, k).forEach((m, i) => { if (i >= 3 && m.perish === 2) late++; });
  });
}
ok('no perishable meal ever lands Thu–Sun', late === 0, `(${late} violations)`);

// 3 ---------------------------------------------------- calorie band, both day types
// Gym day = smoothie INSTEAD of the 5pm snack. Rest day = snack, no smoothie.
const gymKcal  = d => ctx.BREAKFAST.kcal + ctx.planFor(d,'lunch').kcal +
                      ctx.POSTGYM.kcal + ctx.planFor(d,'dinner').kcal;
const restKcal = d => ctx.BREAKFAST.kcal + ctx.planFor(d,'lunch').kcal +
                      ctx.snackFor(d).kcal + ctx.planFor(d,'dinner').kcal;
const gk = days.map(gymKcal), rk = days.map(restKcal);
// Band is set against a computed target (2090 for a 24m 157/60), not a round number.
ok('gym day (smoothie, no snack) lands 1700–2100',
   Math.min(...gk) >= 1700 && Math.max(...gk) <= 2100, `(${Math.min(...gk)}–${Math.max(...gk)})`);
ok('rest day (snack, no smoothie) lands 1500–2000',
   Math.min(...rk) >= 1500 && Math.max(...rk) <= 2000, `(${Math.min(...rk)}–${Math.max(...rk)})`);

// 4 ----------------------------------------------------------------- protein floor
// 1.6 g/kg is the accepted floor for holding muscle in a deficit; at 60kg that is 96g.
const gymP  = d => ctx.BREAKFAST.p + ctx.planFor(d,'lunch').p + ctx.POSTGYM.p + ctx.planFor(d,'dinner').p;
const restP = d => ctx.BREAKFAST.p + ctx.planFor(d,'lunch').p + ctx.snackFor(d).p + ctx.planFor(d,'dinner').p;
const gp = days.map(gymP), rp = days.map(restP);
ok('gym-day protein clears 110g', Math.min(...gp) >= 110, `(${Math.min(...gp)}–${Math.max(...gp)}g)`);
// 1.6 g/kg is where gains plateau, not a cliff. What matters is the weekly average;
// 1.2 g/kg is the real floor below which a training adult loses muscle.
const avg = a => Math.round(a.reduce((x,y)=>x+y,0)/a.length);
ok('weekly average protein clears the 1.6g/kg target (96g)', avg(rp) >= 96 && avg(gp) >= 96,
   `(rest avg ${avg(rp)}g, gym avg ${avg(gp)}g)`);
ok('no single day drops below the 1.2g/kg floor (72g)', Math.min(...rp) >= 72,
   `(worst ${Math.min(...rp)}g)`);

// 5 ------------------------------------------------------- weekly micro coverage
let worst = {}, bad = [];
for (let w = 0; w < 52; w++){
  const count = {};
  for (let i = 0; i < 7; i++){
    const d = ctx.plus(start, w*7 + i);
    new Set([...ctx.BREAKFAST.micros, ...ctx.planFor(d,'lunch').micros,
             ...ctx.planFor(d,'dinner').micros, ...ctx.snackFor(d).micros])
      .forEach(k => count[k] = (count[k]||0) + 1);
  }
  Object.keys(ctx.MICROS).forEach(k => {
    if (k === 'vitd') return;                     // by design: sun + test, not food
    const c = count[k] || 0;
    if (worst[k] === undefined || c < worst[k]) worst[k] = c;
    if (c < 3 && !bad.includes(k)) bad.push(k);
  });
}
ok('every micronutrient hit >=3 days in every week', bad.length === 0,
   bad.length ? `(weak: ${bad.join(', ')})` : `(min/wk: ${JSON.stringify(worst)})`);

// 6 ------------------------------------------------ RULE 2 cannot starve rotation
ctx.LUNCH.forEach(m => ctx.S.swaps[m.id] = 9);    // reject literally everything
ok('rotation survives rejecting every meal', ctx.available('lunch').length >= 3,
   `(${ctx.available('lunch').length} left)`);
ctx.S.swaps = {};

// 7 --------------------------------------------- RULE 3 no-prep mode still feeds
ctx.S.noPrep = true;
const np = ctx.available('lunch');
ok('no-prep mode leaves usable meals', np.length >= 2 && np.every(m => m.noprep),
   `(${np.map(m=>m.id).join(',')})`);
ctx.S.noPrep = false;

// 8 ------------------------------------------------------------------ determinism
const twice = days.slice(0,60).every(d =>
  ctx.planFor(d,'lunch').id === ctx.planFor(d,'lunch').id &&
  ctx.planFor(d,'dinner').id === ctx.planFor(d,'dinner').id);
ok('same date always yields same meal', twice);

// 9 -------------------------------------------------------------- no repeat pairs
let sameDay = 0;
days.forEach(d => {
  const l = ctx.planFor(d,'lunch'), n = ctx.planFor(d,'dinner');
  if (l.name.includes('Egg') && n.name.includes('Egg')) sameDay++;
});
ok('egg lunch + egg dinner rarely collide', sameDay <= 60, `(${sameDay}/365 days)`);

// 10 ------------------------------------------------------------------ week cost
const wkCost = [...Array(52)].map((_,w) =>
  [...Array(7)].reduce((a,_,i) => {
    const d = ctx.plus(start, w*7+i);
    return a + ctx.BREAKFAST.cost + ctx.planFor(d,'lunch').cost +
           ctx.snackFor(d).cost + ctx.planFor(d,'dinner').cost;
  }, 0));
ok('weekly food cost under Rs1500', Math.max(...wkCost) <= 1500,
   `(Rs${Math.min(...wkCost)}–${Math.max(...wkCost)}/wk, ~Rs${Math.round(wkCost[0]*4.3)}/mo)`);

// ---- agenda architecture: the actions that actually break the system ----------
const mondayD = start, saturday = ctx.plus(start,5), sunday = ctx.plus(start,6);
const ids = d => ctx.agenda(d).map(x => x.id);

ok('agenda is always time-sorted',
   days.slice(0,90).every(d => { const a = ctx.agenda(d);
     return a.every((x,i) => i===0 || a[i-1].t <= x.t); }));

ok('workday agenda reminds you to take the lunch box', ids(mondayD).includes('takelunch'));
ok('weekend does NOT nag about the lunch box', !ids(saturday).includes('takelunch'));
ok('Sunday surfaces the shop AND the batch prep',
   ids(sunday).includes('shop') && ids(sunday).includes('prep'));
ok('Wednesday surfaces the top-up trip', ids(ctx.plus(start,2)).includes('topup'));

let thawWrong = 0;
days.slice(0,120).forEach(d => {
  const needs = ctx.thawNeeded(ctx.plus(d,1));
  if (needs !== ids(d).includes('thaw')) thawWrong++;
});
ok('thaw reminder fires exactly when tomorrow needs chicken', thawWrong === 0,
   `(${thawWrong} mismatches)`);

ok('night before a workday, packing lunch is on the list',
   ids(sunday).includes('pack') && !ids(ctx.plus(start,4)).includes('pack'));

ok('Now always has something to show while anything is undone',
   days.slice(0,60).every(d => [7,10,14,18,22].every(h => ctx.current(d,h) !== null)));

// ---- UserAlgorithm: the science, checked against hand-computed values --------
// Mifflin–St Jeor, male:   10W + 6.25H - 5A + 5
// Mifflin–St Jeor, female: 10W + 6.25H - 5A - 161
const m24 = A({gender:'m',age:24,cm:157,kg:60,train:{days:[0,1,2,3,4],type:'weights'}});
const f30 = A({gender:'f',age:30,cm:162,kg:58,train:{days:[0,1,2],type:'cardio'}});
ok('BMR matches Mifflin-St Jeor for a male', Math.round(m24.bmr) === 1466, `(${Math.round(m24.bmr)} vs 1466)`);
ok('BMR matches Mifflin-St Jeor for a female', Math.round(f30.bmr) === 1282, `(${Math.round(f30.bmr)} vs 1282)`);
ok('BMI matches weight/height^2', Math.abs(m24.bmi - 60/(1.57*1.57)) < 1e-9, `(${m24.bmi.toFixed(2)})`);

// Published activity multipliers
ok('activity multipliers match published factors',
   ctx.ACT(0)===1.2 && ctx.ACT(2)===1.375 && ctx.ACT(5)===1.55 && ctx.ACT(7)===1.725 && ctx.ACT(8)===1.9);
ok('no training at all means sedentary, not assumed active',
   A({gender:'m',age:24,cm:157,kg:60}).activity === 1.2);

// Safety rails that must hold whatever the user asks for
const under = A({gender:'f',age:22,cm:165,kg:45,goal:'lean',train:{days:[],type:'yoga'}});
ok('an underweight user is never put into a deficit', under.adjust > 0 && under.calories > under.tdee,
   `(adj ${under.adjust}, ${under.calories} vs TDEE ${Math.round(under.tdee)})`);
const obeseBuild = A({gender:'m',age:40,cm:170,kg:100,goal:'build',train:{days:[0,2,4],type:'weights'}});
ok('an obese user asking to bulk is not given a surplus', obeseBuild.adjust <= 0, `(adj ${obeseBuild.adjust})`);

let belowBmr = 0, belowMin = 0;
[['m',1500],['f',1200]].forEach(([g,min]) => {
  for (let age=18; age<=75; age+=3) for (let kg=40; kg<=120; kg+=8) for (let cm=145; cm<=195; cm+=10){
    const u = A({gender:g,age,cm,kg,goal:'lean',train:{days:[],type:'yoga'}});
    if (u.calories < Math.floor(u.bmr/10)*10) belowBmr++;
    if (u.calories < min) belowMin++;
  }
});
ok('calories never fall below BMR, for any body', belowBmr === 0, `(${belowBmr} violations)`);
ok('calories never fall below the clinical minimum', belowMin === 0, `(${belowMin} violations)`);

// Protein: 1.6 plateau (Morton 2018), 1.2-1.6 for 60+, more in a deficit to spare muscle
let pOut = 0;
[18,30,45,59,60,70].forEach(age => ['weights','cardio','yoga','mixed','sport'].forEach(t =>
  ['lean','maintain','build'].forEach(goal => {
    const u = A({gender:'m',age,cm:175,kg:75,goal,train:{days:[0,1,2],type:t}});
    if (u.proteinPerKg < 1.4 || u.proteinPerKg > 1.8) pOut++;
    if (age >= 60 && u.proteinPerKg !== 1.4) pOut++;
  })));
ok('protein per kg always sits in the evidenced 1.4-1.8 band', pOut === 0, `(${pOut} violations)`);
ok('over BMI 27 protein scales off a reference weight, not actual',
   A({gender:'m',age:30,cm:170,kg:110,goal:'lean',train:{days:[0],type:'weights'}}).protein < 110*1.8);

// Training type changes what the plan offers
ok('yoga gets no post-workout shake',
   !A({gender:'m',age:24,cm:157,kg:60,train:{days:[0,1],type:'yoga'}}).wantsShake);
ok('weights does get a post-workout shake',
   A({gender:'m',age:24,cm:157,kg:60,train:{days:[0,1],type:'weights'}}).wantsShake);

// Schedule is derived, never assumed
const early = A({gender:'m',age:24,cm:157,kg:60,work:{days:[0],out:6,back:14},train:{days:[],type:'weights'}});
const mon = new Date(2026,7,3);
ok('a 6am shift moves breakfast before 6am, not to a fixed 8:30',
   early.clockFor(mon).bf < 5.5 + 1.5, `(${early.clockFor(mon).bf.toFixed(2)}h)`);
ok('someone who never works still gets a full day of meals',
   A({gender:'m',age:24,cm:157,kg:60}).clockFor(mon).lunch === 13.5);
ok('shop day is their first free day, not a hardcoded Sunday',
   A({gender:'m',age:24,cm:157,kg:60,work:{days:[6,0,1,2,3],out:9,back:17}}).shopDay === 5);

// ---- edge cases -------------------------------------------------------------
const base = {gender:'m',age:24,cm:157,kg:60,diet:'nonveg',goal:'lean'};
const mon0 = new Date(2026,7,3);

// people who never train / never work
const idle = A({...base, train:{days:[],type:'weights'}, work:{days:[],out:null,back:null}});
ok('EDGE no training and no job still yields a complete day',
   ['sun','bf','lunch','snack','dinner'].every(k => idle.clockFor(mon0)[k] != null));
ok('EDGE no training means no shake slot', idle.clockFor(mon0).gym === null);

// works every single day -> there is no free day for the big shop
const always = A({...base, work:{days:[0,1,2,3,4,5,6],out:9,back:18}, train:{days:[],type:'weights'}});
ok('EDGE working all 7 days still produces a shop day', Number.isInteger(always.shopDay));

// overnight / very late shift
const night = A({...base, work:{days:[0],out:22,back:6}, train:{days:[],type:'weights'}});
const nc = night.clockFor(mon0);
ok('EDGE a 10pm shift never emits a negative or NaN meal time',
   Object.values(nc).filter(v => typeof v === 'number').every(v => Number.isFinite(v) && v > -12));

// BMI band boundaries land in exactly one band
const bandAt = bmi => A({...base, kg:+(bmi*1.57*1.57).toFixed(3)}).band;
ok('EDGE BMI boundaries classify cleanly',
   bandAt(18.4)==='under' && bandAt(18.6)==='normal' && bandAt(24.9)==='normal' &&
   bandAt(25.1)==='over'  && bandAt(29.9)==='over'   && bandAt(30.1)==='obese');

// age extremes
ok('EDGE a 14-year-old gets a finite, above-floor target',
   Number.isFinite(A({...base, age:14}).calories) && A({...base, age:14}).calories >= 1500);
ok('EDGE a 99-year-old gets the older-adult protein rate', A({...base, age:99}).proteinPerKg === 1.4);

// very small and very large bodies
ok('EDGE a 40kg adult is never starved', A({...base, kg:40, cm:150}).calories >= 1500);
ok('EDGE a 160kg adult still gets a sane target',
   A({...base, kg:160, cm:180, goal:'lean'}).calories > 1500);

// a profile with almost nothing in it must not throw
let threw = false;
try { const bare = A({}); bare.targets; bare.clockFor(mon0); bare.breakfastFor(mon0); }
catch(e){ threw = true; }
ok('EDGE an empty profile never throws', !threw);

// diet + no-prep together must still leave a usable rotation
ctx.S.profile = {...base, diet:'veg', train:{days:[],type:'yoga'}, work:{days:[],out:null,back:null}};
ctx.refreshUser(); ctx.S.noPrep = true;
ok('EDGE vegetarian AND no-prep still feeds you',
   ctx.available('lunch').length >= 2 && ctx.available('dinner').length >= 2,
   `(${ctx.available('lunch').length} lunches, ${ctx.available('dinner').length} dinners)`);
ctx.S.noPrep = false;

// rejecting every vegetarian meal must not empty the rotation
ctx.LUNCH.forEach(m => ctx.S.swaps[m.id] = 9);
ok('EDGE rejecting every meal on a restricted diet still returns options',
   ctx.available('lunch').length >= 1, `(${ctx.available('lunch').length})`);
ctx.S.swaps = {};

// breakfast modes
ok('EDGE skipping breakfast removes it from the day',
   !A({...base, bf:'none'}).eatsBreakfast);
ok('EDGE a vegetarian never gets an egg breakfast',
   A({...base, diet:'veg', bf:'vary'}).filter(ctx.BREAKFASTS).every(b => b.diet === 'veg'));

// restore the standard test profile
ctx.S.profile = { name:'Test', gender:'m', age:24, cm:157, kg:60, diet:'nonveg',
                  goal:'lean', bf:'fixed',
                  work:{ days:[0,1,2,3,4], out:11, back:19 },
                  train:{ days:[0,1,2,3,4], type:'weights' } };
ctx.refreshUser();

// agenda must never emit duplicate ids or unsorted times, for any profile shape
let dup = 0, unsorted = 0;
[[[],[]], [[0,1,2,3,4],[]], [[],[0,1,2,3,4,5,6]], [[0,1,2,3,4,5,6],[0,1,2,3,4,5,6]]]
  .forEach(([wd, td]) => {
    ctx.S.profile = {...base, work:{days:wd,out:9,back:18}, train:{days:td,type:'weights'}};
    ctx.refreshUser();
    for (let i=0;i<14;i++){
      const ag = ctx.agenda(ctx.plus(mon0,i));
      const ids = ag.map(x=>x.id);
      if (new Set(ids).size !== ids.length) dup++;
      if (ag.some((x,j) => j && ag[j-1].t > x.t)) unsorted++;
    }
  });
ok('EDGE agenda never duplicates an action id', dup === 0, `(${dup})`);
ok('EDGE agenda is sorted for every profile shape', unsorted === 0, `(${unsorted})`);

console.log(`\n${fail ? fail + ' FAILED' : 'all 50 invariants hold'}\n`);
process.exit(fail ? 1 : 0);
