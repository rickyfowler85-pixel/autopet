# Procedural Anatomy 01

This increment keeps the V2.1 behavior, interaction, evidence, offline progression, and habitat systems intact. It adds one constrained developmental layer between recorded experience and the existing juvenile presentation. Anatomy never chooses a named form and never uses runtime image generation.

## Development model

Every completed intention already creates durable developmental evidence. The anatomy model reads the bounded 7-day and 30-day evidence windows and derives six overlapping pressures: mobility, aquatic exposure, ground foraging, recovery, independent self-care, and grooming. Expected daily exposure rates and coverage-aware priors keep a few early events from producing a large physical change. Recent evidence has more influence than the longer window, so a sustained new lifestyle can change the direction of development.

The saved body contains continuous values for body length and depth, limb length and build, ear size and lift, tail length and depth, posture, coat hue and lightness, and cream coverage. Each value has a narrow juvenile-safe range. A compatibility projection keeps a deeper body supported by suitable limbs, limits long/deep body combinations, and keeps the tail base compatible with body depth.

At a completed outcome, the body first eases toward its previously saved target using simulation time and a six-day time constant. The new evidence then derives the next pressure profile and target. This order prevents an event from changing the body retroactively. It also makes ordinary sessions subtle, gives a sustained 30-day history a readable effect, and permits later redirection without accumulating features indefinitely.

## Rendering

The renderer uses one fixed juvenile body plan. Continuous anatomy is quantized to restrained native-pixel changes in the body, limbs, ears, tail, posture, and limited authored palette variants. Both standing and sleeping poses use the same persisted anatomy. Eyes, expressive face, two ears, four limbs, dorsal structures, a continuous body, and an attached tail remain invariant.

The rasterizer is pure and does not read time, random state, local storage, or Canvas. The habitat renderer and developer previews paint the same native-grid output with nearest-neighbor scaling. This makes a saved anatomy reconstruct the same pixels after reload and gives tests a DOM-free visual signature.

## Persistence

World schema version 4 stores the anatomical baseline, current values, target values, pressures, and the last simulation-time update. Existing version 3 (Behavioral Refinement V2.1) saves migrate to the neutral procedural juvenile at their existing simulation time, so past evidence is never applied as an instantaneous developed form. Earlier migrations continue through the same validated path. The storage key remains unchanged.

Version 4 saves are rejected if anatomy is missing, nonfinite, out of range, structurally incompatible, or claims an update time in the future. Valid saves are restored exactly; targets and pressures are not recalculated during load.

## Developer review

The `?dev=1` panel exposes current and target anatomy, evidence pressures, baseline/current previews, multi-day acceleration through the production simulator, same-seed history comparisons, and seeded reset/replay. Comparison histories alter recorded opportunities and care patterns rather than assigning anatomy directly.

## Deliberate limits

This milestone does not make anatomy affect pathfinding, activity capability, or behavior selection. It does not add anatomy modules, major structural breakthroughs, metamorphosis, Evolution Reflection, genetics, breeding, additional creatures, or new habitats. The rolling evidence classifies one primary habitat context per completed intention and does not yet retain daily locomotion distance, so its biomechanical interpretation remains intentionally broad. The temporary pixel body plan still needs production art review on final target hardware.

## Validation

The deterministic suite contains 26 passing tests. It covers identical histories, contrasting 30-day activity histories, anatomical bounds and support relationships, stabilization, sustained redirection, standing and sleeping topology, exact pixel restoration, future development after reload, one-shot versus chunked offline progression, and version 1–3 save migration.

Browser validation renders the 400×280 habitat and the developer previews through the production Canvas path. A same-seed 30-day wading history and ground-foraging history produce clearly different proportions and authored palette steps while retaining the same face, four-limbed body plan, ears, ridges, and attached tail. The developer one-day advancement, comparison replay, local version-4 save, and responsive panel were exercised without runtime exceptions.
