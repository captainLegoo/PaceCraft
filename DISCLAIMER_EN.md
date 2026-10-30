# PaceCraft Legal Disclaimer

[简体中文版](DISCLAIMER.md)

Thank you for using **PaceCraft** ("the Software"). Before using the Software, please carefully read and fully understand all terms of this Legal Disclaimer. By using, modifying, distributing, or running the Software, you acknowledge that you have read, understood, and agreed to be bound by all terms herein. If you do not agree with any part of this Disclaimer, please immediately stop using and uninstall the Software.

---

## 1. Generative Artificial Intelligence (AI) Services & Content Disclaimer

1. **Software Nature & Service Characterization**:
   - The Software is an open-source, **local-first client application**. The developers and open-source contributors of the Software **do not operate, host, or provide any centralized generative AI cloud service**, nor do they act as an API proxy or relay intermediary.
   - The Software operates strictly on a **BYOK (Bring Your Own Key)** model. Users independently configure their own API keys and endpoints from third-party model providers (e.g., DeepSeek, Alibaba Cloud Bailian, Zhipu AI, OpenAI, Anthropic, etc.) or local offline runtime engines (e.g., Ollama).
2. **AI Content Accuracy & Liability**:
   - All AI-generated workout reviews, training insights, race predictions, and coach feedback displayed in the Software are derived dynamically by third-party large language models (LLMs) configured directly by the user based on raw workout metrics.
   - Given the inherent nature of LLMs—including algorithmic hallucinations, stochastic inference variations, and knowledge cutoffs—**the developers and contributors make no representations or warranties of any kind, express or implied, regarding the accuracy, completeness, authenticity, reliability, or fitness for a particular purpose of any AI-generated output**.
3. **Model Discrepancies, Prompt Sensitivity & Individual Variations**:
   - The underlying models chosen by users differ fundamentally in architecture, training datasets, parameter size, and alignment mechanisms (e.g., frontier commercial models vs. lightweight quantized local models). Furthermore, LLM responses are sensitive to prompt phrasing, context depth, and inference parameters.
   - **For identical historical training metrics, different LLMs, varying prompts, or inquiries made at different times may yield markedly conflicting suggestions, differing intensity zones, or impractical workout prescriptions.**
   - Large language models perform probability-based textual reasoning on limited sensor metrics. **They cannot perceive, nor can they substitute for, clinical medical evaluations of a user's real-time physiological status** (including but not limited to latent cardiovascular anomalies, prior orthopedic injuries, acute tendon/bone pain, acute electrolyte imbalance, fatigue and sleep deficit, misconfigured baseline heart rate zones, or adverse environmental weather conditions). Users must never treat general AI outputs as infallible, risk-free, or bespoke clinical plans.
4. **User Legal Compliance**:
   - When calling AI interfaces via the Software, users must comply with all applicable local, national, and international laws and regulations.
   - Users are strictly prohibited from using the Software or connected AI models to engage in activities that infringe upon third-party rights, disseminate unlawful or fabricated information, or violate public order.

---

## 2. Sports Health, Medical & Personal Safety Disclaimer

1. **Not a Medical Device & Not Medical Advice**:
   - All calculations, metrics, and models presented by the Software (including but not limited to ACWR training load ratio, aerobic decoupling rate, estimated VO2 Max, race time predictions, and heart rate zone distributions), as well as AI coach commentary, **are provided solely as quantitative reference tools and athletic training simulations. They do NOT constitute medical diagnoses, pathological assessments, medical prescriptions, or mandatory exercise directives**.
2. **AI Workout Plans & Training Execution Special Disclaimer**:
   - **Informational Simulation Only**: Features such as "AI Periodized Training Plan Generation," "Long Slow Distance (LSD) Guidance," "Interval Speedwork Design," or "AI Coach Dialogue" are **exploratory simulation frameworks based on statistical heuristics and user prompts. They carry NO medical or personal safety warranty whatsoever.**
   - **Absolute Priority of Body Signals (No Blind Compliance)**:
     - Prior to executing any AI-generated workout or session, users must independently assess their current physical readiness, joint/muscle sensations, and fatigue levels.
     - **During physical training, the user's subjective bodily sensations (Rate of Perceived Exertion - RPE) and personal safety hold absolute priority over any AI recommendation.** If you experience chest tightness, chest pain, palpitations, dizziness, nausea, acute joint or bone pain, or abnormal exhaustion, **you must immediately decelerate, curtail your mileage, or terminate the workout**. Never force through pain or blindly adhere to AI-prescribed paces and heart rate targets.
   - **Waiver of Liability for Injury or Accidents**: The developers and open-source contributors shall NOT be liable for any acute or chronic athletic injuries (including but not limited to stress fractures, Achilles tendinopathy, plantar fasciitis, bursitis, or rhabdomyolysis), aggravation of underlying conditions, or accidental injury/death resulting from following AI-generated workout plans, overtraining, or training while impaired/injured. All associated risks are voluntarily and entirely assumed by the user.
3. **Assumption of Athletic Risk**:
   - Marathon running, trail running, and endurance athletics are inherently strenuous, high-risk physical activities that entail cardiovascular strain, musculoskeletal stress, dehydration, heat-related illness, and potential life-threatening events.
   - Users must consult certified medical professionals or licensed athletic coaches to undergo comprehensive physical examinations before undertaking strenuous training programs.
   - **To the maximum extent permitted by law, the developers and contributors of the Software disclaim any liability for personal injury, illness, property loss, or incidental damages arising out of or in connection with the use of the Software, its algorithmic projections, or its AI recommendations.**

---

## 3. Third-Party Trademarks, Copyright & API Compliance

1. **Trademark Ownership**:
   - Brand names, logos, and trademarks appearing in this project, including but not limited to "COROS", "Garmin", and "Suunto", are the registered property of their respective owners (such as Guandong COROS Sports Technology Joint Stock Company, Garmin Ltd., Suunto Oy, etc.).
   - PaceCraft is an independent, third-party open-source project and maintains no official affiliation, sponsorship, endorsement, or commercial partnership with any of the aforementioned companies.
2. **Open APIs & Data Legitimacy**:
   - The Software interacts with external ecosystems strictly via officially published open protocols (such as COROS MCP Open Protocol, standard OAuth 2.0 PKCE authentication) or standard industry file specifications (e.g., `.FIT`, `.GPX`) for local sync and parsing.
   - All data synchronization requires explicit, authorized consent from the individual user. The Software contains no routines for decrypting proprietary formats, circumventing paywalls, or compromising computer system integrity.
   - Users syncing data via third-party services must also abide by the respective hardware manufacturers' *Terms of Service* and *Developer Platform Agreements*.

---

## 4. Personal Data Privacy & Security

1. **100% Local Storage**:
   - The Software persists GPS tracks, split laps, and physiological metrics locally on the user's personal device (`~/.coros-dashboard/` or profile-specific directories). The project operates no centralized cloud telemetry to collect, store, profile, or monetize personal sensitive data.
2. **Network & LAN Risks**:
   - The Software binds exclusively to the local loopback interface (`127.0.0.1`) by default. If a user voluntarily enables LAN access (`HOST=0.0.0.0`), they assume all security risks associated with intranet exposure.
3. **Cross-Border AI Requests**:
   - When a user configures overseas AI endpoints (e.g., OpenAI, Anthropic), workout context payloads are dispatched directly from the user's local machine to the target server. The user is solely responsible for verifying the regulatory compliance and privacy policies of their chosen providers.

---

## 5. Open Source License (MIT License)

The Software is licensed under the [MIT License](LICENSE). The Software is provided "AS IS", without warranty of any kind, express or implied. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability arising from the software or the use or other dealings in the software.
