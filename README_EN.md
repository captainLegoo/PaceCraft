<div align="center">

# PaceCraft

> **Cross-platform, Privacy-first AI Running & Endurance Hub with Local-Only Data Storage**  
> *Break the walled gardens of proprietary sports ecosystems · 100% self-hosted on your machine.*

**English** | [简体中文](README.md)

[![GitHub Release](https://img.shields.io/github/v/release/captainLegoo/PaceCraft?color=5a7d00&label=Release)](https://github.com/captainLegoo/PaceCraft/releases)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue)](https://github.com/captainLegoo/PaceCraft/releases)
[![License](https://img.shields.io/badge/License-MIT-gray.svg)](#-license--disclaimer)

</div>

---

**PaceCraft** is built for serious runners and endurance athletes who demand scientific rigor, granular data control, and ironclad privacy. It frees your workout metrics from proprietary vendor silos (initial first-class support for **COROS**, with Garmin and Suunto integrations on the roadmap). 

PaceCraft performs lap-by-lap data cleaning, independent race capability forecasting, marathon readiness diagnostics, and LLM-powered workout debriefing—all entirely within a **zero-telemetry, local-first environment**.

> 🔒 **Privacy Guarantee**: 100% of your training activities, tokens, and physiological metrics are stored exclusively on your local computer. No middleman cloud servers, no tracking, and no data telemetry.

---

## ✨ Key Features

- 🏃 **Cross-Ecosystem Watch Integration**
  - **COROS**: Seamless Web OAuth 2.0 PKCE authentication and automated incremental sync via official open platform & MCP protocol.
  - **Multi-Device Roadmap**: Garmin Connect / Suunto adapters and direct offline `.FIT` file ingestion.
- 👥 **Physical Multi-Profile Isolation**
  - Manage multiple athletes or family members on a single machine.
  - Millisecond hot-swapping between profiles with strictly isolated SQLite databases, OAuth credentials, and elevation caches.
- 📈 **Independent Race Capability Forecasting (No Vendor Black Boxes)**
  - Detects continuous race anchors across split laps, filtering out GPS drift and non-continuous intervals.
  - Regresses personalized lactate threshold pace (88.5% HRmax equivalent) and individual Riegel fatigue decay factor ($k$).
  - Outputs multi-model weighted predictions (5K, 10K, Half Marathon, Full Marathon) with statistical confidence intervals and sea-level altitude normalization.
- 🏁 **Course Profiles & Marathon Readiness Diagnostics**
  - Upload GPX files to inspect 30m high-resolution DEM elevation profiles, calculate net gradient, and evaluate descent compensation.
  - Rolling 4-week training monitor: ACWR (Acute:Chronic Workload Ratio), aerobic volume ratios, and long run milestones.
  - Aerobic decoupling detection ($Pw:Hr$ drift) for steady-state endurance runs.
- 🤖 **AI In-Depth Debriefing & Smart Coach (BYOK)**
  - Connect your preferred LLM provider via **Bring Your Own Key**: Claude, DeepSeek, OpenAI, Qwen/DashScope, Zhipu GLM, SiliconFlow, or local models via **Ollama**.
  - **Session-Level Debriefing**: Automatically reconstructs complex intervals (e.g., `10 × 1km`) and terrain penalties to prevent false "fade" flags.
  - **Objective Boundaries**: AI coach prompts are strictly constrained to data interpretation and observations—no dangerous or unvetted prescriptions.
- 🖥️ **Lightweight Native Desktop Client & Modern UI**
  - Built with Tauri 2.0 (Rust) for a tiny bundle footprint (20–30 MB), supporting macOS (`.dmg`) and Windows (`.exe`).
  - Adaptive Dark / Light themes with lightning-fast, zero-dependency hand-crafted SVG charts.

---

## 🚀 Quick Start

### Option 1: Desktop Application (Recommended, Out-of-the-Box)

No need to install Node.js, Bun, or use terminal commands:

1. Download the latest installer from the [Releases Page](../../releases):
   - **macOS**: Download `.dmg`, open it, and drag PaceCraft to your Applications folder.
   - **Windows**: Download and run `.exe` installer.
2. Launch PaceCraft and follow the UI prompt to click **"Connect COROS Account"** for browser-based OAuth authorization.
3. Your historical training data will automatically synchronize into your local database!

> [!TIP]
> **System Security Warnings on First Launch? (macOS & Windows Quick Fix)**
> 
> As an independent open-source project without commercial code-signing certificates, some operating systems might display an initial safety warning for downloaded files:
> 
> - **🍎 macOS Users ("PaceCraft is damaged and cannot be opened")**
>   - **Method 1 (Terminal, Recommended)**: Run `xattr -cr /Applications/PaceCraft.app` in Terminal.
>   - **Method 2 (System Settings)**: Open **System Settings** ➔ **Privacy & Security** ➔ Scroll to Security section and click **"Open Anyway"**.
>   - **Method 3 (Control-Click)**: In Finder's Applications folder, hold `Control` and click `PaceCraft.app`, select **"Open"**.
> 
> - **🪟 Windows Users ("Windows protected your PC / Microsoft Defender SmartScreen")**
>   - Click the underlined **"More info"** link on the blue prompt ➔ Click the **"Run anyway"** button that appears. This only prompts once during initial installation.

---

### Option 2: Run from Source (Developers & LAN Access)

Ideal for contributors or those wishing to access the dashboard on a mobile device over the local network:

#### Prerequisites
- [Bun](https://bun.sh/) 1.x: `curl -fsSL https://bun.sh/install | bash`
- An active internet connection for initial dependency resolution and API sync.

```bash
# 1. Clone the repository
git clone https://github.com/captainLegoo/PaceCraft.git
cd PaceCraft

# 2. Install dependencies
bun install

# 3. Start local development server with hot-reload
./dev.sh
```

Navigate to **<http://127.0.0.1:43124>** in your browser.

> 💡 **Mobile LAN Access**: Run `./start.sh lan` in your terminal. Scan the generated QR code or enter your local IP into your mobile browser. You can tap "Add to Home Screen" to use it as a fullscreen web app.

---

## 🔒 Privacy & Security Architecture

- **Local Storage Hierarchy**: All databases and access tokens reside under your system user directory:
  ```text
  ~/.coros-dashboard/
  ├── profiles/
  │   └── <profile-id>/
  │       ├── coros.db          # Athlete SQLite database
  │       ├── tokens.json       # OAuth tokens (strictly chmod 600)
  │       ├── profile.json      # Profile metadata
  │       └── fit/              # Elevation FIT cache files
  └── ...
  ```
- **Credential Protection**: OAuth token files are strictly written with `0o600` permissions (readable solely by the current OS user) and are deeply excluded via `.gitignore`.
- **Network Boundary**: Binds exclusively to the loopback interface (`127.0.0.1`) by default, preventing unauthorized exposure across public or shared networks.
- **Data Erasure & Reset**:
  - **In-App Reset**: Go to Settings -> "Danger Zone" to securely wipe all local profile databases and tokens.
  - **Terminal Manual Cleanup**: If the app has already been uninstalled / moved to trash, run `rm -rf ~/.coros-dashboard` in your terminal to completely wipe all traces.

---

## 🧠 Race Prediction Engine

Rather than relying on closed-source, vendor-controlled fitness scores, PaceCraft's predictive model is grounded in empirical lap data:

1. **Anchor Extraction**: Scans contiguous split laps using a dynamic sliding window to pinpoint best efforts while discarding GPS leaps or rest-stitched segments.
2. **Lactate Threshold Regression**: Fits an exponential regression curve over aerobic heart rate and pace pairings to calculate velocity at 88.5% HRmax.
3. **Personalized Riegel Exponent ($k$)**: Pairs homologous intensity efforts across historical records to compute your individual endurance decay rate (typically $1.05 \le k \le 1.15$).
4. **Weighted Ensemble**: Weights models by anchor distance tier (Tier A: $\ge 15\text{ km}$, Tier B: $8\text{--}15\text{ km}$, Tier C: $\le 5\text{ km}$) and generates realistic performance boundaries.

---

## 🛠️ Project Structure

```text
PaceCraft/
├── server/                     # Backend API Service (Bun + Elysia + Drizzle ORM)
│   ├── src/
│   │   ├── coros/              # COROS Adapter (OAuth 2.0 PKCE, MCP Protocol, sync)
│   │   ├── db/                 # SQLite schema & dynamic multi-profile proxy
│   │   ├── profile-manager.ts  # Multi-athlete profile isolation manager
│   │   ├── prediction/         # Prediction engine & marathon readiness algorithms
│   │   └── ai/                 # LLM context builder & multi-provider integrations
├── web/                        # Frontend Application (React 19 + TypeScript + Vite)
│   ├── src/
│   │   ├── pages/              # Training Dashboard, Session Review, Races, Health, Settings
│   │   ├── components/         # Profile Switcher, Onboarding Cards, Pagination
│   │   └── charts.tsx          # Zero-dependency SVG charts & aerobic decoupling
├── src-tauri/                  # Cross-platform desktop shell (Tauri 2.0 / Rust)
├── .github/workflows/          # Automated multi-platform build & release workflows
└── scripts/                    # Sidecar binary packaging & deployment scripts
```

---

## 🗺️ Roadmap

- [x] Multi-profile physical isolation & intelligent incremental sync
- [x] One-click Web OAuth authentication (no terminal required)
- [x] Tauri 2.0 desktop bundles for macOS (`.dmg`) and Windows (`.exe`)
- [ ] **Multi-device Ecosystem**: Garmin Connect & Suunto open platform adapters
- [ ] **Offline File Import**: Drag-and-drop parsing for `.FIT` and `.GPX` files
- [ ] **Dynamic Training Periodization**: Automated plan generator based on rolling fatigue curves (ATL / CTL / TSB)
- [ ] **Voice / Interactive AI Coach**: Real-time Q&A on workout sensations and recovery advice

---

## 📄 License & Disclaimer

- **License**: Released under the [MIT License](LICENSE).
- **Disclaimer**: By using PaceCraft, you acknowledge and agree to the terms in [DISCLAIMER.md](DISCLAIMER.md):
  1. **AI Auxiliary Role**: PaceCraft is a local software tool and does not operate centralized AI services. AI-generated analysis is for informational purposes only.
  2. **Health & Medical**: Predictive figures and AI feedback do not constitute medical diagnoses or prescriptive exercise advice. Endurance sports entail physical risk; train rationally within your physiological limits.
  3. **Trademarks**: COROS, Garmin, Suunto, and other associated brand marks are the property of their respective owners. PaceCraft is an independent third-party application.
