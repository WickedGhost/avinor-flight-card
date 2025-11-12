/*
 * Avinor Flight Card - source file (will be bundled to dist/avinor-flight-card.js)
 * Version placeholder __VERSION__ is replaced during build.
 */

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
  static get version() { return __VERSION__; }
  static getStubConfig(hass) {
    if (hass && hass.states) {
      const firstSensor = Object.keys(hass.states).find((e) => e.startsWith('sensor.avinor_'));
      if (firstSensor) {
        return { entity: firstSensor, title: 'Avinor Flight Data' };
      }
    }
    return { entity: '', title: 'Avinor Flight Data' };
  }
  static getConfigElement() { return document.createElement('avinor-flight-card-editor'); }

  setConfig(config) {
    if (!config.entity) throw new Error('Please define entity');
    this._config = config;
    this._content = document.createElement('div');
    this._content.style.padding = '16px';
    const card = document.createElement('ha-card');
    card.header = config.title || 'Avinor Flight Data';
    card.appendChild(this._content);
    this.appendChild(card);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const state = hass.states[this._config.entity];
    if (!state) { this._content.innerHTML = `<div>Entity ${this._config.entity} not found</div>`; return; }
    const attrs = state.attributes || {};
    const flights = Array.isArray(attrs.flights) ? attrs.flights : [];
    const airport = attrs.airport || ''; const direction = attrs.direction || ''; const lastUpdate = attrs.last_update || '';
    const isArrival = direction === 'A';
    const header = `Airport: ${airport} • Direction: ${direction} • Flights: ${flights.length} • Updated: ${lastUpdate}`;

    const rows = flights.map(f => {
      const typeMap = { 'S': 'Schengen', 'D': 'Domestic', 'I': 'International' };
      const flightType = typeMap[f.dom_int] || f.dom_int || '';
      const airportName = this._getAirportName(f.airport);
      const statusText = this._getStatusText(f.status_code);
      const scheduleTime = this._extractTime(f.schedule_time);
      return `<tr><td style="padding:8px;">${this._e(f.flightId)}</td><td style="padding:8px;">${this._e(flightType)}</td><td style="padding:8px;">${this._e(scheduleTime)}</td><td style="padding:8px;">${this._e(airportName)}</td>${!isArrival?`<td style=\"padding:8px;\">${this._e(f.check_in)}</td>`:''}${!isArrival?`<td style=\"padding:8px;\">${this._e(f.gate)}</td>`:''}<td style="padding:8px;">${this._e(statusText)}</td></tr>`;
    }).join('');

    this._content.innerHTML = `<div style="margin-bottom:8px;font-size:0.9em;color:var(--secondary-text-color);">${header}</div><div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid var(--divider-color);">Flight</th><th style="text-align:left;padding:8px;border-bottom:1px solid var(--divider-color);">Type</th><th style="text-align:left;padding:8px;border-bottom:1px solid var(--divider-color);">Scheduled</th><th style="text-align:left;padding:8px;border-bottom:1px solid var(--divider-color);">Airport</th>${!isArrival?'<th style="text-align:left;padding:8px;border-bottom:1px solid var(--divider-color);">Check-in</th>':''}${!isArrival?'<th style="text-align:left;padding:8px;border-bottom:1px solid var(--divider-color);">Gate</th>':''}<th style="text-align:left;padding:8px;border-bottom:1px solid var(--divider-color);">Status</th></tr></thead><tbody>${rows}</tbody></table></div><div style="margin-top:8px;font-size:0.8em;color:var(--secondary-text-color);">Flydata fra <a href="https://www.avinor.no/" target="_blank" rel="noreferrer">Avinor</a></div>`;
  }

  _e(v){ if(v===undefined||v===null) return ''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  _getAirportName(i){ const map={OSL:'Oslo',BGO:'Bergen',TRD:'Trondheim',SVG:'Stavanger'}; return map[i]||i||''; }
  _getStatusText(c){ const map={E:'New Info',A:'Arrived',C:'Cancelled',D:'Departed'}; return map[c]||c||''; }
  _extractTime(d){ if(!d) return ''; try { const date=new Date(d+(d.includes('Z')?'':'Z')); if(isNaN(date.getTime())) return d; return `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;}catch(e){ return d; } }
  getCardSize(){ return 4; }
}
customElements.define('avinor-flight-card', AvinorFlightCard);

class AvinorFlightCardEditor extends HTMLElement { setConfig(config){ this._config=config; if(!this._rendered) this.render(); } configChanged(newConfig){ const event=new Event('config-changed',{bubbles:true,composed:true}); event.detail={config:newConfig}; this.dispatchEvent(event);} render(){ if(!this._config) return; const avinorEntities=this._hass?Object.keys(this._hass.states).filter(e=>e.startsWith('sensor.avinor_')).sort():[]; const entityOptions=avinorEntities.map(e=>{ const st=this._hass.states[e]; const airport=st.attributes.airport||''; const direction=st.attributes.direction||''; const dirLabel=direction==='D'?'Departures':'Arrivals'; return `<option value="${e}">${e} - ${airport} ${dirLabel}</option>`; }).join(''); this.innerHTML=`<div style="padding:16px;"><div style="margin-bottom:16px;position:relative;"><label style="display:block;margin-bottom:8px;font-weight:500;">Entity (required)</label><select id="entity" style="width:100%;padding:8px;border:1px solid var(--divider-color);border-radius:4px;background:var(--card-background-color);color:var(--primary-text-color);"><option value="">-- Select an entity --</option>${entityOptions}</select><div style="margin-top:4px;font-size:0.9em;color:var(--secondary-text-color);">Select an Avinor flight sensor entity</div></div><div style="margin-bottom:16px;"><label style="display:block;margin-bottom:8px;font-weight:500;">Title (optional)</label><input type="text" id="title" value="${this._config.title||''}" placeholder="Avganger OSL" style="width:100%;padding:8px;border:1px solid var(--divider-color);border-radius:4px;background:var(--card-background-color);color:var(--primary-text-color);"/><div style="margin-top:4px;font-size:0.9em;color:var(--secondary-text-color);">Card title (leave empty for default)</div></div></div>`; const entitySelect=this.querySelector('#entity'); if(this._config.entity) entitySelect.value=this._config.entity; entitySelect.addEventListener('change',e=>{ this._config={...this._config,entity:e.target.value}; this.configChanged(this._config); }); this.querySelector('#title').addEventListener('input',e=>{ this._config={...this._config,title:e.target.value}; this.configChanged(this._config); }); this._rendered=true; } set hass(hass){ this._hass=hass; }}
customElements.define('avinor-flight-card-editor', AvinorFlightCardEditor);

console.info(`%c AVINOR-FLIGHT-CARD %c v${AvinorFlightCard.version} registered`, 'background:#41bdf5;color:#fff;font-weight:bold;', 'background:#333;color:#fff;');
