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

    this._detailsFlightIata = null;
    this._detailsLoading = false;
    this._detailsError = '';
    this._detailsData = null;
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

    const clickAction = this._config.row_click_action;
    const clickable = clickAction === 'more-info' || clickAction === 'flight-details';

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

      const flightIata = f.flightId || '';

      return `
        <tr class="afc-row ${clickable ? 'afc-row--clickable' : ''}" ${clickable ? `tabindex="0" role="button" data-entity="${this._e(entityId)}" data-flight-iata="${this._e(flightIata)}"` : ''}>
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

      .afc-details__back { display: inline-flex; align-items: center; margin: 0 0 10px 0; padding: 6px 10px; border: 1px solid var(--divider-color); border-radius: 6px; background: var(--card-background-color); color: var(--primary-text-color); cursor: pointer; }
      .afc-details__title { font-weight: 600; margin-bottom: 8px; color: var(--primary-text-color); }
      .afc-details__loading { color: var(--secondary-text-color); }
      .afc-details__error { color: var(--error-color); white-space: pre-wrap; }

      .afc-details__grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 8px; }
      .afc-details__row { display: grid; grid-template-columns: minmax(110px, 0.9fr) 2fr; gap: 12px; align-items: baseline; padding: 8px 10px; border: 1px solid var(--divider-color); border-radius: 6px; }
      .afc-details__label { color: var(--secondary-text-color); font-size: 0.85em; }
      .afc-details__value { color: var(--primary-text-color); overflow-wrap: anywhere; }
      .afc-details__route { font-weight: 600; }

      .afc-details__raw { margin-top: 10px; }
      .afc-details__raw > summary { cursor: pointer; color: var(--secondary-text-color); }
      .afc-details__json { margin: 8px 0 0 0; padding: 10px; border: 1px solid var(--divider-color); border-radius: 6px; background: var(--card-background-color); color: var(--primary-text-color); overflow: auto; }
    `;

    if (this._detailsFlightIata) {
      const title = `Flight details: ${this._detailsFlightIata}`;
      const body = this._detailsLoading
        ? `<div class="afc-details__loading">Loading details from Airlabs…</div>`
        : (this._detailsError
          ? `<div class="afc-details__error">${this._e(this._detailsError)}</div>`
          : this._renderFlightDetails(this._detailsData));

      this._content.innerHTML = `
        <style>${styles}</style>
        ${metaHtml}
        <div class="afc-details">
          <button type="button" class="afc-details__back">Back</button>
          <div class="afc-details__title">${this._e(title)}</div>
          ${body}
        </div>
      `;

      const backBtn = this._content.querySelector('.afc-details__back');
      if (backBtn) {
        backBtn.onclick = () => {
          this._detailsFlightIata = null;
          this._detailsLoading = false;
          this._detailsError = '';
          this._detailsData = null;
          this.hass = this._hass;
        };
      }
      return;
    }

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
          const tr = this._getClickableRowFromEvent(ev);
          if (!tr) return;
          if (clickAction === 'more-info') {
            this._fireMoreInfo(entityId);
            return;
          }
          if (clickAction === 'flight-details') {
            const flightIata = tr.getAttribute('data-flight-iata') || '';
            if (!flightIata) return;
            this._openFlightDetails(flightIata);
          }
        };
        tbody.onkeydown = (ev) => {
          const key = ev.key;
          if (key !== 'Enter' && key !== ' ') return;
          const tr = this._getClickableRowFromEvent(ev);
          if (!tr) return;
          ev.preventDefault();
          if (clickAction === 'more-info') {
            this._fireMoreInfo(entityId);
            return;
          }
          if (clickAction === 'flight-details') {
            const flightIata = tr.getAttribute('data-flight-iata') || '';
            if (!flightIata) return;
            this._openFlightDetails(flightIata);
          }
        };
      }
    }
  }

  _getClickableRowFromEvent(ev) {
    try {
      const path = ev && typeof ev.composedPath === 'function' ? ev.composedPath() : null;
      let target = (path && path.length ? path[0] : (ev ? ev.target : null)) || null;

      // Some browsers can report Text nodes as event targets
      if (target && target.nodeType === 3) {
        target = target.parentElement;
      }

      if (target && typeof target.closest === 'function') {
        return target.closest('.afc-row--clickable');
      }

      if (target && target.parentElement && typeof target.parentElement.closest === 'function') {
        return target.parentElement.closest('.afc-row--clickable');
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  async _openFlightDetails(flightIata) {
    const cleaned = String(flightIata || '').trim();
    if (!cleaned) return;

    this._detailsFlightIata = cleaned;
    this._detailsLoading = true;
    this._detailsError = '';
    this._detailsData = null;
    this.hass = this._hass;

    try {
      const details = await this._callFlightDetailsService(cleaned);
      this._detailsData = details;
    } catch (err) {
      this._detailsError = (err && err.message) ? err.message : String(err);
    } finally {
      this._detailsLoading = false;
      this.hass = this._hass;
    }
  }

  async _callFlightDetailsService(flightIata) {
    const hass = this._hass;
    if (!hass) throw new Error('Home Assistant not ready');

    const payload = {
      type: 'call_service',
      domain: 'avinor_flight_data',
      service: 'get_flight_details',
      service_data: {
        flight_iata: String(flightIata || '').trim(),
      },
      return_response: true,
    };

    if (typeof hass.callWS === 'function') {
      const res = await hass.callWS(payload);
      if (res && typeof res === 'object') {
        if (res.response && typeof res.response === 'object') return res.response;
        if (res.result && typeof res.result === 'object') return res.result;
      }
      return res;
    }

    if (typeof hass.callService === 'function') {
      // Fallback for very old HA frontends: call service, but response won't be available.
      hass.callService('avinor_flight_data', 'get_flight_details', payload.service_data);
      return { note: 'Service called. This Home Assistant version does not expose service responses to the frontend.' };
    }

    throw new Error('Home Assistant frontend does not support calling services');
  }

  _renderFlightDetails(details) {
    const root = this._unwrapFlightDetails(details);
    const asJson = () => this._e(JSON.stringify(details || {}, null, 2));

    const linesToHtml = (lines) => {
      const safe = Array.isArray(lines)
        ? lines
          .filter((x) => x !== undefined && x !== null)
          .map((x) => String(x).trim())
          .filter(Boolean)
          .map((x) => this._e(x))
        : [];
      return safe.join('<br/>');
    };

    if (!root || typeof root !== 'object') {
      return `
        <div class="afc-details__grid">
          <div class="afc-details__row">
            <div class="afc-details__label">Details</div>
            <div class="afc-details__value">${this._e(String(root ?? 'No data'))}</div>
          </div>
        </div>
        <details class="afc-details__raw">
          <summary>Raw data</summary>
          <pre class="afc-details__json">${asJson()}</pre>
        </details>
      `;
    }

    const status = this._getAny(root, ['status', 'flight_status', 'flightStatus', 'flight_status_iata', 'flight_status_icao']);
    const airline = this._getAny(root, ['airline_name', 'airline', 'airline.name', 'airlineName', 'airline_fullname']);
    const airlineIata = this._getAny(root, ['airline_iata', 'airline.iata', 'airlineIata']);
    const airlineIcao = this._getAny(root, ['airline_icao', 'airline.icao', 'airlineIcao']);
    const callsign = this._getAny(root, ['callsign', 'call_sign', 'callSign']);
    const flightNumber = this._getAny(root, ['flight_number', 'flightNumber', 'flight.number', 'flight.num']);
    const flightIata = this._getAny(root, ['flight_iata', 'flight.iata', 'iata']);
    const flightIcao = this._getAny(root, ['flight_icao', 'flight.icao', 'icao']);

    const updatedAt = this._formatDetailsDateTime(this._getAny(root, ['updated', 'updated_at', 'updatedAt', 'last_updated', 'timestamp']));

    const depIata = this._getAny(root, ['dep_iata', 'departure.iata', 'dep.iata', 'dep_airport_iata', 'dep_airport']);
    const depIcao = this._getAny(root, ['dep_icao', 'departure.icao', 'dep.icao']);
    const depName = this._getAny(root, ['dep_name', 'departure.name', 'dep.name', 'departure.airport', 'dep_airport_name']);
    const depCity = this._getAny(root, ['dep_city', 'departure.city', 'dep.city']);
    const depTerminal = this._getAny(root, ['dep_terminal', 'departure.terminal', 'dep.terminal', 'departure.term']);
    const depGate = this._getAny(root, ['dep_gate', 'departure.gate', 'dep.gate']);
    const depBaggage = this._getAny(root, ['dep_baggage', 'departure.baggage', 'dep.baggage']);

    const arrIata = this._getAny(root, ['arr_iata', 'arrival.iata', 'arr.iata', 'arr_airport_iata', 'arr_airport']);
    const arrIcao = this._getAny(root, ['arr_icao', 'arrival.icao', 'arr.icao']);
    const arrName = this._getAny(root, ['arr_name', 'arrival.name', 'arr.name', 'arrival.airport', 'arr_airport_name']);
    const arrCity = this._getAny(root, ['arr_city', 'arrival.city', 'arr.city']);
    const arrTerminal = this._getAny(root, ['arr_terminal', 'arrival.terminal', 'arr.terminal', 'arrival.term']);
    const arrGate = this._getAny(root, ['arr_gate', 'arrival.gate', 'arr.gate']);
    const arrBaggage = this._getAny(root, ['arr_baggage', 'arrival.baggage', 'arr.baggage', 'baggage']);

    const delayMin = this._getAny(root, ['delayed', 'delay', 'delay_min', 'delayMinutes', 'dep_delay', 'arr_delay']);

    const depTime = this._formatDetailsDateTime(this._getAny(root, [
      'dep_time', 'departure.scheduled', 'departure.scheduled_time', 'dep_scheduled', 'scheduled_departure',
    ]));
    const depEst = this._formatDetailsDateTime(this._getAny(root, [
      'dep_estimated', 'dep_est', 'departure.estimated', 'departure.estimated_time', 'estimated_departure',
    ]));
    const depAct = this._formatDetailsDateTime(this._getAny(root, [
      'dep_actual', 'dep_act', 'departure.actual', 'departure.actual_time', 'actual_departure',
    ]));

    const arrTime = this._formatDetailsDateTime(this._getAny(root, [
      'arr_time', 'arrival.scheduled', 'arrival.scheduled_time', 'arr_scheduled', 'scheduled_arrival',
    ]));
    const arrEst = this._formatDetailsDateTime(this._getAny(root, [
      'arr_estimated', 'arr_est', 'arrival.estimated', 'arrival.estimated_time', 'estimated_arrival',
    ]));
    const arrAct = this._formatDetailsDateTime(this._getAny(root, [
      'arr_actual', 'arr_act', 'arrival.actual', 'arrival.actual_time', 'actual_arrival',
    ]));

    const aircraftIcao = this._getAny(root, ['aircraft_icao', 'aircraft.icao', 'aircraft.type', 'aircraftType']);
    const aircraftIata = this._getAny(root, ['aircraft_iata', 'aircraft.iata']);
    const reg = this._getAny(root, ['reg_number', 'registration', 'aircraft.reg', 'aircraft.registration', 'tail_number']);
    const hex = this._getAny(root, ['hex', 'aircraft_hex', 'aircraft.hex']);

    const lat = this._getAny(root, ['lat', 'latitude', 'live.lat', 'live.latitude']);
    const lng = this._getAny(root, ['lng', 'lon', 'longitude', 'live.lng', 'live.lon', 'live.longitude']);
    const alt = this._getAny(root, ['alt', 'altitude', 'live.alt', 'live.altitude']);
    const speed = this._getAny(root, ['speed', 'spd', 'live.speed']);
    const heading = this._getAny(root, ['dir', 'heading', 'track', 'live.dir', 'live.heading']);

    const routeLeft = depIata || depIcao || '';
    const routeRight = arrIata || arrIcao || '';
    const route = (routeLeft && routeRight) ? `${routeLeft} → ${routeRight}` : '';

    const rows = [];

    if (route) rows.push(this._detailRow('Route', `<span class="afc-details__route">${this._e(route)}</span>`));
    if (status) {
      const kind = this._getStatusKindFromText(status);
      rows.push(this._detailRow('Status', `<span class="afc-status afc-status--${this._e(kind)}">${this._e(status)}</span>`));
    }
    if (delayMin) rows.push(this._detailRow('Delay', this._e(`${delayMin} min`)));

    const flightLine = [flightIata, flightIcao, flightNumber].filter(Boolean).join(' · ');
    if (flightLine) rows.push(this._detailRow('Flight', this._e(flightLine)));
    const airlineLine = [airline, [airlineIata, airlineIcao].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
    if (airlineLine) rows.push(this._detailRow('Airline', this._e(airlineLine)));
    if (callsign) rows.push(this._detailRow('Callsign', this._e(callsign)));
    if (updatedAt) rows.push(this._detailRow('Updated', this._e(updatedAt)));

    const depAirportLine = [
      [depIata, depIcao].filter(Boolean).join(' · '),
      depName,
      depCity,
    ].filter(Boolean).join(' — ');
    const arrAirportLine = [
      [arrIata, arrIcao].filter(Boolean).join(' · '),
      arrName,
      arrCity,
    ].filter(Boolean).join(' — ');
    if (depAirportLine) rows.push(this._detailRow('Departure', this._e(depAirportLine)));
    if (arrAirportLine) rows.push(this._detailRow('Arrival', this._e(arrAirportLine)));

    const depOps = [
      depTerminal && `Terminal: ${depTerminal}`,
      depGate && `Gate: ${depGate}`,
      depBaggage && `Baggage: ${depBaggage}`,
    ].filter(Boolean);
    const arrOps = [
      arrTerminal && `Terminal: ${arrTerminal}`,
      arrGate && `Gate: ${arrGate}`,
      arrBaggage && `Baggage: ${arrBaggage}`,
    ].filter(Boolean);
    if (depOps.length) rows.push(this._detailRow('Dep ops', linesToHtml(depOps)));
    if (arrOps.length) rows.push(this._detailRow('Arr ops', linesToHtml(arrOps)));

    const depTimes = [
      depTime && `Scheduled: ${depTime}`,
      depEst && `Estimated: ${depEst}`,
      depAct && `Actual: ${depAct}`,
    ].filter(Boolean);
    const arrTimes = [
      arrTime && `Scheduled: ${arrTime}`,
      arrEst && `Estimated: ${arrEst}`,
      arrAct && `Actual: ${arrAct}`,
    ].filter(Boolean);
    if (depTimes.length) rows.push(this._detailRow('Dep times', linesToHtml(depTimes)));
    if (arrTimes.length) rows.push(this._detailRow('Arr times', linesToHtml(arrTimes)));

    const aircraftLine = [aircraftIcao, aircraftIata, reg, hex].filter(Boolean).join(' · ');
    if (aircraftLine) rows.push(this._detailRow('Aircraft', this._e(aircraftLine)));

    const live = [
      (lat && lng) ? `Position: ${lat}, ${lng}` : '',
      alt ? `Altitude: ${alt}` : '',
      speed ? `Speed: ${speed}` : '',
      heading ? `Heading: ${heading}` : '',
    ].filter(Boolean);
    if (live.length) rows.push(this._detailRow('Live', linesToHtml(live)));

    if (!rows.length) rows.push(this._detailRow('Details', 'No recognizable fields in response'));

    return `
      <div class="afc-details__grid">${rows.join('')}</div>
      <details class="afc-details__raw">
        <summary>Raw data</summary>
        <pre class="afc-details__json">${asJson()}</pre>
      </details>
    `;
  }

  _detailRow(label, valueHtml) {
    return `
      <div class="afc-details__row">
        <div class="afc-details__label">${this._e(label)}</div>
        <div class="afc-details__value">${valueHtml}</div>
      </div>
    `;
  }

  _unwrapFlightDetails(details) {
    if (!details || typeof details !== 'object') return details;
    // Common wrappers: { data: {...} }, { flight: {...} }, { flight_details: {...} }
    const candidates = ['data', 'flight', 'flight_details', 'flightDetails', 'result', 'response'];
    for (const key of candidates) {
      if (details[key] && typeof details[key] === 'object') return details[key];
    }
    return details;
  }

  _getAny(obj, paths) {
    if (!obj || typeof obj !== 'object') return '';
    for (const p of paths) {
      const v = this._getPath(obj, p);
      if (v === undefined || v === null) continue;
      const s = String(v).trim();
      if (s) return v;
    }
    return '';
  }

  _getPath(obj, path) {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = String(path || '').split('.').map((x) => x.trim()).filter(Boolean);
    let cur = obj;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  }

  _formatDetailsDateTime(value) {
    if (value === undefined || value === null) return '';
    const raw = String(value).trim();
    if (!raw) return '';

    // Numeric timestamps (seconds or milliseconds)
    if (typeof value === 'number' || /^[0-9]{10,13}$/.test(raw)) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        const ms = n > 1e12 ? n : n * 1000;
        const d = new Date(ms);
        if (!isNaN(d.getTime())) return this._formatDateTimeLocal(d);
      }
    }

    const d = this._tryParseDate(raw);
    if (d) return this._formatDateTimeLocal(d);
    return raw;
  }

  _formatDateTimeLocal(date) {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    } catch (e) {
      // Fallback for older engines
      return date.toLocaleString();
    }
  }

  _getStatusKindFromText(statusText) {
    const s = String(statusText || '').toLowerCase();
    if (!s) return 'info';
    if (s.includes('cancel')) return 'bad';
    if (s.includes('delay') || s.includes('divert') || s.includes('late') || s.includes('hold')) return 'warn';
    if (s.includes('arriv') || s.includes('land') || s.includes('depart') || s.includes('airborne') || s.includes('en route') || s.includes('en-route') || s.includes('active')) return 'good';
    if (s.includes('scheduled') || s.includes('boarding') || s.includes('gate')) return 'ok';
    return 'ok';
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
            <option value="flight-details" ${rowClickAction === 'flight-details' ? 'selected' : ''}>Open flight details (Airlabs)</option>
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