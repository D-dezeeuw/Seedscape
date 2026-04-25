# Seedscape — Game Design Document (Core)

## Core Gameplay Loop

Plant → Grow → Harvest → Process → Sell → Expand

---

## Systems Overview

### Farming System
- Crop lifecycle:
  Seed → Growth → Mature → Harvest → Decay

- Influenced by:
  - Time
  - Water
  - Fertilizer
  - Biome modifiers

---

### Production System
Buildings transform resources:

- Mill → Flour
- Bakery → Bread
- Dairy → Cheese

Each building:
- Queue-based processing
- Time-based completion
- Upgradeable efficiency

---

### Economy System
- Coins (soft currency)
- NPC demand system
- Dynamic pricing via supply/demand pressure

---

### Expansion System
- Unlock new chunks
- Fog-of-war map expansion
- Increasing cost curve per expansion radius

---

### NPC Orders
- Requests for goods
- Reward scaling based on rarity and complexity

---

### Progression
- XP-based leveling
- Unlock crops, buildings, systems

---

## Game Loops

### Idle Loop
- Offline crop growth

### Optimization Loop
- Production chain efficiency

### Expansion Loop
- Unlock world chunks

### Economy Loop
- Fulfill demand cycles

