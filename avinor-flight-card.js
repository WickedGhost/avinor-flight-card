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
    });
  }
} catch (e) {
  // non-fatal; HA will still allow manual YAML usage
}

class AvinorFlightCard extends HTMLElement {
  static getStubConfig(hass) {
    // Provide a simple default entity for preview/selection in the card picker
    if (hass && hass.states) {
      const firstSensor = Object.keys(hass.states).find((e) => e.startsWith('sensor.avinor_'));
      if (firstSensor) {
        return { entity: firstSensor, title: 'Avinor Flight Data' };
      }
    }
    return { entity: '', title: 'Avinor Flight Data' };
  }

  static getConfigElement() {
    return document.createElement('avinor-flight-card-editor');
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define entity');
    }
    this._config = config;
    this._content = document.createElement('div');
    this._content.style.padding = '16px';
    const card = document.createElement('ha-card');
    if (config.title) {
      card.header = config.title;
    } else {
      card.header = 'Avinor Flight Data';
    }
    card.appendChild(this._content);
    this.appendChild(card);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const entityId = this._config.entity;
    const state = hass.states[entityId];
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
          <td style="padding: 8px;">${this._e(f.flightId)}</td>
          <td style="padding: 8px;">${this._e(flightType)}</td>
          <td style="padding: 8px;">${this._e(scheduleTime)}</td>
          <td style="padding: 8px;">${this._e(airportName)}</td>
          ${!isArrival ? `<td style="padding: 8px;">${this._e(f.check_in)}</td>` : ''}
          ${!isArrival ? `<td style="padding: 8px;">${this._e(f.gate)}</td>` : ''}
          <td style="padding: 8px;">${this._e(statusText)}</td>
        </tr>
      `;
    }).join('');

    this._content.innerHTML = `
      <div style="margin-bottom:8px; font-size: 0.9em; color: var(--secondary-text-color);">${header}</div>
      <div style="overflow:auto;">
        <table style="width:100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Flight</th>
              <th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Type</th>
              <th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Scheduled</th>
              <th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Airport</th>
              ${!isArrival ? '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Check-in</th>' : ''}
              ${!isArrival ? '<th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Gate</th>' : ''}
              <th style="text-align:left; padding: 8px; border-bottom: 1px solid var(--divider-color);">Status</th>
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
  setConfig(config) {
    this._config = config;
    // Only render if not already rendered
    if (!this._rendered) {
      this.render();
    }
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

    this._rendered = true;
  }

  set hass(hass) {
    this._hass = hass;
  }
}

customElements.define('avinor-flight-card-editor', AvinorFlightCardEditor);

// Log confirmation for debugging
console.info(
  '%c AVINOR-FLIGHT-CARD %c Registered successfully with visual editor ',
  'background-color: #41bdf5; color: #fff; font-weight: bold;',
  'background-color: #333; color: #fff;'
);