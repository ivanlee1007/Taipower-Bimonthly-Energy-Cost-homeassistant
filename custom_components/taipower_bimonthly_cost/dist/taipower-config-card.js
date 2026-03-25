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
    this._tab = 'rates';
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
    this._renderIfNeeded();
  }

  _renderIfNeeded() {
    // Only re-render if state actually changed
    const el = this.querySelector('.card-content');
    if (!el) {
      this.render();
    }
  }

  async _findEntry() {
    if (!this._hass) return;
    try {
      // Get all config entries and find taipower one
      const entries = this._hass.configEntries?.entries || [];
      // Fallback: scan entity attributes
      this._loadFromEntities();
    } catch (e) {
      this._error = '找不到台電整合設定';
      this._loading = false;
      this.render();
    }
  }

  _loadFromEntities() {
    if (!this._hass) return;

    // Find rate status sensor
    const statusSensor = Object.keys(this._hass.states).find(
      id => id.startsWith('sensor.taipower_') && id.endsWith('_rate_status')
    );
    if (statusSensor) {
      const sensor = this._hass.states[statusSensor];
      this._rates = {
        pdf_version: sensor.attributes.pdf_version || 'unknown',
        rates_version: sensor.attributes.rates_version || 'unknown',
        manual_override: sensor.attributes.manual_override || false,
        rates_age_days: sensor.attributes.rates_age_days ?? 'unknown',
      };
    }

    // Find cost sensor to get config attributes
    const costSensor = Object.keys(this._hass.states).find(
      id => id.startsWith('sensor.taipower_') && id.endsWith('_energy_cost')
    );
    const kwhSensor = Object.keys(this._hass.states).find(
      id => id.startsWith('sensor.taipower_') && id.endsWith('_kwh_cost')
    );
    const refSensor = costSensor || kwhSensor;
    if (refSensor) {
      const ent = this._hass.states[refSensor];
      this._options = {
        bimonthly_energy: ent.attributes.bimonthly_energy || '',
        billing_mode: ent.attributes.billing_mode || 'residential',
        meter_start_day: ent.attributes.meter_start_day || '',
        manual_rates: ent.attributes.manual_rates || null,
      };
    }

    this._loading = false;
    this.render();
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

  _switchTab(tab) {
    this._tab = tab;
    this.render();
  }

  async _onApplyRates() {
    if (!this._hass) return;
    this._saving = true;
    this._error = null;
    this._success = null;
    this.render();

    const inputs = this.querySelectorAll('.rate-input');
    const tierCount = inputs.length / 2; // summer + non_summer
    const summer = [];
    const non_summer = [];

    for (let i = 0; i < tierCount; i++) {
      const sInput = this.querySelector(`.rate-input[data-tier="${i}"][data-season="summer"]`);
      const nsInput = this.querySelector(`.rate-input[data-tier="${i}"][data-season="non_summer"]`);
      summer.push(parseFloat(sInput?.value || '0'));
      non_summer.push(parseFloat(nsInput?.value || '0'));
    }

    if (summer.some(isNaN) || non_summer.some(isNaN)) {
      this._error = '費率必須是數字';
      this._saving = false;
      this.render();
      return;
    }

    const mode = this._options.billing_mode || 'residential';
    const newManualRates = { ...this._options.manual_rates };
    newManualRates[mode] = { summer, non_summer };

    try {
      await this._hass.callService('taipower_bimonthly_cost', 'update_config', {
        manual_rates: newManualRates,
      });
      this._success = '費率已更新！';
      setTimeout(() => this._loadFromEntities(), 1500);
    } catch (err) {
      this._error = '套用失敗: ' + err.message;
    }
    this._saving = false;
    this.render();
  }

  async _onResetRates() {
    if (!this._hass) return;
    this._saving = true;
    this._error = null;
    this._success = null;
    this.render();

    const mode = this._options.billing_mode || 'residential';
    const newManualRates = { ...this._options.manual_rates };
    delete newManualRates[mode];

    try {
      await this._hass.callService('taipower_bimonthly_cost', 'update_config', {
        manual_rates: Object.keys(newManualRates).length > 0 ? newManualRates : null,
      });
      this._success = '已恢復預設費率！';
      setTimeout(() => this._loadFromEntities(), 1500);
    } catch (err) {
      this._error = '恢復失敗: ' + err.message;
    }
    this._saving = false;
    this.render();
  }

  async _onSave(e) {
    e.preventDefault();
    if (!this._hass) return;
    this._saving = true;
    this._error = null;
    this._success = null;
    this.render();

    const form = this.querySelector('#taipower-form');
    if (!form) { this._saving = false; return; }

    const data = new FormData(form);
    const body = {};
    const energyVal = data.get('bimonthly_energy');
    if (energyVal) body.bimonthly_energy = energyVal;
    const modeVal = data.get('billing_mode');
    if (modeVal) body.billing_mode = modeVal;
    const dayVal = data.get('meter_start_day');
    if (dayVal) body.meter_start_day = dayVal;

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
      setTimeout(() => {
        this._loadFromEntities();
      }, 1500);
    } catch (err) {
      this._error = '儲存失敗: ' + err.message;
    }
    this._saving = false;
    this.render();
  }

  _getEnergyEntities() {
    if (!this._hass) return [];
    const currentVal = this._options.bimonthly_energy || '';
    const seen = new Set();
    const results = [];

    const addEntity = (entity_id, name) => {
      if (seen.has(entity_id)) return;
      seen.add(entity_id);
      results.push({ entity_id, name });
    };

    // Current value always included (even if filtered out otherwise)
    if (currentVal) addEntity(currentVal, currentVal);

    for (const [entity_id, st] of Object.entries(this._hass.states)) {
      if (!entity_id.startsWith('sensor.')) continue;
      const attrs = st.attributes || {};
      const unit = (attrs.unit_of_measurement || '').toLowerCase();
      const id = entity_id.toLowerCase();
      const name = (attrs.friendly_name || '').toLowerCase();

      // Match: kWh unit, or energy/power keywords in ID or name
      const isKwh = unit === 'kwh';
      const isEnergy =
        id.includes('kwh') || id.includes('energy') || id.includes('power') ||
        id.includes('累計') || id.includes('電') || id.includes('電量') ||
        name.includes('kwh') || name.includes('energy') || name.includes('電');

      if (isKwh || isEnergy) {
        addEntity(entity_id, attrs.friendly_name || entity_id);
      }
    }

    results.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return results;
  }

  _buildRateTable(mode, manualRates) {
    let rateData;
    const isManual = manualRates && manualRates[mode];
    if (isManual) {
      const mr = manualRates[mode];
      rateData = {
        summer: mr.summer,
        non_summer: mr.non_summer,
        thresholds: mr.summer.map((_, i) => {
          if (i === mr.summer.length - 1) return '∞';
          const defThresholds = [120, 330, 500, 700, 1000, 1500, 3000];
          return defThresholds[i] || '—';
        }),
      };
    } else {
      rateData = this._getDefaultRates(mode);
    }

    const modeNames = { residential: '住宅用', non_commercial: '非營業用', commercial: '營業用' };
    const now = new Date();
    const isSummer = (now.getMonth() + 1 >= 6 && now.getMonth() + 1 <= 9);
    const tierCount = rateData.summer.length;

    let html = `
      <div class="rate-section">
        <h3>📊 費率表 — ${modeNames[mode] || mode} ${isManual ? '<span class="badge badge-manual">手動覆蓋</span>' : '<span class="badge badge-default">預設費率</span>'}</h3>
        <div class="season-label">當前季節：<strong>${isSummer ? '☀️ 夏季 (6/1~9/30)' : '❄️ 非夏季'}</strong>　<span style="color:#888;font-size:0.85em">（直接修改費率，按下方按鈕套用）</span></div>
        <table class="rate-table">
          <thead><tr><th>級距 (kWh)</th><th>夏季費率</th><th>非夏季費率</th><th>當前</th></tr></thead>
          <tbody>
    `;

    for (let i = 0; i < tierCount; i++) {
      const sr = rateData.summer[i];
      const nsr = rateData.non_summer[i];
      const thr = rateData.thresholds[i];
      const prevThr = i > 0 ? rateData.thresholds[i - 1] : 0;
      const label = i === 0 ? `0 ~ ${thr}` : `${prevThr} ~ ${thr}`;
      const currentRate = isSummer ? sr : nsr;
      html += `
        <tr>
          <td>${label}</td>
          <td class="${isSummer ? 'highlight' : ''}"><input type="number" step="0.01" min="0" class="rate-input" data-tier="${i}" data-season="summer" value="${sr}"/></td>
          <td class="${!isSummer ? 'highlight' : ''}"><input type="number" step="0.01" min="0" class="rate-input" data-tier="${i}" data-season="non_summer" value="${nsr}"/></td>
          <td class="current-rate"><strong>${currentRate}</strong></td>
        </tr>
      `;
    }

    html += `</tbody></table>
        <div class="rate-actions">
          <button type="button" id="apply-rates-btn" ${this._saving ? 'disabled' : ''}>💾 套用費率${isManual ? '（更新）' : '（設為手動覆蓋）'}</button>
          ${isManual ? '<button type="button" id="reset-rates-btn">↩️ 恢復預設</button>' : ''}
        </div>
      </div>`;
    return html;
  }

  render() {
    if (!this._hass) return;

    const mode = this._options.billing_mode || 'residential';
    const manualRates = this._options.manual_rates;
    const modeNames = { residential: '住宅用', non_commercial: '非營業用', commercial: '營業用' };

    this.innerHTML = `
      <ha-card header="⚡ 台電二段式電價">
        <div class="card-content">
          ${this._loading ? '<div class="loading">載入中...</div>' : ''}

          ${this._error ? `<div class="msg error">❌ ${this._error}</div>` : ''}
          ${this._success ? `<div class="msg success">✅ ${this._success}</div>` : ''}

          <!-- Tabs -->
          <div class="tabs">
            <button class="tab ${this._tab === 'rates' ? 'tab-active' : ''}" data-tab="rates">📊 費率表</button>
            <button class="tab ${this._tab === 'settings' ? 'tab-active' : ''}" data-tab="settings">⚙️ 設定</button>
          </div>

          <!-- Tab: 費率表 -->
          ${this._tab === 'rates' ? `
            ${this._buildRateTable(mode, manualRates)}
            <div class="info">
              <p>費率版本：${this._rates?.rates_version || '—'} | 資料距今：${this._rates?.rates_age_days ?? '—'} 天 ${this._rates?.manual_override ? '<span class="badge badge-manual">手動覆蓋中</span>' : ''}</p>
            </div>
          ` : ''}

          <!-- Tab: 設定 -->
          ${this._tab === 'settings' ? `
            <form id="taipower-form">
              <div class="field">
                <label>累計電量實體 (Entity ID)</label>
                <select name="bimonthly_energy">
                  <option value="">-- 請選擇 --</option>
                  ${this._getEnergyEntities().map(e =>
                    `<option value="${e.entity_id}" ${e.entity_id === this._options.bimonthly_energy ? 'selected' : ''}>${e.name} (${e.entity_id})</option>`
                  ).join('')}
                </select>
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
                <details>
                  <summary style="cursor:pointer;color:var(--secondary-text-color,#888);font-size:0.9em">▶ 進階：手動費率 JSON（備用）</summary>
                  <textarea name="manual_rates" rows="3" style="margin-top:6px" placeholder='留空使用預設費率'>${manualRates ? JSON.stringify(manualRates, null, 2) : ''}</textarea>
                </details>
              </div>
              <div class="actions">
                <button type="submit" ${this._saving ? 'disabled' : ''}>${this._saving ? '儲存中...' : '💾 儲存設定'}</button>
              </div>
            </form>
            <div class="info">
              <p>費率版本：${this._rates?.rates_version || '—'} | 資料距今：${this._rates?.rates_age_days ?? '—'} 天</p>
            </div>
          ` : ''}
        </div>
      </ha-card>
    `;

    // Apply styles
    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; }
      .card-content { padding: 16px; font-family: var(--ha-font-family); }
      .loading { text-align: center; padding: 20px; color: var(--secondary-text-color); }
      /* Tabs */
      .tabs { display: flex; gap: 0; margin-bottom: 14px; border-bottom: 2px solid var(--divider-color, #e0e0e0); }
      .tab { flex: 1; padding: 8px 0; border: none; background: none; cursor: pointer; font-size: 14px; font-weight: 500; color: var(--secondary-text-color, #888); border-bottom: 2px solid transparent; margin-bottom: -2px; transition: color 0.2s, border-color 0.2s; }
      .tab:hover { color: var(--primary-text-color); }
      .tab-active { color: var(--primary-color, #2196f3); border-bottom-color: var(--primary-color, #2196f3); }
      /* Rate table */
      .rate-section { margin-bottom: 8px; }
      .season-label { margin-bottom: 8px; color: var(--secondary-text-color, #666); font-size: 0.9em; }
      .rate-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 0.9em; }
      .rate-table th, .rate-table td { padding: 6px 8px; border: 1px solid var(--divider-color, #e0e0e0); text-align: center; }
      .rate-table th { background: var(--card-background-color, #f5f5f5); font-weight: 600; }
      .rate-table td:first-child { text-align: left; white-space: nowrap; }
      .rate-table td.highlight { background: #fff3e0; font-weight: 600; }
      .rate-table td.current-rate { background: #e8f5e9; }
      .rate-input { width: 64px; padding: 4px 6px; border: 1px solid var(--divider-color, #ccc); border-radius: 3px; font-size: 13px; text-align: center; background: var(--card-background-color, #fff); color: var(--primary-text-color); }
      .rate-input:focus { border-color: var(--primary-color, #2196f3); outline: none; box-shadow: 0 0 0 1px var(--primary-color, #2196f3); }
      .rate-actions { margin-top: 10px; display: flex; gap: 8px; }
      .rate-actions button { background: var(--primary-color, #2196f3); color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; }
      .rate-actions button:hover { opacity: 0.9; }
      .rate-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
      #reset-rates-btn { background: var(--secondary-background-color, #757575); }
      /* Settings form */
      h3 { margin: 16px 0 8px; font-size: 1.1em; }
      hr { border: none; border-top: 1px solid var(--divider-color, #e0e0e0); margin: 16px 0; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; vertical-align: middle; color: #fff; }
      .badge-manual { background: #ff9800; }
      .badge-default { background: #4caf50; }
      .field { margin-bottom: 12px; }
      .field label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 0.9em; }
      .field input, .field select, .field textarea { width: 100%; padding: 8px; border: 1px solid var(--divider-color, #ccc); border-radius: 4px; font-size: 14px; box-sizing: border-box; background: var(--card-background-color, #fff); color: var(--primary-text-color); }
      .field textarea { font-family: monospace; resize: vertical; }
      .actions { margin-top: 16px; }
      .actions button { background: var(--primary-color, #2196f3); color: #fff; border: none; padding: 10px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; }
      .actions button:hover { opacity: 0.9; }
      .actions button:disabled { opacity: 0.5; cursor: not-allowed; }
      .msg { padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; }
      .msg.error { background: #ffebee; color: #c62828; }
      .msg.success { background: #e8f5e9; color: #2e7d32; }
      .info { font-size: 0.85em; color: var(--secondary-text-color, #888); margin-top: 12px; }
      .info p { margin: 2px 0; }
    `;
    this.appendChild(style);

    // Bind tab clicks
    this.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
    });

    // Bind form submit
    const form = this.querySelector('#taipower-form');
    if (form) {
      form.addEventListener('submit', this._onSave.bind(this));
    }

    // Bind rate table buttons
    const applyBtn = this.querySelector('#apply-rates-btn');
    if (applyBtn) {
      applyBtn.addEventListener('click', this._onApplyRates.bind(this));
    }
    const resetBtn = this.querySelector('#reset-rates-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', this._onResetRates.bind(this));
    }
  }

  getCardSize() {
    return 10;
  }
}

customElements.define('taipower-config-card', TaiPowerConfigCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'taipower-config-card',
  name: '台電二段式電價設定',
  description: 'TaiPower 費率表 + 設定卡片',
  preview: true,
});
