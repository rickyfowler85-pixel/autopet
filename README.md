# Autopet — Procedural Anatomy Prototype 03

One persistent, unnamed juvenile lives autonomously in a small woodland clearing. No care meters, punishments, accounts, or backend.

## Run

Node 22.12+ (validated on Node 24). Use the existing checkout; a separate worktree is unnecessary.

```sh
cd /workspace/autopet
npm ci --cache /tmp/autopet-npm
npm run dev
```

Open the Local address printed by Vite. Watch without interacting, tap the companion to say hello, gently stroke across it, or drag the branch, stone, and seedpod to valid ground. Tap empty ground to offer a voluntary exploration invitation. If it pauses and looks toward you while foraging, bring the seedpod near it; while grooming, a longer stroke can offer help. It may accept, decline, or continue on its own. “Ways to interact” contains accessible equivalents and keyboard object movement. Developer controls are available only with `?dev=1`: behavior and anatomy inspection, baseline/current previews, multi-day development acceleration, contrasting history comparison, and deterministic reset/replay.

```sh
npm run build
npm test
```

## Structure

- `model.ts`: versioned world, seeded temperament, habitat features, behavior intentions, care independence, developmental evidence, and persisted anatomy.
- `anatomy.ts`: evidence pressures, continuous targets, compatibility projection, validation, and slow deterministic development.
- `behavior.ts`: opportunity discovery and two-stage selection across activities and their real habitat targets.
- `learning.ts`: competing preference distributions, habituation, autonomous practice, assisted care, confidence, reliance, and help seeking.
- `evidence.ts`: lifetime summaries plus bounded daily evidence for recent 7- and 30-day developmental windows.
- `simulation.ts`: deterministic 100 ms intentions with event-driven bulk advancement for live, test, and offline time.
- `persistence.ts`: validated version-four snapshots plus compatible migration from version-one, version-two, and V2.1 version-three saves.
- `interaction.ts`: creature/object hit tests, contextual care gestures, safe object placement, and optional social reactions.
- `assets.ts`: pure native-grid procedural juvenile rasterizer and shared Canvas painter.
- `render.ts`: 400×280 habitat, painter ordering, ambient movement, and anatomy-aware idle / locomotion / resting presentation.
- `devtools.ts`: deterministic history replay, anatomy inspection data, fingerprints, and shared previews.
- `main.ts`: browser clock, input mapping, lifecycle, and development controls.

Simulation randomness is separate from ambient rendering. Autonomous decisions, outcomes, and social responses use separate deterministic streams, so petting does not invisibly reshuffle future autonomous choices. Timed phases advance in deterministic bulk while route movement preserves the same fixed 100 ms path. Online, accelerated, and offline progression therefore produce the same state. Offline catch-up supports up to 30 simulated days in one load; longer absences are deliberately bounded and never reduce health or erase development.

An action progresses through noticing, approach, an optional help request, attempt, experienced outcome, and reflection. The root shelter, pond edge, vegetation patches, clearing, branch, stone, and seedpod each expose multiple affordances. Selection first chooses an activity, then a matching opportunity, avoiding bias toward activities that merely have more targets.

Activity preferences and object interests are normalized competing distributions. Outcome quality changes them slowly relative to the creature's prior expectation; they cannot all rise together. Repetition produces separate simulation-time habituation that fades without erasing a durable preference. Temperament remains a stable identity influence.

Feeding and grooming each track proficiency (`capability` in the save schema), confidence, reliance, autonomous and assisted practice, and help seeking. Independent practice builds proficiency fastest and gradually reduces reliance. Accepted help develops a smaller amount of skill while teaching that assistance is available. Ignored requests proceed into autonomous care without a failure or absence penalty, and a frequently assisted creature can become more independent through later practice. Attachment remains separate: saying hello and petting do not alter care reliance.

The short event log retains 80 observations and the concrete outcome ring retains 240 results. Lifetime activity, affordance, opportunity, care, and social totals remain durable. Sparse daily buckets retain at most 30 days and can be merged into recent 7- or 30-day evidence for future evolution and reflection systems. Older saves that lack daily buckets begin rolling coverage at migration time rather than inventing historical detail.

Procedural anatomy reads those rolling windows as overlapping mobility, aquatic, ground-foraging, recovery, independent-care, and grooming pressures. It maps them into narrow continuous ranges for body depth and length, limb build and length, ears, tail, posture, and limited pigmentation. Physical compatibility rules keep the silhouette supported and coherent. The body eases toward its saved target over simulated days, so a short visit is subtle, a sustained history becomes visible, and a later lifestyle can redirect development. There are no named evolutionary classes.

## Temporary art and remaining refinement

The creature follows the October 9 textual handoff: rounded low quadruped, large face, softly triangular ears, four short limbs, short tail, dorsal ridges, slate / cream / peach palette. It is an original procedural placeholder, not a production sprite sheet. Its fixed body plan changes by a few native pixels and small authored palette steps in both standing and sleeping poses. The root shelter, pond, and clearing are provisional art guided by the supplied concept. Final target resolution, direction-specific poses, animation coverage, and hardware palette still need production art review.

Behavior remains deliberately scoped: observe, wander, rest, investigate, forage, groom, wade, and play. The care-learning rates and gesture thresholds are prototype calibration values and need observation with a wider set of play histories. The 30-day offline ceiling intentionally compresses longer absences, and daily evidence assigns a completed intention to its completion day. Rolling evidence has no player-facing reflection view yet.

Anatomy does not yet change pathfinding or unlock behavior. Major metamorphosis, Evolution Reflection, full swimming, memory presentation, and learned object manipulation remain unimplemented. A single tab is supported; simultaneous tabs can overwrite the same local save.

## Acceptance check

Leave the app untouched: status text and movement should progress through purposeful actions at actual habitat locations, with longer quiet activity and reflection between decisions. Over time it should forage in vegetation, groom at suitable places, rest at the shelter or stone, investigate, wade, and play without care input. Reload during an action to resume the same intention, anatomy, and future outcome. Drag an object during approach to retarget safely. Tap empty ground to offer an invitation; the companion may accept, decline, defer, or finish resting. At `?dev=1`, inspect pressures and current/target anatomy, compare baseline and current pixels, advance development, or replay contrasting same-seed histories.

## Downloaded copy

GitHub contains the source and `package-lock.json`. Download or clone it, open a terminal in the `autopet` folder, then run `npm ci` and `npm run dev`. Node 24 LTS is recommended. Open the Local address printed by Vite and keep the terminal running.

## Reference reconciliation

The supplied habitat integration illustration guides warm woodland colors, organic arching roots, layered foliage, sandy shallows, and environmental framing. The earlier “The Keel” study is superseded by the later simplified juvenile handoff: that working title is retired, its detailed evolutionary paths are not implemented classes, and no image has been cropped into a sprite atlas. Both habitat and creature remain original authored temporary pixel assets. The refined renderer uses native-grid scanline clusters with no vector antialiasing.
