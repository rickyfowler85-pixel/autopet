# Playable Habitat Prototype 01 — integration plan

The approved habitat handoff is preserved in [references/habitat-design-handoff.md](references/habitat-design-handoff.md). The October 9 creature handoff supplied in chat establishes the unnamed juvenile's compact quadrupedal anatomy and slate / cream / peach palette. Both habitat concept illustrations are approved references but their image files are not yet present. Do not extract production sprites from concept illustrations.

## Existing baseline

Implemented and previously validated: Vite / TypeScript / Canvas 2D; single-screen clearing, left root shelter, right shallow pond; temporary juvenile sprite; idle / wander / rest / exploration; three persistent objects; fixed-step seeded randomness; local saves; bounded catch-up; developer inspection and time controls. Tap-ground invitations currently redirect non-resting behavior; they are a placeholder for scored voluntary responses. Current objects support investigation, not movement or multiple visible uses. Temperament curiosity and sociability are stored but not yet used by selection; restfulness is used. Development observations are counters, not learned behavior.

## Narrow next implementation sequence

1. **Behavior foundation.** Introduce activity candidates with preconditions, target, affordance, score, and completion / interruption outcomes. Apply curiosity, restfulness, novelty, recent activity, and limited preference history. Keep spontaneous variation and quiet idle periods. Separate player invitations from activity commitments; accept / defer / decline through the same decision layer.
2. **Physical interaction.** Add pointer hit testing, capture, drag preview, and release for existing objects. Silently project invalid placements onto valid ground, reject object overlap, and retarget safely if an object moves. Persist placements. Provide keyboard selection and placement alternatives. Distinguish a creature tap, petting stroke, and empty-ground invitation.
3. **Small voluntary reactions.** Add acknowledgment and petting poses, seedpod play, and a second simple object use such as resting by the stone. Allow gentle seedpod movement by the creature within juvenile capabilities. Offer one contextual food opportunity backed by reliable autonomous foraging; no hunger meter, depletion economy, or survival requirement.
4. **Event-based observations.** Record actual activity outcomes, object relocation, and social responses with actor, subject, and location. Surface a few plain-language memories only through creature interaction. Do not show a forced welcome-back recap or player-facing statistics dashboard. Preserve enough compact history for preferences without building a complete learning system.
5. **Visual reconciliation.** Review supplied concept images when available. Refine the organic root shelter and shallow perspective; reduce background competition with the creature. Replace temporary character art with authored native-grid movement, rest, inspect, and acknowledgment frames. Preserve four limbs, restrained ridges / tail, original identity, and simple readable facial clusters.

## Shared interfaces

Extend the existing World / Creature / HabitatObject / PlayerEvent / Experience contracts rather than putting rules inside rendering. Introduce an activity registry, object properties (mass, movability, affordances, persistent condition), bounded preference history, and transient animation cues. Use one event dispatcher for pointer and keyboard interactions. Migration and validation must cover new save fields. Advance all behavior through the same deterministic step online and offline; ambient rendering never consumes simulation randomness. Anatomy and development remain integration interfaces; no procedural morphing or metamorphosis in this milestone.

## Acceptance and validation

- Leave untouched: varied movement, pauses, exploration, resting, and self-directed activity remain observable without care.
- Different seeds / temperaments produce observable tendencies without fixed classes.
- A branch / stone / seedpod has valid placement, and at least one has two visible uses.
- A player invitation can be declined without guilt or punishment.
- Pointer and keyboard interaction work on desktop; touch placement works on mobile.
- Reload retains creature, placements, object condition, and preference history; corrupt saves recover safely.
- Seeded replay and online / offline batching agree; absence never harms the creature.
- Memories describe recorded events rather than fabricated experiences.
- Build, meaningful simulation tests, and browser smoke checks pass.

## Excluded

Full V1 product, procedural anatomy, metamorphosis, aquatic evolution, continuous ecological simulation, crafting, inventories, accounts, backend, mandatory care, notifications, and fixed evolutionary branches. The full handoff is a direction for future work, not a claim these systems already exist.

## Refinement pass completed

The supplied habitat and earlier creature study have now been reviewed in chat. The renderer was refined with original pixel clusters, a rooted arch, warm clearing, shallow sandy pond, and a simpler juvenile / resting pose. Pointer and touch object dragging, assisted collision-safe placement, safe object investigation retargeting, tap acknowledgment, petting with optional acceptance, keyboard placement, and button alternatives are implemented. Curiosity now influences exploration and invitations. Nine tests plus desktop / mobile browser checks validate this pass. Food, multiple object uses, learned preferences, and memories UI remain future work.

## Behavioral Intelligence 02 completed

The next increment adds persisted multi-phase intentions, semantic habitat opportunities, normalized relative preferences, decaying habituation, slowly learned feeding and grooming independence, separate deterministic random streams, long-term evidence, and version-one save migration. Invitations wait for a decision boundary and remain voluntary. The developer inspector exposes this behavior without adding player-facing meters. See [behavioral-intelligence-02.md](behavioral-intelligence-02.md) for the model and deliberate limits.
