<div align="center">

<img src="web/public/favicon.svg" alt="PaceCraft Logo" width="100" height="100" />

# PaceCraft

> **Cross-platform, Privacy-first AI Running & Endurance Hub with Local-Only Data Storage**  
> *Break the walled gardens of proprietary sports ecosystems · 100% self-hosted on your machine.*

**English** | [简体中文](README.md)

[![GitHub Release](https://img.shields.io/github/v/release/captainLegoo/PaceCraft?include_prereleases&color=5a7d00&label=Release)](https://github.com/captainLegoo/PaceCraft/releases)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue)](https://github.com/captainLegoo/PaceCraft/releases)
[![License](https://img.shields.io/badge/License-MIT-gray.svg)](#-license--disclaimer)

</div>

---

**PaceCraft** is built for serious runners and endurance athletes who demand scientific rigor, granular data control, and ironclad privacy. It breaks down the walled gardens of proprietary sports ecosystems—**officially supporting both COROS and Garmin (both Garmin China & Garmin Global regions)**, with simultaneous multi-watch pairing.

PaceCraft performs lap-by-lap data cleaning, concurrent dual-watch conflict resolution, head-to-head micro comparisons, independent race capability forecasting, marathon readiness diagnostics, and LLM-powered workout debriefing—all entirely within a **zero-telemetry, local-first environment**.

> 🔒 **Privacy Guarantee**: 100% of your training activities, tokens, and physiological metrics are stored exclusively on your local computer. No middleman cloud servers, no tracking, and no data telemetry.

---

## ✨ Key Features

- 🏃 **Cross-Ecosystem Watch Integration & Head-to-Head Comparison**
  - **COROS**: Official Web OAuth 2.0 PKCE authentication and automated incremental sync via official open platform & MCP protocol.
  - **Garmin**: Deep integration with Garmin's official Personal API (**supporting both China & Global regions**), pulling activity timelines and parsing raw `.FIT` files.
  - **Dual-Watch Conflict Resolution & Head-to-Head Compare**: Automatically detects concurrent workouts recorded on both COROS and Garmin, intelligently eliminating duplicate mileage and calories. Provides an in-depth side-by-side comparison of GPS tracks, optical vs. chest strap heart rate, pace drift, and cadence variance.
  - **Multi-Brand Physiological Health & HRV**: Synchronizes Garmin overnight sleep stages (Deep, Light, REM), sleep scores, overnight HRV average, and baseline status alongside COROS daily health, complete with dynamic multi-ecosystem views.
  - **Unified Banister EWMA Training Load & ACWR**: Computes continuous Edwards TRIMP across all connected watch brands to model Acute Training Load (ATL / fatigue), Chronic Training Load (CTL / fitness), and Acute:Chronic Workload Ratio (ACWR sweet spot 0.80–1.30).
- 👥 **Physical Multi-Profile Isolation**
  - Manage multiple athletes or family members on a single machine.
  - Millisecond hot-swapping between profiles with strictly isolated SQLite databases, OAuth credentials, and elevation caches.
- 📈 **Independent Race Capability Forecasting (No Vendor Black Boxes)**
  - Operates independently from vendor-proprietary, closed-source fitness scores.
  - Detects continuous race anchors across historical split laps, filtering out GPS drift and non-continuous intervals.
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

1. Download the latest installer from the [Releases Page](https://github.com/captainLegoo/PaceCraft/releases):
   - **macOS**: Download `.dmg`, open it, and drag PaceCraft to your Applications folder.
   - **Windows**: Download and run `.exe` installer.
2. Launch PaceCraft and click **"Connect Watch"** to authorize your COROS account and/or enter your Garmin Personal API Key (supports simultaneous multi-watch connections).
3. Click **"Sync Now"**, and your historical training and health data will automatically synchronize into your local database!

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
  │       ├── tokens.json       # OAuth tokens and Garmin API keys (chmod 600)
  │       ├── profile.json      # Profile metadata
  │       └── fit/              # Elevation and workout FIT cache files
  └── ...
  ```
- **Credential Protection**: Token files are strictly written with `0o600` permissions (readable solely by the current OS user) and are deeply excluded via `.gitignore`.
- **Network Boundary**: Binds exclusively to the loopback interface (`127.0.0.1`) by default, preventing unauthorized exposure across public or shared networks.
- **Data Erasure & Reset**:
  - **In-App Reset**: Go to Settings -> "Danger Zone" to securely wipe all local profile databases and tokens.
  - **Terminal Manual Cleanup**: If the app has already been uninstalled / moved to trash, run `rm -rf ~/.coros-dashboard` in your terminal to completely wipe all traces.

---

## 🧠 Core Methodology & Physiology

PaceCraft’s predictive and analytical pipeline is **built strictly on empirical lap splits and real-world race records**, completely free from proprietary, black-box vendor scores. Rather than blindly applying elite world-record formulas to recreational runners, PaceCraft models your true endurance using straightforward sports science logic:

### 🏃‍♂️ 1. Structured Workout Classification: No More Interval Mislabeling
- **The Problem**: A runner completes a `1km×6` interval session totaling 10 km including warm-up and cool-down. Most running apps look only at total distance and label it as a "medium-distance easy run", misleading your weekly reports and AI coach into believing you did zero speedwork.
- **The PaceCraft Solution**: PaceCraft examines the **actual cadence and rhythm of every split lap**. It detects pace variance, cleanly separating high-intensity repetitions from slow recovery jogs to identify your exact workout structure (e.g., `1km×6 reps` at 3:38/km with 165s rest).
- **Zero False Positives**: Steady 10 km runs have uniform splits and will never be misclassified as intervals; non-steady interval sessions are automatically shielded from irrelevant "aerobic decoupling" metrics.

### 📈 2. Race Performance Prediction: Realistic & Unbiased
- **No Rest-Stitched Illusions**: PaceCraft slides through continuous splits to locate your true best 5K and 10K efforts. If recovery walks or jogs are detected within a window, the algorithm **strictly rejects stitching them together**, preventing fake "continuous 8 km" efforts from exaggerating your marathon prediction.
- **Dynamic Marathon Decay Adjusted by Real Weekly Mileage**:
  - Classical formulas (like Riegel's) assume world-record fatigue curves, predicting marathon times that are dangerously optimistic for amateur runners (often leading to severe wall-hitting past 30 km);
  - PaceCraft dynamically calibrates your fatigue exponent using your **actual 8-week average weekly volume**—the higher your mileage base, the more confident the prediction; if mileage is modest, the model automatically adds conservative late-race decay buffers.
- **Pure Lactate Threshold Pace**: Regresses heart rate and pace strictly within steady aerobic zones, excluding non-steady interval heart-rate lag to pinpoint your real lactate threshold (88.5% HRmax).
- **Ground-Truth Long Run Comparison**: Benchmarks predictions against your fastest real-world long run ($\ge 40\text{ km}$) with transparent confidence ratings (Tier A / B / C).

### 🏁 3. Race Day Simulation & Readiness Check
- **Course Elevation & Altitude Normalization**: Uphill climbs, downhill benefits, and thin altitude air are converted into flat, sea-level equivalent times, so challenging mountain courses don't skew your baseline.
- **Rolling 28-Day Window**: Anchored strictly to your latest workout date, eliminating misleading dips at the start of calendar weeks and preventing phantom score drift when resting.
- **Long-Run Readiness ($\ge 28\text{ km}$)**: Automatically checks whether you've completed $\ge 28\text{ km}$ efforts in the past 4 weeks to evaluate late-race muscular endurance.

### 💓 4. Physiological Load & Aerobic Decoupling
- **Acute-to-Chronic Workload Ratio (ACWR)**: Exponentially weights heart-rate reserve (TRIMP) to balance acute fatigue (7 days) and chronic fitness (42 days), keeping you within the 0.8–1.3 sweet spot to prevent overtraining injuries.
- **Aerobic Decoupling (Decoupling %)**: Evaluated only on steady-state continuous runs ($\ge 5\text{ km}$). Compares first-half vs. second-half pace-to-heart-rate efficiency. A drift $<5\%$ confirms a rock-solid aerobic base, while $>8\%$ signals cardiovascular strain, dehydration, or glycogen depletion.

<details>
<summary>🔬 <b>Click to expand: Mathematical Formulations & Peer-Reviewed Literature</b></summary>

<br />

1. **Structured Interval Clustering & Intermittent Dynamics**:
   - Grounded in **Billat (1996, 2000)** on $v\text{VO}_2\max$ interval mechanics and **Skiba et al. (2012, 2015, MSSE/IJSPP)** Critical Speed ($CS$) and intermittent work recovery models.
2. **Daniels & Gilbert (1979) VDOT Exact Bisection Solution**:
   - Replaces discrete lookup tables with exact numerical root-finding using the coupled physiological equations:
     $$\text{VO}_2 = -4.60 + 0.182258 \cdot v + 0.000104 \cdot v^2 \quad (v \text{ in m/min})$$
     $$\%\max = 0.8 + 0.1894393 \cdot e^{-0.012778 \cdot t} + 0.2989558 \cdot e^{-0.1932605 \cdot t} \quad (t \text{ in minutes})$$
     $$\text{VDOT} = \text{VO}_2 / \%\max$$
3. **Riegel (1981) Power Law & Vickers & Vertosick (2016, $n=2303$) Mileage Adjustment**:
   - Riegel formula: $T_2 = T_1 \cdot (D_2 / D_1)^k$. Verified across 2,300+ marathoners, weekly volume is the only significant factor explaining marathon fatigue decay:
     $$k_{\text{Marathon}} = 1.4510756 - 0.23797948 \cdot k_{12} - 0.01410023 \cdot (\text{Weekly Miles} / 10)$$
4. **Banister (1991) / Morton TRIMP Impulse-Response**:
   - Heart Rate Reserve exponential weighting: $\text{TRIMP} = t \cdot \Delta\text{HR} \cdot 0.64 e^{1.92 \cdot \Delta\text{HR}}$, driving EWMA ACWR tracking.
5. **Altitude & Terrain Compensation**:
   - Grade penalty $1.244\text{ s/km per m/km}$; altitude penalty $2.5\text{ s/km per 1000m}$ based on Saunders et al. altitude running physiology.

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
│   │   ├── pages/              # Training Dashboard, Session Review & Dual Compare, Races, Health, Settings
│   │   ├── components/         # Profile Switcher, Connect Watch Modal, Pagination
│   │   └── charts.tsx          # Zero-dependency SVG charts & Heart Rate Reserve (HRR) model
├── src-tauri/                  # Cross-platform desktop shell (Tauri 2.0 / Rust)
├── .github/workflows/          # Automated multi-platform build & release workflows
└── scripts/                    # Sidecar binary packaging & deployment scripts
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
- [ ] **Ecosystem Expansion**: Suunto open platform adapter
- [ ] **Offline File Import**: Drag-and-drop parsing for local `.FIT` and `.GPX` files
- [ ] **Dynamic Training Periodization**: Automated plan generator based on rolling fatigue curves (ATL / CTL / TSB)
- [ ] **Voice / Interactive AI Coach**: Real-time Q&A on workout sensations and recovery advice

---

## 📄 License & Disclaimer

- **License**: Released under the standard [MIT License](LICENSE).
- **Disclaimer**: By using PaceCraft, you acknowledge and unconditionally agree to all terms in [DISCLAIMER.md](DISCLAIMER.md) ([English Version](DISCLAIMER_EN.md)), including:
  1. **AI Auxiliary Role & Model Variations**: PaceCraft is a local software tool and does not operate centralized AI services. All AI insights, coach interactions, and workout plans are dynamically derived by user-configured models. Outputs vary significantly across model architectures, parameter sizes, and prompt variations, and carry inherent algorithmic biases.
  2. **AI Workout Plans & Athletic Safety (Body Signals Priority)**: All predictive figures, training load assessments, and AI-generated periodized plans are **athletic simulation references, NOT medically certified prescriptions**. The athlete's real-time subjective physical feedback (RPE) and safety hold absolute priority. Never force through pain or blindly comply with AI targets; immediately decelerate or stop if discomfort arises. All athletic risks are assumed solely by the user.
  3. **Third-Party Trademarks**: COROS, Garmin, Suunto, and other associated brand marks belong to their respective owners. PaceCraft is an independent third-party open-source application with no official affiliation or endorsement.
