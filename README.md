# diet-plate

A personal meal-planning PWA. No framework, no build step, no server — five static
files and a service worker. Installs to an Android home screen as a real WebAPK.

## Why it works the way it does

**The intelligence lives in the data, not the runtime.** Every meal in a slot sits in
a narrow calorie/protein band, and each slot's meals collectively cover all twelve
tracked micronutrients. That makes *any* rotation through the library nutritionally
valid by construction, so the runtime needs no solver — just `day % n` plus a few
rules. A plan that changes when you reopen the app destroys trust, so nothing here
is random: the calendar date is the only seed.

**`UserAlgorithm` owns everything personal.** Body maths (Mifflin-St Jeor), activity
multipliers, goal adjustment, protein targets, diet filtering and the daily schedule
all live in one class. The rest of the app asks it questions and never inspects the
profile directly.

**Nothing is assumed.** Work days and hours, training days and type, breakfast habit
and diet all come from onboarding. Meal times are derived from them — a 6am shift
moves breakfast, someone who doesn't train gets no post-workout slot and a 1.2
activity factor.

## The science

- **BMR** — Mifflin-St Jeor, chosen for being unbiased with the narrowest error range
  across non-obese and obese adults.
- **Protein** — 1.6 g/kg is where resistance-training gains plateau (Morton 2018
  meta-analysis); a deficit gets 1.8 because it spares muscle; adults 60+ sit at 1.4.
  Above BMI 27 it scales off a reference weight rather than actual bodyweight.
- **Safety rails** — an underweight user is never put into a deficit, an obese user
  is never given a surplus whatever they picked, and calories never fall below BMR
  or the clinical minimum (1500 male / 1200 female).

These are estimates, not medical advice.

## Tests

```
node test.js
```

53 invariants: the nutritional guarantees, the schedule rules, the algorithm checked
against hand-computed reference values, and edge cases (no training, no job, 7-day
work weeks, overnight shifts, BMI boundaries, ages 14-99, 40-160kg, empty profiles,
vegetarian + no-prep, rejecting every meal).

## Files

| | |
|---|---|
| `index.html` | markup and the whole design system |
| `data.js` | meal library, recipes, shopping lists |
| `app.js` | `UserAlgorithm`, rotation rules, rendering |
| `sw.js` | network-first service worker |
| `test.js` | the 53 invariants |
