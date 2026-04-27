# Seedscape — Phase 11: Dynamic Economy & Full Production Catalog

> Resolves the deferred 4.5 work. With Phase 10's people simulation creating real food demand, prices have something to respond to. Wires the rest of the building catalog and turns the economy from "fixed price list" into a feedback loop.

## Goal

Two large layers, each large enough to be a phase on its own but tightly coupled:
1. **Dynamic pricing** — supply, demand, and player behavior shift NPC offer prices over time, replacing today's fixed `basePrice` table.
2. **Full production catalog** — Juicer, Smelter, Press, Dairy, Forge, Refinery, plus the upgrade-tier UI for buildings already in [data/buildings.json](../../../data/buildings.json) but locked to tier 0.

After Phase 11, every JSON-defined production chain is reachable in-game and prices respond meaningfully to player actions.

## Why now

- Phase 10 created food demand (settlers eat; kitchens consume); without dynamic pricing the player can't feel that demand in the economy.
- Buildings in [data/buildings.json](../../../data/buildings.json) already exist at tier 0–4 in JSON — Phase 11 unlocks them, no new content authoring needed.
- The economy reference [10_economy_system.md](10_economy_system.md) already specs demand multipliers and inflation controls; Phase 11 implements them.
- Phase 12 (settler arrivals) wants a real economy to tune scarcity against (a struggling village can't accept new arrivals).

## Scope

### Dynamic pricing

- Per-item rolling supply/demand counters maintained by the order system.
  - Supply counter: items player has sold this rolling window
  - Demand counter: items NPC orders have requested (whether fulfilled or not)
- Demand multiplier per item: `clamp(0.5, demand / supply, 2.0)`.
- Order generation: NPC offer prices = `basePrice * demandMultiplier * randomNoise`.
- Inflation controls per [10_economy_system.md](10_economy_system.md): floor at 0.5× basePrice, ceiling at 2.0× basePrice; supply cap per tick to prevent flooding.
- Sinks: building placement costs scale with player's coin balance (gentle progressive cost ramp).

### Full production catalog

Wire each building below into the unlock tree, recipe registry, and shop. JSON definitions exist; Phase 11 makes them placeable + functional.

- **Juicer** — produces juice from fruits (carrot juice from carrots; corn syrup from corn; future fruits). Mirrors Mill pattern.
- **Smelter** — requires ore. Phase 11 ships with a placeholder ore that drops from "rocky outcrop" tiles when mined (introduces a `mine` tool action). Output: ingots.
- **Press** — Feed Press for animal feed (closes Phase 9's "shop sells feed" gap). Also Oil Press for cooking oil.
- **Dairy** — consumes milk (Phase 9 produce) → cheese, butter. Multi-output building (extends `BuildingDef` to support multiple output items).
- **Forge** — consumes ingots → tools (later phase consumers). Phase 11 just produces tools as sellable items.
- **Refinery** — endgame: takes refined goods (oil + ingots) → high-value trade goods.

### Building upgrade tiers

- Tier 0 → 4 progression already in JSON. Each tier:
  - Increases output per cycle
  - Decreases cycle time
  - Increases input buffer cap
- Tier UI: Building window gets a "Tier 1/4" indicator + upgrade button costing coins + items per the JSON's `upgradeRecipe`.
- Save migration: SAVE_VERSION 12 → 13 adds per-building `tier: u8`.

### NPC trader expansion

- Grow from 2 NPCs to 3–5 with distinct preference profiles (one wants raw produce, one wants processed, one wants high-tier).
- Standing-orders: an NPC can have a recurring weekly demand the player can pre-commit to (better prices, late penalties).
- NPC schedules: traders only buy during certain day phases (ties Phase 11 to Phase 10's day cycle).

### UI

- Order rows show price trend arrow vs basePrice (↑ ↓ →).
- Shop shows current market price for each sellable item.
- Building window: tier indicator + upgrade panel.
- Optional: a minimal "market history" graph (deferred if pressed for time).

## Out of scope

- Conveyor automation / item routing pipes — explicit "if time" since Phase 4; still post-MVP.
- Player-set sell prices — pricing is system-driven only.
- True commodity exchange / multi-NPC bidding — fixed offer model continues, just with dynamic prices.
- Ore mining beyond rocky outcrops — proper mining + ore variety is later.
- Tier 4+ recipes — JSON tops out at tier 4; Phase 11 ships 0–4, no new tiers added.
- Cross-region trade routes — single-trader-per-region model continues.

## Data shape changes

- **New items:** ingots, oil, cheese, butter, juice variants, tools — all need ids in [data/items.json](../../../data/items.json) (range 800–899 already used for processed goods; extend if needed).
- **New tile ids:** 250 (Juicer), 251 (Smelter), 252 (Press), 253 (Dairy), 254 (Forge), 255 (Refinery).
- **`BuildingDef` extension:** support multiple output items per cycle (Dairy produces both cheese + butter from one milk batch).
- **`OrderBook` extension:** per-item supply/demand counters with a sliding window (~1 in-game day worth of ticks).
- **Save migration:** SAVE_VERSION 12 → 13. Adds per-building tier, market state (supply/demand counters, NPC preference seeds).

## Open questions (decide before kickoff)

1. **Multi-output buildings** — extend `BuildingDef` with `outputs: ItemDef[]` (array) or keep single output and add a sibling building per output? Recommend the array.
2. **Mining** — full mining requires durability/tools from the Forge, recursive dependency. Recommend a single dummy "ore" item that drops from rocky outcrop tiles when right-clicked, no tool requirement, until a later phase.
3. **Inflation tuning** — what's the right window for supply/demand? Too short = volatile, too long = slow feedback. Start with 1 day (1440 ticks); make it tunable in [data/prices.json](../../../data/prices.json).
4. **Standing orders** — full implementation or stretch goal? Recommend stretch goal; ship dynamic pricing + 5 NPCs first.
5. **Coin sink ramping** — placement cost as a function of player balance is unusual; simpler alternative is a flat tax on each sell. Decide based on whether the player feels "rich" or "broken" mid-Phase 11 testing.

## Exit criteria

> Player has a Phase 10 village (multiple settlers eating, sleeping). NPC orders for bread spike when village population is high; bread sells for 1.5× basePrice. Player builds a Dairy → cheese sells well; flooding the market with cheese drops the price 30% over a few days. All seven production buildings are placeable and run end-to-end (raw → processed via settler-driven hauling). At least one building has been upgraded from tier 0 to tier 1 with a visible cycle-time improvement.

## Estimated effort

~10–14 days. Dynamic pricing engine is ~3 days; per-building wiring is ~1 day each (×6 = 6 days); tier UI + multi-output is ~2 days; NPC expansion + standing orders ~2 days.

## References

- [10_economy_system.md](10_economy_system.md) — pricing math + supply/demand spec
- [11_production_system.md](11_production_system.md) — building recipes + tier model
- [12_progression_system.md](12_progression_system.md) — unlock tree extension
- [data/buildings.json](../../../data/buildings.json), [data/prices.json](../../../data/prices.json), [data/unlocks.json](../../../data/unlocks.json)
