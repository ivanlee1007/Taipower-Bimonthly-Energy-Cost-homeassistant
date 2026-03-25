class TaiPowerConfigCard extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._entryId = null;
    this._options = {};
    this._rates = null;
    this._loading = true;
    this._saving = false;
    this._error = null;
    this._success = null;
  }

  setConfig(config) {
    this._config = config;
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._entryId) {
      this._findEntry();
    }
    this.render();
  }

  async _findEntry() {
    if (!this._hass) return;
    try {
      const resp = await this._hass.callApi('GET', 'config/config_entries/flow');
      const entries = resp.filter(e => e.handler === 'taipower_bimonthly_cost');
      if (entries.length > 0) {
        this._entryId = entries[0].flow_id;
        await this._loadConfig();
      }
    } catch (e) {
      this._error = '找不到台電整合設定';
      this._loading = false;
      this.render();
    }
  }

  async _loadConfig() {
    if (!this._hass || !this._entryId) return;
    try {
      // Fetch config entry from .storage via states
      const resp = await fetch('/api/config/config_entries/flow', {
        headers: { 'Authorization': `Bearer ${this._hass.connection.options.auth.access_token}` }
      });
      // Alternative: get entity attributes for rate info
      const sensorEntity = Object.keys(this._hass.states).find(
        id => id.startsWith('sensor.taipower_') && id.endsWith('_rate_status')
      );
      if (sensorEntity) {
        const sensor = this._hass.states[sensorEntity];
        this._rates = {
          pdf_version: sensor.attributes.pdf_version || 'unknown',
          rates_version: sensor.attributes.rates_version || 'unknown',
          manual_override: sensor.attributes.manual_override || false,
          rates_age_days: sensor.attributes.rates_age_days || 0,
        };
      }

      // Try to get options from the entity
      const configEntity = Object.keys(this._hass.states).find(
        id => id.startsWith('sensor.taipower_') && !id.endsWith('_rate_status') && !id.endsWith('_kwh_cost')
      );
      if (configEntity) {
        const ent = this._hass.states[configEntity];
        this._options = {
          bimonthly_energy: ent.attributes.bimonthly_energy || '',
          billing_mode: ent.attributes.billing_mode || 'residential',
          meter_start_day: ent.attributes.meter_start_day || '',
          manual_rates: ent.attributes.manual_rates || null,
        };
      }

      this._loading = false;
      this.render();
    } catch (e) {
      this._error = e.message;
      this._loading = false;
      this.render();
    }
  }

  _getDefaultRates(mode) {
    const defaults = {
      residential: {
        summer: [1.78, 2.55, 3.80, 5.14, 6.44, 8.86],
        non_summer: [1.78, 2.26, 3.13, 4.24, 5.27, 7.03],
        thresholds: [120, 330, 500, 700, 1000, '∞'],
      },
      non_commercial: {
        summer: [1.78, 2.55, 3.80, 5.14, 6.44, 8.86],
        non_summer: [1.78, 2.26, 3.13, 4.24, 5.27, 7.03],
        thresholds: [120, 330, 500, 700, 1000, '∞'],
      },
      commercial: {
        summer: [2.71, 3.76, 4.46, 7.08, 7.43],
        non_summer: [2.28, 3.10, 3.61, 5.56, 5.83],
        thresholds: [330, 700, 1500, 3000, '∞'],
      },
    };
    return defaults[mode] || defaults.residential;
  }

  async _onSave(e) {
    e.preventDefault();
    if (!this._hass) return;
    this._saving = true;
    this._error = null;
    this._success = null;
    this.render();

    const form = this.shadowRoot?.querySelector('#taipower-form') || this.querySelector('#taipower-form');
    if (!form) { this._saving = false; return; }

    const data = new FormData(form);
    const body = {};
    if (data.get('bimonthly_energy')) body.bimonthly_energy = data.get('bimonthly_energy');
    if (data.get('billing_mode')) body.billing_mode = data.get('billing_mode');
    if (data.get('meter_start_day')) body.meter_start_day = data.get('meter_start_day');

    const manualRatesStr = (data.get('manual_rates') || '').trim();
    if (manualRatesStr) {
      try {
        body.manual_rates = JSON.parse(manualRatesStr);
      } catch (err) {
        this._error = '手動費率 JSON 格式錯誤: ' + err.message;
        this._saving = false;
        this.render();
        return;
      }
    } else {
      body.manual_rates = null;
    }

    try {
      await this._hass.callService('taipower_bimonthly_cost', 'update_config', body);
      this._success = '設定已更新！';
      await this._loadConfig();
    } catch (err) {
      this._error = '儲存失敗: ' + err.message;
    }
    this._saving = false;
    this.render();
  }

  _buildRateTable(mode, manualRates) {
    let rates, thresholds;
    if (manualRates && manualRates[mode]) {
      const mr = manualRates[mode];
      rates = { summer: mr.summer, non_summer: mr.non_summer };
      thresholds = mr.summer.map((_, i) => {
        if (i === 0) return 120;
        if (i === mr.summer.length - 1) return '∞';
        return [120, 330, 500, 700, 1000, 1500, 3000][i] || '—';
      });
    } else {
      const def = this._getDefaultRates(mode);
      rates = { summer: def.summer, non_summer: def.non_summer };
      rates = def;
      thresholds = def.thresholds;
    }

    const modeNames = { residential: '住宅用', non_commercial: '非營業用', commercial: '營業用' };
    const isManual = manualRates && manualRates[mode];
    const now = new Date();
    const isSummer = (now.getMonth() + 1 >= 6 && now.getMonth() + 1 <= 9);

    let html = `
      <div class="rate-section">
        <h3>📊 目前費率表 — ${modeNames[mode] || mode} ${isManual ? '<span class="badge-manual">手動覆蓋</span>' : '<span class="badge-default">預設費率</span>'}</h3>
        <div class="season-label">當前季節：<strong>${isSummer ? '☀️ 夏季 (6/1-9/30)' : '❄️ 非夏季'}</strong></div>
        <table class="rate-table">
          <thead>
            <tr>
              <th>級距 (kWh)</th>
              <th>費率 (TWD/kWh)</th>
            </tr>
          </thead>
          <tbody>
    `;

    const tierCount = (rates.summer || rates).length;
    for (let i = 0; i < tierCount; i++) {
      const summerRate = (rates.summer || [])[i];
      const nonSummerRate = (rates.non_summer || [])[i];
      const threshold = thresholds[i] || '∞';
      const prevThreshold = i > 0 ? (thresholds[i - 1] || 0) : 0;
      const label = i === 0
        ? `0 ~ ${threshold}`
        : `${prevThreshold} ~ ${threshold}`;
      const rate = isSummer ? summerRate : nonSummerRate;
      const highlight = isSummer ? ' class="highlight"' : '';
      html += `
        <tr>
          <td>${label}</td>
          <td${highlight}>${rate}</td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;
    return html;
  }

  render() {
    const mode = this._options.billing_mode || 'residential';
    const manualRates = this._options.manual_rates;
    const rateTable = this._buildRateTable(mode, manualRates);
    const modeNames = { residential: '住宅用', non_commercial: '非營業用', commercial: '營業用' };
    const now = new Date();
    const isSummer = (now.getMonth() + 1 >= 6 && now.getMonth() + 1 <= 9);

    this.innerHTML = `
      <ha-card header="⚡ 台電二段式電價設定">
        <div class="card-content">
          ${this._loading ? '<p>載入中...</p>' : ''}

          ${this._error ? `<div class="msg error">❌ ${this._error}</div>` : ''}
          ${this._success ? `<div class="msg success">✅ ${this._success}</div>` : ''}

          ${rateTable}

          <hr/>

          <h3>⚙️ 設定</h3>
          <form id="taipower-form">
            <div class="field">
              <label>累計電量實體 (Entity ID)</label>
              <input type="text" name="bimonthly_energy" value="${this._options.bimonthly_energy || ''}" placeholder="sensor.xxx_kwh"/>
            </div>
            <div class="field">
              <label>計費模式</label>
              <select name="billing_mode">
                ${Object.entries(modeNames).map(([k, v]) =>
                  `<option value="${k}" ${k === mode ? 'selected' : ''}>${v}</option>`
                ).join('')}
              </select>
            </div>
            <div class="field">
              <label>抄表起始日</label>
              <input type="date" name="meter_start_day" value="${this._options.meter_start_day || ''}"/>
            </div>
            <div class="field">
              <label>手動費率覆蓋 (JSON，留空使用預設費率)</label>
              <textarea name="manual_rates" rows="4" placeholder='{"residential":{"summer":[1.78,2.55,3.80,5.14,6.44,8.86],"non_summer":[1.78,2.26,3.13,4.24,5.27,7.03]}}'>${manualRates ? JSON.stringify(manualRates, null, 2) : ''}</textarea>
            </div>
            <div class="actions">
              <button type="submit" ${this._saving ? 'disabled' : ''}>${this._saving ? '儲存中...' : '💾 儲存設定'}</button>
            </div>
          </form>

          <hr/>
          <div class="info">
            <p>費率版本：${this._rates?.rates_version || 'unknown'} | PDF：${this._rates?.pdf_version || 'unknown'}</p>
            <p>費率資料距今：${this._rates?.rates_age_days ?? 'unknown'} 天</p>
          </div>
        </div>
      </ha-card>
    `;

    // Apply styles
    const style = document.createElement('style');
    style.textContent = `
      .card-content { padding: 16px; }
      h3 { margin: 16px 0 8px; font-size: 1.1em; }
      hr { border: none; border-top: 1px solid #e0e0e0; margin: 16px 0; }
      .rate-section { margin-bottom: 8px; }
      .season-label { margin-bottom: 8px; color: #666; font-size: 0.9em; }
      .rate-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      .rate-table th, .rate-table td { padding: 6px 12px; border: 1px solid #e0e0e0; text-align: left; }
      .rate-table th { background: #f5f5f5; font-weight: 600; }
      .rate-table td.highlight { background: #fff3e0; font-weight: 600; }
      .badge-manual { display: inline-block; background: #ff9800; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; vertical-align: middle; }
      .badge-default { display: inline-block; background: #4caf50; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; vertical-align: middle; }
      .field { margin-bottom: 12px; }
      .field label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 0.9em; }
      .field input, .field select, .field textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box; }
      .field textarea { font-family: monospace; resize: vertical; }
      .actions { margin-top: 16px; }
      .actions button { background: #2196f3; color: #fff; border: none; padding: 10px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; }
      .actions button:hover { background: #1976d2; }
      .actions button:disabled { background: #ccc; cursor: not-allowed; }
      .msg { padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; }
      .msg.error { background: #ffebee; color: #c62828; }
      .msg.success { background: #e8f5e9; color: #2e7d32; }
      .info { font-size: 0.85em; color: #888; }
      .info p { margin: 2px 0; }
    `;
    this.appendChild(style);

    // Bind form submit
    const form = this.querySelector('#taipower-form');
    if (form) {
      form.addEventListener('submit', this._onSave.bind(this));
    }
  }

  getCardSize() {
    return 10;
  }
}

customElements.define('taipower-config-card', TaiPowerConfigCard);

// Lovelace registration
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'taipower-config-card',
  name: '台電二段式電價設定',
  description: 'TaiPower 設定卡片：顯示費率表、編輯設定',
  preview: true,
});
