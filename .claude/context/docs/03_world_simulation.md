# Seedscape — World Simulation

## Principle

Simulation is deterministic and chunk-based.

---

## Tick System

- Fixed timestep (5–20 TPS)
- Independent from rendering

---

## Core Systems

### Crop Growth
- Seeded RNG determines growth variation
- Time-based progression

---

### Production Simulation
- Queue-based processing
- Input/output transformation rules

---

### Economy Simulation
- Supply/demand driven pricing
- NPC order generation

---

### Animal Systems
- Feeding cycles
- Production outputs
- Happiness modifiers

---

## Determinism Rules

- Must use seeded RNG
- No system time
- Fully reproducible state per chunk

---

## Chunk Simulation Scope

All simulation operates per chunk:
- Crops
- Entities
- Production buildings

