import './style.css';
import { createWorld, STEP, type Point } from './model';
import { step, interact, advance, advanceOffline } from './simulation';
import { load, save } from './persistence';
import { hitCreature, hitObject, placement, moveObject, greet, type InteractionView } from './interaction';
import { assistCare } from './learning';
import { recentEvidence } from './evidence';
import { Renderer, WIDTH, HEIGHT } from './render';
import {
  HISTORY_PRESETS,
  advanceDevelopment,
  anatomyTableRows,
  comparisonText,
  developmentFingerprint,
  paintAnatomyPair,
  pressureTableRows,
  replayRecordedHistory,
  type HistoryPreset,
} from './devtools';

const historyOptions = HISTORY_PRESETS
  .map(preset => `<option value="${preset.id}">${preset.label}</option>`)
  .join('');

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <header>
      <div class="brand">autopet<span>a little life</span></div>
      <div class="edition">HABITAT STUDY / 003</div>
    </header>
    <div class="intro">
      <div><h1>A world of its own.</h1><p>No chores. No hurry. Just a little company.</p></div>
      <span class="season">◌ &nbsp; THE ROOT CLEARING</span>
    </div>
    <div class="frame">
      <canvas id="habitat" tabindex="0" aria-describedby="interaction-help" aria-label="A small blue creature lives autonomously in a woodland clearing, with a root shelter and shallow pond." role="img"></canvas>
    </div>
    <div class="under">
      <span id="status" aria-live="polite">Taking in the clearing</span>
      <span class="hint">Stay a while. Tap or stroke your companion. Drag objects to make room for curiosity.</span>
    </div>
    <details class="interaction-help">
      <summary>Ways to interact</summary>
      <p id="interaction-help">Tap your companion to say hello, or gently stroke across it. Drag a branch, stone, or seedpod; invalid placement is quietly adjusted. When it pauses for help, bring the seedpod close or give a longer grooming stroke. Invitations and care offers are always optional.</p>
      <div class="accessible-controls">
        <button id="hello" type="button">Say hello</button>
        <button id="pet" type="button">Gentle pet</button>
        <button id="offer-feed" type="button">Offer seedpod</button>
        <button id="offer-groom" type="button">Help groom</button>
        <label>Move
          <select id="object">
            <option value="">Choose an object</option>
            <option value="fallen-branch">Branch</option>
            <option value="warm-stone">Stone</option>
            <option value="seedpod">Seedpod</option>
          </select>
        </label>
        <span>Use arrow keys on the habitat to place a selected object; Escape deselects.</span>
      </div>
    </details>
    <p id="interaction-feedback" class="interaction-feedback" aria-live="polite"></p>
    <p id="notice"></p>
    <footer><span>A little life, unfolding.</span><span>PROTOTYPE 03 · TEMPORARY PIXEL ART</span></footer>

    <section id="dev" hidden aria-labelledby="dev-title">
      <div class="dev-heading">
        <div><strong id="dev-title">Developer observation</strong><span>Procedural anatomy</span></div>
        <output id="dev-progress" aria-live="polite"></output>
      </div>

      <div class="dev-grid">
        <section class="dev-card dev-appearance" aria-labelledby="appearance-title">
          <h2 id="appearance-title">Baseline / current</h2>
          <canvas id="anatomy-compare" class="dev-preview" width="360" height="112" role="img" aria-label="The baseline juvenile and its current developed appearance shown in the same neutral pose."></canvas>
          <div class="preview-labels" aria-hidden="true"><span>Baseline</span><span>Current</span></div>
          <p id="anatomy-meta" class="dev-meta"></p>
        </section>

        <section class="dev-card" aria-labelledby="parameters-title">
          <h2 id="parameters-title">Anatomical parameters</h2>
          <div class="dev-table-scroll">
            <table>
              <thead><tr><th scope="col">Parameter</th><th scope="col">Current</th><th scope="col">Target</th><th scope="col">Δ</th></tr></thead>
              <tbody id="anatomy-parameters"></tbody>
            </table>
          </div>
        </section>

        <section class="dev-card" aria-labelledby="pressures-title">
          <h2 id="pressures-title">Adaptation pressures</h2>
          <table>
            <thead><tr><th scope="col">Evidence pressure</th><th scope="col">Value</th><th scope="col">From neutral</th></tr></thead>
            <tbody id="anatomy-pressures"></tbody>
          </table>
        </section>
      </div>

      <div class="dev-controls" aria-label="Simulation controls">
        <label>Live speed
          <select id="speed"><option value="1">1×</option><option value="5">5×</option><option value="20">20×</option></select>
        </label>
        <button id="pause" type="button">Pause</button>
        <button id="catchup" type="button">Simulate 1 hour away</button>
        <button id="assist-feed" type="button">Offer feeding help</button>
        <button id="assist-groom" type="button">Offer grooming help</button>
      </div>

      <div class="dev-controls dev-development" aria-label="Development controls">
        <label>Development span
          <select id="dev-days"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select>
        </label>
        <button id="advance-development" type="button">Advance development</button>
        <label>Identity seed <input id="dev-seed" type="number" min="1" max="4294967295" step="1"></label>
        <button id="reset" type="button">Reset from seed</button>
        <label>Replay history <select id="replay-history">${historyOptions}</select></label>
        <button id="replay" type="button">Replay preset from seed</button>
      </div>

      <section class="dev-card dev-history" aria-labelledby="history-title">
        <div class="dev-subheading">
          <div><h2 id="history-title">Contrasting histories</h2><p>Two temporary creatures share one identity seed and accumulate 30 days of recorded experience. Activity-focused histories replay completed actions at their real habitat locations through the production learning path. This does not alter the saved creature.</p></div>
          <div class="dev-controls">
            <label>Left <select id="history-left">${historyOptions}</select></label>
            <label>Right <select id="history-right">${historyOptions}</select></label>
            <button id="compare-histories" type="button">Compare 30 days</button>
          </div>
        </div>
        <div id="history-result" hidden>
          <canvas id="history-compare" class="dev-preview" width="360" height="112" role="img" aria-label="Two same-seed creatures after contrasting recorded developmental histories."></canvas>
          <div class="preview-labels"><span id="history-left-label"></span><span id="history-right-label"></span></div>
          <pre id="history-summary"></pre>
        </div>
      </section>

      <details id="raw-state" class="dev-raw">
        <summary>Raw deterministic state</summary>
        <pre id="inspect"></pre>
      </details>
    </section>
  </main>`;

const loaded = load();
let world = loaded.world;
let view: InteractionView = {};
let speed = 1;
let paused = false;
let accumulator = 0;
let last = performance.now();
let visualTime = 0;
let lastSave = 0;
let lastDevRefresh = Number.NEGATIVE_INFINITY;
let devBusy = false;

const canvas = document.querySelector<HTMLCanvasElement>('#habitat')!;
canvas.width = WIDTH;
canvas.height = HEIGHT;
const context = canvas.getContext('2d')!;
const renderer = new Renderer();
const dev = document.querySelector<HTMLElement>('#dev')!;
dev.hidden = !new URLSearchParams(location.search).has('dev');
const notice = document.querySelector<HTMLElement>('#notice')!;
const interactionFeedback = document.querySelector<HTMLElement>('#interaction-feedback')!;
const selector = document.querySelector<HTMLSelectElement>('#object')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const seedInput = document.querySelector<HTMLInputElement>('#dev-seed')!;
const devProgress = document.querySelector<HTMLOutputElement>('#dev-progress')!;
const rawState = document.querySelector<HTMLDetailsElement>('#raw-state')!;
const inspect = document.querySelector<HTMLElement>('#inspect')!;
const anatomyParameters = document.querySelector<HTMLTableSectionElement>('#anatomy-parameters')!;
const anatomyPressures = document.querySelector<HTMLTableSectionElement>('#anatomy-pressures')!;
const anatomyComparison = document.querySelector<HTMLCanvasElement>('#anatomy-compare')!;
const anatomyMeta = document.querySelector<HTMLElement>('#anatomy-meta')!;

seedInput.value = String(world.identitySeed);
document.querySelector<HTMLSelectElement>('#history-left')!.value = 'wading-heavy';
document.querySelector<HTMLSelectElement>('#history-right')!.value = 'foraging-heavy';

if (!loaded.available) notice.textContent = 'Storage is unavailable. This visit will not be saved.';
else if (loaded.offline > 60) {
  notice.textContent = loaded.capped
    ? 'Life in the clearing unfolded through the most recent month away.'
    : 'While you were away, life in the clearing kept unfolding.';
}

function feedback(text: string) {
  view.feedback = { text, until: visualTime + 3.5 };
  interactionFeedback.textContent = text;
}

function careContext(activity: 'forage' | 'groom') {
  const intent = world.creature.intent;
  return !!intent && intent.activity === activity && (intent.phase === 'request' || intent.phase === 'attempt');
}

function offerCare(domain: 'feeding' | 'grooming') {
  if (devBusy) return false;
  const accepted = assistCare(world, domain);
  feedback(accepted
    ? domain === 'feeding'
      ? 'It accepts the seedpod and settles into foraging.'
      : 'It holds still and accepts your gentle help.'
    : careContext(domain === 'feeding' ? 'forage' : 'groom')
      ? 'It chooses to keep trying in its own way.'
      : `It isn't looking for ${domain === 'feeding' ? 'feeding' : 'grooming'} help right now.`);
  persist();
  return accepted;
}

function persist() {
  if (!save(world)) notice.textContent = 'Storage is unavailable. This visit will not be saved.';
}

function point(event: PointerEvent): Point {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * WIDTH / bounds.width,
    y: (event.clientY - bounds.top) * HEIGHT / bounds.height,
  };
}

let gesture: {
  pointer: number;
  start: Point;
  last: Point;
  object?: string;
  creature: boolean;
  distance: number;
  offset: Point;
} | undefined;

function select(id?: string) {
  view.selected = id;
  selector.value = id ?? '';
}

canvas.addEventListener('pointerdown', event => {
  if (devBusy || gesture || !event.isPrimary || event.button !== 0) return;
  const position = point(event);
  const creature = hitCreature(world, position);
  const object = creature ? undefined : hitObject(world, position);
  const habitatObject = world.objects.find(candidate => candidate.id === object);
  gesture = {
    pointer: event.pointerId,
    start: position,
    last: position,
    object,
    creature,
    distance: 0,
    offset: habitatObject
      ? { x: habitatObject.position.x - position.x, y: habitatObject.position.y - position.y }
      : { x: 0, y: 0 },
  };
  canvas.setPointerCapture(event.pointerId);
  if (object) select(object);
});

canvas.addEventListener('pointermove', event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const position = point(event);
  gesture.distance += Math.hypot(position.x - gesture.last.x, position.y - gesture.last.y);
  gesture.last = position;
  if (gesture.object && gesture.distance > 3) {
    view.drag = {
      id: gesture.object,
      position: placement(world, gesture.object, {
        x: position.x + gesture.offset.x,
        y: position.y + gesture.offset.y,
      }),
    };
  }
});

canvas.addEventListener('pointerup', event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const completedGesture = gesture;
  const raw = point(event);
  gesture = undefined;
  if (view.drag) {
    const feedingGesture = view.drag.id === 'seedpod'
      && careContext('forage')
      && Math.hypot(raw.x - world.creature.position.x, raw.y - world.creature.position.y) <= 26;
    if (feedingGesture) offerCare('feeding');
    moveObject(world, view.drag.id, view.drag.position, { retarget: !feedingGesture });
    view.drag = undefined;
    persist();
  } else if (completedGesture.creature) {
    const displacement = Math.hypot(raw.x - completedGesture.start.x, raw.y - completedGesture.start.y);
    if (careContext('groom') && completedGesture.distance >= 18 && displacement >= 12) offerCare('grooming');
    else {
      view.reaction = greet(world, completedGesture.distance > 5, visualTime);
      persist();
    }
  } else if (!completedGesture.object && completedGesture.distance < 5) {
    select();
    interact(world, { type: 'invite', position: raw });
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

function cancelGesture() {
  gesture = undefined;
  view.drag = undefined;
}

canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', cancelGesture);
selector.addEventListener('change', () => {
  if (devBusy) return;
  select(selector.value || undefined);
  canvas.focus();
});

canvas.addEventListener('keydown', event => {
  if (devBusy) return;
  if (event.key === 'Escape') {
    select();
    return;
  }
  const delta: Record<string, Point> = {
    ArrowLeft: { x: -5, y: 0 }, ArrowRight: { x: 5, y: 0 }, ArrowUp: { x: 0, y: -5 }, ArrowDown: { x: 0, y: 5 },
  };
  if (view.selected && delta[event.key]) {
    event.preventDefault();
    const object = world.objects.find(candidate => candidate.id === view.selected)!;
    moveObject(world, object.id, {
      x: object.position.x + delta[event.key].x,
      y: object.position.y + delta[event.key].y,
    });
    persist();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    view.reaction = greet(world, event.key === ' ', visualTime);
    persist();
  }
});

document.querySelector('#hello')!.addEventListener('click', () => {
  if (devBusy) return;
  view.reaction = greet(world, false, visualTime);
  persist();
});
document.querySelector('#pet')!.addEventListener('click', () => {
  if (devBusy) return;
  view.reaction = greet(world, true, visualTime);
  persist();
});
document.querySelector('#offer-feed')!.addEventListener('click', () => offerCare('feeding'));
document.querySelector('#offer-groom')!.addEventListener('click', () => offerCare('grooming'));
document.querySelector('#speed')!.addEventListener('change', event => {
  speed = Number((event.target as HTMLSelectElement).value);
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
});
document.querySelector('#catchup')!.addEventListener('click', () => {
  if (devBusy) return;
  advance(world, 3600);
  persist();
  refreshDeveloperPanel(true);
});
document.querySelector('#assist-feed')!.addEventListener('click', () => offerCare('feeding'));
document.querySelector('#assist-groom')!.addEventListener('click', () => offerCare('grooming'));

function resetInteractionState() {
  cancelGesture();
  view = {};
  selector.value = '';
  interactionFeedback.textContent = '';
  accumulator = 0;
  last = performance.now();
}

function replaceWorld(nextWorld: typeof world, message: string) {
  world = nextWorld;
  resetInteractionState();
  seedInput.value = String(world.identitySeed);
  notice.textContent = message;
  persist();
  refreshDeveloperPanel(true);
}

function selectedSeed() {
  const candidate = Math.floor(Number(seedInput.value));
  if (Number.isSafeInteger(candidate) && candidate > 0 && candidate <= 0xffff_ffff) return candidate;
  seedInput.value = String(world.identitySeed);
  return world.identitySeed;
}

function setDeveloperBusy(busy: boolean, message: string) {
  devBusy = busy;
  dev.setAttribute('aria-busy', String(busy));
  dev.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button, select, input')
    .forEach(control => { control.disabled = busy; });
  devProgress.textContent = message;
}

async function runDeveloperJob(
  openingMessage: string,
  job: (progress: (completed: number, total: number) => void) => Promise<void>,
) {
  if (devBusy) return;
  const wasPaused = paused;
  paused = true;
  pauseButton.textContent = 'Resume';
  cancelGesture();
  accumulator = 0;
  setDeveloperBusy(true, openingMessage);
  try {
    await job((completed, total) => {
      devProgress.textContent = `${openingMessage} ${completed}/${total} days`;
      refreshDeveloperPanel(true);
    });
  } catch (error) {
    console.error(error);
    devProgress.textContent = 'Developer simulation could not complete.';
  } finally {
    paused = wasPaused;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    last = performance.now();
    accumulator = 0;
    setDeveloperBusy(false, devProgress.textContent);
  }
}

document.querySelector('#reset')!.addEventListener('click', () => {
  if (devBusy) return;
  replaceWorld(createWorld(selectedSeed()), 'Seeded scenario reset to its juvenile baseline.');
  devProgress.textContent = 'Deterministic baseline restored.';
});

document.querySelector('#advance-development')!.addEventListener('click', () => {
  const days = Number(document.querySelector<HTMLSelectElement>('#dev-days')!.value);
  void runDeveloperJob('Advancing development…', async progress => {
    await advanceDevelopment(world, days, progress);
    persist();
    refreshDeveloperPanel(true);
    devProgress.textContent = `${days} simulated day${days === 1 ? '' : 's'} added.`;
  });
});

document.querySelector('#replay')!.addEventListener('click', () => {
  const days = Number(document.querySelector<HTMLSelectElement>('#dev-days')!.value);
  const preset = document.querySelector<HTMLSelectElement>('#replay-history')!.value as HistoryPreset;
  const seed = selectedSeed();
  void runDeveloperJob('Replaying recorded history…', async progress => {
    const replayed = await replayRecordedHistory(seed, days, preset, progress);
    replaceWorld(replayed, `Replayed ${days} deterministic day${days === 1 ? '' : 's'} from seed ${seed}.`);
    devProgress.textContent = `Replay complete · state ${developmentFingerprint(world)}`;
  });
});

document.querySelector('#compare-histories')!.addEventListener('click', () => {
  const seed = selectedSeed();
  const leftPreset = document.querySelector<HTMLSelectElement>('#history-left')!.value as HistoryPreset;
  const rightPreset = document.querySelector<HTMLSelectElement>('#history-right')!.value as HistoryPreset;
  const leftLabel = HISTORY_PRESETS.find(preset => preset.id === leftPreset)!.label;
  const rightLabel = HISTORY_PRESETS.find(preset => preset.id === rightPreset)!.label;
  void runDeveloperJob('Building same-seed comparison…', async progress => {
    const leftWorld = await replayRecordedHistory(seed, 30, leftPreset, (completed, total) => progress(completed, total * 2));
    const rightWorld = await replayRecordedHistory(seed, 30, rightPreset, (completed, total) => progress(total + completed, total * 2));
    paintAnatomyPair(
      document.querySelector<HTMLCanvasElement>('#history-compare')!,
      leftWorld.creature.anatomy.current,
      rightWorld.creature.anatomy.current,
    );
    document.querySelector('#history-left-label')!.textContent = leftLabel;
    document.querySelector('#history-right-label')!.textContent = rightLabel;
    document.querySelector('#history-summary')!.textContent = comparisonText(leftWorld, rightWorld, leftLabel, rightLabel);
    document.querySelector<HTMLElement>('#history-result')!.hidden = false;
    devProgress.textContent = 'Comparison ready. Saved habitat unchanged.';
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelGesture();
    persist();
  } else {
    const now = Date.now();
    const away = (now - world.lastSaved) / 1000;
    advanceOffline(world, away);
    world.lastSaved = now;
    last = performance.now();
    accumulator = 0;
    persist();
  }
});
window.addEventListener('pagehide', persist);

const actions = {
  idle: 'the clearing', wander: 'a new path', rest: 'a comfortable place', explore: 'something interesting',
  forage: 'a promising patch', groom: 'a grooming spot', wade: 'the shallow water', play: 'a playful possibility',
};
const places: Record<string, string> = {
  'root-shelter': 'the root shelter', 'shallow-pool': 'the pond edge', 'north-vegetation': 'the leafy patch',
  'south-vegetation': 'the low grasses', 'open-clearing': 'the open clearing', 'fallen-branch': 'the fallen branch',
  'warm-stone': 'the warm stone', seedpod: 'the seedpod', 'player-invitation': 'your invitation',
};
const attempts = {
  idle: 'Quietly observing', wander: 'Padding through the clearing', rest: 'Settling in to rest',
  explore: 'Investigating with care', forage: 'Foraging among the leaves', groom: 'Taking care of its coat',
  wade: 'Testing the shallows', play: 'Trying out a little game',
};

function description() {
  const intent = world.creature.intent;
  if (!intent) return 'Taking in the clearing';
  const place = places[intent.opportunityId] ?? actions[intent.activity];
  if (intent.phase === 'notice') return `Noticing ${place}`;
  if (intent.phase === 'approach') return `Heading toward ${place}`;
  if (intent.phase === 'request') return intent.activity === 'forage'
    ? 'Looking toward you, then the seedpod'
    : 'Holding still for a gentle stroke';
  if (intent.phase === 'attempt' && intent.assistanceSource === 'player-feeding') return 'Foraging with your offered seedpod';
  if (intent.phase === 'attempt' && intent.assistanceSource === 'player-grooming') return 'Accepting a little grooming help';
  if (intent.phase === 'attempt') return attempts[intent.activity];
  if (intent.phase === 'outcome') return intent.outcome === 'success'
    ? 'That went well'
    : intent.outcome === 'partial' ? 'Learning as it goes' : 'Deciding to try another way';
  return 'Considering what it learned';
}

function addCell(row: HTMLTableRowElement, value: string, className?: string) {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
}

function refreshDeveloperPanel(force = false, now = performance.now()) {
  if (dev.hidden || (!force && now - lastDevRefresh < 250)) return;
  lastDevRefresh = now;
  anatomyParameters.replaceChildren(...anatomyTableRows(world).map(parameter => {
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = parameter.label;
    row.append(heading);
    addCell(row, parameter.current.toFixed(3), 'numeric');
    addCell(row, parameter.target.toFixed(3), 'numeric');
    addCell(row, `${parameter.delta >= 0 ? '+' : ''}${parameter.delta.toFixed(3)}`, `numeric ${Math.abs(parameter.delta) < 0.0005 ? 'quiet' : ''}`);
    return row;
  }));
  anatomyPressures.replaceChildren(...pressureTableRows(world).map(pressure => {
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = pressure.label;
    row.append(heading);
    addCell(row, pressure.value.toFixed(3), 'numeric');
    const offset = pressure.value - 0.5;
    addCell(row, `${offset >= 0 ? '+' : ''}${offset.toFixed(3)}`, `numeric ${Math.abs(offset) < 0.0005 ? 'quiet' : ''}`);
    return row;
  }));
  paintAnatomyPair(anatomyComparison, world.creature.anatomy.baseline, world.creature.anatomy.current);
  anatomyMeta.textContent = `Day ${(world.time / 86_400).toFixed(2)} · anatomy updated day ${(world.creature.anatomy.lastUpdatedAt / 86_400).toFixed(2)} · state ${developmentFingerprint(world)}`;
  if (rawState.open) {
    inspect.textContent = JSON.stringify({
      time: world.time.toFixed(1),
      identitySeed: world.identitySeed,
      anatomy: world.creature.anatomy,
      activity: world.creature.activity,
      intent: world.creature.intent,
      position: world.creature.position,
      preferences: world.creature.learning.activityPreferences,
      objectInterests: world.creature.learning.objectInterests,
      independence: world.creature.learning.independence,
      evidence: {
        activities: world.development.evidence.activities,
        recent7Days: recentEvidence(world, 7),
        recent30Days: recentEvidence(world, 30),
        recentOutcomes: world.development.evidence.outcomes.slice(-5),
      },
      recent: world.experiences.slice(-6),
    }, null, 2);
  }
}

rawState.addEventListener('toggle', () => refreshDeveloperPanel(true));

function frame(now: number) {
  const elapsed = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!document.hidden) {
    if (!paused) {
      visualTime += elapsed * speed;
      if (view.drag) accumulator = 0;
      else {
        accumulator += elapsed * speed;
        while (accumulator >= STEP) {
          step(world);
          accumulator -= STEP;
        }
      }
    }
    if (view.feedback && view.feedback.until <= visualTime) {
      view.feedback = undefined;
      interactionFeedback.textContent = '';
    }
    renderer.render(context, world, visualTime, view);
    document.querySelector('#status')!.textContent = description();
    refreshDeveloperPanel(false, now);
    if (now - lastSave > 5000) {
      persist();
      lastSave = now;
    }
  }
  requestAnimationFrame(frame);
}

refreshDeveloperPanel(true);
requestAnimationFrame(frame);
