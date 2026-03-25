/**
 * TaiPower Config Card - Lovelace custom element
 * Allows users to configure TaiPower integration settings via a card
 * instead of the broken options flow.
 */
class TaiPowerConfigCard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._entryId = null;
    this._config = {
      bimonthly_energy: "",
      billing_mode: "residential",
      meter_start_day: ""
    };
    this._editConfig = { ...this._config };
    this._saving = false;
    this._error = null;
  }

  setConfig(config) {
    this._config = config || {};
    this._editConfig = { ...this._config };
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this._loadEntryConfig();
    this.render();
  }

  async _loadEntryConfig() {
    if (!this._hass) return;

    try {
      // Fetch config entries via REST API
      const resp = await this._hass.fetchWithAuth("/api/config/config_entries");
      const entries = await resp.json();
      const tpEntry = entries.find(e => e.domain === "taipower_bimonthly_cost");
      if (tpEntry) {
        this._entryId = tpEntry.entry_id;
        this._config = {
          bimonthly_energy: tpEntry.options?.bimonthly_energy || "",
          billing_mode: tpEntry.options?.billing_mode || "residential",
          meter_start_day: tpEntry.options?.meter_start_day || ""
        };
        this._editConfig = { ...this._config };
        this.render();
      }
    } catch (err) {
      console.error("[TaiPower Config] Failed to load entry:", err);
    }
  }

  async _saveConfig() {
    if (!this._hass) return;
    this._saving = true;
    this._error = null;
    this.render();

    try {
      await this._hass.callService("taipower_bimonthly_cost", "update_config", {
        entry_id: this._entryId,
        bimonthly_energy: this._editConfig.bimonthly_energy,
        billing_mode: this._editConfig.billing_mode,
        meter_start_day: this._editConfig.meter_start_day
      });
      this._config = { ...this._editConfig };
      this._saving = false;
      this._error = null;
      this.render();
    } catch (err) {
      console.error("[TaiPower Config] Save failed:", err);
      this._saving = false;
      this._error = String(err);
      this.render();
    }
  }

  _updateField(field, value) {
    this._editConfig[field] = value;
  }

  getCardSize() {
    return 6;
  }

  render() {
    const billingModes = [
      { value: "residential", label: "🏠 住宅用" },
      { value: "non_commercial", label: "🏢 非營業用" },
      { value: "commercial", label: "🏬 營業用" }
    ];

    const modeOptions = billingModes.map(m =>
      `<option value="${m.value}" ${this._editConfig.billing_mode === m.value ? 'selected' : ''}>${m.label}</option>`
    ).join('');

    this.innerHTML = `
      <ha-card header="⚡ 台電費率設定">
        <div class="card-content">
          ${this._error ? `<div class="error">${this._error}</div>` : ''}

          <div class="field">
            <label>累計電量感測器</label>
            <input type="text"
              .value="${this._editConfig.bimonthly_energy}"
              @input="${e => this._updateField('bimonthly_energy', e.target.value)}"
              placeholder="sensor.xxx累计电量" />
          </div>

          <div class="field">
            <label>計費模式</label>
            <select @change="${e => this._updateField('billing_mode', e.target.value)}">
              ${modeOptions}
            </select>
          </div>

          <div class="field">
            <label>抄表起始日</label>
            <input type="date"
              .value="${this._editConfig.meter_start_day}"
              @input="${e => this._updateField('meter_start_day', e.target.value)}" />
          </div>
        </div>
        <div class="card-actions">
          <mwc-button
            @click="${() => this._saveConfig()}"
            ?disabled="${this._saving}">
            ${this._saving ? '儲存中...' : '💾 儲存設定'}
          </mwc-button>
        </div>
      </ha-card>

      <style>
        .card-content { padding: 0 16px 16px; }
        .field { margin-bottom: 12px; }
        .field label {
          display: block;
          font-size: 12px;
          color: var(--secondary-text-color);
          margin-bottom: 4px;
        }
        .field input, .field select {
          width: 100%;
          padding: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--paper-card-background-color, var(--card-background-color));
          color: var(--primary-text-color);
          font-size: 14px;
          box-sizing: border-box;
        }
        .field input:focus, .field select:focus {
          border-color: var(--primary-color);
          outline: none;
        }
        .error {
          color: var(--error-color);
          background: var(--error-color-bg, #fdecea);
          padding: 8px 12px;
          border-radius: 4px;
          margin-bottom: 12px;
          font-size: 13px;
        }
        .card-actions { padding: 0 8px 8px; }
      </style>
    `;
  }
}

customElements.define('taipower-config-card', TaiPowerConfigCard);

// Register for HACS/Lovelace discovery
window.customCards = window.customCards || [];
window.customCards.push({
  type: "taipower-config-card",
  name: "台電費率設定卡片",
  description: "設定台電二段式電價整合的感測器、計費模式與抄表日",
  preview: true,
  documentationURL: "https://github.com/ivanlee1007/Taipower-Bimonthly-Energy-Cost-homeassistant"
});
