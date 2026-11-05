<div align="center">

<img src="web/public/favicon.svg" alt="PaceCraft Logo" width="96" height="96" />

# PaceCraft

> **Cross-platform, Privacy-first AI Running & Endurance Hub with Local-Only Data Storage**  
> *Break the walled gardens of proprietary sports ecosystems · 100% self-hosted on your machine.*

**English** | [简体中文](README.md)

[![GitHub Release](https://img.shields.io/github/v/release/captainLegoo/PaceCraft?include_prereleases&color=5a7d00&label=Release)](https://github.com/captainLegoo/PaceCraft/releases)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue)](https://github.com/captainLegoo/PaceCraft/releases)
[![License](https://img.shields.io/badge/License-MIT-gray.svg)](#-license--disclaimer)

</div>

**PaceCraft** is built for serious runners and endurance athletes, breaking down the walled gardens of proprietary sports ecosystems (**officially supporting both COROS and Garmin China / Global regions**, with simultaneous multi-watch pairing). It delivers multi-source aggregation, lap-by-lap cleaning, head-to-head dual-watch comparisons, independent capability forecasting, marathon readiness diagnostics, and adaptive AI training plans—all within a 100% self-hosted, local-first environment.

> 🔒 **Privacy Guarantee**: All training records, physiological metrics, and authentication tokens are **100% stored exclusively on your local computer**. No middleman cloud, no telemetry tracking.

---

## ✨ Key Features

- 🏃 **Cross-Ecosystem Watch Integration & Head-to-Head Comparison**
  - **Multi-Brand Pairing**: COROS (Official OAuth 2.0 PKCE & MCP protocol) and Garmin (Official Personal API covering **both Garmin China & Global regions**), supporting simultaneous multi-watch connections.
  - **Conflict Resolution & Micro Comparison**: Automatically detects overlapping workouts between COROS and Garmin to prevent duplicated mileage; aligns laps millisecond-by-millisecond to compare GPS tracks, optical vs. chest strap heart rate, pace drift, and cadence variance.
  - **Physiological Health & HRV Hub**: Synchronizes Garmin overnight sleep stages (Deep/Light/REM), sleep scores, and HRV balance status alongside COROS daily physiological metrics.
  - **Unified Banister EWMA Load Model**: Normalizes Edwards TRIMP across all connected watch brands to calculate Acute Training Load (ATL / fatigue), Chronic Training Load (CTL / fitness), and the Acute:Chronic Workload Ratio (ACWR sweet spot 0.80–1.30).
- 🤖 **AI-Powered 2-Week Rolling Adaptive Training Plan**
  - **Empirical Ground Truth**: Derives Daniels VDOT paces and Karvonen Heart Rate Reserve (HRR) zones directly from your synced watch data, rejecting arbitrary template guessing.
  - **Runner Phenotype Diagnostics**: Identifies whether you are "Endurance-Dominant" (prescribes VO2max intervals & strides) or "Speed-Dominant" (prescribes aerobic base volume).
  - **2-Week Periodized Rolling Cycles**: Follows 80/20 polarization and 3:1 step-load supercompensation (Week 1 Active Execution + Week 2 Rolling Preview).
  - **🏋️ Post-Run Core & Neuromuscular Strength**: Automatically bundles targeted post-run strength routines with running workouts (4 specialized modules: leg stiffness, pelvic stability, anti-rotation, and Achilles tendon recoil).
  - **🔄 Mid-Plan Schedule Hot-Swapping**: Freely adjust training days and long run days at any time with automatic continuity; completed workouts are shielded with **strict physical immutability**.
  - **📊 Transparent Hero Metrics (Responsive UI)**: VDOT, CTL, ATL, TSB, ACWR, and Pw:Hr feature plain-English definitions and scientific brackets; desktop popovers smoothly adapt into **native bottom sheets on mobile devices**.
  - **Closed-Loop Adaptation & Multi-LLM Support (BYOK)**: Weekly one-click reconciliation triggers Advance, Deload, or Prune decisions; supports Claude, DeepSeek, GPT-4o, Qwen, Zhipu GLM, SiliconFlow, and local **Ollama** models.
- 📈 **Independent Performance Prediction (No Vendor Black Boxes)**
  - Replaces vendor closed-source scores with rolling window regressions on real split laps, deriving personalized Riegel fatigue decay exponents and lactate threshold paces.
  - Dynamically weights predictions against your actual 8-week average weekly volume to deliver realistic 5K, 10K, Half Marathon, and Full Marathon confidence intervals.
- 🏁 **Course Profiles & Marathon Readiness Diagnostics**
  - Upload GPX files to inspect 30m high-resolution DEM elevation profiles, computing gradient penalties and sea-level altitude normalization.
  - Rolling 28-day training status monitor: 4-week volume, aerobic decoupling ($Pw:Hr$), and $\ge 28\text{km}$ long-run muscular readiness.
- 👥 **Physical Multi-Profile Isolation**
  - Instant millisecond switching among multiple athletes or family members on a single machine.
  - Dedicated SQLite databases, OAuth credentials, and elevation caches are 100% physically isolated.
- 🖥️ **Lightweight Native Desktop Client & Modern UI**
  - Built with Tauri 2.0 (Rust) for a tiny bundle footprint (20–30 MB), supporting macOS (`.dmg`) and Windows (`.exe`).
  - Adaptive Dark / Light themes with lightning-fast, zero-dependency hand-crafted SVG charts.

---

## 🚀 Quick Start

### Option 1: Desktop Application (Recommended, Out-of-the-Box)

No development environment required:

1. Download the latest installer from the [Releases Page](https://github.com/captainLegoo/PaceCraft/releases):
   - **macOS**: Download `.dmg` and drag PaceCraft to your Applications folder.
   - **Windows**: Download and run `.exe` installer.
2. Launch PaceCraft and click **"Connect Watch"** to authorize your COROS account and/or enter your Garmin API Key.
3. Click **"Sync Now"** to pull your historical training data and begin your training and review cycles.

<details>
<summary>💡 <b>System Security Warnings on First Launch? (macOS & Windows Quick Fix)</b></summary>

<br />

As an independent open-source project without commercial code-signing certificates, some operating systems might display an initial safety prompt:

- **🍎 macOS Users** ("PaceCraft is damaged and cannot be opened" or Gatekeeper prompt):
  - Run the one-line unquarantine command in Terminal: `xattr -cr /Applications/PaceCraft.app`
  - Or go to **System Settings** ➔ **Privacy & Security** ➔ Scroll down and click **Open Anyway**.
- **🪟 Windows Users** ("Windows protected your PC / Microsoft Defender SmartScreen"):
  - Click **More info** on the blue popup ➔ Click **Run anyway**.

</details>

---

### Option 2: Run from Source (Developers & LAN Access)

```bash
# 1. Clone repository
git clone https://github.com/captainLegoo/PaceCraft.git
cd PaceCraft

# 2. Install dependencies and start development server (requires Bun 1.x)
bun install
./dev.sh
```

Navigate to **<http://127.0.0.1:43124>** in your browser.

> 💡 **Mobile LAN Access**: Run `./start.sh lan` in your terminal. Scan the generated QR code with your phone to use it as a full-screen web app.

---

## 🔒 Privacy & Security

- **Local Storage Hierarchy**: All files reside under your home directory `~/.coros-dashboard/` (migrating to `~/.pacecraft/` in future releases):
  ```text
  ~/.coros-dashboard/
  └── profiles/<profile-id>/
      ├── coros.db          # Athlete SQLite database
      ├── tokens.json       # Auth credentials and API keys (chmod 600, user-only readable)
      ├── profile.json      # Profile metadata
      └── fit/              # Elevation and workout FIT cache files
  ```
- **Network Boundaries**: Binds strictly to the loopback interface (`127.0.0.1`) by default, preventing unauthorized exposure across local networks.
- **Data Erasure**: Click "Danger Zone -> Wipe Local Data" in Settings to securely purge all local files, or run `rm -rf ~/.coros-dashboard` in your terminal.

---

## 🧠 Scientific Methodology & Physiology

PaceCraft **rejects black-box vendor scores and unconstrained LLM guessing**. The core design philosophy: **Sports science computes the Ground Truth first; the LLM delivers articulate human coaching; backend guardrails enforce safety.**

### 1. Structured Lap Classification
- Automatically detects pace variance to separate high-intensity work reps from recovery jogs (e.g., identifies `1000m×6 reps @ 3:38`, 165s rest);
- Steady-state runs are shielded from interval false positives; non-steady intervals bypass irrelevant cardiovascular decoupling calculations.

### 2. Race Performance Forecasting
- Slides through continuous split laps to identify true personal best 5K/10K anchors, rejecting stitched-together interval efforts;
- Calibrates Riegel power-law fatigue exponents against your **actual 8-week average weekly mileage** (higher volume increases prediction confidence; lower volume applies conservative decay buffers);
- Regresses pace against heart rate strictly within steady aerobic zones to isolate true lactate threshold pace (88.5% HRmax).

### 3. Load Balance & Injury Prevention
- **Acute-to-Chronic Workload Ratio (ACWR)**: Applies Edwards TRIMP to balance acute fatigue (7 days) and chronic fitness (42 days) within the safe 0.8–1.3 sweet spot;
- **Aerobic Decoupling ($Pw:Hr$)**: Compares first-half vs. second-half pace-to-heart-rate efficiency on steady long runs. Decoupling $<5\%$ confirms a solid aerobic base, while $>8\%$ signals cardiac drift, dehydration, or glycogen depletion.

### 4. Why Are Generated Training Plans So Reliable?
- **Hard-Locked Parameters**: Target pace ranges, heart rate zones, weekly mileage, mandatory rest days, and long run days are fed to the model as immutable Ground Truth;
- **Strict Role Boundaries**: The LLM handles workout warm-up/cool-down splits, form guidance, and encouraging instructions;
- **Backend Safety Net**: If an LLM hallucinates an unscheduled workout on a designated rest day, server-side guardrails automatically intercept and reset it to rest with zero mileage.

<details>
<summary>🔬 <b>Click to expand: Peer-Reviewed Literature & Mathematical Formulations</b></summary>

<br />

1. **Structured Interval Mechanics**: Grounded in **Billat (1996, 2000)** $v\text{VO}_2\max$ interval physiology and **Skiba et al. (2012, 2015, MSSE/IJSPP)** Critical Speed ($CS$) dynamic recovery models.
2. **Daniels & Gilbert (1979) VDOT Exact Bisection Solution**:
   $$\text{VO}_2 = -4.60 + 0.182258 \cdot v + 0.000104 \cdot v^2 \quad (v \text{ in m/min})$$
   $$\%\max = 0.8 + 0.1894393 \cdot e^{-0.012778 \cdot t} + 0.2989558 \cdot e^{-0.1932605 \cdot t} \quad (t \text{ in minutes})$$
   $$\text{VDOT} = \text{VO}_2 / \%\max$$
3. **Riegel (1981) Power Law & Vickers & Vertosick (2016, $n=2303$) Mileage Adjustment**:
   $$k_{\text{Marathon}} = 1.4510756 - 0.23797948 \cdot k_{12} - 0.01410023 \cdot (\text{Weekly Miles} / 10)$$
4. **Banister (1991) TRIMP Impulse-Response**:
   $$\text{TRIMP} = t \cdot \Delta\text{HR} \cdot 0.64 e^{1.92 \cdot \Delta\text{HR}}$$
5. **Altitude & Terrain Compensation**: Grade penalty $1.244\text{ s/km per m/km}$; altitude penalty $2.5\text{ s/km per 1000m}$ based on Saunders et al. altitude running physiology.

</details>

---

## 🛠️ Project Structure

```text
PaceCraft/
├── server/                     # Backend API Service (Bun + Elysia + Drizzle ORM)
│   ├── src/
│   │   ├── coros/              # COROS Adapter (OAuth 2.0 PKCE, MCP Protocol, sync)
│   │   ├── garmin/             # Garmin Adapter (Personal API, FIT parser, sleep/HRV sync)
│   │   ├── conflicts.ts        # Dual-watch conflict detection & deduplication engine
│   │   ├── db/                 # SQLite schema & dynamic multi-profile proxy
│   │   ├── profile-manager.ts  # Multi-athlete profile isolation manager
│   │   ├── prediction/         # Prediction engine & marathon readiness algorithms
│   │   └── ai/                 # LLM context builder & multi-provider integrations
├── web/                        # Frontend Application (React 19 + TypeScript + Vite)
│   ├── src/
│   │   ├── pages/              # Training Dashboard, Session Review & Dual Compare, Races, Health, AI Coach, Settings
│   │   ├── components/         # Profile Switcher, Connect Watch Modal, Strength Library Modal
│   │   └── charts.tsx          # Zero-dependency SVG charts & Heart Rate Reserve (HRR) model
├── src-tauri/                  # Cross-platform desktop shell (Tauri 2.0 / Rust)
└── .github/workflows/          # Automated multi-platform build & release workflows
```

---

## 🗺️ Roadmap

- [x] Multi-profile physical isolation & intelligent incremental sync
- [x] One-click Web OAuth authentication (no terminal required)
- [x] Tauri 2.0 desktop bundles for macOS (`.dmg`) and Windows (`.exe`)
- [x] **Cross-Device Ecosystem**: Official integration with COROS and Garmin (China & Global regions)
- [x] **Dual-Watch Conflict Resolution & Head-to-Head Compare**: Micro-level side-by-side workout analysis
- [x] **Garmin Sleep Stages & Overnight HRV Integration**
- [x] **Cross-Brand Banister EWMA Training Load & ACWR Injury Sweet-Spot Monitor**
- [x] **AI-Powered 2-Week Rolling Training Plan & Closed-Loop Adaptation** (VDOT, HRR, phenotype diagnostics, decision trees)
- [x] **Post-Run Core & Neuromuscular Strength Modules** (4 specialized routines with seamless workout integration)
- [x] **Mid-Plan Schedule Hot-Swapping & Progress Continuity** (Flexible training days, completed workout immutability)
- [x] **Transparent Hero Metrics & Native Mobile Bottom Sheet**
- [ ] **Ecosystem Expansion**: Suunto open platform adapter
- [ ] **Offline File Import**: Drag-and-drop parsing for local `.FIT` and `.GPX` files
- [ ] **Voice / Interactive AI Coach**: Real-time Q&A on workout sensations and recovery advice

---

## 📄 License & Disclaimer

- **License**: Released under the standard [MIT License](LICENSE).
- **Disclaimer**: By using PaceCraft, you acknowledge and agree to all terms in [DISCLAIMER.md](DISCLAIMER.md) ([English Version](DISCLAIMER_EN.md)):
  1. **AI Auxiliary Role & Model Variations**: PaceCraft is a local software tool. All AI insights and workout plans are dynamically derived by user-configured models. Outputs carry inherent algorithmic variations and biases.
  2. **Athletic Safety Priority (RPE First Principle)**: All predictive figures, training load assessments, and AI-generated plans are **athletic simulation references, NOT medical prescriptions**. Subjective physical feedback and safety hold absolute priority. Never force through pain; decelerate or stop if discomfort arises.
  3. **Third-Party Trademarks**: COROS, Garmin, Suunto, and other brand marks belong to their respective owners, with no official affiliation or endorsement.
