<div align="center">

<img src="web/public/favicon.svg" alt="PaceCraft Logo" width="100" height="100" />

# PaceCraft

> **跨生态跑者 AI 数据与训练中心 · 隐私至上的个人耐力运动操作系统**  
> *Cross-platform, Privacy-first AI Running & Endurance Hub with Local-Only Data Storage.*

[English](README_EN.md) | **简体中文**

[![GitHub Release](https://img.shields.io/github/v/release/captainLegoo/PaceCraft?include_prereleases&color=5a7d00&label=Release)](https://github.com/captainLegoo/PaceCraft/releases)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blue)](https://github.com/captainLegoo/PaceCraft/releases)
[![License](https://img.shields.io/badge/License-MIT-gray.svg)](#开源协议与免责声明)

</div>

**PaceCraft** 专为追求科学训练与隐私安全的严肃跑者打造。它打破单一运动手表品牌的生态围墙（**首发生态现已深度支持高驰 COROS 与佳明 Garmin 中国区 / 国际区**，支持双表同时绑定），在完全由你掌控的本地环境中完成数据聚合、分圈清洗、同场双表微观比对、自建真实跑力预测、马拉松备赛体检与 AI 智能教练分析。

**所有数据 100% 仅持久化保存在你个人的电脑本地，不经由任何第三方云端。**

---

## ✨ 核心特性

- 🏃 **跨生态运动手表多源接入与同场比对**
  - **COROS 高驰**：基于官方开放平台与 MCP 协议，支持一键 Web OAuth 授权与自动增量同步。
  - **Garmin 佳明**：已接入佳明官方 Personal API（深度支持**中国区与国际区**），支持活动时序与 `.FIT` 原始文件解析。
  - **同场双表重叠去重与比对 (Head-to-Head Compare)**：同场佩戴高驰与佳明训练时，系统自动识别时间重叠并去重，杜绝跑量与负荷翻倍；支持同场次深度微观比对，横向评估不同手表的 GPS 轨迹、光电/心率带公差、配速漂移与步频稳定性。
  - **多品牌生理健康与 HRV 接入**：同步佳明夜间睡眠分期（深睡、浅睡、REM）、睡眠评分、夜间 HRV 平均值与平衡状态，以及高驰日常生理指标，支持动态生态视窗切换。
  - **统一 Banister EWMA 训练负荷与 ACWR**：归一化 Edwards TRIMP 聚合全品牌有效训练，连续推算短期疲劳（ATL）、长期体能（CTL）与急慢性负荷比（ACWR 0.8–1.3 甜点区）。
- 👥 **多跑友档案物理隔离 (Multi-Profile)**
  - 一台电脑支持多个跑友/家庭成员自由切换。
  - 每个档案拥有专属的 SQLite 数据库、Token 与海拔缓存，数据毫秒级热切换且 100% 物理隔离。
- 📈 **自建真实能力预测 (不依赖官方评分)**
  - 脱离单一厂商闭源黑盒评分，基于真实比赛锚点与连续分圈滑动窗口，拟合个人 Riegel 疲劳衰减指数与无氧阈值配速。
  - 多模型加权合成，给出 5K / 10K / 半马 / 全马的置信区间与海平面等效成绩。
- 🏁 **赛事画像与马拉松备赛体检**
  - 上传 GPX 轨迹反查 30m 高精度 DEM 海拔剖面，计算爬坡率与下坡代偿。
  - 动态滚动训练窗口监控：近 4 周周均、训练负荷比（ACWR）、有氧占比、长距离拉练完成度。
- 🤖 **AI 深度复盘与智能教练 (BYOK)**
  - 支持接入主流大语言模型（Claude、DeepSeek、OpenAI、Qwen/通义千问、智谱 GLM、硅基流动、Ollama 本地模型等）。
  - **AI 场次分析**：自动识别间歇组结构（如 `1km×10`）与爬升代价，避免机械化误判掉速。
  - **AI 备赛决策 & 课表建议**：根据当前疲劳状态与比赛剩余天数，提供周期化减量与重点突破建议。
- 🖥️ **全平台桌面客户端 & 现代化交互**
  - 基于 Tauri 2.0 构建轻量桌面原生应用（20~30MB），支持 macOS（`.dmg`）与 Windows（`.exe`）。
  - 深度优化的暗黑 / 明亮（浅色）自适应主题，零外部图表库依赖的极速手绘 SVG。

---

## 🚀 快速使用

### 方式一：直接下载桌面安装包（推荐，开箱即用）

无需配置 Node.js、Bun 或终端环境：

1. 前往 [Releases 发行页](https://github.com/captainLegoo/PaceCraft/releases) 下载对应系统的最新安装包：
   - **macOS**：下载 `.dmg` 文件，打开后拖入 Applications 目录。
   - **Windows**：下载 `.exe` 安装程序直接运行。
2. 打开 PaceCraft，根据界面引导点击 **「连接运动手表」** 完成高驰 COROS 网页授权或佳明 Garmin（中国区 / 国际区）Personal API 绑定（支持同时连接多块手表）。
3. 点击 **「立即同步」**，系统将自动拉取历史训练数据，开始你的科学训练与 AI 复盘！

> [!TIP]
> **首次运行遇到系统安全拦截提示？（macOS & Windows 快速解决）**
> 
> 本项目为开源独立软件，尚未购买商业代码签名证书，部分系统在首次打开从浏览器下载的程序时可能会有拦截提示（并非软件本身有问题）：
> 
> - **🍎 macOS 用户（提示「已损坏，无法打开」或被隔离拦截）**
>   - **方式一（终端一键解除，最推荐）**：打开 Mac「终端」应用，执行 `xattr -cr /Applications/PaceCraft.app` 即可。
>   - **方式二（系统设置中授权）**：打开 Mac **「系统设置」** ➔ **「隐私与安全性」** ➔ 页面下方找到安全性提示，点击 **「仍要打开」**。
>   - **方式三（访达右键）**：在「访达」应用程序中，按住 `Control` 键点击 PaceCraft 选择 **「打开」**。
> 
> - **🪟 Windows 用户（蓝底弹窗提示「Windows 已保护你的电脑 / SmartScreen」）**
>   - 点击弹窗上的 **「更多信息」 (More info)** ➔ 再点击右下角出现的 **「仍要运行」 (Run anyway)** 即可继续安装运行。仅首次安装时提示一次，之后不再提示。

---

### 方式二：开发者本地源码运行

适合有二次开发需求或想使用局域网手机访问的跑者：

#### 前置环境
- [Bun](https://bun.sh/) 1.x：`curl -fsSL https://bun.sh/install | bash`
- 网络环境：用于拉取依赖与调用开放平台接口。

```bash
# 1. 克隆代码仓库
git clone https://github.com/captainLegoo/PaceCraft.git
cd PaceCraft

# 2. 安装项目依赖
bun install

# 3. 启动本地开发服务 (支持热重载)
./dev.sh
```

打开浏览器访问 **<http://127.0.0.1:43124>** 即可。

> 💡 **局域网手机访问**：在终端执行 `./start.sh lan`，扫描终端输出的二维码或直接在手机浏览器输入内网 IP 访问，可直接「添加到主屏幕」作为全屏 App 使用。

---

## 🔒 隐私与数据安全说明

- **本地存储路径**：数据与凭证均保存在用户主目录 `~/.coros-dashboard/` 下（未来将平滑迁移至 `~/.pacecraft/`）：
  ```
  ~/.coros-dashboard/
  ├── profiles/
  │   └── <profile-id>/
  │       ├── coros.db          # 跑友个人独立 SQLite 数据库
  │       ├── tokens.json       # OAuth 授权凭证与 Garmin API Key (chmod 600)
  │       ├── profile.json      # 档案元信息
  │       └── fit/              # 海拔与活动 FIT 缓存文件
  └── ...
  ```
- **权限安全**：授权凭据存储权限严格设为 600（仅当前系统用户可读），且已被 `.gitignore` 深度排除，绝对不会上传到代码仓库。
- **端口隔离**：默认仅监听 `127.0.0.1` 本地回环接口，不向公网暴露端口。
- **数据重置与彻底清理**：
  - **应用内一键抹除**：前往客户端「系统设置」页最底部「本地数据管理与安全重置」，点击即可安全清空本地所有档案、数据库与凭据。
  - **终端手动清理**：如已直接将 App 移入废纸篓，在终端执行 `rm -rf ~/.coros-dashboard` 即可彻底清除全部历史残留。

---

## 🧠 自建成绩预测原理

PaceCraft 的预测引擎**完全基于你真实跑过的分圈数据与比赛记录**，脱离厂商专有黑盒评分：

1. **提取成绩锚点**：在全品牌历史训练记录的连续分圈中滑动寻找最佳成绩窗口，过滤 GPS 漂移与非连续间歇拼凑。
2. **反推阈值配速**：对有氧区间的「配速-心率」拟合回归曲线，推算 88.5% HRmax 对应的乳酸阈值配速。
3. **拟合个人 Riegel 衰减指数**：在相同强度分层内两两配对，计算个性化耐力衰减指数 $k$（通常在 1.05~1.15 之间）。
4. **多模型加权集成**：根据锚点距离的可信度梯度（A: ≥15km、B: 8~15km、C: ≤5km），输出带置信区间的预测成绩。

---

## 🛠️ 项目工程结构

```
PaceCraft/
├── server/                     # 后端 API 服务 (Bun + Elysia + Drizzle ORM)
│   ├── src/
│   │   ├── coros/              # COROS 适配器 (OAuth、MCP、分圈解析、增量同步)
│   │   ├── garmin/             # Garmin 适配器 (Personal API、FIT 解析、健康/HRV 同步)
│   │   ├── conflicts.ts        # 同场双表重叠冲突检测与去重绑定引擎
│   │   ├── db/                 # SQLite 架构与动态多档案代理客户端
│   │   ├── profile-manager.ts  # 多跑友物理隔离与切换管理器
│   │   ├── prediction/         # 跨品牌独立能力预测与马拉松备赛体检算法
│   │   └── ai/                 # AI 上下文构建与模型调用接口
├── web/                        # 前端应用 (React 19 + TypeScript + Vite)
│   ├── src/
│   │   ├── pages/              # 训练看板、场次复盘与双表比对、赛事中心、身体状态、系统设置
│   │   ├── components/         # 跑友切换器、手表连接引导、分页组件
│   │   └── charts.tsx          # 纯原生 SVG 现代轻量图表与储备心率（HRR）模型
├── src-tauri/                  # 跨平台桌面应用壳 (Tauri 2.0 / Rust)
├── .github/workflows/          # GitHub Actions 全自动打包发布工作流
└── scripts/                    # 桌面端侧边二进制构建与部署脚本
```

---

## 🗺️ 后续路线图 (Roadmap)

- [x] 多跑友档案（Profile）物理隔离与智能增量同步
- [x] Web 端免终端一键授权登录
- [x] Tauri 2.0 跨平台桌面客户端打包 (macOS / Windows)
- [x] **多设备生态打通**：官方接入高驰 COROS 与佳明 Garmin（中国区 / 国际区）
- [x] **同场双表重叠冲突去重与 Head-to-Head 深度微观比对**
- [x] **佳明夜间睡眠分期与 HRV 生态指标整合**
- [x] **跨品牌统一 Banister EWMA 训练负荷与 ACWR 伤病监控**
- [ ] **多设备扩展**：Suunto 颂拓开放协议对接
- [ ] **标准文件离线导入**：支持手动拖拽上传本地 `.FIT` / `.GPX` 文件离线解析
- [ ] **AI 动态训练课表**：基于历史疲劳曲线（ATL/CTL/TSB）与目标赛事自动生成周期课表
- [ ] **AI 语音/对话交互教练**：随时提问训练状态与伤病疲劳恢复建议

---

## 📄 开源协议与免责声明

- **开源协议**：本项目基于 [MIT License](LICENSE) 开源。
- **免责声明**：使用本项目即表示您已阅读并同意 [DISCLAIMER.md](DISCLAIMER.md) 中的全部条款，包括：
  1. **AI 辅助定性**：本项目为本地开源工具，开发者不提供中心化 AI 服务；所有 AI 分析由用户自行配置的模型生成，仅供参考，不承担算法幻觉或内容风险。
  2. **运动健康与安全**：所有数据预测与 AI 建议非医疗诊断或强制处方，用户需结合自身身体状况量力而行，运动风险自负。
  3. **第三方商标**：COROS、Garmin、Suunto 等商标归其各自权利人所有。本项目为独立第三方客户端，与各厂商无官方隶属关系。
