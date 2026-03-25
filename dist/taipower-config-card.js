/**
 * TaiPower Config Card - Lovelace custom element
 * Pure DOM: build once, never rebuild innerHTML.
 * Skips value sync while user is actively editing to prevent focus/dropdown loss.
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
    this._domReady = false;
    this._userEditing = false;
    this._version = "1.5.3";
  }

  setConfig(config) {
    this._config = config || {};
    this._editConfig = { ...this._config };
    this._ensureDOM();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._userEditing) {
      this._loadEntryConfig();
    }
  }

  async _loadEntryConfig() {
    if (!this._hass) return;
    try {
      const resp = await this._hass.fetchWithAuth("/api/config/config_entries");
      const entries = await resp.json();
      const tpEntry = entries.find(e => e.domain === "taipower_bimonthly_cost");
      if (tpEntry) {
        const newEnergy = tpEntry.options?.bimonthly_energy || "";
        const newMode = tpEntry.options?.billing_mode || "residential";
        const newDay = tpEntry.options?.meter_start_day || "";
        if (
          newEnergy !== this._config.bimonthly_energy ||
          newMode !== this._config.billing_mode ||
          newDay !== this._config.meter_start_day
        ) {
          this._entryId = tpEntry.entry_id;
          this._config = { bimonthly_energy: newEnergy, billing_mode: newMode, meter_start_day: newDay };
          this._editConfig = { ...this._config };
          if (!this._userEditing) this._syncToDOM();
        }
      }
    } catch (err) {
      console.error("[TaiPower Config] Failed to load entry:", err);
    }
  }

  _ensureDOM() {
    if (this._domReady) return;
    this._domReady = true;
    while (this.firstChild) this.removeChild(this.firstChild);

    const card = document.createElement("ha-card");
    card.setAttribute("header", "⚡ 台電費率設定");

    const content = document.createElement("div");
    content.className = "card-content";

    // Error
    this._errorEl = document.createElement("div");
    this._errorEl.className = "error";
    this._errorEl.style.display = "none";
    content.appendChild(this._errorEl);

    // Entity
    this._fieldEntity = this._makeField("累計電量感測器", "text", "sensor.xxx 累計電量");
    this._inputEntity = this._fieldEntity.querySelector("input");
    content.appendChild(this._fieldEntity);

    // Billing mode
    this._fieldMode = document.createElement("div");
    this._fieldMode.className = "field";
    const labelMode = document.createElement("label");
    labelMode.textContent = "計費模式";
    this._fieldMode.appendChild(labelMode);
    this._selectMode = document.createElement("select");
    for (const m of [
      { value: "residential", label: "🏠 住宅用" },
      { value: "non_commercial", label: "🏢 非營業用" },
      { value: "commercial", label: "🏬 營業用" }
    ]) {
      const opt = document.createElement("option");
      opt.value = m.value;
      opt.textContent = m.label;
      this._selectMode.appendChild(opt);
    }
    this._fieldMode.appendChild(this._selectMode);
    content.appendChild(this._fieldMode);

    // Meter day
    this._fieldDay = this._makeField("抄表起始日", "date");
    this._inputDay = this._fieldDay.querySelector("input");
    content.appendChild(this._fieldDay);

    // Version
    const ver = document.createElement("div");
    ver.className = "ver";
    ver.textContent = "v" + this._version;
    content.appendChild(ver);

    card.appendChild(content);

    // Actions
    const actions = document.createElement("div");
    actions.className = "card-actions";
    this._btnSave = document.createElement("mwc-button");
    this._btnSave.textContent = "💾 儲存設定";
    actions.appendChild(this._btnSave);
    card.appendChild(actions);

    // Style
    const style = document.createElement("style");
    style.textContent = `
      .card-content { padding: 0 16px 16px; }
      .field { margin-bottom: 12px; }
      .field label {
        display: block; font-size: 12px;
        color: var(--secondary-text-color);
        margin-bottom: 4px;
      }
      .field input, .field select {
        width: 100%; padding: 8px;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font-size: 14px; box-sizing: border-box;
      }
      .field input:focus, .field select:focus {
        border-color: var(--primary-color); outline: none;
      }
      .error {
        color: var(--error-color);
        background: var(--error-color-bg, #fdecea);
        padding: 8px 12px; border-radius: 4px;
        margin-bottom: 12px; font-size: 13px;
      }
      .ver {
        text-align: right; font-size: 10px;
        color: var(--secondary-text-color);
        opacity: 0.5; margin-top: 4px;
      }
      .card-actions { padding: 0 8px 8px; }
    `;

    this.appendChild(card);
    this.appendChild(style);

    // --- Events (bound once) ---
    const markEdit = () => { this._userEditing = true; };
    const unmarkEdit = () => {
      this._userEditing = false;
      this._editConfig.bimonthly_energy = this._inputEntity.value;
      this._editConfig.billing_mode = this._selectMode.value;
      this._editConfig.meter_start_day = this._inputDay.value;
    };

    this._inputEntity.addEventListener("focus", markEdit);
    this._inputEntity.addEventListener("blur", unmarkEdit);
    this._inputEntity.addEventListener("input", () => {
      this._editConfig.bimonthly_energy = this._inputEntity.value;
    });

    this._selectMode.addEventListener("focus", markEdit);
    this._selectMode.addEventListener("blur", unmarkEdit);
    this._selectMode.addEventListener("change", () => {
      this._editConfig.billing_mode = this._selectMode.value;
    });

    this._inputDay.addEventListener("focus", markEdit);
    this._inputDay.addEventListener("blur", unmarkEdit);
    this._inputDay.addEventListener("input", () => {
      this._editConfig.meter_start_day = this._inputDay.value;
    });

    this._btnSave.addEventListener("click", () => this._saveConfig());

    this._syncToDOM();
  }

  _makeField(labelText, inputType, placeholder) {
    const div = document.createElement("div");
    div.className = "field";
    const label = document.createElement("label");
    label.textContent = labelText;
    div.appendChild(label);
    const input = document.createElement("input");
    input.type = inputType;
    if (placeholder) input.placeholder = placeholder;
    div.appendChild(input);
    return div;
  }

  _syncToDOM() {
    if (!this._domReady) return;
    this._inputEntity.value = this._editConfig.bimonthly_energy;
    this._selectMode.value = this._editConfig.billing_mode;
    this._inputDay.value = this._editConfig.meter_start_day;
  }

  async _saveConfig() {
    if (!this._hass) return;
    this._saving = true;
    this._errorEl.style.display = "none";
    this._btnSave.setAttribute("disabled", "");
    this._btnSave.textContent = "儲存中...";
    try {
      await this._hass.callService("taipower_bimonthly_cost", "update_config", {
        entry_id: this._entryId,
        bimonthly_energy: this._editConfig.bimonthly_energy,
        billing_mode: this._editConfig.billing_mode,
        meter_start_day: this._editConfig.meter_start_day
      });
      this._config = { ...this._editConfig };
      this._errorEl.style.display = "none";
    } catch (err) {
      console.error("[TaiPower Config] Save failed:", err);
      this._errorEl.textContent = String(err);
      this._errorEl.style.display = "";
    } finally {
      this._saving = false;
      this._btnSave.removeAttribute("disabled");
      this._btnSave.textContent = "💾 儲存設定";
    }
  }

  getCardSize() { return 6; }
}

customElements.define('taipower-config-card', TaiPowerConfigCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "taipower-config-card",
  name: "台電費率設定卡片",
  description: "設定台電二段式電價整合的感測器、計費模式與抄表日",
  preview: true,
  documentationURL: "https://github.com/ivanlee1007/Taipower-Bimonthly-Energy-Cost-homeassistant"
});
