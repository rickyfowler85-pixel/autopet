# Autopet — Behavioral Intelligence Prototype 02

One persistent, unnamed juvenile lives autonomously in a small woodland clearing. No care meters, punishments, accounts, or backend.

## Run

Node 22.12+ (validated on Node 24). Use the existing checkout; a separate worktree is unnecessary.

```sh
cd /workspace/autopet
npm ci --cache /tmp/autopet-npm
npm run dev
```

Open the Vite app in a browser. Watch without interacting, tap the companion to say hello, gently stroke across it, or drag the branch, stone, and seedpod to valid ground. Tap empty ground to offer a voluntary exploration invitation. Open “Ways to interact” for button and keyboard alternatives (arrow keys move the selected object; Enter acknowledges and Space pets). The creature may continue resting. Developer controls are available only with `?dev=1`: inspection, pause, 5× / 20× speed, seeded reset, one-hour offline simulation, and explicit feeding/grooming-assistance evidence for history testing.

```sh
npm run build
npm test
```

## Structure

- `model.ts`: versioned world, seeded temperament, habitat features, behavior intentions, independence, and developmental evidence.
- `behavior.ts`: opportunity discovery and two-stage selection across activities and their real habitat targets.
- `learning.ts`: competing preference distributions, time-decaying habituation, care skills, and durable outcome summaries.
- `simulation.ts`: deterministic 100 ms intention phases, movement, outcomes, invitations, unrestricted test advancement, and bounded offline catch-up.
- `persistence.ts`: validated version-two snapshots and migration of version-one saves; absence simulates at most six hours, with no penalty.
- `interaction.ts`: creature/object hit tests, quietly assisted placement, safe investigation retargeting, and optional social reactions.
- `assets.ts`: authored native-grid temporary character art and asset interface.
- `render.ts`: 400×280 habitat, painter ordering, ambient movement, idle / locomotion / resting presentation.
- `main.ts`: browser clock, input mapping, lifecycle, and development controls.

Simulation randomness is separate from ambient rendering. Autonomous decisions, outcomes, and social responses use separate deterministic streams, so petting does not invisibly reshuffle future autonomous choices. Online and offline behavior run through the same fixed-step intention engine. Offline catch-up is capped at six hours for performance and forgiveness.

An action progresses through noticing, approach, attempt, experienced outcome, and reflection. The root shelter, pond edge, vegetation patches, clearing, branch, stone, and seedpod each expose multiple affordances. Selection first chooses an activity, then a matching opportunity, avoiding bias toward activities that merely have more targets.

Activity preferences and object interests are normalized competing distributions. Outcome quality changes them slowly relative to the creature's prior expectation; they cannot all rise together. Repetition produces separate simulation-time habituation that fades without erasing a durable preference. Temperament remains a stable identity influence.

Feeding and grooming each track capability, confidence, and reliance. Autonomous foraging and grooming continue without the player, develop through actual outcomes, and never create starvation, neglect, or absence penalties. The short event log retains 80 observations; compact activity, affordance, opportunity, social, and outcome evidence persists separately for future evolution and reflection work.

## Temporary art and remaining refinement

The creature follows the October 9 textual handoff: rounded low quadruped, large face, softly triangular ears, four short limbs, short tail, dorsal ridges, slate / cream / peach palette. It is an original placeholder, not a production sprite sheet. The root shelter, pond, and clearing are authored provisional art guided by the concept image supplied in chat. Production anatomy, sprite resolution, direction-specific poses, perspective, animation frames, and habitat palette need visual-reference review. Replace pixel asset definitions (or implement an atlas behind the asset interface) without changing simulation.

Behavior remains deliberately scoped: observe, wander, rest, investigate, forage, groom, wade, and play. Foraging is contextual baseline self-care rather than a hunger system; there is no player food-offering UI yet. Grooming has no care schedule. Procedural anatomy, metamorphosis, full swimming, memory presentation, and learned object manipulation remain unimplemented. Object dragging, acknowledgment, petting, and voluntary invitations remain available. A single tab is supported; simultaneous tabs can overwrite the same local save.

## Acceptance check

Leave the app untouched: status text and movement should progress through purposeful actions at actual habitat locations, with quiet observation between them. Over time it should forage in vegetation, groom at suitable places, rest at the shelter or stone, investigate, wade, and play without care input. Reload during an action to resume the same intention and future outcome. Drag an object during approach to retarget safely; simulation pauses while the object is held. Tap empty ground to offer an invitation; the companion may accept, decline, defer, or finish resting. At `?dev=1`, inspect phase, preferences, object interests, independence, and durable outcomes; reset to replay the same seeded history.

## Downloaded copy

GitHub contains the source and `package-lock.json`. Download or clone it, open a terminal in the `autopet` folder, then run `npm ci` and `npm run dev`. Node 24 LTS is recommended. Open the Local address printed by Vite and keep the terminal running.

## Reference reconciliation

The supplied habitat integration illustration guides warm woodland colors, organic arching roots, layered foliage, sandy shallows, and environmental framing. The earlier “The Keel” study is superseded by the later simplified juvenile handoff: that working title is retired, its detailed evolutionary paths are not implemented classes, and no image has been cropped into a sprite atlas. Both habitat and creature remain original authored temporary pixel assets. The refined renderer uses native-grid scanline clusters with no vector antialiasing.
