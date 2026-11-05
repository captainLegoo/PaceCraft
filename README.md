<div align="center">

<img src="web/public/favicon.svg" alt="PaceCraft Logo" width="96" height="96" />

# PaceCraft

> **跨生态跑者 AI 数据与训练中心 · 隐私至上的个人耐力运动操作系统**  
> *Cross-platform, Privacy-first AI Running & Endurance Hub with Local-Only Data Storage.*

[English](README_EN.md) | **简体中文**

[![GitHub Release](https://img.shields.io/github/v/release/captainLegoo/PaceCraft?include_prereleases&color=5a7d00&label=Release)](https://github.com/captainLegoo/PaceCraft/releases)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue)](https://github.com/captainLegoo/PaceCraft/releases)
[![License](https://img.shields.io/badge/License-MIT-gray.svg)](#-开源协议与免责声明)

</div>

**PaceCraft** 专为严肃跑者与耐力运动员打造，打破手表品牌生态壁垒（**深度支持高驰 COROS 与佳明 Garmin 中国区 / 国际区**，支持双表同时绑定）。在 100% 本地环境中实现多源数据聚合、分圈清洗、同场双表微观比对、真实跑力预测、马拉松备赛体检与 AI 科学自适应课表。

> 🔒 **隐私承诺**：所有训练记录、生理数据与授权 Token **100% 仅保存在个人电脑本地**，无中转云端，无遥测追踪。

---

## ✨ 核心特性

- 🏃 **跨生态运动手表接入与同场比对**
  - **全生态接入**：高驰 COROS（官方开放平台与 MCP 协议一键授权）与佳明 Garmin（官方 Personal API，全面覆盖**中国区与国际区**），支持多表同时绑定。
  - **同场去重与微观比对 (Head-to-Head)**：自动识别同场佩戴高驰与佳明的时间重叠并去重，避免跑量虚增；毫秒级对齐横向评估 GPS 轨迹、光电/心率带公差、配速漂移与步频稳定性。
  - **生理健康与 HRV 视窗**：深度同步佳明夜间睡眠分期（深睡/浅睡/REM）、睡眠评分、夜间 HRV 平衡状态与高驰日常生理指标。
  - **统一 Banister EWMA 负荷模型**：全品牌归一化 Edwards TRIMP，连续推算短期疲劳（ATL）、长期体能（CTL）与急慢性负荷比（ACWR 0.8–1.3 甜点区）。
- 🤖 **AI 科学双周滚动课表 (Adaptive Training Plan)**
  - **真实生理推演**：基于手表真实导入的分圈数据推演 Daniels VDOT 配速与 Karvonen 储备心率区间（HRR），拒绝死板套用公式。
  - **跑者表型短板诊断**：自动诊断「长明灯耐力型」（针对性加码 VO2max 间歇与跨步跑）与「速度爆发型」（针对性堆叠低心率有氧基础）。
  - **双周滚动周期编排**：遵循 80/20 极化与 3:1 阶梯超补偿，执行第 1 周 + 滚动预告第 2 周。
  - **🏋️ 跑后核心与抗阻力量课表**：每节跑步课智能配套跑后针对性训练（下肢刚度、臀肌骨盆稳定、抗扭转、跟腱储能 4 大专向动作库与指导）。
  - **🔄 训练日随时热调整与进度继承**：中途任意调整每周跑步天数与长跑日，自动无缝继承当前周次进度；对已完成的手表打卡提供**物理不可变性保护**。
  - **📊 生理底座指标透明化 (双端适配)**：VDOT、CTL、ATL、TSB、ACWR、Pw:Hr 6 大指标配备通俗释义与科学标尺；电脑端气泡悬停，手机端自适应**原生底部抽屉 (Bottom Sheet)**。
  - **闭环复盘与主流大模型支持 (BYOK)**：周度一键对齐手表记录，动态触发进阶（Advance）、减负（Deload）或剪枝（Prune）；支持 Claude、DeepSeek、GPT-4o、通义千问、智谱 GLM、硅基流动与 Ollama 本地模型。
- 📈 **自建独立跑力预测 (拒绝黑盒评分)**
  - 脱离厂商闭源评分，基于真实分圈滑动窗口拟合个人 Riegel 疲劳衰减指数与无氧阈值配速。
  - 结合近 8 周真实平均周跑量校准全马后程掉速预期，给出 5K / 10K / 半马 / 全马置信区间。
- 🏁 **赛事画像与马拉松备赛体检**
  - 上传 GPX 轨迹反查 30m 高精度 DEM 海拔剖面，折算坡度阻力与高原低氧海平面等效用时。
  - 动态滚动 28 天状态窗口：近 4 周周均、有氧脱钩率（$Pw:Hr$）、$\ge 28\text{km}$ 长拉练耐受度体检。
- 👥 **多跑友档案物理隔离 (Multi-Profile)**
  - 单机支持多位跑友/家庭成员一键毫秒级热切换。
  - 专属 SQLite 数据库、Token 与海拔缓存 100% 物理隔离。
- 🖥️ **全平台轻量桌面端 & 现代自适应交互**
  - 基于 Tauri 2.0 (Rust) 构建原生客户端（安装包仅 20~30MB），支持 macOS 与 Windows。
  - 原生支持暗黑/明亮自适应主题，零外部图表库依赖的极速手绘 SVG。

---

## 🚀 快速使用

### 方式一：下载桌面安装包（推荐，开箱即用）

无需配置开发环境，直接安装运行：

1. 前往 [Releases 发行页](https://github.com/captainLegoo/PaceCraft/releases) 下载最新版本：
   - **macOS**：下载 `.dmg` 文件，拖入 Applications 目录。
   - **Windows**：下载 `.exe` 安装程序运行。
2. 打开 PaceCraft，根据界面引导点击 **「连接运动手表」** 完成 COROS 授权或 Garmin API Key 绑定。
3. 点击 **「立即同步」** 即可拉取历史训练，开启科学训练与 AI 复盘。

<details>
<summary>💡 <b>首次打开遇到系统安全拦截提示？（macOS & Windows 快速解决）</b></summary>

<br />

本项目为开源独立软件，尚未购买商业代码签名证书，部分系统在首次打开时可能出现拦截：

- **🍎 macOS 用户**（提示「已损坏，无法打开」或拦截）：
  - 打开「终端」执行一键解除命令：`xattr -cr /Applications/PaceCraft.app`
  - 或在 **系统设置** ➔ **隐私与安全性** ➔ 页面底部点击 **仍要打开**。
- **🪟 Windows 用户**（SmartScreen 提示「Windows 已保护你的电脑」）：
  - 点击弹窗上的 **更多信息** (More info) ➔ 点击出现的 **仍要运行** (Run anyway) 即可。

</details>

---

### 方式二：开发者本地源码运行

```bash
# 1. 克隆代码仓库
git clone https://github.com/captainLegoo/PaceCraft.git
cd PaceCraft

# 2. 安装依赖并启动本地开发服务 (需提前安装 Bun 1.x)
bun install
./dev.sh
```

浏览器访问 **<http://127.0.0.1:43124>**。

> 💡 **局域网手机访问**：执行 `./start.sh lan`，扫描终端二维码即可在手机浏览器访问，支持「添加到主屏幕」作为全屏 App 使用。

---

## 🔒 隐私与数据安全

- **本地存储路径**：数据与凭证均保存在本地主目录 `~/.coros-dashboard/`（未来平滑过渡至 `~/.pacecraft/`）：
  ```text
  ~/.coros-dashboard/
  └── profiles/<profile-id>/
      ├── coros.db          # 跑友独立 SQLite 数据库
      ├── tokens.json       # 授权凭据与 API Key (chmod 600，仅本用户可读)
      ├── profile.json      # 档案元信息
      └── fit/              # 海拔与活动 FIT 文件缓存
  ```
- **端口与网络边界**：默认仅监听 `127.0.0.1` 本地回环接口，不向公网暴露端口。
- **数据彻底清理**：客户端设置页提供「本地数据管理与安全重置」一键抹除；亦可在终端直接执行 `rm -rf ~/.coros-dashboard`。

---

## 🧠 算法模型与运动科学依据

PaceCraft **坚决抵制黑盒评分与盲猜式大模型排课**，核心逻辑遵循：**运动科学算准真值在前，AI 大模型拟人化润色在后，代码层安全防护兜底。**

### 1. 结构化分圈清洗 (Lap Classification)
- 自动识别配速方差，精确拆解间歇跑快跑段与休息段（如识别为 `1000m×6 组 @ 3:38`，间歇休 165 秒）；
- 稳态匀速跑坚决不误判为间歇，间歇课自动屏蔽无意义的心血管脱钩率。

### 2. 真实跑力与掉速校准 (Performance Forecasting)
- 滑动窗口截取真实连续最快 5K/10K 锚点，严禁跨段拼凑间歇跑假成绩；
- 引入**过去 8 周真实平均周跑量**校准 Riegel 疲劳衰减幂律系数（周跑量越扎实，预测越有底气；周跑量偏低，模型自动加大后程掉速预期）；
- 在稳态有氧区间拟合配速与心率，提取纯净的乳酸阈值（88.5% HRmax）配速。

### 3. 生理负荷天平与伤病防线 (Load Balance & Decoupling)
- **ACWR 急慢性负荷比**：以 Edwards TRIMP 计算单次生理刺激，维持 7 天短期疲劳（ATL）与 42 天长期体能（CTL）处于 0.8~1.3 防伤甜点区；
- **有氧脱钩率 ($Pw:Hr$)**：对比长距离前后半程心率与配速比率漂移，脱钩率 $<5\%$ 提示有氧底盘扎实，$>8\%$ 提示心脏漂移代偿或糖原耗竭。

### 4. AI 课表为什么稳定靠谱？
- **核心数据硬编码锁定**：目标配速区间、目标心率区间、周总跑量、指定休息日与长跑日作为硬性 Ground Truth 输入给大模型；
- **AI 职责明确定位**：大模型仅负责课表分段拆解、体感动作要点解读与激励性指导语；
- **代码级安全拦截网**：非训练日若被大模型误排课，代码层入库前强制重置为休息日并跑量归零。

<details>
<summary>🔬 <b>点击展开：同行评审学术论文与数学公式依据</b></summary>

<br />

1. **结构化间歇识别理论**：参考 **Billat (1996, 2000)** $v\text{VO}_2\max$ 间歇生理学与 **Skiba et al. (2012, 2015, MSSE/IJSPP)** 临界速度（Critical Speed）与做功恢复模型。
2. **Daniels & Gilbert (1979) VDOT 联立数值求解**：
   $$\text{VO}_2 = -4.60 + 0.182258 \cdot v + 0.000104 \cdot v^2 \quad (v \text{ 为速度 m/min})$$
   $$\%\max = 0.8 + 0.1894393 \cdot e^{-0.012778 \cdot t} + 0.2989558 \cdot e^{-0.1932605 \cdot t} \quad (t \text{ 为用时 min})$$
   $$\text{VDOT} = \text{VO}_2 / \%\max$$
3. **Riegel (1981) 疲劳幂律与 Vickers & Vertosick (2016, $n=2303$) 周跑量修正**：
   $$k_{\text{全马}} = 1.4510756 - 0.23797948 \cdot k_{12} - 0.01410023 \cdot (\text{周英里} / 10)$$
4. **Banister (1991) TRIMP 冲量响应模型**：
   $$\text{TRIMP} = t \cdot \Delta\text{HR} \cdot 0.64 e^{1.92 \cdot \Delta\text{HR}}$$
5. **海拔与地形代偿**：坡度惩罚 $1.244\text{ s/km per m/km}$，海拔低氧惩罚 $2.5\text{ s/km per 1000m}$（基于 Saunders 等高原耐力运动生理学研究）。

</details>

---

## 🛠️ 项目工程结构

```text
PaceCraft/
├── server/                     # 后端 API 服务 (Bun + Elysia + Drizzle ORM)
│   ├── src/
│   │   ├── coros/              # COROS 适配器 (OAuth 2.0 PKCE、MCP 协议、增量同步)
│   │   ├── garmin/             # Garmin 适配器 (Personal API、FIT 解析、健康/HRV 同步)
│   │   ├── conflicts.ts        # 同场双表重叠冲突检测与去重比对引擎
│   │   ├── db/                 # SQLite 架构与动态多档案代理客户端
│   │   ├── profile-manager.ts  # 多跑友物理隔离与切换管理器
│   │   ├── prediction/         # 独立跑力预测与马拉松备赛体检算法
│   │   └── ai/                 # AI 上下文构建与多模型调用适配器
├── web/                        # 前端应用 (React 19 + TypeScript + Vite)
│   ├── src/
│   │   ├── pages/              # 训练看板、场次复盘与双表比对、赛事中心、身体状态、AI 课表、系统设置
│   │   ├── components/         # 跑友切换器、手表连接引导、核心动作库弹窗
│   │   └── charts.tsx          # 纯原生手绘 SVG 现代轻量图表与储备心率（HRR）模型
├── src-tauri/                  # 跨平台桌面应用壳 (Tauri 2.0 / Rust)
└── .github/workflows/          # GitHub Actions 全自动多平台发布流水线
```

---

## 🗺️ 路线图 (Roadmap)

- [x] 多跑友档案（Profile）物理隔离与智能增量同步
- [x] Web 端免终端一键授权登录与手表引导
- [x] Tauri 2.0 跨平台桌面客户端打包 (macOS / Windows)
- [x] **跨生态手表打通**：官方接入高驰 COROS 与佳明 Garmin（中国区 / 国际区）
- [x] **同场双表重叠冲突去重与 Head-to-Head 深度微观比对**
- [x] **佳明夜间睡眠分期与 HRV 生态指标整合**
- [x] **跨品牌统一 Banister EWMA 训练负荷与 ACWR 伤病监控**
- [x] **AI 科学双周滚动课表与闭环自适应微调**（VDOT、HRR、表型诊断、决策树复盘）
- [x] **跑后核心与抗阻力量动作库**（4 大专向 syllabus 与跑步课表智能联动）
- [x] **课表训练日热调整与进度连续性保护**（随时增减训练日、已完成历史物理不可变）
- [x] **生理底座指标透明化与移动端原生底部抽屉 (Bottom Sheet)**
- [ ] **多设备扩展**：Suunto 颂拓开放协议对接
- [ ] **标准文件离线导入**：支持手动拖拽上传本地 `.FIT` / `.GPX` 文件解析
- [ ] **AI 语音/交互教练**：实时提问训练体感与恢复建议

---

## 📄 开源协议与免责声明

- **开源协议**：本项目基于标准的 [MIT License](LICENSE) 协议开源。
- **免责声明**：使用本项目即表示您已阅读并完全同意 [DISCLAIMER.md](DISCLAIMER.md)（[English](DISCLAIMER_EN.md)）中的全部条款，核心概要包括：
  1. **AI 辅助定性与模型差异**：本项目为本地工具，所有 AI 分析与课表均由用户自选模型推导。受模型架构与提示词敏感性影响，不同模型生成结果存在客观偏差。
  2. **身体感知第一原则（最高优先级）**：所有数据预测、负荷评估及 AI 生成课表**仅作为训练模拟参考，绝非医疗保障处方**。实际运动中个人主观身体感知与安全享有绝对最高优先级，若有不适须立即降速或终止，运动风险自负。
  3. **第三方商标合规**：COROS、Garmin、Suunto 等商标归其各自权利人所有，本项目与各厂商无官方隶属或背书关系。
