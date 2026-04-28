// Game Guide — long-form, player-facing documentation. Each chapter
// covers one milestone of gameplay that's actually shipped, written as
// what the player can do (not what the engine does). The Help FAB is
// for quick reference; the Guide is for "I've never played this — walk
// me through it."
//
// Layout: a left sidebar with the chapter list (click to jump) and a
// right content pane. Bottom-row Prev / Next buttons let the player
// read sequentially without breaking flow back to the sidebar.
//
// Adding a chapter: append to CHAPTERS. Order matches the natural
// player progression (basics → economy → settlers → possession →
// animals/irrigation), not the technical phase numbering.

import { makeWindow, type UiWindow } from "./window";

interface Chapter {
  id: string;
  title: string;
  // HTML body. Keep paragraphs short and bold the in-game UI labels —
  // the goal is "skim and act," not a manual you read end-to-end.
  body: string;
}

const CHAPTERS: ReadonlyArray<Chapter> = [
  {
    id: "welcome",
    title: "Welcome",
    body: `
      <p>Seedscape is an open-ended farming &amp; village sim. There's no fail state and no fixed ending — grow what interests you, at your own pace. This guide walks the systems in the order they tend to unlock.</p>
      <p><b>You start with:</b> 30 coins, 4 carrot seeds, two settlers, and a small tilled patch beside them. The 30 coins are exactly enough for one <b>Storage Crate</b> from the Shop — placing it lets the settlers start depositing harvests for you.</p>
      <p><b>Suggested first moves:</b></p>
      <ol>
        <li>Pick the <b>Plant</b> tool, choose Carrot in the seed row, and plant the four tilled tiles.</li>
        <li>Open the <b>Shop</b> and buy a Storage Crate. Place it next to the patch.</li>
        <li>Water the carrots; the settlers will harvest and deposit when they ripen.</li>
        <li>Sell carrots to the <b>Trader</b> for coins and XP. Use the proceeds to scale up.</li>
      </ol>
      <p><b>What you'll find in this guide:</b></p>
      <ol>
        <li><b>Your World</b> — controls, camera, the world seed.</li>
        <li><b>Farming Basics</b> — till, plant, water, harvest.</li>
        <li><b>Economy &amp; Trade</b> — coins, XP, the Shop and Trader.</li>
        <li><b>Production Chain</b> — Mill, Bakery, processed goods.</li>
        <li><b>Settlers</b> — autonomous helpers and the infrastructure they need.</li>
        <li><b>Possession</b> — drive a settler in first person.</li>
        <li><b>Production Hauling</b> — settlers running the whole chain unattended.</li>
        <li><b>Animals &amp; Irrigation</b> — pens, produce, Wells, Sprinklers.</li>
        <li><b>Hunger &amp; Food</b> — settlers eat or die; what counts as food.</li>
      </ol>
      <p>Pick a chapter from the list on the left, or step through with <b>Next</b>. Hit the <b>?</b> button in the corner any time to come back.</p>
    `,
  },
  {
    id: "world",
    title: "1. Your World",
    body: `
      <p>Seedscape drops you into <b>Bloomridge</b>, a procedurally generated farming world. The land is unique to your seed — drag the canvas to explore, scroll to zoom. <b>WASD</b> or arrow keys also pan when no settler is possessed.</p>
      <p>Your goal is open-ended: build a farm, grow a village, run a production chain. There's no fail state. Take your time.</p>
      <p>The world autosaves continuously. Close the tab and come back; everything's where you left it.</p>
    `,
  },
  {
    id: "farming",
    title: "2. Farming Basics",
    body: `
      <p>Four tools turn raw ground into food:</p>
      <ul>
        <li><b>Till</b> — break soil into farmland.</li>
        <li><b>Plant</b> — drop a seed on a tilled tile. The seed row above the toolbar lets you pick which one.</li>
        <li><b>Water</b> — dry crops grow slowly. Watered ones thrive.</li>
        <li><b>Harvest</b> — pick when the crop is fully grown.</li>
      </ul>
      <p>Two settlers and a small starter patch sit near your spawn so you can try the loop immediately. Wheat is unlocked from the start; carrots and corn arrive at higher levels.</p>
    `,
  },
  {
    id: "economy",
    title: "3. Economy & Trade",
    body: `
      <p>The <b>Trader</b> panel posts standing orders for items in your inventory. Click <b>Sell</b> to fulfil one — coins land, XP ticks up.</p>
      <p>The <b>Shop</b> sells seeds and arms buildings for placement. Building rows show their coin cost; locked items appear greyed out until you reach the required level.</p>
      <p>Levelling up unlocks new seeds and buildings. Watch the HUD's XP bar; the level-up toast tells you what just opened up.</p>
    `,
  },
  {
    id: "production",
    title: "4. Production Chain",
    body: `
      <p>Raw produce sells fine, but processed goods sell for more. The first chain is wheat &rarr; <b>Mill</b> &rarr; flour &rarr; <b>Bakery</b> &rarr; bread.</p>
      <p>Click an active building (Mill, Bakery) to open its window. You can manually deposit input items and withdraw output, but settlers will do it for you once a Storage Crate exists nearby.</p>
      <p>Place buildings close to each other — every tile a settler walks is time not spent producing.</p>
    `,
  },
  {
    id: "settlers",
    title: "5. Settlers",
    body: `
      <p>You're not alone. Settlers are autonomous: they water thirsty crops, harvest ripe ones, plant empty tilled tiles, and haul produce — without instruction.</p>
      <p>For autonomy to work, give them infrastructure:</p>
      <ul>
        <li><b>Storage Crate</b> — gives settlers a place to deposit harvests.</li>
        <li><b>Seed Dispenser</b> — stocked seeds let settlers plant empty tilled tiles on their own.</li>
      </ul>
      <p>Click any settler to open their details panel. The eye icon centres the camera; the Possess button hands you the wheel.</p>
    `,
  },
  {
    id: "possession",
    title: "6. Possession",
    body: `
      <p>Possess a settler to play in first person. The camera locks on, the action toolbar disappears, and a single contextual <b>action bar</b> takes its place at the bottom of the screen.</p>
      <p><b>WASD</b> or arrow keys move; <b>E</b> performs the action shown in the bottom bar — open a crate, water a crop, plant a seed, fill a water bucket. The yellow tile reticle ahead of you shows what E will hit.</p>
      <p><b>ESC</b> releases possession. The action bar tells you what's possible at any moment; if it greys out, the tile in front of you doesn't accept that action.</p>
    `,
  },
  {
    id: "hauling",
    title: "7. Production Hauling",
    body: `
      <p>Settlers don't just farm — they run the production chain end-to-end. They'll haul wheat from a crate to the Mill, wait for flour to come out, and carry it to the Bakery (or to another crate).</p>
      <p>Two new behaviours kick in once a building exists:</p>
      <ul>
        <li><b>Feed</b> — when a Mill or Bakery's input runs low, an idle settler hauls more from the nearest matching crate.</li>
        <li><b>Haul output</b> — finished goods get pulled out of the building's output buffer and delivered to a crate.</li>
      </ul>
      <p>The result: place buildings + crates, then watch the chain run itself.</p>
    `,
  },
  {
    id: "animals",
    title: "8. Animals & Irrigation",
    body: `
      <p>Two layers of farm life on top of crops:</p>
      <p><b>Irrigation:</b> a <b>Well</b> auto-waters a 3&times;3 patch around it; a <b>Sprinkler</b> reaches 5&times;5 and refills twice as often. Place either next to a farm from the Shop and you can forget the water tool exists. Watered tiles visibly darken so you can see the reach.</p>
      <p><b>Animals:</b> from the Shop, place pen tiles (Chicken Pen 80c, Cow Pen 200c) — adjacent tiles form a fenced pen, and each tile holds one animal. Then buy a <b>Chicken</b> (50c) or <b>Cow</b> (200c); the new resident appears at the nearest empty pen tile of that species. If no empty pen exists, the shop tells you to place one first.</p>
      <p><b>Feeding &amp; collecting:</b> animals decay hunger over time. Stock a Storage Crate with <b>Animal Feed</b> from the Shop — settlers will haul feed to your pens automatically and collect eggs / milk from the pen output buffer back to a crate. A starving animal stops producing until it's fed.</p>
      <p>Eggs and milk sell at the Trader for early-game income. A future update will route them through processing buildings (Bakery's egg recipe, Dairy) for richer chains.</p>
    `,
  },
  {
    id: "hunger",
    title: "9. Hunger & Food",
    body: `
      <p>Settlers get hungry. Their hunger drops slowly every game-tick — a settler that's never fed will starve in about ten minutes of real time. The <b>Person window</b> shows each settler's hunger as a coloured bar: green when full, amber as they get peckish, red when they're in trouble.</p>
      <p><b>What counts as food:</b></p>
      <ul>
        <li><b>Bread</b> — the most filling meal in the village.</li>
        <li><b>Corn</b> — solid, two-thirds the value of bread.</li>
        <li><b>Carrots</b> — quick and reliable, half a meal.</li>
        <li><b>Eggs</b> — a small snack, less filling than vegetables.</li>
        <li><b>Wheat / flour / milk</b> are <i>ingredients</i>, not food. Settlers won't eat them raw.</li>
      </ul>
      <p><b>How they eat:</b> when a settler's hunger drops below 40%, they pause whatever they're doing at the next idle moment and walk to the nearest <b>Storage Crate</b> that holds food. They take one item and eat it — restoring hunger by the food's value, then resume work.</p>
      <p><b>Death:</b> if a settler's hunger reaches 0 they die. The entity is removed and a toast announces it. Keep at least one crate near your village stocked with food — early game, that's just the carrots from your starter patch.</p>
      <p>Phase 10.2 will add sleep, exhaustion, beds, kitchens, and the rest of the daily-needs cycle.</p>
    `,
  },
];

interface Deps {
  parent: HTMLElement;
}

export function createGuideWindow(deps: Deps): UiWindow {
  const panel = document.createElement("div");
  panel.className = "ss-panel ss-guide";
  panel.innerHTML = `
    <h3>Game Guide</h3>
    <div class="ss-guide-layout">
      <nav class="ss-guide-toc" data-field="toc"></nav>
      <div class="ss-guide-content">
        <div data-field="body"></div>
        <div class="ss-guide-nav">
          <button class="ss-btn" data-act="prev">&larr; Prev</button>
          <span class="ss-guide-counter" data-field="counter"></span>
          <button class="ss-btn" data-act="next">Next &rarr;</button>
        </div>
      </div>
    </div>
  `;
  deps.parent.appendChild(panel);

  const tocEl = panel.querySelector('[data-field="toc"]') as HTMLElement;
  const bodyEl = panel.querySelector('[data-field="body"]') as HTMLElement;
  const counterEl = panel.querySelector('[data-field="counter"]') as HTMLElement;
  const prevBtn = panel.querySelector('[data-act="prev"]') as HTMLButtonElement;
  const nextBtn = panel.querySelector('[data-act="next"]') as HTMLButtonElement;

  let currentIdx = 0;

  const tocButtons: HTMLButtonElement[] = [];
  CHAPTERS.forEach((chapter, idx) => {
    const btn = document.createElement("button");
    btn.className = "ss-guide-toc-item";
    btn.textContent = chapter.title;
    btn.addEventListener("click", () => goTo(idx));
    tocEl.appendChild(btn);
    tocButtons.push(btn);
  });

  const goTo = (idx: number): void => {
    if (idx < 0 || idx >= CHAPTERS.length) return;
    currentIdx = idx;
    const chapter = CHAPTERS[idx];
    if (!chapter) return;
    // Title via textContent so raw "&" in chapter titles ("Animals &
    // Irrigation") renders cleanly without HTML-entity escaping.
    bodyEl.innerHTML = chapter.body;
    const titleEl = document.createElement("h2");
    titleEl.className = "ss-guide-title";
    titleEl.textContent = chapter.title;
    bodyEl.insertBefore(titleEl, bodyEl.firstChild);
    counterEl.textContent = `${idx + 1} / ${CHAPTERS.length}`;
    prevBtn.disabled = idx === 0;
    nextBtn.disabled = idx === CHAPTERS.length - 1;
    for (let i = 0; i < tocButtons.length; i++) {
      tocButtons[i]?.classList.toggle("ss-active", i === idx);
    }
    // Scroll content back to top so a long chapter doesn't open
    // mid-page when the player jumps from a lower one.
    bodyEl.parentElement?.scrollTo({ top: 0 });
  };

  prevBtn.addEventListener("click", () => goTo(currentIdx - 1));
  nextBtn.addEventListener("click", () => goTo(currentIdx + 1));

  goTo(0);

  return makeWindow(panel, () => {});
}
