# Autopet — Playable Habitat Prototype 01

One persistent, unnamed juvenile lives autonomously in a small woodland clearing. No care meters, punishments, accounts, or backend.

## Run

Node 22.12+ (validated on Node 24). Use the existing checkout; a separate worktree is unnecessary.

```sh
cd /workspace/autopet
npm ci --cache /tmp/autopet-npm
npm run dev
```

Open the Vite app in a browser. Watch without interacting, tap the companion to say hello, gently stroke across it, or drag the branch, stone, and seedpod to valid ground. Tap empty ground to offer a voluntary exploration invitation. Open “Ways to interact” for button and keyboard alternatives (arrow keys move the selected object; Enter acknowledges and Space pets). The creature may continue resting. Developer controls are available only with `?dev=1`: inspection, pause, 5× / 20× speed, seeded reset, and one-hour offline simulation.

```sh
npm run build
npm test
```

## Structure

- `model.ts`: versioned world, anatomy, temperament, object affordances, player events, experiences, and development state.
- `behavior.ts`: seeded activity selection and exploration weighted toward less-visited objects.
- `simulation.ts`: deterministic 100 ms updates, movement boundaries, invitations, and catch-up.
- `persistence.ts`: validated local storage snapshots; absence simulates at most six hours, with no penalty. Saves every five seconds and on page hide. Unavailable storage is reported visibly.
- `interaction.ts`: creature/object hit tests, quietly assisted placement, safe investigation retargeting, and optional social reactions.
- `assets.ts`: authored native-grid temporary character art and asset interface.
- `render.ts`: 400×280 habitat, painter ordering, ambient movement, idle / locomotion / resting presentation.
- `main.ts`: browser clock, input mapping, lifecycle, and development controls.

Simulation randomness is separate from ambient rendering. Replay uses seed and fixed tick count. Offline simulation runs the same decisions without rendering. It is bounded for performance rather than promising exact unlimited offline history. Experience history retains the latest 80 events. Development observations are recorded but do not trigger evolution.

## Temporary art and remaining refinement

The creature follows the October 9 textual handoff: rounded low quadruped, large face, softly triangular ears, four short limbs, short tail, dorsal ridges, slate / cream / peach palette. It is an original placeholder, not a production sprite sheet. The root shelter, pond, and clearing are authored provisional art guided by the concept image supplied in chat. Production anatomy, sprite resolution, direction-specific poses, perspective, animation frames, and habitat palette need visual-reference review. Replace pixel asset definitions (or implement an atlas behind the asset interface) without changing simulation.

Behavior is deliberately small: curiosity/restfulness-weighted activities, seeded voluntary invitations, simple straight-line valid movement, resting at the shelter, and inspecting objects. No learned independence, procedural anatomy, swimming, food, memories UI, or metamorphosis is implemented. Object dragging, brief acknowledgment, and petting reactions are implemented; petting may be deferred and does not interrupt resting. The pond is a movement exclusion, not a swimming system. A single tab is supported; simultaneous tabs can overwrite the same local save.

## Acceptance check

Leave the app untouched: observe walking and blinking, object investigation, idle pauses, shelter resting, pond ripples, and floating motes. Reload to resume the same organism and object visit history. Drag objects, including toward the pond: they should settle on valid, unobstructed ground and persist after reload. Tap and stroke the companion; brief responses must not cancel its activity. At `?dev=1`, observe activity and visit counters; reset to replay the same seeded scenario.

## Downloaded copy

The `autopet-playable-02.zip` bundle includes source and `package-lock.json`. Unzip, open a terminal in the extracted `autopet` folder, then run `npm ci` and `npm run dev`. Node 24 LTS is recommended. Open the Local address printed by Vite. Keep the terminal running. Use `npm install` only if using an older download without the lockfile.

## Reference reconciliation

The supplied habitat integration illustration guides warm woodland colors, organic arching roots, layered foliage, sandy shallows, and environmental framing. The earlier “The Keel” study is superseded by the later simplified juvenile handoff: that working title is retired, its detailed evolutionary paths are not implemented classes, and no image has been cropped into a sprite atlas. Both habitat and creature remain original authored temporary pixel assets. The refined renderer uses native-grid scanline clusters with no vector antialiasing.
