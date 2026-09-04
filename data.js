/* Plate — meal library.
   The invariant: every meal in a slot sits in a narrow kcal/protein band, and the
   five meals in each slot collectively cover all 12 micronutrients. That makes ANY
   rotation through this library nutritionally valid, so the runtime needs no solver.

   perish: 2 = fresh greens/paneer, must be eaten Mon–Wed
           1 = fridge chicken, fine to Thursday
           0 = shelf-stable, any day
   noprep: true = cookable with zero Sunday batch prep

   Prices are Bangalore, Aug 2026, approximate. */

const MICROS = {
  iron:   'Iron',      zinc:   'Zinc',     b12:    'B12',
  vitd:   'Vit D',     calc:   'Calcium',  mag:    'Magnesium',
  omega3: 'Omega-3',   vita:   'Vit A',    vitc:   'Vit C',
  folate: 'Folate',    sel:    'Selenium', fibre:  'Fibre'
};

// Breakfast is deliberately fixed — it already works for you. Only the fruit rotates,
// which keeps decision cost at zero while avoiding taste fatigue.
const BREAKFASTS = [
  { id:'bf', diet:'veg', name:'Overnight oats', kcal:520, p:22, cost:42, mins:2, perish:0, noprep:true,
    base:'60g oats · 200ml milk · 1 tbsp ground flaxseed · 15g peanut butter',
    how:'60g oats · 200ml milk · 1 tbsp ground flaxseed · 15g peanut butter',
    micros:['omega3','mag','calc','b12','fibre'],
    tip:'Soaked last night. Just add the fruit.',
    rotate:['+ banana','+ apple & cinnamon','+ banana & 4 soaked almonds','+ papaya','+ guava'] },

  { id:'bf2', diet:'egg', name:'Eggs on toast', kcal:490, p:28, cost:48, mins:8, perish:1, noprep:true,
    base:'3 eggs · 2 slices toast · tomato',
    how:'3 eggs any way · 2 slices toast · tomato on the side',
    micros:['sel','b12','vita','iron','fibre'],
    tip:'Fastest hot breakfast. Eight minutes start to plate.',
    rotate:['+ a glass of milk','+ half an avocado','+ a banana','+ sautéed spinach','+ curd'] },

  { id:'bf3', diet:'veg', name:'Poha + peanuts', kcal:500, p:18, cost:35, mins:12, perish:0, noprep:true,
    base:'1½ cups poha · peanuts · onion, curry leaves',
    how:'1½ cups poha · roasted peanuts · onion, curry leaves, mustard seeds · lemon',
    micros:['iron','mag','fibre','vitc'],
    tip:'Rinse the poha, never soak it. Soggy poha is unrecoverable.',
    rotate:['+ 150g curd','+ 2 boiled eggs','+ a glass of milk','+ sprouts','+ banana'] }
];
// Kept for code that still refers to a single default breakfast.
const BREAKFAST = BREAKFASTS[0];

const LUNCH = [
  { id:'l1', diet:'egg', name:'Egg fried rice', kcal:640, p:32, cost:52, mins:12, perish:1, noprep:false,
    how:'4 eggs · cooked rice · peas, carrot, capsicum, spring onion · soy sauce',
    micros:['iron','sel','b12','vita','vitc','zinc'],
    tip:'Your favourite — it stays, just not daily.' },

  { id:'l2', diet:'nonveg', name:'Chicken rice bowl', kcal:620, p:42, cost:70, mins:8, perish:1, noprep:false, thaw:true,
    how:'150g pre-cooked chicken · rice · sautéed veg · lemon squeezed over',
    micros:['iron','zinc','b12','sel','vitc'],
    tip:'Lemon is not garnish — the vitamin C roughly doubles iron absorption.' },

  { id:'l3', diet:'veg', name:'Soya pulao + curd', kcal:600, p:38, cost:35, mins:15, perish:0, noprep:true,
    how:'60g soya chunks (boiled) · rice · onion, tomato · 150g curd on the side',
    micros:['iron','calc','b12','zinc','fibre','folate'],
    tip:'Cheapest protein you own — 52g per 100g dry, about ₹10 a serving.' },

  { id:'l4', diet:'egg', name:'Masoor dal + rice + 2 eggs', kcal:600, p:30, cost:40, mins:10, perish:0, noprep:true,
    how:'Masoor dal (batch) · rice · 2 boiled eggs · tomato',
    micros:['iron','folate','fibre','sel','b12','vitc'],
    tip:'Masoor needs no pressure cooker — 20 min in an open pot.' },

  { id:'l5', diet:'nonveg', name:'Chicken roti wrap', kcal:600, p:45, cost:70, mins:10, perish:2, noprep:false, thaw:true,
    how:'2 ready rotis (40s on the pan) · 150g chicken · onion, tomato, cucumber · curd-mint sauce',
    micros:['zinc','b12','calc','sel','vitc'],
    tip:'Packs cold, eats fine at room temperature.' },

  { id:'l6', diet:'veg', name:'Paneer rice bowl', kcal:620, p:32, cost:75, mins:10, perish:1, noprep:false,
    how:'150g paneer · rice · capsicum, onion · lemon',
    micros:['calc','b12','zinc','vitc','vita'],
    tip:'The vegetarian answer to the chicken bowl. Same protein bracket.' },

  { id:'l7', diet:'veg', name:'Moong khichdi + curd', kcal:605, p:32, cost:58, mins:22, perish:1, noprep:true,
    how:'½ cup moong dal · rice · turmeric, cumin · 150g curd · 50g paneer stirred in',
    micros:['iron','folate','fibre','calc','b12'],
    tip:'One pot, no cooker. The easiest thing on this list to get right.' }
];

const DINNER = [
  { id:'d1', diet:'egg', name:'Egg bhurji + 2 roti', kcal:530, p:29, cost:48, mins:12, perish:0, noprep:true,
    how:'3 eggs · onion, tomato, green chilli · 2 ready rotis · 100g curd on the side',
    micros:['iron','sel','b12','vita','vitc'],
    tip:'Fastest thing here. Never roll dough at 9pm — buy the rotis.' },

  { id:'d2', diet:'nonveg', name:'Chicken + sweet potato', kcal:460, p:40, cost:75, mins:15, perish:1, noprep:false, thaw:true,
    how:'150g chicken breast, pan-seared · 200g sweet potato · side salad',
    micros:['zinc','b12','vita','sel','fibre'],
    tip:'Your existing post-gym meal, portioned properly.' },

  { id:'d3', diet:'veg', name:'Soya curry + rice', kcal:480, p:35, cost:35, mins:18, perish:0, noprep:true,
    how:'60g soya chunks · onion-tomato masala · rice',
    micros:['iron','zinc','fibre','vitc','folate'],
    tip:'Cheapest dinner here. Good on tight weeks.' },

  { id:'d4', diet:'veg', name:'Palak paneer + roti', kcal:490, p:26, cost:60, mins:18, perish:2, noprep:false,
    how:'100g paneer · 1 bunch palak · 2 ready rotis, or rice',
    micros:['iron','calc','folate','vita','b12','mag'],
    tip:'Palak twice a week covers folate and a good chunk of your iron.' },

  { id:'d5', diet:'egg', name:'Egg curry + rice', kcal:560, p:29, cost:53, mins:20, perish:0, noprep:true,
    how:'3 boiled eggs · onion-tomato gravy · rice · 100g curd on the side',
    micros:['iron','sel','b12','vitc','vita'],
    tip:'Uses the Sunday boiled eggs. Almost no active work.' },

  { id:'d6', diet:'veg', name:'Paneer bhurji + roti', kcal:520, p:28, cost:65, mins:14, perish:1, noprep:false,
    how:'150g paneer crumbled · onion, tomato, chilli · 2 ready rotis',
    micros:['calc','b12','zinc','vita','vitc'],
    tip:'Crumble the paneer by hand, not a grater. Better texture.' }
];

const SNACK = [
  { id:'s1', diet:'veg', name:'Roasted chana + curd', kcal:215, p:14, cost:18, micros:['iron','fibre','mag','folate','calc','b12'] },
  { id:'s2', diet:'egg', name:'3 boiled eggs',  kcal:210, p:18, cost:21, micros:['sel','b12','vita'] },
  { id:'s3', diet:'egg', name:'Curd, peanuts + egg', kcal:270, p:16, cost:32, micros:['calc','b12','mag','zinc','sel'] },
  { id:'s4', diet:'veg', name:'Banana, peanuts + curd', kcal:290, p:14, cost:28, micros:['mag','fibre','vitc','calc','b12'] },
  { id:'s6', diet:'veg', name:'Paneer cubes + amla', kcal:210, p:14, cost:35, micros:['calc','b12','vitc','zinc'] },
  { id:'s5', diet:'egg', name:'Amla, chana + egg', kcal:230, p:14, cost:29, micros:['vitc','iron','fibre','folate','sel','b12'] }
];

const POSTGYM = { id:'gym', name:'Protein smoothie', kcal:300, p:34, cost:95, mins:2,
  micros:['calc','b12','mag','zinc'],
  note:'Gym days only. On gym days this replaces the 5pm snack — otherwise the day runs ~200 kcal over.' };

// Daily non-negotiables that carry most of the micro load for very little money or effort.
const ANCHORS = [
  { id:'a1', text:'15 min sun before 11am', why:'Vitamin D. Food cannot realistically give you this in India.' },
  { id:'a2', text:'Curd once a day',        why:'B12, calcium, gut. ₹12.' },
  { id:'a3', text:'Lemon or amla with a meal', why:'Vitamin C — the iron-absorption multiplier.' },
  { id:'a4', text:'3L water',               why:'Skin and lips. The cheapest thing on this page.' },
  { id:'a5', text:'No tea/coffee 1hr around meals', why:'Tannins block iron uptake. Relevant to your hair.' }
];

const SHOP_SUNDAY = [
  ['Eggs — 30', 220], ['Chicken — 700g', 170], ['Paneer — 200g', 90],
  ['Soya chunks — 500g', 60, 1], ['Rice — 2kg', 130, 1], ['Masoor dal — 500g', 70, 1],
  ['Oats — 1kg', 200, 1], ['Peanut butter — 340g', 190, 1], ['Flaxseed — 500g', 70, 1],
  ['Peanuts / roasted chana — 500g', 90, 1], ['Onion — 1kg', 35],
  ['Tomato — 1kg', 40], ['Carrot + capsicum', 60], ['Sweet potato — 1kg', 50],
  ['Frozen peas — 500g', 60], ['Palak — 2 bunches', 40], ['Lemon — 6', 30],
  ['Cooking oil / spices (as needed)', 100, 1]
];

const SHOP_WED = [
  ['Ready rotis — 20 (iD / Mother Dairy)', 120], ['Milk — 3L', 200], ['Curd — 1kg', 70], ['Bananas — 12', 60],
  ['Seasonal fruit', 100], ['Palak / greens', 25], ['Tomato + onion top-up', 50]
];

const PREP = [
  { t:'Boil 12 eggs',                  m:15, n:'Mostly passive. Start this first.' },
  { t:'Cook 5 cups rice',              m:20, n:'Cool fully before it goes in the fridge.' },
  { t:'Cook masoor dal batch',         m:25, n:'Open pot, no cooker needed.' },
  { t:'Cook 500g chicken, split in 3', m:25, n:'Freeze two, fridge one.' },
  { t:'Chop onion / tomato / capsicum',m:15, n:'Airtight box. Saves 5 min every weekday.' },
  { t:'Portion soya + weigh oats',     m:10, n:'Small bags. Removes all morning thinking.' }
];

const TARGETS = { kcal:1850, p:125 };

/* Recipes live in their own map, keyed by meal id, so the meal objects the
   invariants test against stay untouched. Written for an induction hob and
   NO pressure cooker. */
const RECIPES = {
  bf:{ing:['60g oats','200ml milk','1 tbsp ground flaxseed','15g peanut butter','Fruit of the day'],
      steps:['Jar: oats + milk + flaxseed. Stir properly, no dry pockets.',
             'Lid on, fridge overnight.','Morning: peanut butter and the fruit on top.'],
      note:'Make it while you cook dinner — the kitchen is already open.'},

  bf2:{ing:['3 eggs','2 slices bread','1 tomato','Butter or oil','Salt, pepper'],
      steps:['Toast the bread.','Eggs however you like them — scrambled is fastest.',
             'Tomato sliced on the side, salt and pepper.'],
      note:'Eight minutes start to plate. The hot option when oats get boring.'},

  bf3:{ing:['1½ cups poha','A handful of roasted peanuts','1 onion','Curry leaves','Mustard seeds','½ lemon','Turmeric'],
      steps:['Rinse the poha in a sieve. Do not soak it.',
             'Mustard seeds in hot oil till they pop, then curry leaves and onion.',
             'Turmeric, then the poha, tossed gently for 3 min.',
             'Peanuts and a squeeze of lemon at the end.'],
      note:'Rinse, never soak. Soggy poha cannot be rescued.'},

  l1:{ing:['4 eggs','1½ cups cold cooked rice','½ onion','½ capsicum','1 carrot','2 tbsp peas','1 tbsp soy sauce','1 tsp oil','Spring onion'],
      steps:['Scramble the eggs hard and fast, tip them out.',
             'Same pan: onion 1 min, then carrot, capsicum and peas 3 min on high.',
             'Rice in, soy sauce, salt, pepper. Toss 2 min without stirring too much.',
             'Fold the egg back in, spring onion, off the heat.'],
      note:'Rice must be cold from the fridge. Fresh rice turns to mush.'},

  l2:{ing:['150g cooked chicken','1½ cups rice','1 cup mixed veg','1 tsp oil','½ lemon','Salt, pepper'],
      steps:['Warm the chicken through, 2 min.','Veg in, toss 3 min.',
             'Rice in, season, warm through.','Squeeze the lemon over just before you eat.'],
      note:'The lemon is not garnish — vitamin C roughly doubles iron absorption.'},

  l3:{ing:['60g soya chunks','1½ cups rice','1 onion','1 tomato','1 tsp garam masala','150g curd','1 tsp oil'],
      steps:['Boil soya 8 min in salted water. Drain and squeeze dry — this matters.',
             'Oil, onion till soft, tomato 2 min, garam masala.',
             'Soya in, toss 3 min.','Fold through the rice. Curd on the side.'],
      note:'Squeeze the soya properly or the whole thing goes watery.'},

  l4:{ing:['½ cup masoor dal','2 boiled eggs','1½ cups rice','1 tomato','½ onion','Turmeric, cumin, salt'],
      steps:['Dal + 1½ cups water + turmeric. Open pot, 20 min, till it collapses.',
             'Small pan: cumin in hot oil, onion, tomato. Pour into the dal.',
             'Over rice, eggs halved on top.'],
      note:'Masoor needs no pressure cooker. Rajma and chole would — that is why they are not here.'},

  l5:{ing:['2 ready rotis','150g cooked chicken','¼ onion','1 tomato','Cucumber','3 tbsp curd','Mint','Salt'],
      steps:['Curd + chopped mint + salt = the sauce.','Rotis 40 seconds a side.',
             'Chicken and veg down the middle, sauce over.','Roll tight, wrap in foil.'],
      note:'Travels well and eats fine at room temperature.'},

  l6:{ing:['150g paneer','1 capsicum','½ onion','1½ cups rice','½ lemon','Salt, pepper'],
      steps:['Cube the paneer, sear it in a dry hot pan 2 min a side. Do not stir it about.',
             'Capsicum and onion in the same pan, 3 min — keep them with some bite.',
             'Over the rice, lemon squeezed on top.'],
      note:'Same protein bracket as the chicken bowl. Sear the paneer dry or it weeps.'},

  l7:{ing:['½ cup moong dal','1 cup rice','50g paneer','150g curd','Turmeric, cumin','Salt'],
      steps:['Dal and rice rinsed together into one pot, 3 cups water, turmeric.',
             'Cumin in hot ghee, tip it in. Simmer 20 min till it goes soft and loose.',
             'Paneer crumbled through at the end. Curd on the side.'],
      note:'One pot, no cooker. The easiest thing on this list to get right.'},

  d1:{ing:['3 eggs','1 onion','1 tomato','1 green chilli','Turmeric, salt','2 ready rotis'],
      steps:['Oil, onion till golden, 3 min.','Tomato, chilli, turmeric — 2 min.',
             'Beat the eggs, pour in, stir constantly 2 min. Take it off while still soft.',
             'Rotis 40 seconds a side.'],
      note:'Fastest thing here. Your default when you get home late.'},

  d2:{ing:['150g chicken breast','200g sweet potato','1 tsp oil','Salt, pepper, paprika','Side salad'],
      steps:['Cube the sweet potato, boil 12 min.','Season the chicken, sear 4 min a side, no moving it.',
             'Rest 2 min before slicing — otherwise it goes dry.','Salad alongside.'],
      note:'Needs defrosting. The app reminds you the night before.'},

  d3:{ing:['60g soya chunks','1 onion','2 tomatoes','Ginger-garlic','Garam masala, chilli powder','Rice'],
      steps:['Boil soya 8 min, drain, squeeze dry.','Onion till brown, ginger-garlic 1 min.',
             'Tomatoes and spices, cook down 5 min till the oil separates.',
             'Soya in with ½ cup water, simmer 6 min.'],
      note:'Cheapest dinner on the list. Good on a tight week.'},

  d4:{ing:['1 bunch palak','100g paneer','1 onion','1 tomato','Garlic','Cumin','2 ready rotis'],
      steps:['Blanch the palak 2 min, straight into cold water, then blend.',
             'Cumin, garlic, onion. Tomato 3 min.','Palak purée in, simmer 4 min.',
             'Paneer last, 2 min only.'],
      note:'Do not overcook the paneer or it goes rubbery. Cold water after blanching keeps the green.'},

  d5:{ing:['3 boiled eggs','1 onion','2 tomatoes','Ginger-garlic','Garam masala, turmeric','Rice'],
      steps:['Onion till brown, ginger-garlic 1 min.','Tomato and spices, 5 min.',
             '½ cup water, simmer 5 min.','Slide the halved eggs in, 2 min. Do not stir hard.'],
      note:'Uses the Sunday boiled eggs. Almost no active work.'},

  d6:{ing:['150g paneer','1 onion','1 tomato','1 green chilli','Turmeric, salt','2 ready rotis'],
      steps:['Crumble the paneer by hand — a grater turns it to paste.',
             'Onion 3 min, tomato and chilli 3 more, turmeric in.',
             'Paneer through it for 2 minutes only, off the heat while still soft.',
             'Rotis 40 seconds a side.'],
      note:'Overcooked paneer goes squeaky. Two minutes is the whole trick.'},

  s1:{ing:['40g roasted chana','100g curd'],steps:['Open packet. Curd alongside.'],note:'The curd is what takes this from 8g protein to 14g.'},
  s2:{ing:['3 boiled eggs','Salt, pepper'],steps:['From the Sunday batch.'],note:'18g protein for ₹21. The cheapest protein per rupee here after soya.'},
  s3:{ing:['150g curd','A small handful of peanuts','1 boiled egg'],steps:['Stir the peanuts through the curd. Egg on the side.'],note:'The egg is what keeps rest days from dipping under your protein floor.'},
  s4:{ing:['1 banana','A handful of peanuts','100g curd'],steps:['No cooking involved.'],note:'The biggest snack here. Good before a heavy session.'},
  s6:{ing:['100g paneer','1 amla','Salt, pepper'],steps:['Cube the paneer raw. Amla alongside.'],note:'The vegetarian stand-in for the boiled eggs. Amla is the vitamin C.'},
  s5:{ing:['1 amla','40g roasted chana','1 boiled egg'],steps:['Eat the amla first, it is sour.'],note:'Amla is one of the highest vitamin C foods there is.'},
  gym:{ing:['1 scoop whey','200ml milk','½ banana','1 tsp peanut butter'],
      steps:['Everything into the portable blender.','30 seconds. Drink within the hour.'],
      note:'On gym days this replaces the 5pm snack. Both would put the day ~200 kcal over target.'}
};
