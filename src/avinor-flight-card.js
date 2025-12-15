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
    return {
      entity: '',
      title: 'Avinor Flight Data',
      exclude_columns: [],
      compact: false,
      show_table_header: true,
      show_meta: true,
      row_click_action: 'none',
      sort_by: 'scheduled',
      sort_dir: 'asc',
      max_rows: 0,
    };
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
      compact: false,
      show_table_header: true,
      show_meta: true,
      row_click_action: 'none',
      sort_by: 'scheduled',
      sort_dir: 'asc',
      max_rows: 0,
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

    const updatedDisplay = this._formatUpdated(lastUpdate);
    const visibleFlights = this._applySortAndLimit(flights);
    const flightsLabel = visibleFlights.length === flights.length
      ? `${flights.length}`
      : `${visibleFlights.length}/${flights.length}`;
    const header = `Airport: ${airport} • Direction: ${direction} • Flights: ${flightsLabel} • Updated: ${updatedDisplay}`;

    const clickable = this._config.row_click_action === 'more-info';

    const rows = visibleFlights.map(f => {
      // Convert dom_int code to description
      const typeMap = {
        'S': 'Schengen',
        'D': 'Domestic',
        'I': 'International'
      };
      const flightType = typeMap[f.dom_int] || f.dom_int || '';

      // Get airport name from IATA code
      const airportName = this._getAirportName(f.airport);
      
      const statusText = this._getStatusText(f.status_code);
      const statusKind = this._getStatusKind(f.status_code);

      const scheduleCell = this._formatScheduleCell(f);

      return `
        <tr class="afc-row ${clickable ? 'afc-row--clickable' : ''}" ${clickable ? `tabindex="0" role="button" data-entity="${this._e(entityId)}"` : ''}>
          ${isExcluded('flight') ? '' : `<td>${this._e(f.flightId)}</td>`}
          ${isExcluded('type') ? '' : `<td>${this._e(flightType)}</td>`}
          ${isExcluded('scheduled') ? '' : `<td>${scheduleCell}</td>`}
          ${isExcluded('airport') ? '' : `<td>${this._e(airportName)}</td>`}
          ${isExcluded('check_in') ? '' : `<td>${this._e(f.check_in)}</td>`}
          ${isExcluded('gate') ? '' : `<td>${this._e(f.gate)}</td>`}
          ${isExcluded('status') ? '' : `<td><span class="afc-status afc-status--${statusKind}">${this._e(statusText)}</span></td>`}
        </tr>
      `;
    }).join('');

    const tableHeaderHtml = this._config.show_table_header
      ? `
          <thead>
            <tr>
              ${isExcluded('flight') ? '' : '<th>Flight</th>'}
              ${isExcluded('type') ? '' : '<th>Type</th>'}
              ${isExcluded('scheduled') ? '' : '<th>Scheduled</th>'}
              ${isExcluded('airport') ? '' : '<th>Airport</th>'}
              ${isExcluded('check_in') ? '' : '<th>Check-in</th>'}
              ${isExcluded('gate') ? '' : '<th>Gate</th>'}
              ${isExcluded('status') ? '' : '<th>Status</th>'}
            </tr>
          </thead>
        `
      : '';

    const metaHtml = this._config.show_meta
      ? `<div class="afc-meta">${this._e(header)}</div>`
      : '';

    const styles = `
      .afc-meta { margin-bottom: 8px; font-size: 0.9em; color: var(--secondary-text-color); }
      .afc-table-wrap { overflow: auto; }
      .afc-table { width: 100%; border-collapse: collapse; }
      .afc-table th { text-align: left; font-weight: 500; color: var(--primary-text-color); border-bottom: 1px solid var(--divider-color); padding: ${this._config.compact ? '6px' : '8px'}; }
      .afc-table td { border-bottom: 1px solid var(--divider-color); padding: ${this._config.compact ? '6px' : '8px'}; }
      .afc-table tbody tr:last-child td { border-bottom: none; }

      .afc-row--clickable { cursor: pointer; }
      .afc-row--clickable:hover { background: var(--table-row-background-hover-color, rgba(128, 128, 128, 0.1)); }
      .afc-row--clickable:focus { outline: 2px solid var(--primary-color); outline-offset: -2px; }

      .afc-time { display: inline-flex; gap: 6px; align-items: baseline; white-space: nowrap; }
      .afc-time__orig { color: var(--primary-text-color); }
      .afc-time__new { color: var(--warning-color, var(--primary-color)); font-weight: 600; }
      .afc-time__arrow { color: var(--secondary-text-color); }

      .afc-status { display: inline-block; font-weight: 600; }
      .afc-status--ok { color: var(--primary-text-color); }
      .afc-status--info { color: var(--secondary-text-color); }
      .afc-status--warn { color: var(--warning-color, var(--primary-color)); }
      .afc-status--bad { color: var(--error-color); }
      .afc-status--good { color: var(--success-color); }

      .afc-footer { margin-top: 8px; font-size: 0.8em; color: var(--secondary-text-color); }
    `;

    this._content.innerHTML = `
      <style>${styles}</style>
      ${metaHtml}
      <div class="afc-table-wrap">
        <table class="afc-table">
          ${tableHeaderHtml}
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <div class="afc-footer">
        Flydata fra <a href="https://www.avinor.no/" target="_blank" rel="noreferrer">Avinor</a>
      </div>
    `;

    if (clickable) {
      const tbody = this._content.querySelector('tbody');
      if (tbody) {
        // Replace existing handler by resetting onclick/keydown (simple + safe)
        tbody.onclick = (ev) => {
          const tr = ev.target && ev.target.closest ? ev.target.closest('.afc-row--clickable') : null;
          if (!tr) return;
          this._fireMoreInfo(entityId);
        };
        tbody.onkeydown = (ev) => {
          const key = ev.key;
          if (key !== 'Enter' && key !== ' ') return;
          const tr = ev.target && ev.target.closest ? ev.target.closest('.afc-row--clickable') : null;
          if (!tr) return;
          ev.preventDefault();
          this._fireMoreInfo(entityId);
        };
      }
    }
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

  _applySortAndLimit(flights) {
    const list = Array.isArray(flights) ? flights.slice() : [];

    const sortBy = String(this._config && this._config.sort_by ? this._config.sort_by : 'scheduled')
      .trim()
      .toLowerCase();
    const sortDir = String(this._config && this._config.sort_dir ? this._config.sort_dir : 'asc')
      .trim()
      .toLowerCase();
    const dir = sortDir === 'desc' ? -1 : 1;

    const getSortValue = (flight) => {
      if (!flight) return '';

      switch (sortBy) {
        case 'flight':
          return flight.flightId || '';
        case 'type':
          return flight.dom_int || '';
        case 'airport':
          return this._getAirportName(flight.airport || '');
        case 'check_in':
          return flight.check_in || '';
        case 'gate':
          return flight.gate || '';
        case 'status':
          return flight.status_code || '';
        case 'scheduled':
        default: {
          const raw = flight.new_time || flight.estimated_time || flight.expected_time || flight.actual_time || flight.time || flight.schedule_time;
          const dt = this._tryParseDate(raw);
          if (dt) return dt.getTime();
          return this._extractTime(raw) || '';
        }
      }
    };

    const withIndex = list.map((f, idx) => ({ f, idx }));
    withIndex.sort((a, b) => {
      const av = getSortValue(a.f);
      const bv = getSortValue(b.f);

      if (typeof av === 'number' && typeof bv === 'number' && isFinite(av) && isFinite(bv)) {
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return a.idx - b.idx;
      }

      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as < bs) return -1 * dir;
      if (as > bs) return 1 * dir;
      return a.idx - b.idx;
    });

    let result = withIndex.map((x) => x.f);

    const maxRaw = this._config && this._config.max_rows !== undefined ? this._config.max_rows : 0;
    const maxRows = Number.isFinite(Number(maxRaw)) ? Math.max(0, Math.floor(Number(maxRaw))) : 0;
    if (maxRows > 0) {
      result = result.slice(0, maxRows);
    }

    return result;
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

  _formatUpdated(lastUpdate) {
    if (!lastUpdate) return '';
    const d = this._tryParseDate(lastUpdate);
    if (!d) return String(lastUpdate);
    const abs = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
    const rel = this._formatRelativeTime(d);
    return rel ? `${abs} (${rel})` : abs;
  }

  _tryParseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const s = String(value).trim();
    if (!s) return null;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // Some integrations provide timestamps without timezone
    const dz = new Date(s + (s.includes('Z') ? '' : 'Z'));
    return isNaN(dz.getTime()) ? null : dz;
  }

  _formatRelativeTime(date) {
    const deltaMs = Date.now() - date.getTime();
    if (!isFinite(deltaMs)) return '';
    const deltaSec = Math.round(deltaMs / 1000);
    if (deltaSec < 0) return '';
    if (deltaSec < 60) return `${deltaSec}s ago`;
    const deltaMin = Math.round(deltaSec / 60);
    if (deltaMin < 60) return `${deltaMin}m ago`;
    const deltaHr = Math.round(deltaMin / 60);
    if (deltaHr < 24) return `${deltaHr}h ago`;
    const deltaDay = Math.round(deltaHr / 24);
    return `${deltaDay}d ago`;
  }

  _formatScheduleCell(f) {
    const sched = this._extractTime(f.schedule_time);
    const altRaw = f.new_time || f.estimated_time || f.expected_time || f.actual_time || f.time;
    const alt = altRaw ? this._extractTime(altRaw) : '';
    if (alt && alt !== sched) {
      return `<span class="afc-time"><span class="afc-time__orig">${this._e(sched)}</span><span class="afc-time__arrow">→</span><span class="afc-time__new">${this._e(alt)}</span></span>`;
    }
    return `<span class="afc-time"><span class="afc-time__orig">${this._e(sched)}</span></span>`;
  }

  _getStatusKind(statusCode) {
    const code = String(statusCode || '').toUpperCase();
    if (!code) return 'info';
    if (code === 'C' || code === 'CNX') return 'bad';
    if (code === 'DLY' || code === 'N' || code === 'E') return 'warn';
    if (code === 'A' || code === 'ARR' || code === 'LND' || code === 'D' || code === 'DEP') return 'good';
    if (code === 'BRD' || code === 'GTD' || code === 'FIR') return 'warn';
    return 'ok';
  }

  _fireMoreInfo(entityId) {
    const ev = new CustomEvent('hass-more-info', {
      bubbles: true,
      composed: true,
      detail: { entityId },
    });
    this.dispatchEvent(ev);
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
      compact: false,
      show_table_header: true,
      show_meta: true,
      row_click_action: 'none',
      sort_by: 'scheduled',
      sort_dir: 'asc',
      max_rows: 0,
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

    const rowClickAction = this._config.row_click_action || 'none';
    const sortBy = this._config.sort_by || 'scheduled';
    const sortDir = this._config.sort_dir || 'asc';
    const maxRows = this._config.max_rows === undefined || this._config.max_rows === null ? 0 : this._config.max_rows;

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

        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">
            Layout (optional)
          </label>
          <label style="display:flex; align-items:center; gap:8px; margin: 6px 0;">
            <input type="checkbox" id="compact" ${this._config.compact ? 'checked' : ''} />
            <span>Compact rows</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; margin: 6px 0;">
            <input type="checkbox" id="show_table_header" ${this._config.show_table_header ? 'checked' : ''} />
            <span>Show table header</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; margin: 6px 0;">
            <input type="checkbox" id="show_meta" ${this._config.show_meta ? 'checked' : ''} />
            <span>Show meta line (airport/direction/updated)</span>
          </label>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">
            Row click action (optional)
          </label>
          <select
            id="row_click_action"
            style="width: 100%; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color);"
          >
            <option value="none" ${rowClickAction === 'none' ? 'selected' : ''}>None</option>
            <option value="more-info" ${rowClickAction === 'more-info' ? 'selected' : ''}>Open entity more-info</option>
          </select>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500;">
            Sorting & limiting (optional)
          </label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div>
              <div style="margin-bottom: 6px; color: var(--secondary-text-color);">Sort by</div>
              <select
                id="sort_by"
                style="width: 100%; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color);"
              >
                <option value="scheduled" ${sortBy === 'scheduled' ? 'selected' : ''}>Scheduled</option>
                <option value="flight" ${sortBy === 'flight' ? 'selected' : ''}>Flight</option>
                <option value="type" ${sortBy === 'type' ? 'selected' : ''}>Type</option>
                <option value="airport" ${sortBy === 'airport' ? 'selected' : ''}>Airport</option>
                <option value="check_in" ${sortBy === 'check_in' ? 'selected' : ''}>Check-in</option>
                <option value="gate" ${sortBy === 'gate' ? 'selected' : ''}>Gate</option>
                <option value="status" ${sortBy === 'status' ? 'selected' : ''}>Status</option>
              </select>
            </div>
            <div>
              <div style="margin-bottom: 6px; color: var(--secondary-text-color);">Direction</div>
              <select
                id="sort_dir"
                style="width: 100%; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color);"
              >
                <option value="asc" ${sortDir === 'asc' ? 'selected' : ''}>Ascending</option>
                <option value="desc" ${sortDir === 'desc' ? 'selected' : ''}>Descending</option>
              </select>
            </div>
          </div>
          <div style="margin-top: 12px;">
            <div style="margin-bottom: 6px; color: var(--secondary-text-color);">Max rows</div>
            <input
              type="number"
              id="max_rows"
              min="0"
              step="1"
              value="${maxRows}"
              placeholder="0"
              style="width: 100%; padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color);"
            />
            <div style="margin-top: 4px; font-size: 0.9em; color: var(--secondary-text-color);">0 = show all flights</div>
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

    const compactEl = this.querySelector('#compact');
    if (compactEl) {
      compactEl.addEventListener('change', (e) => {
        this._config = { ...this._config, compact: !!e.target.checked };
        this.configChanged(this._config);
      });
    }

    const showHeaderEl = this.querySelector('#show_table_header');
    if (showHeaderEl) {
      showHeaderEl.addEventListener('change', (e) => {
        this._config = { ...this._config, show_table_header: !!e.target.checked };
        this.configChanged(this._config);
      });
    }

    const showMetaEl = this.querySelector('#show_meta');
    if (showMetaEl) {
      showMetaEl.addEventListener('change', (e) => {
        this._config = { ...this._config, show_meta: !!e.target.checked };
        this.configChanged(this._config);
      });
    }

    const rowActionEl = this.querySelector('#row_click_action');
    if (rowActionEl) {
      rowActionEl.addEventListener('change', (e) => {
        this._config = { ...this._config, row_click_action: e.target.value };
        this.configChanged(this._config);
      });
    }

    const sortByEl = this.querySelector('#sort_by');
    if (sortByEl) {
      sortByEl.addEventListener('change', (e) => {
        this._config = { ...this._config, sort_by: e.target.value };
        this.configChanged(this._config);
      });
    }

    const sortDirEl = this.querySelector('#sort_dir');
    if (sortDirEl) {
      sortDirEl.addEventListener('change', (e) => {
        this._config = { ...this._config, sort_dir: e.target.value };
        this.configChanged(this._config);
      });
    }

    const maxRowsEl = this.querySelector('#max_rows');
    if (maxRowsEl) {
      maxRowsEl.addEventListener('input', (e) => {
        const raw = e.target.value;
        const n = raw === '' ? 0 : Number(raw);
        this._config = { ...this._config, max_rows: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0 };
        this.configChanged(this._config);
      });
    }

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