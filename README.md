[![](https://img.shields.io/github/v/release/ivanlee1007/Taipower-Bimonthly-Energy-Cost-homeassistant.svg?style=flat-square)](https://github.com/ivanlee1007/Taipower-Bimonthly-Energy-Cost-homeassistant/releases/latest)  [![](https://img.shields.io/badge/HACS-Default-orange.svg?style=flat-square)](https://github.com/hacs/integration)

# Taipower-Bimonthly-Energy-Cost-homeassistant

Calculate Taipower (Taiwan Power Company) bi-monthly (60 days) bill amount from kWh sensor on Home Assistant.  
在 Home Assistant (HA) 內以 kWh sensor (千瓦⋅時 電度 傳感器) 計算每期 (60日曆天) 電費帳單金額.

### ✨ Features / 功能特色

- **三種計費模式**：住宅用、非營業用、營業用（表燈非時間電價）
- **自動累進計價**：正確計算各級距累進費用，不只給平均單價
- **自動費率更新**：透過台電官方 PDF 自動解析最新費率
- **一鍵更新按鈕**：裝置頁內建按鈕，一鍵從台電 PDF 重新抓取費率
- **費率狀態監控**：`rate_status` sensor 自動檢測費率是否過期或異常
- **手動費率覆寫**：當 PDF 解析失敗時，可手動貼上 JSON 覆寫費率
- **多電表支援**：可設定多個台電電表來源分別計算
- **能源面板整合**：提供 `kwh_cost` sensor 給 HA 內建能源面板作為電費單價
- **裝置頁整合**：所有實體（3 個 sensor + 1 個 button）自動歸入同一裝置頁
- **設定卡片**：提供 Lovelace 自訂卡片，不需進 Options 流程即可修改設定

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
|       |-- manifest.json
|       |-- scripts/
|       |   |-- package.json
|       |   |-- update_rates.js
|       |-- translations/
|           |-- en.json
|           |-- zh-Hant.json
|-- dist/
    |-- taipower-config-card.js
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

卡片會自動抓取當前設定，可直接修改計費模式、感測器、抄表日，並儲存。

### 3c) 自動費率更新按鈕

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

### `sensor.<name>_rate_status`

| 屬性 | 說明 |
|------|------|
| `rates_version` | 費率版本（checksum） |
| `rates_last_parsed_at` | PDF 最後成功解析時間 |
| `rates_age_days` | 費率資料天數 |
| `pdf_version` | PDF 版本號 |
| `manual_override` | 是否使用手動覆寫（true/false） |
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
| v1.4.11 | 2026-03-26 | Options flow 自動 reload + 舊 sensor 自動清理 |
| v1.4.10 | 2026-03-25 | sensor.py 加入 setup 詳細日誌 |
| v1.4.9 | 2026-03-25 | Options flow 改用 HA 官方標準模式 (add_suggested_values_to_schema) |
| v1.4.8 | 2026-03-25 | 修正 manifest.json 版本號 |
| v1.4.7 | 2026-03-25 | service `update_config` 的 `meter_start_day` 改用字串，避免 date 物件導致 sensor 崩潰 |
| v1.4.6 | 2026-03-25 | `__init__.py` 與 `sensor.py` 的 `_get_config_value` 統一空值 fallback 邏輯 |
| v1.4.5 | 2026-03-25 | Options flow 增加空值備援（舊配置被 v1.4.0 bug 清空時的自癒能力） |
| v1.4.4 | 2026-03-25 | Options flow 不再清空 config entry 的 data |
| v1.4.3 | 2026-03-25 | 雙月抄表閾值修正（單月 ×2） |
| v1.4.2 | 2026-03-25 | `kwh_cost` 改回階距費率（非平均單價） |
| v1.4.1 | 2026-03-25 | 修復 async_register_static_paths、services.yaml 缺失、sensor 初始化崩潰 |
| v1.4.0 | 2026-03-25 | 新增裝置頁整合（device_info）、sensor 預設啟用、一鍵更新按鈕、設定卡片 |
| v1.3.8 | 2026-03-25 | 卡片雙頁籤佈局 |
| v1.3.6 | 2026-03-25 | 手動更新按鈕 + 累計電量下拉選單 |
| v1.3.5 | 2026-03-25 | 卡片安裝移到 async_setup_entry |
| v1.3.2 | 2026-03-25 | 翻譯修正 |
| v1.3.0 | 2026-03-25 | 手動費率覆寫 UI |
| v1.2.0 | 2026-03-25 | 選項流程 + 自訂卡片並存 |
| v1.1.0 | 2026-03-25 | 自訂服務 bypass 選項流程 500 錯誤 |
| v1.0.0 | 2026-03-25 | 首次穩定版（PDF 解析、三種計費模式、費率監控） |
