/*
 * Avinor Flight Card - renders a table of flights from the avinor_flight_data sensor attributes
 * Make available in HA card picker via window.customCards metadata.
 */

// Register metadata so the card shows up in the Lovelace card picker
// See: https://developers.home-assistant.io/docs/frontend/custom-ui/lovelace-custom-card/
try {
  window.customCards = window.customCards || [];
  const exists = window.customCards.some((c) => c.type === 'avinor-flight-card');
  if (!exists) {
    window.customCards.push({
      type: 'avinor-flight-card',
      name: 'Avinor Flight Card',
      description: 'Table of Avinor flights from sensor attributes (custom component).',
      preview: true,
      documentationURL: 'https://github.com/WickedGhost/avinor_flight_data',
      version: __VERSION__
    });
  }
} catch (e) {
  // non-fatal; HA will still allow manual YAML usage
}

class AvinorFlightCard extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._excludedColumns = new Set();
    this._card = null;
    this._content = null;
  }

  static getStubConfig(hass) {
    // Provide a simple default entity for preview/selection in the card picker
    if (hass && hass.states) {
      const firstSensor = Object.keys(hass.states).find((e) => e.startsWith('sensor.avinor_'));
      if (firstSensor) {
        return { entity: firstSensor, title: 'Avinor Flight Data' };
      }
    }
    return { entity: '', title: 'Avinor Flight Data', exclude_columns: [] };
  }

  static getConfigElement() {
    return document.createElement('avinor-flight-card-editor');
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error('Please define entity');
    }
    // Keep defaults stable even when config is missing keys
    this._config = {
      title: 'Avinor Flight Data',
      exclude_columns: [],
      ...config,
    };

    this._excludedColumns = this._normalizeExcludedColumns(this._config.exclude_columns);

    if (!this._card) {
      this._card = document.createElement('ha-card');
      this._content = document.createElement('div');
      this._content.style.padding = '16px';
      this._card.appendChild(this._content);
      this.appendChild(this._card);
    }

    this._card.header = this._config.title || 'Avinor Flight Data';

    // Re-render immediately if hass is already set
    if (this._hass) {
      this.hass = this._hass;
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config || !this._content) return;

    // Keep excluded columns in sync if config changes via UI
    this._excludedColumns = this._normalizeExcludedColumns(this._config.exclude_columns);

    const entityId = this._config.entity;
    const state = hass && hass.states ? hass.states[entityId] : undefined;
    if (!state) {
      this._content.innerHTML = `<div>Entity ${entityId} not found</div>`;
      return;
    }
    const attrs = state.attributes || {};
    const flights = Array.isArray(attrs.flights) ? attrs.flights : [];

    const airport = attrs.airport || '';
    const direction = attrs.direction || '';
    const lastUpdate = attrs.last_update || '';
    
    // Hide Check-in and Gate columns for arrivals (A)
    const isArrival = direction === 'A';

    const isExcluded = (key) => {
      if (this._excludedColumns.has(key)) return true;
      // Preserve legacy behavior: arrivals never show check-in / gate
      if (isArrival && (key === 'check_in' || key === 'gate')) return true;
      return false;
    };

    const header = `Airport: ${airport} • Direction: ${direction} • Flights: ${flights.length} • Updated: ${lastUpdate}`;

    const rows = flights.map(f => {
      // Convert dom_int code to description
      const typeMap = {
        'S': 'Schengen',
        'D': 'Domestic',
        'I': 'International'
      };
      const flightType = typeMap[f.dom_int] || f.dom_int || '';

      // Get airport name from IATA code
      const airportName = this._getAirportName(f.airport);
      
      // Get status description from code
      const statusText = this._getStatusText(f.status_code);
      
      // Extract only time from schedule_time (format: "2024-11-10T14:30:00")
      const scheduleTime = this._extractTime(f.schedule_time);

      return `
        <tr>
          ${isExcluded('flight') ? '' : `<td style="padding: 8px;">${this._e(f.flightId)}</td>`}
          ${isExcluded('type') ? '' : `<td style="padding: 8px;">${this._e(flightType)}</td>`}
          ${isExcluded('scheduled') ? '' : `<td style="padding: 8px;">${this._e(scheduleTime)}</td>`}
          ${isExcluded('airport') ? '' : `<td style="padding: 8px;">${this._e(airportName)}</td>`}
          ${isExcluded('check_in') ? '' : `<td style="padding: 8px;">${this._e(f.check_in)}</td>`}
          ${isExcluded('gate') ? '' : `<td style="padding: 8px;">${this._e(f.gate)}</td>`}
          ${isExcluded('status') ? '' : `<td style="padding: 8px;">${this._e(statusText)}</td>`}
        </tr>
      `;
    }).join('');

    this._content.innerHTML = `
      <div style="margin-bottom:8px; font-size: 0.9em; color: var(--secondary-text-color);">${header}</div>
      <div style="overflow:auto;">
        <table style="width:100%; border-collapse: collapse;">
          <thead>
            <tr>
              ${isExcluded('flight') ? '' : '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Flight</th>'}
              ${isExcluded('type') ? '' : '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Type</th>'}
              ${isExcluded('scheduled') ? '' : '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Scheduled</th>'}
              ${isExcluded('airport') ? '' : '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Airport</th>'}
              ${isExcluded('check_in') ? '' : '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Check-in</th>'}
              ${isExcluded('gate') ? '' : '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Gate</th>'}
              ${isExcluded('status') ? '' : '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Status</th>'}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <div style="margin-top:8px; font-size: 0.8em; color: var(--secondary-text-color);">
        Flydata fra <a href="https://www.avinor.no/" target="_blank" rel="noreferrer">Avinor</a>
      </div>
    `;
  }

  _e(v) {
    if (v === undefined || v === null) return '';
    const s = String(v);
    // Basic HTML escaping to mitigate injection inside innerHTML usage.
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _normalizeExcludedColumns(excludeColumns) {
    const normalized = new Set();
    const list = Array.isArray(excludeColumns)
      ? excludeColumns
      : (typeof excludeColumns === 'string' ? excludeColumns.split(',') : []);
    for (const raw of list) {
      if (raw === undefined || raw === null) continue;
      const key = String(raw)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/-/g, '_');
      if (key) normalized.add(key);
    }
    return normalized;
  }

  _getAirportName(iataCode) {
    if (!iataCode) return '';
    
    // Common Norwegian airports (most frequently used)
    const airportNames = {
      'OSL': 'Oslo',
      'BGO': 'Bergen',
      'TRD': 'Trondheim',
      'SVG': 'Stavanger',
      'BOO': 'Bodø',
      'TOS': 'Tromsø',
      'AES': 'Ålesund',
      'KRS': 'Kristiansand',
      'HAU': 'Haugesund',
      'MOL': 'Molde',
      'EVE': 'Harstad/Narvik',
      'KKN': 'Kirkenes',
      'LKL': 'Lakselv',
      'ALF': 'Alta',
      'HFT': 'Hammerfest',
      'VDS': 'Vadsø',
      'BDU': 'Bardufoss',
      'SSJ': 'Sandnessjøen',
      'MJF': 'Mosjøen',
      'RVK': 'Rørvik',
      'BNN': 'Brønnøysund',
      'SKN': 'Stokmarknes',
      'LYR': 'Longyearbyen',
      'ANX': 'Andøya',
      'FDE': 'Førde',
      'SOG': 'Sogndal',
      'FRO': 'Florø',
      'NTB': 'Notodden',
      'SKE': 'Skien',
      'TRF': 'Sandefjord',
      'RRS': 'Røros',
      'OLA': 'Ørland',
      'HOV': 'Ørsta-Volda',
      'SDN': 'Sandane',
      // Major international airports
      'CPH': 'Copenhagen',
      'ARN': 'Stockholm',
      'HEL': 'Helsinki',
      'LHR': 'London',
      'AMS': 'Amsterdam',
      'CDG': 'Paris',
      'FRA': 'Frankfurt',
      'MUC': 'Munich',
      'ZRH': 'Zurich',
      'BCN': 'Barcelona',
      'MAD': 'Madrid',
      'FCO': 'Rome',
      'IST': 'Istanbul',
      'DXB': 'Dubai',
      'DOH': 'Doha',
      'JFK': 'New York',
      'EWR': 'Newark',
      'ORD': 'Chicago',
      'LAX': 'Los Angeles',
      'MIA': 'Miami',
      'BKK': 'Bangkok',
      'SIN': 'Singapore',
      'HKG': 'Hong Kong',
      'NRT': 'Tokyo',
      'ICN': 'Seoul',
      'KEF': 'Reykjavik',
      'ATH': 'Athens',
      'DUB': 'Dublin',
      'BRU': 'Brussels',
      'VIE': 'Vienna',
      'PRG': 'Prague',
      'WAW': 'Warsaw',
      'LIS': 'Lisbon',
      'MAN': 'Manchester',
      'EDI': 'Edinburgh',
      'GLA': 'Glasgow',
      'NCE': 'Nice',
      'LYS': 'Lyon',
      'TXL': 'Berlin',
      'HAM': 'Hamburg',
      'DUS': 'Düsseldorf',
      'BER': 'Berlin',
      'CGN': 'Cologne',
      'STR': 'Stuttgart'
    };
    
    return airportNames[iataCode] || iataCode;
  }

  _getStatusText(statusCode) {
    if (!statusCode) return '';
    
    // Avinor flight status codes with Norwegian/English descriptions
    const statusMap = {
      'E': 'New Info',          // New information
      'A': 'Arrived',           // Arrived / Ankommet
      'C': 'Cancelled',         // Cancelled / Kansellert
      'D': 'Departed',          // Departed / Avgått
      'N': 'New Time',          // New time / Ny tid
      'BRD': 'Boarding',        // Boarding / Ombordstigning
      'GCL': 'Gate Closed',     // Gate closed / Gate stengt
      'GTD': 'Gate Open',       // Gate open / Gate åpnet
      'DLY': 'Delayed',         // Delayed / Forsinket
      'EXP': 'Expected',        // Expected / Forventet
      'FIR': 'Final Call',      // Final call / Siste opprop
      'WIL': 'Wait in Lounge',  // Wait in lounge / Vent i lounge
      'DEP': 'Departed',        // Departed / Avgått
      'ARR': 'Arrived',         // Arrived / Ankommet
      'CNX': 'Cancelled',       // Cancelled / Kansellert
      'AIR': 'Airborne',        // Airborne / I luften
      'LND': 'Landed',          // Landet / Landet
      'CKI': 'Check-in',        // Check-in open / Innsjekking åpnet
      'CKC': 'Check-in Closed', // Check-in closed / Innsjekking stengt
    };
    
    return statusMap[statusCode] || statusCode;
  }

  _extractTime(dateTimeString) {
    if (!dateTimeString) return '';
    
    // Convert from UTC to local timezone and extract time
    try {
      // Parse as UTC time (Avinor provides times in UTC/Zulu)
      const date = new Date(dateTimeString + (dateTimeString.includes('Z') ? '' : 'Z'));
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return dateTimeString;
      }
      
      // Format in local timezone as HH:MM
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      
      return `${hours}:${minutes}`;
    } catch (e) {
      return dateTimeString;
    }
  }

  getCardSize() {
    return 4;
  }
}

customElements.define('avinor-flight-card', AvinorFlightCard);

// Visual card editor for UI configuration
class AvinorFlightCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
  }

  setConfig(config) {
    // Ensure config always has expected keys
    this._config = {
      title: '',
      exclude_columns: [],
      ...config,
    };
    this.render();
  }

  configChanged(newConfig) {
    const event = new Event('config-changed', {
      bubbles: true,
      composed: true,
    });
    event.detail = { config: newConfig };
    this.dispatchEvent(event);
  }

  render() {
    if (!this._config) {
      return;
    }

    // Get all Avinor flight entities
    const avinorEntities = this._hass ? Object.keys(this._hass.states)
      .filter(e => e.startsWith('sensor.avinor_'))
      .sort() : [];

    const entityOptions = avinorEntities.map(e => {
      const state = this._hass.states[e];
      const airport = state.attributes.airport || '';
      const direction = state.attributes.direction || '';
      const dirLabel = direction === 'D' ? 'Departures' : 'Arrivals';
      return `<option value="${e}">${e} - ${airport} ${dirLabel}</option>`;
    }).join('');

    const excluded = new Set(Array.isArray(this._config.exclude_columns) ? this._config.exclude_columns.map((c) => String(c).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')) : []);
    const columns = [
      { key: 'flight', label: 'Flight' },
      { key: 'type', label: 'Type' },
      { key: 'scheduled', label: 'Scheduled' },
      { key: 'airport', label: 'Airport' },
      { key: 'check_in', label: 'Check-in' },
      { key: 'gate', label: 'Gate' },
      { key: 'status', label: 'Status' },
    ];

    const columnOptions = columns.map(({ key, label }) => `
      <label style="display:flex; align-items:center; gap:8px; margin: 6px 0;">
        <input type="checkbox" data-col="${key}" ${excluded.has(key) ? 'checked' : ''} />
        <span>${label}</span>
      </label>
    `).join('');

    this.innerHTML = `
      <div style="padding: 16px;">
        <div style="margin-bottom: 16px; position: relative;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">
            Entity (required)
          </label>
          <select
            id="entity"
            style="width: 100%; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color);"
          >
            <option value="">-- Select an entity --</option>
            ${entityOptions}
          </select>
          <div style="margin-top: 4px; font-size: 0.9em; color: var(--secondary-text-color);">
            Select an Avinor flight sensor entity
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">
            Title (optional)
          </label>
          <input
            type="text"
            id="title"
            value="${this._config.title || ''}"
            placeholder="Avganger OSL"
            style="width: 100%; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color);"
          />
          <div style="margin-top: 4px; font-size: 0.9em; color: var(--secondary-text-color);">
            Card title (leave empty for default)
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">
            Exclude columns (optional)
          </label>
          <div style="padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px;">
            ${columnOptions}
          </div>
          <div style="margin-top: 4px; font-size: 0.9em; color: var(--secondary-text-color);">
            Check the columns you want to hide
          </div>
        </div>
      </div>
    `;

    // Set the current entity value
    const entitySelect = this.querySelector('#entity');
    if (this._config.entity) {
      entitySelect.value = this._config.entity;
    }

    // Add event listeners
    entitySelect.addEventListener('change', (e) => {
      this._config = { ...this._config, entity: e.target.value };
      this.configChanged(this._config);
    });

    this.querySelector('#title').addEventListener('input', (e) => {
      this._config = { ...this._config, title: e.target.value };
      this.configChanged(this._config);
    });

    // Excluded columns checkboxes
    this.querySelectorAll('input[type="checkbox"][data-col]').forEach((el) => {
      el.addEventListener('change', () => {
        const nextExcluded = [];
        this.querySelectorAll('input[type="checkbox"][data-col]').forEach((cb) => {
          if (cb.checked) nextExcluded.push(cb.getAttribute('data-col'));
        });
        this._config = { ...this._config, exclude_columns: nextExcluded };
        this.configChanged(this._config);
      });
    });

  }

  set hass(hass) {
    this._hass = hass;
    // Home Assistant often sets hass after setConfig; re-render to populate entity list.
    if (this._config) {
      this.render();
    }
  }
}

customElements.define('avinor-flight-card-editor', AvinorFlightCardEditor);

// Log confirmation for debugging
console.info(
  '%c AVINOR-FLIGHT-CARD %c Registered successfully with visual editor ',
  'background-color: #41bdf5; color: #fff; font-weight: bold;',
  'background-color: #333; color: #fff;'
);