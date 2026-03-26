[![](https://img.shields.io/github/v/release/ivanlee1007/Taipower-Bimonthly-Energy-Cost-homeassistant.svg?style=flat-square)](https://github.com/ivanlee1007/Taipower-Bimonthly-Energy-Cost-homeassistant/releases/latest)  [![](https://img.shields.io/badge/HACS-Default-orange.svg?style=flat-square)](https://github.com/hacs/integration)

# Taipower-Bimonthly-Energy-Cost-homeassistant

Calculate Taipower (Taiwan Power Company) bi-monthly (60 days) bill amount from kWh sensor on Home Assistant.  
在 Home Assistant (HA) 內以 kWh sensor (千瓦⋅時 電度 傳感器) 計算每期 (60日曆天) 電費帳單金額.

### ✨ Features / 功能特色

- **三種計費模式**：住宅用、非營業用、營業用（表燈非時間電價）
- **雙月累進計價**：依雙月級距正確計算總電費與當前級距單價（不是平均單價）
- **自動費率更新**：透過台電官方 PDF 自動解析最新費率
- **一鍵更新按鈕**：裝置頁內建按鈕，一鍵從台電 PDF 重新抓取費率
- **費率狀態監控**：`rate_status` sensor 自動檢測費率是否最新、過期或解析異常
- **手動費率覆寫**：可用 JSON 覆寫費率，並在卡片與 Options 流程中雙向維護
- **雙頁籤設定卡片**：Lovelace 卡片提供「費率表 / 設定」兩個頁籤，可直接編輯來源 sensor、抄表日、計費模式與手動費率
- **清除所有手動覆寫**：卡片可偵測其他 mode 遺留的手動覆寫，並一鍵清空全部 overrides
- **卡片自動註冊**：整合會自動註冊前端資源與 Lovelace resource，不需要手動加 `resources:`
- **裝置頁整合**：所有實體（3 個 sensor + 1 個 button）自動歸入同一裝置頁
- **即時更新與舊實體清理**：Options 流程儲存後自動重新載入，改實體時舊 sensor 自動清除
- **啟動後自動恢復**：若 HA 啟動時來源 sensor 尚未就緒，`kwh_cost` / `power_cost` 會在來源恢復後自動重新計算
- **能源面板整合**：提供 `kwh_cost` sensor 給 HA 內建能源面板作為電費單價

### 📋 當前費率版本

**114年10月1日起實施**（11410）— [台電官方費率表 PDF](https://www.taipower.com.tw/media/ba2angqi/各類電價表及計算範例.pdf)

| 累進級距 | 住宅用 夏月 | 住宅用 非夏月 | 營業用 夏月 | 營業用 非夏月 |
|----------|------------|-------------|------------|-------------|
| 120度以下 | 1.78 | 1.78 | — | — |
| 121~330度 | 2.55 | 2.26 | 2.71 | 2.28 |
| 331~500度 | 3.80 | 3.13 | 3.76 | 3.10 |
| 501~700度 | 5.14 | 4.24 | 4.46 | 3.61 |
| 701~1000度 | 6.44 | 5.27 | 7.08 | 5.56 |
| 1001度以上 | 8.86 | 7.03 | 7.43 | 5.83 |

> 夏月：6/1~9/30　｜　非夏月：10/1~5/31
> 營業用累進級距與住宅用不同（330度起跳），請以設定 UI 選擇正確計費模式。

---

## 1) Install by HACS - 使用 HACS 安裝

請在 HACS 的 `Integrations` 內搜尋 `Taipower bimonthly cost` 並安裝後，依照 UI 提示安裝即可：

| 設定欄位 | 說明 |
|---------|------|
| 雙月計量電源實體 | 要引用為電費計算的即時 kWh 的 `utility meter` sensor（請看附錄 I） |
| 電錶抄表日 | 本期電費計算週期的第一天（YYYY-MM-DD，過去日期，即上次抄表日） |
| 計費模式 | `住宅用` / `非營業用` / `營業用`，三選一 |

安裝完成後會產生以下實體，並自動歸入「台電雙月電費」裝置頁：

| 實體 | 類型 | 說明 |
|------|------|------|
| `sensor.<name>_power_cost` | sensor | 本期累計電費（TWD） |
| `sensor.<name>_kwh_cost` | sensor | 當前電度單價（TWD/kWh） |
| `sensor.<name>_rate_status` | sensor | 費率狀態監控 |
| `button.<name>_update_taipower_rates` | button | 一鍵重新解析台電費率 PDF |

所有實體預設啟用，安裝後可在 **設定 → 裝置與服務 → 台電雙月電費** 的裝置頁內看到全部實體。

---

## 2) Manual Install - 手動安裝

下載本專案檔案後解壓縮，拷貝 `custom_components` 到您 Home Assistant 內的 configuration 目錄下：

```
<config directory>/
|-- custom_components/
|   |-- taipower_bimonthly_cost/
|       |-- __init__.py
|       |-- button.py
|       |-- config_flow.py
|       |-- const.py
|       |-- sensor.py
|       |-- services.yaml
|       |-- manifest.json
|       |-- rates_info.json
|       |-- dist/
|       |   |-- taipower-config-card.js
|       |-- translations/
|           |-- en.json
|           |-- zh-Hant.json
```

然後重啟 Home Assistant，並至 HA → 設定 → 裝置與服務 → 整合 → 新增整合，搜尋 `Taipower bimonthly cost`。

---

## 3) 設定方式

### 3a) Options 流程（安裝時）

安裝完成後可隨時修改設定：HA → 整合 → 台電雙月電費 → 選項（gear icon）

| 選項 | 說明 |
|------|------|
| 計費模式 | 可隨時切換 住宅用/非營業用/營業用 |
| 累計電量感測器 | 設定來源 kWh sensor |
| 抄表起始日 | 電錶抄表日（YYYY-MM-DD） |
| 手動費率覆寫 | JSON 格式，留空則使用內建費率 |

### 3b) 設定卡片（Lovelace）

在 dashboard 加入自訂卡片：

```yaml
type: custom:taipower-config-card
```

卡片會自動抓取當前設定，並提供兩個頁籤：

- **📊 費率表**：查看目前費率、編輯手動覆寫、套用或清除所有手動覆蓋
- **⚙️ 設定**：修改計費模式、來源 sensor、抄表日、手動費率 JSON

> 本整合會自動註冊卡片 JS 與 Lovelace resource，一般情況下不需要手動加 `resources:`。

#### 多組 integration 時，如何讓每張 card 對應不同設定？

**建議用 `entry_id` 綁定**，因為它是穩定的；就算你之後把來源 sensor 改掉，card 還是會指向同一組 integration。

```yaml
type: custom:taipower-config-card
title: ⚡ 本期號電量
entry_id: 01KMM5G5RBHXE8WK4PFSH54MM1
```

也支援用 `sensor` 綁定，但這比較適合臨時使用：

```yaml
type: custom:taipower-config-card
title: ⚡ 商業用電
sensor: sensor.example_power_cost
```

> `sensor` 建議填 `*_power_cost` 或 `*_rate_status`。如果這組 integration 之後改了來源 sensor，相關 entity_id 可能會跟著變，屆時請改用新的 sensor，或直接改成 `entry_id`。

範例：同一個 dashboard 放兩張 card，各自編輯不同 config entry：

```yaml
views:
  - title: 台電設定
    cards:
      - type: custom:taipower-config-card
        title: ⚡ 住宅 A
        entry_id: 01KMM5G5RBHXE8WK4PFSH54MM1
      - type: custom:taipower-config-card
        title: ⚡ 營業 B
        entry_id: 01KMN83V70QH52XGAKSCZ3HE1G
```

> `entry_id` 可從 `sensor.*_power_cost` 或 `sensor.*_rate_status` 的 attributes 裡找到 `config_entry_id`。

### 3c) `update_config` 服務

整合提供 `taipower_bimonthly_cost.update_config` 服務，可用於腳本、自動化或卡片內部呼叫。

可更新欄位：

- `entry_id`（可省略；多組 integration 時建議帶入，明確指定要更新哪一組）
- `bimonthly_energy`
- `billing_mode`
- `meter_start_day`
- `manual_rates`

### 3d) 自動費率更新按鈕

裝置頁內建「手動更新台電費率」按鈕，按下後自動：
1. 從台電官方 PDF 下載最新費率
2. 解析並更新本地費率檔
3. 重新載入整合設定

> 前提：HA 主機需安裝 Node.js（用於執行 `update_rates.js`）

---

## 4) 手動費率覆寫

**手動費率覆寫 JSON 格式範例：**

```json
{
  "residential": {
    "summer": [1.78, 2.55, 3.80, 5.14, 6.44, 8.86],
    "non_summer": [1.78, 2.26, 3.13, 4.24, 5.27, 7.03]
  }
}
```

- `summer`：夏月（6-9月）各級距費率，陣列順序由低到高
- `non_summer`：非夏月（10-5月）各級距費率
- 兩個陣列長度必須一致，數值必須為正數
- 可同時覆寫多個 mode：`residential`、`non_commercial`、`commercial`
- 若要恢復內建預設費率，可在卡片按「清除所有手動覆蓋」，或讓 `manual_rates` 保持空白

---

## 5) 自動費率更新腳本

`scripts/update_rates.js` 可從台電官方 PDF 自動解析最新費率並更新內建費率。

```bash
cd scripts
npm install
node update_rates.js          # 解析 PDF → 產生 rates.json
```

解析成功後 `rates_info.json` 會記錄 checksum 和解析時間。`rate_status` sensor 會自動偵測費率是否異常。

---

## Sensor 屬性 - Attributes

### `sensor.<name>_power_cost`

| 屬性 | 說明 |
|------|------|
| `bimonthly energy source` | 來源 kWh sensor |
| `price per kwh` | 當前電度單價 |
| `start day` | 本期起始日 |
| `used days` | 已使用天數 |
| `billing_mode` | 計費模式 |
| `pdf_version` | 費率來源版本 |
| `manual_rates` | 目前套用中的手動費率覆寫（若有） |

### `sensor.<name>_rate_status`

| 屬性 | 說明 |
|------|------|
| `rates_version` | 費率版本（checksum） |
| `rates_last_parsed_at` | PDF 最後成功解析時間 |
| `rates_age_days` | 費率資料天數 |
| `pdf_version` | PDF 版本號 |
| `bimonthly energy source` | 來源 kWh sensor |
| `start day` | 抄表起始日 |
| `billing_mode` | 當前計費模式 |
| `manual_rates` | 目前儲存的手動費率覆寫 JSON |
| `manual_override` | 目前計費模式是否使用手動覆寫（true/false） |
| `status_code` | 狀態代碼：`up_to_date` / `outdated` / `rates_changed` / `no_info` |

### `button.<name>_update_taipower_rates`

| 屬性 | 說明 |
|------|------|
| `last_result` | 上次按鈕執行結果（成功/失敗訊息） |

---

## Appendix I (附錄 I): 如何新增即時 kWh 的 `utility meter` sensor？

請在 `configuration.yaml` 內加入總用電 `utility meter`：

```yaml
utility_meter:
  bimonthly_energy:
    source: sensor.total_power  # 這是您想用來計算電費的 kWh 來源傳感器
```

設定 UI 的第一行輸入 `sensor.bimonthly_energy`。

## Appendix II (附錄 II): 如何將 W 轉換為 kWh？

一般來說大部分的電量偵測硬體是回傳 W（瓦特），可於 `configuration.yaml` 內加入轉換：

```yaml
sensor:
  - platform: integration
    source: sensor.your_W_sensor  # 原始的用電 W 偵測器
    name: total_power
    unit_prefix: k
    method: trapezoidal
    round: 3
```

## Appendix III (附錄 III): Home Assistant 能源面板整合

HA 2021.8.0+ 內建能源面板 → 右上角設定 → 能源設定 → 電網耗能 → 新增項目 → 選擇獨立價格實體 → 選 `sensor.<name>_kwh_cost`。

（能源面板最多需要 2 小時後才會開始顯現數值。）

---

## Changelog / 版本紀錄

| 版本 | 日期 | 說明 |
|------|------|------|
| v1.5.31 | 2026-03-26 | 設定卡片新增多組 integration 綁定能力：支援 `entry_id`（首選）與 `sensor` 綁定，讓同一個 dashboard 可各自編輯不同 config entry |
| v1.5.29 | 2026-03-26 | 卡片新增「其他模式仍有手動覆蓋」提示與「清除所有手動覆蓋」按鈕，修正 stale override JSON 問題 |
| v1.5.27 | 2026-03-26 | Options flow 顯示 `manual_rates` 時改為 JSON 字串，避免 `[object Object]` |
| v1.5.26 | 2026-03-26 | 修復 `const.py` / 啟動 race condition，`kwh_cost` / `power_cost` 會在來源 sensor 恢復後自動正常計算 |
| v1.5.24 | 2026-03-26 | 修復套用費率前被 debug render 洗掉使用者輸入的問題 |
| v1.5.23 | 2026-03-26 | 正規化 `manual_rates` sync，修復恢復預設後卡片卡在「等待同步」 |
| v1.5.22 | 2026-03-26 | 重寫 Lovelace resource 註冊邏輯，避免破壞其他自訂卡片資源 |
| v1.5.21 | 2026-03-26 | 修正 `_applyRates()` 內 `non_summer` 變數錯誤，Chrome DevTools MCP 閉環驗證通過 |
| v1.5.20 | 2026-03-26 | 改用 `composedPath()` 偵測卡片按鈕點擊 |
| v1.5.19 | 2026-03-26 | 卡片改為 root event delegation，改善 HA 重繪後 click listener 丟失 |
| v1.5.18 | 2026-03-26 | 卡片加入可見的送出中 / 等待同步 / 錯誤狀態訊息 |
| v1.5.17 | 2026-03-26 | 套用費率前先更新本地 state，再 render，再送 backend |
| v1.5.16 | 2026-03-26 | 卡片同步來源固定優先使用 `rate_status` |
| v1.5.15 | 2026-03-26 | 卡片依實際 attributes 選擇 backend sync source |
| v1.5.14 | 2026-03-26 | 保留 `rate_status` 的 `_entry_data`，避免 `manual_rates` 被驗證流程洗掉 |
| v1.5.12 | 2026-03-26 | backend sensor 處理 `manual_rates = null`，避免 cost sensor 起動失敗 |
| v1.5.11 | 2026-03-26 | `manual_rates` 暴露到 cost sensor attributes，供卡片同步使用 |
| v1.5.10 | 2026-03-26 | 卡片加入等待 backend reload 完成前的 sync guard |
| v1.5.9  | 2026-03-26 | 保留使用者尚未儲存的卡片編輯內容，避免被 HA state 覆蓋 |
| v1.5.8  | 2026-03-26 | 恢復雙頁籤卡片（費率表 / 設定） |
| v1.5.7  | 2026-03-26 | 將卡片 JS 持久化到 Lovelace resources，修復載入不穩定 |
| v1.5.6  | 2026-03-26 | `manifest.json` 補上 `dependencies: ["frontend"]` |
| v1.5.4  | 2026-03-26 | StaticPathConfig 改用 FILE path，修復 card JS 404 |
| v1.5.3  | 2026-03-26 | 卡片 JS 改由整合直接提供，不再依賴手動複製到 `/local` |
| v1.4.11 | 2026-03-25 | Options flow 自動 reload + 舊 sensor 自動清理 |
| v1.4.9  | 2026-03-25 | Options flow 改用 HA 官方標準模式 (`add_suggested_values_to_schema`) |
| v1.4.7  | 2026-03-25 | service `update_config` 的 `meter_start_day` 改用字串，避免 date 物件導致 sensor 崩潰 |
| v1.4.4  | 2026-03-25 | Options flow 不再清空 config entry 的 data |
| v1.4.3  | 2026-03-25 | 雙月抄表閾值修正（單月 ×2） |
| v1.4.2  | 2026-03-25 | `kwh_cost` 改回階距費率（非平均單價） |
| v1.4.1  | 2026-03-25 | 修復 static path、`services.yaml` 缺失、sensor 初始化崩潰 |
| v1.4.0  | 2026-03-25 | 新增裝置頁整合（device_info）、sensor 預設啟用、一鍵更新按鈕、設定卡片 |
| v1.3.8  | 2026-03-25 | 卡片雙頁籤佈局 |
| v1.3.0  | 2026-03-25 | 手動費率覆寫 UI |
| v1.2.0  | 2026-03-25 | 選項流程 + 自訂卡片並存 |
| v1.1.0  | 2026-03-25 | 自訂服務 bypass 選項流程 500 錯誤 |
| v1.0.0  | 2026-03-25 | 首次穩定版（PDF 解析、三種計費模式、費率監控） |
