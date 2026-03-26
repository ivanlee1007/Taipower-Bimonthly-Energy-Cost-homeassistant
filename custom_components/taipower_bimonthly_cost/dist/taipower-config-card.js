/**
 * TaiPower Config Card
 * Stable plain-DOM version with restored dual tabs.
 */
class TaiPowerConfigCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._initialized = false;
    this._saving = false;
    this._error = "";
    this._message = "";
    this._userEditing = false;
    this._dirty = false;
    this._pendingSync = false;
    this._activeAction = "";
    this._delegatedClickBound = false;
    this._tab = "rates";
    this._config = {
      bimonthly_energy: "",
      billing_mode: "residential",
      meter_start_day: "",
      manual_rates: null,
    };
    this._editConfig = { ...this._config };
    this._ratesInfo = {
      rates_version: "—",
      rates_age_days: "—",
      manual_override: false,
    };
    this._version = "1.5.19";
  }

  setConfig(config) {
    this.config = {
      title: "⚡ 台電費率設定",
      ...config,
    };
    this._render();
  }

  connectedCallback() {
    if (this._delegatedClickBound) return;
    this._delegatedClickBound = true;
    this.addEventListener("click", async (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;

      const tabBtn = target.closest(".tab");
      if (tabBtn && this.contains(tabBtn)) {
        this._tab = tabBtn.dataset.tab;
        this._message = "";
        this._error = "";
        this._userEditing = false;
        this._render();
        return;
      }

      const saveBtn = target.closest("#tp-save");
      if (saveBtn && this.contains(saveBtn)) {
        ev.preventDefault();
        await this._saveSettings();
        return;
      }

      const applyBtn = target.closest("#tp-apply-rates");
      if (applyBtn && this.contains(applyBtn)) {
        ev.preventDefault();
        await this._applyRates();
        return;
      }

      const resetRatesBtn = target.closest("#tp-reset-rates");
      if (resetRatesBtn && this.contains(resetRatesBtn)) {
        ev.preventDefault();
        await this._resetRates();
        return;
      }

      const resetBtn = target.closest("#tp-reset");
      if (resetBtn && this.contains(resetBtn)) {
        ev.preventDefault();
        this._editConfig = {
          ...this._config,
          manual_rates_text: this._config.manual_rates ? JSON.stringify(this._config.manual_rates, null, 2) : "",
        };
        this._error = "";
        this._message = "已重設為目前設定";
        this._userEditing = false;
        this._dirty = false;
        this._pendingSync = false;
        this._activeAction = "";
        this._render();
      }
    });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._syncFromHass();
      this._render();
      return;
    }

    if (this._pendingSync) {
      if (this._backendMatchesLocalConfig()) {
        const action = this._activeAction;
        this._pendingSync = false;
        this._activeAction = "";
        this._dirty = false;
        this._message = action === "apply_rates"
          ? "費率已同步完成。"
          : action === "reset_rates"
            ? "已恢復預設費率並同步完成。"
            : action === "save_settings"
              ? "設定已同步完成。"
              : "同步完成。";
        this._syncFromHass();
        this._render();
      }
      return;
    }

    if (!this._userEditing && !this._dirty) {
      this._syncFromHass();
      this._render();
    }
  }

  getCardSize() {
    return this._tab === "rates" ? 10 : 8;
  }

  _esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _findReferenceSensors() {
    const states = this._hass?.states || {};
    let powerCost = null;
    let kwhCost = null;
    let rateStatus = null;

    for (const [entityId, stateObj] of Object.entries(states)) {
      if (!entityId.startsWith("sensor.")) continue;
      if (!powerCost && entityId.endsWith("_power_cost")) powerCost = { entityId, stateObj };
      if (!kwhCost && entityId.endsWith("_kwh_cost")) kwhCost = { entityId, stateObj };
      if (!rateStatus && entityId.endsWith("_rate_status")) rateStatus = { entityId, stateObj };
    }

    return { powerCost, kwhCost, rateStatus };
  }

  _extractConfigFromRef(ref) {
    if (!ref?.stateObj) return null;
    const attrs = ref.stateObj.attributes || {};
    const source = attrs["bimonthly energy source"] || attrs.bimonthly_energy || "";
    const billingMode = attrs.billing_mode || "";
    const meterStartDay = attrs["start day"] || attrs.meter_start_day || "";
    const hasConfig = !!(source || billingMode || meterStartDay || Object.prototype.hasOwnProperty.call(attrs, "manual_rates"));
    if (!hasConfig) return null;
    return {
      bimonthly_energy: source,
      billing_mode: billingMode || "residential",
      meter_start_day: String(meterStartDay || ""),
      manual_rates: Object.prototype.hasOwnProperty.call(attrs, "manual_rates") ? attrs.manual_rates : null,
    };
  }

  _buildBackendSnapshot() {
    const { powerCost, kwhCost, rateStatus } = this._findReferenceSensors();
    const config =
      this._extractConfigFromRef(rateStatus) ||
      this._extractConfigFromRef(powerCost) ||
      this._extractConfigFromRef(kwhCost);

    const rates = rateStatus
      ? {
          rates_version: rateStatus.stateObj.attributes?.rates_version || "—",
          rates_age_days: rateStatus.stateObj.attributes?.rates_age_days ?? "—",
          manual_override: !!rateStatus.stateObj.attributes?.manual_override,
        }
      : null;

    return { config, rates };
  }

  _jsonEqual(a, b) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }

  _backendMatchesLocalConfig() {
    const snap = this._buildBackendSnapshot();
    if (!snap.config) return false;
    return (
      snap.config.bimonthly_energy === (this._config.bimonthly_energy || "") &&
      snap.config.billing_mode === (this._config.billing_mode || "residential") &&
      snap.config.meter_start_day === String(this._config.meter_start_day || "") &&
      this._jsonEqual(snap.config.manual_rates, this._config.manual_rates || null)
    );
  }

  _syncFromHass() {
    const snap = this._buildBackendSnapshot();
    if (snap.config) {
      const next = snap.config;
      this._config = next;
      this._editConfig = {
        ...next,
        manual_rates_text: next.manual_rates ? JSON.stringify(next.manual_rates, null, 2) : "",
      };
    }

    if (snap.rates) {
      this._ratesInfo = snap.rates;
    }
  }

  _getEnergySensorOptions() {
    const states = this._hass?.states || {};
    const result = [];
    const seen = new Set();
    const current = this._editConfig.bimonthly_energy || this._config.bimonthly_energy || "";

    const pushOption = (entityId, label) => {
      if (!entityId || seen.has(entityId)) return;
      seen.add(entityId);
      result.push({ entity_id: entityId, label: label || entityId });
    };

    if (current) pushOption(current, current);

    for (const [entityId, stateObj] of Object.entries(states)) {
      if (!entityId.startsWith("sensor.")) continue;
      if (
        entityId.endsWith("_power_cost") ||
        entityId.endsWith("_kwh_cost") ||
        entityId.endsWith("_rate_status")
      ) {
        continue;
      }

      const attrs = stateObj.attributes || {};
      const unit = String(attrs.unit_of_measurement || attrs.native_unit_of_measurement || "");
      const text = [
        entityId,
        attrs.friendly_name || "",
        attrs.device_class || "",
        unit,
      ]
        .join(" ")
        .toLowerCase();

      if (
        unit.toLowerCase() === "kwh" ||
        unit.toLowerCase() === "千瓦時" ||
        text.includes("kwh") ||
        text.includes("energy") ||
        text.includes("electric") ||
        text.includes("電") ||
        text.includes("累計")
      ) {
        pushOption(entityId, attrs.friendly_name ? `${attrs.friendly_name} (${entityId})` : entityId);
      }
    }

    result.sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
    return result;
  }

  _getModeMeta(mode) {
    const map = {
      residential: {
        name: "住宅用",
        thresholds: [240, 660, 1000, 1400, 2000, "∞"],
        summer: [1.78, 2.55, 3.8, 5.14, 6.44, 8.86],
        non_summer: [1.78, 2.26, 3.13, 4.24, 5.27, 7.03],
      },
      non_commercial: {
        name: "非營業用",
        thresholds: [240, 660, 1000, 1400, 2000, "∞"],
        summer: [1.78, 2.55, 3.8, 5.14, 6.44, 8.86],
        non_summer: [1.78, 2.26, 3.13, 4.24, 5.27, 7.03],
      },
      commercial: {
        name: "營業用",
        thresholds: [660, 1400, 3000, 6000, "∞"],
        summer: [2.71, 3.76, 4.46, 7.08, 7.43],
        non_summer: [2.28, 3.1, 3.61, 5.56, 5.83],
      },
    };
    return map[mode] || map.residential;
  }

  _getEffectiveRates(mode) {
    const meta = this._getModeMeta(mode);
    const manual = this._editConfig.manual_rates || this._config.manual_rates || null;
    if (manual && manual[mode] && Array.isArray(manual[mode].summer) && Array.isArray(manual[mode].non_summer)) {
      return {
        name: meta.name,
        thresholds: meta.thresholds,
        summer: manual[mode].summer,
        non_summer: manual[mode].non_summer,
        isManual: true,
      };
    }
    return {
      name: meta.name,
      thresholds: meta.thresholds,
      summer: meta.summer,
      non_summer: meta.non_summer,
      isManual: false,
    };
  }

  _buildRateTable() {
    const mode = this._editConfig.billing_mode || this._config.billing_mode || "residential";
    const rateData = this._getEffectiveRates(mode);
    const month = new Date().getMonth() + 1;
    const isSummer = month >= 6 && month <= 9;
    const currentRates = isSummer ? rateData.summer : rateData.non_summer;

    const rows = rateData.summer
      .map((summerRate, idx) => {
        const nonSummerRate = rateData.non_summer[idx];
        const upper = rateData.thresholds[idx];
        const lower = idx === 0 ? 0 : rateData.thresholds[idx - 1];
        const rangeLabel = idx === 0 ? `0 ~ ${upper}` : `${lower} ~ ${upper}`;
        return `
          <tr>
            <td>${this._esc(rangeLabel)}</td>
            <td class="${isSummer ? "active-season" : ""}">
              <input class="rate-input" type="number" step="0.01" min="0" data-tier="${idx}" data-season="summer" value="${this._esc(summerRate)}" ${this._saving ? "disabled" : ""}>
            </td>
            <td class="${!isSummer ? "active-season" : ""}">
              <input class="rate-input" type="number" step="0.01" min="0" data-tier="${idx}" data-season="non_summer" value="${this._esc(nonSummerRate)}" ${this._saving ? "disabled" : ""}>
            </td>
            <td class="current-rate"><strong>${this._esc(currentRates[idx])}</strong></td>
          </tr>
        `;
      })
      .join("");

    return `
      <div class="section-title-row">
        <div>
          <div class="section-title">📊 費率表 — ${this._esc(rateData.name)}</div>
          <div class="section-subtitle">目前季節：${isSummer ? "☀️ 夏月" : "❄️ 非夏月"}</div>
        </div>
        <div class="badge ${rateData.isManual ? "warn" : "ok"}">${rateData.isManual ? "手動覆蓋中" : "預設費率"}</div>
      </div>

      <table class="rate-table">
        <thead>
          <tr>
            <th>級距 (kWh)</th>
            <th>夏月費率</th>
            <th>非夏月費率</th>
            <th>當前</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="info-line">
        費率版本：${this._esc(this._ratesInfo.rates_version)} ｜ 資料距今：${this._esc(this._ratesInfo.rates_age_days)} 天
      </div>

      <div class="actions rate-actions">
        <button id="tp-apply-rates" class="primary" ${(this._saving || (this._pendingSync && this._activeAction === "apply_rates")) ? "disabled" : ""}>${this._saving && this._activeAction === "apply_rates" ? "送出中..." : this._pendingSync && this._activeAction === "apply_rates" ? "等待同步..." : "💾 套用費率"}</button>
        ${rateData.isManual ? `<button id="tp-reset-rates" class="secondary" ${(this._saving || (this._pendingSync && this._activeAction === "reset_rates")) ? "disabled" : ""}>${this._saving && this._activeAction === "reset_rates" ? "送出中..." : this._pendingSync && this._activeAction === "reset_rates" ? "等待同步..." : "↩️ 恢復預設"}</button>` : ""}
      </div>
    `;
  }

  _renderSettingsTab() {
    const options = this._getEnergySensorOptions();
    const current = this._editConfig.bimonthly_energy || "";
    const hasCurrent = current && options.some((item) => item.entity_id === current);

    return `
      <div class="field">
        <label for="tp-energy">累計電量感測器</label>
        <select id="tp-energy">
          <option value="">請選擇 kWh sensor</option>
          ${options
            .map(
              (item) => `<option value="${this._esc(item.entity_id)}" ${item.entity_id === current ? "selected" : ""}>${this._esc(item.label)}</option>`
            )
            .join("")}
        </select>
        ${!hasCurrent && current ? `<div class="hint">目前設定：${this._esc(current)}</div>` : ""}
      </div>

      <div class="field">
        <label for="tp-billing-mode">計費模式</label>
        <select id="tp-billing-mode">
          <option value="residential" ${this._editConfig.billing_mode === "residential" ? "selected" : ""}>🏠 住宅用</option>
          <option value="non_commercial" ${this._editConfig.billing_mode === "non_commercial" ? "selected" : ""}>🏢 非營業用</option>
          <option value="commercial" ${this._editConfig.billing_mode === "commercial" ? "selected" : ""}>🏬 營業用</option>
        </select>
      </div>

      <div class="field">
        <label for="tp-meter-start-day">抄表起始日</label>
        <input id="tp-meter-start-day" type="date" value="${this._esc(this._editConfig.meter_start_day || "")}" />
      </div>

      <div class="field">
        <details>
          <summary>▶ 進階：手動費率 JSON（備用）</summary>
          <textarea id="tp-manual-rates" rows="5" placeholder='留空使用預設費率'>${this._esc(this._editConfig.manual_rates_text || "")}</textarea>
        </details>
      </div>

      <div class="info-line">
        費率版本：${this._esc(this._ratesInfo.rates_version)} ｜ 資料距今：${this._esc(this._ratesInfo.rates_age_days)} 天
      </div>

      <div class="actions">
        <button id="tp-reset" class="secondary" ${this._saving ? "disabled" : ""}>重設</button>
        <button id="tp-save" class="primary" ${(this._saving || (this._pendingSync && this._activeAction === "save_settings")) ? "disabled" : ""}>${this._saving && this._activeAction === "save_settings" ? "送出中..." : this._pendingSync && this._activeAction === "save_settings" ? "等待同步..." : "💾 儲存設定"}</button>
      </div>
    `;
  }

  _render() {
    if (!this.config) return;

    const { powerCost, rateStatus } = this._findReferenceSensors();
    const stateText = rateStatus
      ? `目前來源：${this._esc(rateStatus.entityId)}`
      : powerCost
        ? `目前來源：${this._esc(powerCost.entityId)}`
        : "目前還抓不到台電 cost sensor，卡片仍可先顯示。";
    const statusBadge = this._error
      ? '<span class="badge warn">錯誤</span>'
      : this._saving
        ? '<span class="badge warn">送出中</span>'
        : this._pendingSync
          ? '<span class="badge warn">等待同步</span>'
          : '<span class="badge ok">就緒</span>';

    this.innerHTML = `
      <ha-card header="${this._esc(this.config.title)}">
        <div class="tp-wrap">
          <div class="tp-topbar">
            <span class="badge build">build v${this._esc(this._version)}</span>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              ${statusBadge}
              <span class="muted">${stateText}</span>
            </div>
          </div>

          ${this._error ? `<div class="alert error">${this._esc(this._error)}</div>` : ""}
          ${this._message ? `<div class="alert success">${this._esc(this._message)}</div>` : ""}

          <div class="tabs">
            <button class="tab ${this._tab === "rates" ? "active" : ""}" data-tab="rates">📊 費率表</button>
            <button class="tab ${this._tab === "settings" ? "active" : ""}" data-tab="settings">⚙️ 設定</button>
          </div>

          <div class="tab-panel">
            ${this._tab === "rates" ? this._buildRateTable() : this._renderSettingsTab()}
          </div>
        </div>

        <style>
          ha-card { display:block; }
          .tp-wrap { padding: 12px; }
          .tp-topbar {
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:8px;
            margin-bottom:12px;
            flex-wrap:wrap;
          }
          .badge {
            display:inline-flex;
            align-items:center;
            padding:3px 8px;
            border-radius:999px;
            font-size:.75rem;
            font-weight:700;
          }
          .badge.build {
            background: rgba(33, 150, 243, .14);
            color: var(--primary-color);
          }
          .badge.ok {
            background: rgba(56, 142, 60, .12);
            color: #2e7d32;
          }
          .badge.warn {
            background: rgba(245, 124, 0, .12);
            color: #ef6c00;
          }
          .muted {
            color: var(--secondary-text-color);
            font-size: .82rem;
          }
          .tabs {
            display:flex;
            gap:0;
            margin: 6px 0 14px;
            border-bottom: 2px solid var(--divider-color, rgba(127,127,127,.2));
          }
          .tab {
            flex:1;
            border:none;
            background:none;
            padding:10px 8px;
            cursor:pointer;
            color: var(--secondary-text-color);
            font-weight:700;
            border-bottom:2px solid transparent;
            margin-bottom:-2px;
          }
          .tab.active {
            color: var(--primary-color);
            border-bottom-color: var(--primary-color);
          }
          .tab-panel { min-height: 140px; }
          .field { margin-bottom: 12px; }
          .field label {
            display:block;
            margin-bottom: 6px;
            font-size: .86rem;
            font-weight: 700;
            color: var(--secondary-text-color);
          }
          .field input,
          .field select,
          .field textarea {
            width:100%;
            box-sizing:border-box;
            padding: 10px 12px;
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            background: var(--card-background-color, var(--ha-card-background, #fff));
            color: var(--primary-text-color);
            font-size: 14px;
          }
          .field textarea {
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            resize: vertical;
          }
          .hint {
            margin-top: 6px;
            color: var(--secondary-text-color);
            font-size: .78rem;
            word-break: break-all;
          }
          details summary {
            cursor:pointer;
            color: var(--secondary-text-color);
            font-size: .9rem;
          }
          .actions {
            display:flex;
            justify-content:flex-end;
            gap:8px;
            margin-top: 14px;
            flex-wrap: wrap;
          }
          .actions button {
            border: none;
            border-radius: 8px;
            padding: 10px 14px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
          }
          .actions button.primary {
            background: var(--primary-color);
            color: white;
          }
          .actions button.secondary {
            background: var(--secondary-background-color, rgba(127,127,127,.12));
            color: var(--primary-text-color);
          }
          .actions button[disabled] {
            opacity: .55;
            cursor: not-allowed;
          }
          .rate-table {
            width:100%;
            border-collapse: collapse;
            font-size: .9rem;
            margin-top: 8px;
          }
          .rate-table th,
          .rate-table td {
            padding: 8px;
            border: 1px solid var(--divider-color, rgba(127,127,127,.2));
            text-align: center;
          }
          .rate-table th {
            background: var(--secondary-background-color, rgba(127,127,127,.08));
          }
          .rate-table td:first-child {
            text-align:left;
            white-space:nowrap;
          }
          .rate-input {
            width: 84px;
            padding: 6px 8px;
            border: 1px solid var(--divider-color);
            border-radius: 6px;
            background: var(--card-background-color, var(--ha-card-background, #fff));
            color: var(--primary-text-color);
            text-align:center;
          }
          .active-season {
            background: rgba(33, 150, 243, .08);
          }
          .current-rate {
            background: rgba(76, 175, 80, .08);
          }
          .section-title-row {
            display:flex;
            justify-content:space-between;
            gap:8px;
            align-items:flex-start;
            flex-wrap:wrap;
            margin-bottom: 8px;
          }
          .section-title {
            font-weight: 800;
            font-size: 1rem;
          }
          .section-subtitle,
          .info-line {
            color: var(--secondary-text-color);
            font-size: .84rem;
          }
          .alert {
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 12px;
            font-size: .85rem;
          }
          .alert.error {
            background: rgba(211, 47, 47, .10);
            color: var(--error-color);
          }
          .alert.success {
            background: rgba(56, 142, 60, .10);
            color: #2e7d32;
          }
          @media (max-width: 640px) {
            .rate-table { font-size: .82rem; }
            .rate-input { width: 70px; }
          }
        </style>
      </ha-card>
    `;

    this._bindEvents();
  }

  _markEditingOn(elements) {
    elements.forEach((el) => {
      if (!el) return;
      el.addEventListener("focus", () => {
        this._userEditing = true;
      });
      el.addEventListener("blur", () => {
        setTimeout(() => {
          this._userEditing = !!this.contains(document.activeElement);
        }, 0);
      });
    });
  }

  _bindEvents() {
    const energy = this.querySelector("#tp-energy");
    const billingMode = this.querySelector("#tp-billing-mode");
    const meterStartDay = this.querySelector("#tp-meter-start-day");
    const manualRates = this.querySelector("#tp-manual-rates");

    this._markEditingOn([energy, billingMode, meterStartDay, manualRates, ...this.querySelectorAll(".rate-input")]);

    if (energy) {
      energy.addEventListener("change", (ev) => {
        this._editConfig.bimonthly_energy = ev.target.value;
        this._dirty = true;
        this._message = "";
        this._error = "";
      });
    }

    if (billingMode) {
      billingMode.addEventListener("change", (ev) => {
        this._editConfig.billing_mode = ev.target.value;
        this._dirty = true;
        this._message = "";
        this._error = "";
        if (this._tab === "rates") this._render();
      });
    }

    if (meterStartDay) {
      meterStartDay.addEventListener("input", (ev) => {
        this._editConfig.meter_start_day = ev.target.value;
        this._dirty = true;
        this._message = "";
        this._error = "";
      });
    }

    if (manualRates) {
      manualRates.addEventListener("input", (ev) => {
        this._editConfig.manual_rates_text = ev.target.value;
        this._dirty = true;
        this._message = "";
        this._error = "";
      });
    }

    this.querySelectorAll(".rate-input").forEach((input) => {
      input.addEventListener("input", () => {
        this._dirty = true;
        this._message = "";
        this._error = "";
      });
    });

  }

  async _saveSettings() {
    if (!this._hass) return;

    if (!this._editConfig.bimonthly_energy) {
      this._error = "請先選擇累計電量感測器";
      this._message = "";
      this._render();
      return;
    }

    if (!this._editConfig.meter_start_day) {
      this._error = "請先填寫抄表起始日";
      this._message = "";
      this._render();
      return;
    }

    let manualRates = null;
    const raw = String(this._editConfig.manual_rates_text || "").trim();
    if (raw) {
      try {
        manualRates = JSON.parse(raw);
      } catch (err) {
        this._error = `手動費率 JSON 格式錯誤：${err?.message || err}`;
        this._message = "";
        this._render();
        return;
      }
    }

    this._saving = true;
    this._activeAction = "save_settings";
    this._error = "";
    this._message = "設定送出中…";
    this._render();

    try {
      await this._hass.callService("taipower_bimonthly_cost", "update_config", {
        bimonthly_energy: this._editConfig.bimonthly_energy,
        billing_mode: this._editConfig.billing_mode,
        meter_start_day: this._editConfig.meter_start_day,
        manual_rates: manualRates,
      });

      this._config = {
        bimonthly_energy: this._editConfig.bimonthly_energy,
        billing_mode: this._editConfig.billing_mode,
        meter_start_day: this._editConfig.meter_start_day,
        manual_rates: manualRates,
      };
      this._editConfig = {
        ...this._config,
        manual_rates_text: manualRates ? JSON.stringify(manualRates, null, 2) : "",
      };
      this._message = "設定已送出，等待整合同步。";
      this._dirty = true;
      this._pendingSync = true;
    } catch (err) {
      console.error("[TaiPower Config] save failed:", err);
      this._activeAction = "";
      this._error = `儲存失敗：${err?.message || err}`;
      this._message = "";
    } finally {
      this._saving = false;
      this._userEditing = false;
      this._render();
    }
  }

  async _applyRates() {
    if (!this._hass) return;

    const mode = this._editConfig.billing_mode || "residential";
    const currentManual = { ...(this._config.manual_rates || {}) };
    const inputs = [...this.querySelectorAll(".rate-input")];
    const summer = [];
    const nonSummer = [];

    for (const input of inputs) {
      const val = parseFloat(input.value);
      if (Number.isNaN(val)) {
        this._error = "費率必須是數字";
        this._message = "";
        this._render();
        return;
      }
      if (input.dataset.season === "summer") summer[Number(input.dataset.tier)] = val;
      if (input.dataset.season === "non_summer") nonSummer[Number(input.dataset.tier)] = val;
    }

    currentManual[mode] = { summer, non_summer };

    // 先把本地 state 更新成使用者剛輸入的值，避免 render 立刻把畫面洗回舊值
    this._config = {
      ...this._config,
      manual_rates: currentManual,
    };
    this._editConfig = {
      ...this._editConfig,
      manual_rates: currentManual,
      manual_rates_text: JSON.stringify(currentManual, null, 2),
    };

    this._saving = true;
    this._activeAction = "apply_rates";
    this._error = "";
    this._message = "費率送出中…";
    this._render();

    try {
      await this._hass.callService("taipower_bimonthly_cost", "update_config", {
        manual_rates: currentManual,
      });
      this._message = "費率已送出，等待整合同步。";
      this._dirty = true;
      this._pendingSync = true;
    } catch (err) {
      console.error("[TaiPower Config] apply rates failed:", err);
      this._activeAction = "";
      this._error = `套用費率失敗：${err?.message || err}`;
    } finally {
      this._saving = false;
      this._userEditing = false;
      this._render();
    }
  }

  async _resetRates() {
    if (!this._hass) return;

    const mode = this._editConfig.billing_mode || "residential";
    const currentManual = { ...(this._config.manual_rates || {}) };
    delete currentManual[mode];
    const nextManual = Object.keys(currentManual).length ? currentManual : null;

    this._saving = true;
    this._activeAction = "reset_rates";
    this._error = "";
    this._message = "恢復預設送出中…";
    this._render();

    try {
      await this._hass.callService("taipower_bimonthly_cost", "update_config", {
        manual_rates: nextManual,
      });
      this._config.manual_rates = nextManual;
      this._editConfig.manual_rates = nextManual;
      this._editConfig.manual_rates_text = nextManual ? JSON.stringify(nextManual, null, 2) : "";
      this._message = "已送出恢復預設，等待整合同步。";
      this._dirty = true;
      this._pendingSync = true;
    } catch (err) {
      console.error("[TaiPower Config] reset rates failed:", err);
      this._activeAction = "";
      this._error = `恢復預設失敗：${err?.message || err}`;
    } finally {
      this._saving = false;
      this._userEditing = false;
      this._render();
    }
  }
}

if (!customElements.get("taipower-config-card")) {
  customElements.define("taipower-config-card", TaiPowerConfigCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "custom:taipower-config-card")) {
  window.customCards.push({
    type: "custom:taipower-config-card",
    name: "台電費率設定卡片",
    description: "雙頁籤台電設定卡片：費率表 + 設定",
    preview: true,
    documentationURL: "https://github.com/ivanlee1007/Taipower-Bimonthly-Energy-Cost-homeassistant",
  });
}
