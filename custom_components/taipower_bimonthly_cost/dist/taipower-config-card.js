/**
 * TaiPower Config Card
 * Stable plain-DOM version.
 *
 * Goals:
 * 1. Card must appear reliably once the bundled JS is loaded.
 * 2. Avoid broken HA config_entries REST calls.
 * 3. Use current sensor attributes + service call for a practical config UI.
 */
class TaiPowerConfigCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._initialized = false;
    this._rendered = false;
    this._saving = false;
    this._error = "";
    this._message = "";
    this._userEditing = false;
    this._config = {
      bimonthly_energy: "",
      billing_mode: "residential",
      meter_start_day: "",
    };
    this._editConfig = { ...this._config };
    this._version = "1.5.5";
  }

  setConfig(config) {
    this.config = {
      title: "⚡ 台電費率設定",
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._syncFromHass();
      this._render();
      return;
    }

    if (!this._userEditing) {
      this._syncFromHass();
      this._render();
    }
  }

  getCardSize() {
    return 6;
  }

  _esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _findPowerCostEntity() {
    const states = this._hass?.states || {};
    for (const [entityId, stateObj] of Object.entries(states)) {
      if (!entityId.startsWith("sensor.")) continue;
      const attrs = stateObj.attributes || {};
      if (attrs["bimonthly energy source"] && attrs["start day"] && attrs.billing_mode) {
        return { entityId, stateObj };
      }
    }
    return null;
  }

  _syncFromHass() {
    const found = this._findPowerCostEntity();
    if (!found) return;

    const attrs = found.stateObj.attributes || {};
    const next = {
      bimonthly_energy: attrs["bimonthly energy source"] || "",
      billing_mode: attrs.billing_mode || "residential",
      meter_start_day: String(attrs["start day"] || ""),
    };

    this._config = next;
    this._editConfig = { ...next };
  }

  _getEnergySensorOptions() {
    const states = this._hass?.states || {};
    const result = [];

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
      ].join(" ").toLowerCase();

      if (
        unit.toLowerCase() === "kwh" ||
        unit.toLowerCase() === "千瓦時" ||
        text.includes("kwh") ||
        text.includes("energy") ||
        text.includes("electric") ||
        text.includes("電") ||
        text.includes("累計")
      ) {
        result.push({
          entity_id: entityId,
          label: attrs.friendly_name ? `${attrs.friendly_name} (${entityId})` : entityId,
        });
      }
    }

    result.sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
    return result;
  }

  _renderEntityField() {
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
    `;
  }

  _render() {
    if (!this.config) return;

    const found = this._findPowerCostEntity();
    const stateText = found
      ? `目前來源：${this._esc(found.entityId)}`
      : "目前還抓不到台電 cost sensor，卡片仍可先顯示。";

    this.innerHTML = `
      <ha-card header="${this._esc(this.config.title)}">
        <div class="tp-wrap">
          <div class="tp-topbar">
            <span class="badge">build v${this._esc(this._version)}</span>
            <span class="muted">${stateText}</span>
          </div>

          ${this._error ? `<div class="alert error">${this._esc(this._error)}</div>` : ""}
          ${this._message ? `<div class="alert success">${this._esc(this._message)}</div>` : ""}

          ${this._renderEntityField()}

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

          <div class="card-actions">
            <button id="tp-reset" class="secondary" ${this._saving ? "disabled" : ""}>重設</button>
            <button id="tp-save" class="primary" ${this._saving ? "disabled" : ""}>${this._saving ? "儲存中..." : "儲存設定"}</button>
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
            background: rgba(33, 150, 243, .14);
            color: var(--primary-color);
            font-size: .75rem;
            font-weight: 700;
          }
          .muted {
            color: var(--secondary-text-color);
            font-size: .82rem;
          }
          .field { margin-bottom: 12px; }
          .field label {
            display:block;
            margin-bottom: 6px;
            font-size: .86rem;
            font-weight: 700;
            color: var(--secondary-text-color);
          }
          .field input,
          .field select {
            width:100%;
            box-sizing:border-box;
            padding: 10px 12px;
            border: 1px solid var(--divider-color);
            border-radius: 8px;
            background: var(--card-background-color, var(--ha-card-background, #fff));
            color: var(--primary-text-color);
            font-size: 14px;
          }
          .hint {
            margin-top: 6px;
            color: var(--secondary-text-color);
            font-size: .78rem;
            word-break: break-all;
          }
          .card-actions {
            display:flex;
            justify-content:flex-end;
            gap:8px;
            margin-top: 14px;
          }
          .card-actions button {
            border: none;
            border-radius: 8px;
            padding: 10px 14px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
          }
          .card-actions button.primary {
            background: var(--primary-color);
            color: white;
          }
          .card-actions button.secondary {
            background: var(--secondary-background-color, rgba(127,127,127,.12));
            color: var(--primary-text-color);
          }
          .card-actions button[disabled] {
            opacity: .55;
            cursor: not-allowed;
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
        </style>
      </ha-card>
    `;

    this._bindEvents();
    this._rendered = true;
  }

  _bindEvents() {
    const energy = this.querySelector("#tp-energy");
    const billingMode = this.querySelector("#tp-billing-mode");
    const meterStartDay = this.querySelector("#tp-meter-start-day");
    const saveBtn = this.querySelector("#tp-save");
    const resetBtn = this.querySelector("#tp-reset");

    [energy, billingMode, meterStartDay].forEach((el) => {
      if (!el) return;
      el.addEventListener("focus", () => {
        this._userEditing = true;
      });
      el.addEventListener("blur", () => {
        setTimeout(() => {
          const active = this.contains(document.activeElement);
          this._userEditing = !!active;
        }, 0);
      });
    });

    if (energy) {
      energy.addEventListener("change", (ev) => {
        this._editConfig.bimonthly_energy = ev.target.value;
        this._message = "";
        this._error = "";
      });
    }

    if (billingMode) {
      billingMode.addEventListener("change", (ev) => {
        this._editConfig.billing_mode = ev.target.value;
        this._message = "";
        this._error = "";
      });
    }

    if (meterStartDay) {
      meterStartDay.addEventListener("input", (ev) => {
        this._editConfig.meter_start_day = ev.target.value;
        this._message = "";
        this._error = "";
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        this._editConfig = { ...this._config };
        this._error = "";
        this._message = "已重設為目前設定";
        this._userEditing = false;
        this._render();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        await this._saveConfig();
      });
    }
  }

  async _saveConfig() {
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

    this._saving = true;
    this._error = "";
    this._message = "";
    this._render();

    try {
      await this._hass.callService("taipower_bimonthly_cost", "update_config", {
        bimonthly_energy: this._editConfig.bimonthly_energy,
        billing_mode: this._editConfig.billing_mode,
        meter_start_day: this._editConfig.meter_start_day,
      });

      this._config = { ...this._editConfig };
      this._message = "設定已送出，整合會自動重載。";
      this._error = "";
    } catch (err) {
      console.error("[TaiPower Config] save failed:", err);
      this._error = `儲存失敗：${err?.message || err}`;
      this._message = "";
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
    description: "設定台電雙月電費整合的感測器、計費模式與抄表日",
    preview: true,
    documentationURL: "https://github.com/ivanlee1007/Taipower-Bimonthly-Energy-Cost-homeassistant",
  });
}
