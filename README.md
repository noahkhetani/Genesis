# evolve — living simulation (v1)

a big browser sim where autonomous agents run around a procedurally generated
world - they survive, expand, trade, fight, evolve and eventually clump into
civilizations. still a wip.

## quick start

it's es modules so u need a local http server:

```
python -m http.server 8765
```
then open http://localhost:8765

or with node: `npx serve .`

## controls

| input | action |
|-------|--------|
| scroll wheel | zoom |
| middle-click + drag | pan |
| alt + left-click + drag | pan |
| wasd / arrows | pan |
| left-click an agent | inspect it |
| left-click territory | inspect a civ |
| right-click | deselect |
| click the minimap | jump there |
| ⏸ / ▶ | pause / resume |
| ◀◀ / ▶▶ | slower / faster (0.25x - 20x) |
| ↺ | new world |

## how it's laid out

```
src/
├── config.js              global constants
├── main.js                entry point + game loop
├── utils/
│   ├── noise.js           simplex noise for worldgen
│   └── seededRandom.js    mulberry32 seeded prng
├── world/
│   ├── world.js           tile grid
│   └── worldGen.js        procedural generation (7 steps)
├── entities/
│   ├── agent.js           agent class + reproduction
│   └── resource.js        biome resource tables
├── systems/
│   ├── agentSystem.js     agent ai, movement, lifecycle
│   ├── resourceSystem.js  resource regen + depletion
│   ├── civSystem.js       civ formation + diplomacy
│   ├── combatSystem.js    civ wars
│   ├── evolutionSystem.js trait drift
│   └── eventSystem.js     random world events
└── rendering/
    ├── camera.js          pan/zoom camera
    ├── renderer.js        canvas 2d renderer
    └── ui.js              panels, inspector, controls
```

## what the systems do

**worldgen** - seven deterministic steps off a single integer seed: height map
(8-octave fbm + a radial island gradient), temperature (latitude + altitude +
noise), moisture (5-octave fbm), biome assignment (13 biomes), rivers (flow
downhill from mountains), resource placement (per-biome tables ±20%), then a
walkability pass.

**agent ai** - priority state machine (rest → seek food → attack → flee →
reproduce → gather → wander) with a spatial hash grid for cheap neighbour
lookups. heritable traits: intelligence, aggression, social tendency, speed,
strength.

**civs** - form on their own once 6+ social agents cluster up. they grab
territory, pool resources, and do diplomacy (neutral / peace / allied / war).

**events** - one fires at random roughly every ~1m40s:
- 🔥 wildfire - burns forest to grassland, hurts agents
- ☠️ plague - aoe health drain
- 🌊 flood - lowlands go temporarily unwalkable
- ☀️ drought - less food regen
- 🌱 resource boom - regen rates spike

## v1 scope

done (phases 1-4 of the prd): procedural world, agent system (ai/movement/
reproduction/death), resources, civs (formation/territory/expansion), diplomacy
+ war, evolution tracking, world events, and the camera/renderer/minimap/
inspector ui.

not in v1: multiplayer, religions, trade networks, climate, tech trees.
