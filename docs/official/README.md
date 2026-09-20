# 官方数据附带包（2026-09-20 加入）

> 这些文件来自官方 APK **1.1.1**（versionCode 231）与设备运行时缓存，用于把旧项目缺的
> 官方内容补齐。**新增文件是并存的，没有覆盖任何旧文件**（唯一例外：6 张登录背景，见下）。
> 采集环境与「明确不做」的事见 `PROVENANCE.md`。

## 1. 加入了什么

| 路径 | 内容 | 来源 | 对客户端的影响 |
|---|---|---|---|
| `web/assets/images/login_background_*.jpg`（6 语） | 官方 1.1.1 版登录背景（同分辨率 1875×1999，压缩不同） | APK 1.1.1 | **已生效**（纯画质升级，无行为风险） |
| `web/assets/spine/crf_chr_002/*/\*_gesture.rev2.json` | 官方 1.1.1 的**动作表 rev2**（两份） | APK 1.1.1 | **暂未加载**，见 §3 |
| `docs/official/masters_bundle.json` | 官方服务器数据缓存（任务板/皮肤名册/代币档位） | 设备 `/data/data/.../files/` | 不影响运行 |
| `docs/official/official_ja_texts.tsv` | 官方日语 UI 文本 **2269 条** | `libapp.so` 提取 | 不影响运行 |
| `docs/official/official_symbols.txt` | 官方 Dart 符号 **46,433 个**（类名/方法名） | `libapp.so` 提取 | 不影响运行 |
| `docs/official/official-data-schema.md` | 官方数据结构施工图（脚本生成） | 官方资产 | 不影响运行 |
| `docs/official/PROVENANCE.md` | 采集环境与出处 | — | — |

## 2. 关键差异（实测）

官方 1.1.1 相对本项目原来的 1.0.2/1.0.3 包，**包内资产只有 8 个文件不同**：

- **2 个动作表**（rev1 → rev2，结构性改写）
- **6 张登录背景**（已更新）

其余 3601 个资产逐字节相同；1.0.2 → 1.0.3 之间资产零变化。

## 3. rev2 动作表：为什么是并存而不是替换

旧项目 `avatar.js` 的注视系统读的是 **rev1 结构**：

```
emotionalGesture.DriverDefs                       ← 98 条预烘焙驱动（含 yaw/pitch/roll 范围）
emotionProfiles.<emo>.tensionProfiles.<band>.ambientBindings   ← 指向 driverDefId
```

官方 rev2 **删掉了这两个结构**，改成：

```
projectConfig.ambientGaze                         ← 31 个具名参数（幅度/停留/速度/跟随）
emotionalGesture.GesturePatternDefs               ← 21 条形状（方向/路线/点数/跟随规则）
emotionalGesture.AttitudePatterns                 ← 57 条模式（态度 × 形状 × 时机 × 权重）
<emo>.tensionProfiles.<band>.gaze.{gazeEntries,eyeModeEntries,motionModifiers}
```

如果直接覆盖 `*_gesture.json`：旧代码**不会崩**（缺失字段处优雅降级为空数组），
但注视会退化成常量、身体跟随全部失效 —— 玩家能直接看出「变呆了」。

所以这两个文件以 `*_gesture.rev2.json` **并存**：

- 想直接比较：`diff` 两份 JSON 即可
- 想迁移：需要按 `docs/official/official-data-schema.md` 第 6 节重写注视驱动
  （重建项目 `ryza-ai-chat-revive-official/web/js/gaze.js` 已完成这部分，可参考）

## 4. 可直接拿来用的官方数值

### 4.1 任务板（`masters_bundle.json` → `mission_groups` / `missions` / `activities`）

官方是 **3 组 × 4 条**，按天开启：

| 组 | 开启日 | 组奖励 | 组内 4 条任务 |
|---|---|---|---|
| `crf_msng_001` | 第 0 天 | 4 点 → `voice_token` 100 | 完成 3 次任务 / 触摸莱莎 1 次 / 与角色对话 5 次 / 领取登录奖励 |
| `crf_msng_002` | 第 3 天 | 同上 | 同上（登录奖励需连续 3 天） |
| `crf_msng_003` | 第 5 天 | 同上 | 同上（登录奖励需连续 5 天） |

任务源活动（`activities`，共 10 个）：`app_launched` / `login_streak` / `alarm_created` /
`app_shared` / `memory_viewed` / `profile_edited` / `subscribed` / `talk_response_received` /
`talk_sent`（带 `resource_id`）/ `voice_token_purchased`。

> 本项目现在的欢迎任务界面是自造的 5 格流程；若要一比一，应按上表改成 3 组 × 4 条。

### 4.2 皮肤名册（`skins`，共 6 款）

| id | 官方名（zh_TW） | 价格 | 解锁 | ASMR | 姿势 | rev |
|---|---|---|---|---|---|---|
| `crf_skn_002_0001_01` | 鍊金術士採集服 | 1850 | 购买 | ✓ | sitting | 2 |
| `crf_skn_002_0001_99` | 基本款 | 0 | 免费 | ✗ | standing | 2 |
| `crf_skn_002_0002_01` | 歡樂陽光 | 1850 | 购买 | ✓ | sitting | 3 |
| `crf_skn_002_0003_01` | 夜色人魚 | 0 | 订阅 | ✗ | sitting | 3 |
| `crf_skn_002_0004_01` | 小心噗尼出沒！ | 1850 | 购买 | ✓ | sitting | 4 |
| `crf_skn_002_0005_01` | 夏日海灘 | 1850 | 购买 | ✓ | sitting | 3 |

包内只有前两款（`_0001_01` / `_0001_99`），且其**文件字节数与服务器记录逐一致**
（唯一例外是动作表 rev）。其余 4 款在官方 CDN + 账号权益后面，本项目不实现购买。

### 4.3 官方 UI 文本（`official_ja_texts.tsv`）

2269 条官方日语原文（含 62 个 `Translations<模块><语言>` 分类，模块清单可搜
`official_symbols.txt` 里的 `Translations`）。用途：把自译文案换成官方原文。

> 注意：从 AOT 快照提取的文本含少量**残片**（相邻数据拼接造成的乱码片段），
> 单条使用前建议人工过一眼；完整句子可直接用。

## 5. 没有加入的（以及为什么）

| 项 | 原因 |
|---|---|
| 4 款付费皮肤档案 | 不在 APK 内，在官方 CDN + 账号权益后面。本项目不实现购买，也不伪造客户端调用官方接口 |
| 官方服务端接口数据（等级曲线/价目/任务正文） | 同上；`masters_bundle` 里也没有这几张表，只能本地定值 |
| 账号凭据 | 设备上是 Android Keystore 加密值（`ENCRYPTED:`），**不提取** |
