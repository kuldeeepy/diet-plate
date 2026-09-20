# The pile

A browse-first way to pick a meal: every dish sits in a physical heap at the bottom of the
screen. Ask for something and the matches rise out of it and line up.

Built because a grid of 76 dishes is a list you scroll past, while a heap is a bounded set
you rummage through.

## Running it

```bash
node pile/dev.js          # http://localhost:8099
```

`dev.js` serves this folder and runs the `/api/match` function that Vercel hosts in
production, so local behaves like deployed.

## Matching

Two paths, in order:

1. **Jev** (`typesafe-ai/jev` via Vercel AI Gateway) — all 76 dishes go up as one request
   and come back as calibrated probabilities, which double as the ranking. Handles
   negation (`no onion`), inference (`something spicy`, where no dish records spice) and
   typos. ~3.5k input tokens, ~$0.00015 a search.
2. **Local rules** — regex intents over the dish fields. Used whenever Jev is unreachable,
   keyless, rate-limited or slow, so the page keeps working offline. Noticeably dumber:
   it cannot do negation and returns the opposite for `not chicken`.

Identical queries are cached in memory, so chips and repeats cost nothing.

## The key

`AI_GATEWAY_API_KEY` is read **server-side only**, in `api/match.js`. It never reaches the
browser, which is the whole reason the function exists rather than calling the gateway
from the page.

- Local: copy `.env.example` to `.env.local` in the repo root and fill it in.
- Production: set it in the Vercel project's environment variables.

Without a key the API returns `503 {fallback:true}` and the page quietly uses the rules.

## Data

`dishes.json` is generated from the root `data.js`. 22 dishes are the real Plate rotation;
the rest are tagged `demo: true`, sit outside the nutritional invariants and are labelled
as such in the UI. Snack cook times default to 2 minutes here because `data.js` records
none — that default lives in this layer, not in `data.js`.

Each dish carries one or two emoji. Pairs exist because no single glyph says "paneer
bhurji with roti"; they give 76 distinct signatures where single emoji gave 57.
