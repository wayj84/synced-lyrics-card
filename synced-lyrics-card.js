/* Synced Lyrics Card v1.0.0 - Home Assistant Lovelace custom card */
class SyncedLyricsCard extends HTMLElement {
  static getConfigElement() { return document.createElement('synced-lyrics-card-editor'); }
  static getStubConfig() { return { entity: '', layout: 'focus', alignment: 'center', font_family: 'system-ui', font_size: 42, font_weight: 700, card_height: '560px', show_previous: true, show_upcoming: true, inactive_opacity: 0.32, active_scale: 1.16, sync_offset: 0, show_track_info: true, background_opacity: 1, background_mode: 'theme', artwork_blur: 12, artwork_opacity: 1, artwork_overlay_opacity: 0.35, text_color_mode: 'auto', contrast_mode: 'adaptive', backdrop_blur: 8, backdrop_opacity: 0.18, text_shadow: true, text_shadow_strength: 0.75 }; }
  static get properties() { return {}; }

  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this._config = null; this._hass = null; this._lyrics = []; this._plainLyrics = '';
    this._trackKey = ''; this._artKey = ''; this._artUrl = ''; this._artText = ''; this._fetchKey = ''; this._raf = null; this._lastActive = -1; this._translateY = 0;
  }
  setConfig(config) {
    if (!config?.entity) throw new Error('Please define an entity.');
    this._config = {...SyncedLyricsCard.getStubConfig(), ...config};
    this._render();
  }
  set hass(hass) { this._hass = hass; this._update(); }
  getCardSize() { return 6; }
  connectedCallback() { this._tick(); }
  disconnectedCallback() { cancelAnimationFrame(this._raf); }
  _state() { return this._hass?.states?.[this._config?.entity]; }
  _trackFromState(s) {
    if (!s) return null;
    const a = s.attributes || {};
    const title = a.media_title || ''; const artist = a.media_artist || '';
    if (!title || !artist) return null;
    return {title, artist, album: a.media_album_name || '', duration: Math.round(Number(a.media_duration) || 0), id: a.media_content_id || `${artist}|${title}|${a.media_album_name || ''}`};
  }
  _update() {
    const s = this._state(), track = this._trackFromState(s);
    const key = track ? track.id : '';
    if (key !== this._trackKey) { this._trackKey = key; this._lyrics = []; this._plainLyrics = ''; this._lastActive = -1; this._translateY = 0; this._render(); if (track) this._loadLyrics(track); }
    const artUrl = s?.attributes?.entity_picture || '';
    if (artUrl !== this._artKey) { this._artKey = artUrl; this._artUrl = artUrl; this._analyseArtwork(artUrl); }
    this._paint();
  }
  async _analyseArtwork(url) {
    this._artText = '';
    if (!url || this._config?.background_mode !== 'artwork' || this._config?.text_color_mode === 'theme') { this._render(); return; }
    try {
      const image = new Image(); image.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', {willReadFrequently:true}); ctx.drawImage(image, 0, 0, 1, 1);
      const [r,g,b] = ctx.getImageData(0,0,1,1).data;
      const lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
      this._artText = lum > 0.55 ? '#111111' : '#ffffff';
    } catch (_) { this._artText = ''; }
    this._render(); this._paint();
  }
  _cacheKey(track) { return `synced-lyrics-card:v1:${track.id}`; }
  _readCache(track) {
    try { const saved = JSON.parse(localStorage.getItem(this._cacheKey(track)) || 'null'); return saved && Date.now() - saved.saved < 2592000000 ? saved.data : null; } catch (_) { return null; }
  }
  _writeCache(track, data) {
    try { localStorage.setItem(this._cacheKey(track), JSON.stringify({saved: Date.now(), data})); } catch (_) {}
  }
  _applyLyrics(data) { this._lyrics = this._parseLrc(data?.syncedLyrics || ''); this._plainLyrics = data?.plainLyrics || ''; }
  async _loadLyrics(track) {
    const requestKey = this._trackKey;
    this._fetchKey = requestKey;
    const cached = this._readCache(track);
    if (cached) { this._applyLyrics(cached); this._render(); this._paint(); return; }
    const params = new URLSearchParams({track_name: track.title, artist_name: track.artist});
    if (track.album) params.set('album_name', track.album);
    if (track.duration) params.set('duration', String(track.duration));
    let data = null;
    try {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 7000);
      let res = await fetch(`https://lrclib.net/api/get?${params}`, {headers: {'Accept': 'application/json'}, signal: controller.signal});
      if (res.ok) data = await res.json();
      if (!data?.syncedLyrics && !data?.plainLyrics) {
        const q = new URLSearchParams({track_name: track.title, artist_name: track.artist});
        res = await fetch(`https://lrclib.net/api/search?${q}`, {headers: {'Accept': 'application/json'}, signal: controller.signal});
        if (res.ok) { const results = await res.json(); data = results.find(x => x.syncedLyrics) || results[0] || null; }
      }
      clearTimeout(timeout);
    } catch (err) { console.warn('synced-lyrics-card: LRCLIB request failed', err); }
    if (this._trackKey !== requestKey) return;
    this._applyLyrics(data); if (data?.syncedLyrics || data?.plainLyrics) this._writeCache(track, data);
    this._render(); this._paint();
  }
  _parseLrc(text) {
    const entries = [];
    for (const raw of String(text).replace(/\r/g, '').split('\n')) {
      const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const line = raw.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();
      for (const tag of tags) { const frac = tag[3] ? Number(`0.${tag[3].padEnd(3,'0').slice(0,3)}`) : 0; entries.push({time: Number(tag[1]) * 60 + Number(tag[2]) + frac, text: line}); }
    }
    return entries.sort((a,b) => a.time - b.time);
  }
  _position() {
    const s = this._state(); if (!s) return Number(this._config?.sync_offset || 0);
    const a = s.attributes || {}; let pos = Number(a.media_position) || 0;
    if (s.state === 'playing' && a.media_position_updated_at) { const at = Date.parse(a.media_position_updated_at); if (!Number.isNaN(at)) pos += Math.max(0, (Date.now() - at) / 1000); }
    return pos + (Number(this._config?.sync_offset) || 0);
  }
  _activeIndex(pos) { let found = -1; for (let i=0;i<this._lyrics.length;i++) { if (this._lyrics[i].time <= pos) found=i; else break; } return found; }
  _tick() { this._paint(); this._raf = requestAnimationFrame(() => this._tick()); }
  _render() {
    if (!this._config) return;
    const c = this._config, s = this._state(), track = this._trackFromState(s);
    const useArt = c.background_mode === 'artwork' && this._artUrl;
    const textColor = c.text_color_mode === 'light' ? '#ffffff' : c.text_color_mode === 'dark' ? '#111111' : c.text_color_mode === 'auto' && useArt ? (this._artText || 'var(--primary-text-color)') : 'var(--primary-text-color)';
    const layout = c.layout || 'focus';
    const content = !track ? `<div class="empty">Select a track to display lyrics</div>` : this._lyrics.length ? `<div class="lyrics ${layout}" id="lyrics">${this._lyrics.map((l,i)=>`<div class="line${l.text ? '' : ' blank'}" data-index="${i}">${this._escape(l.text || ' ')}</div>`).join('')}</div>` : this._plainLyrics ? `<pre class="plain">${this._escape(this._plainLyrics)}</pre>` : `<div class="empty" id="loading">Loading lyrics for<br><b>${this._escape(track.title)}</b><small>${this._escape(track.artist)}</small></div>`;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block} ha-card{height:${this._css(c.card_height)};box-sizing:border-box;overflow:hidden;background:${useArt ? 'transparent' : `color-mix(in srgb, ${this._css(c.background || 'var(--ha-card-background, var(--card-background-color, #1c1c1e))')} ${Math.max(0, Math.min(1, Number(c.background_opacity ?? 1))) * 100}%, transparent)`};color:${textColor};position:relative;isolation:isolate}ha-card::before{content:'';position:absolute;inset:-${useArt ? Math.max(0, Number(c.artwork_blur ?? 12)) * 2 : 0}px;z-index:-2;background-image:${useArt ? `url('${this._css(this._artUrl).replace(/'/g, '%27')}')` : 'none'};background-size:cover;background-position:center;filter:${useArt ? `blur(${Math.max(0, Number(c.artwork_blur ?? 12))}px)` : 'none'};opacity:${useArt ? Math.max(0, Math.min(1, Number(c.artwork_opacity ?? 1))) : 0}}ha-card::after{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background:${useArt ? `rgba(0,0,0,${Math.max(0, Math.min(.9, Number(c.artwork_overlay_opacity ?? .35)))})` : 'transparent'}} .wrap{height:100%;overflow:hidden;display:flex;flex-direction:column}.meta{padding:14px 18px 0;text-align:${this._css(c.alignment)};font:500 13px system-ui;color:color-mix(in srgb, currentColor 72%, transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta span{margin-left:6px}.viewport{position:relative;flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center}.lyrics{position:absolute;top:0;left:0;width:100%;padding:0 8%;box-sizing:border-box;transition:transform .38s cubic-bezier(.2,.8,.2,1);will-change:transform}.line{font-family:${this._css(c.font_family)};font-size:${Number(c.font_size)||42}px;font-weight:${Number(c.font_weight)||700};line-height:1.25;text-align:${this._css(c.alignment)};opacity:${Number(c.inactive_opacity) ?? .32};transform:scale(1);transition:opacity .25s,transform .25s,filter .25s;transform-origin:${c.alignment === 'left' ? 'left' : c.alignment === 'right' ? 'right' : 'center'};padding:7px 0;word-break:break-word}.line.blank{height:1.25em}.line.active{opacity:1;transform:scale(${Number(c.active_scale)||1.16});filter:drop-shadow(0 1px 12px color-mix(in srgb, var(--primary-text-color) 25%, transparent))}.compact .line,.two_line .line{display:none}.compact .line.active{display:block}.two_line .line.active,.two_line .line.next{display:block}.minimal .line:not(.active){display:none}.minimal{padding:0 8%}.karaoke .line{padding:10px 0}.plain{width:100%;height:100%;overflow:auto;box-sizing:border-box;margin:0;padding:22px;white-space:pre-wrap;font-family:${this._css(c.font_family)};font-size:${Number(c.font_size)*.6||24}px;line-height:1.55;text-align:${this._css(c.alignment)}}.empty{text-align:${this._css(c.alignment)};line-height:1.55;color:var(--secondary-text-color);font:400 17px system-ui}.empty b{color:var(--primary-text-color);font-weight:600}.empty small{display:block;font-size:13px}.status{position:absolute;right:10px;bottom:8px;font:11px system-ui;color:var(--disabled-text-color)}
      .viewport::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background:${c.contrast_mode === 'adaptive' ? `rgba(0,0,0,${Math.max(0, Math.min(.8, Number(c.backdrop_opacity ?? .18)))})` : 'transparent'};backdrop-filter:${c.contrast_mode === 'adaptive' ? `blur(${Math.max(0, Number(c.backdrop_blur ?? 8))}px) brightness(75%)` : 'none'};-webkit-backdrop-filter:${c.contrast_mode === 'adaptive' ? `blur(${Math.max(0, Number(c.backdrop_blur ?? 8))}px) brightness(75%)` : 'none'}}
      .lyrics,.plain,.empty{position:relative;z-index:1}.line{text-shadow:${c.text_shadow !== false ? `0 1px 2px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75)))}), 0 0 10px rgba(0,0,0,${Math.max(0, Math.min(1, Number(c.text_shadow_strength ?? .75))) * .6})` : 'none'}}
    </style><ha-card><div class="wrap">${c.show_track_info !== false ? `<div class="meta">${track ? this._escape(track.title) + `<span>— ${this._escape(track.artist)}</span>` : 'Synced Lyrics'}</div>` : ''}<div class="viewport">${content}</div><div class="status">${this._lyrics.length ? 'LRCLIB synced' : this._plainLyrics ? 'LRCLIB lyrics' : ''}</div></div></ha-card>`;
  }
  _paint() {
    if (!this._lyrics.length || !this.shadowRoot) return;
    const index = this._activeIndex(this._position()); if (index === this._lastActive) return; this._lastActive = index;
    const root = this.shadowRoot.querySelector('#lyrics'); if (!root) return;
    const lines = [...root.querySelectorAll('.line')]; lines.forEach((el,i) => { el.classList.toggle('active', i===index); el.classList.toggle('next', i===index+1); });
    const active = lines[index]; const layout = this._config.layout;
    if (active && !['compact','two_line','minimal'].includes(layout)) {
      const viewport = this.shadowRoot.querySelector('.viewport');
      // The lyric sheet is absolutely positioned at the viewport top, so this is
      // a stable coordinate: each line moves only by its own line-height.
      this._translateY = Math.round(viewport.clientHeight / 2 - active.offsetTop - active.offsetHeight / 2);
      root.style.transform = `translateY(${this._translateY}px)`;
    }
  }
  _escape(value) { const d=document.createElement('div'); d.textContent=String(value); return d.innerHTML; }
  _css(value) { return String(value ?? '').replace(/[<>{};]/g, ''); }
}

class SyncedLyricsCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = null; this._hass = null; this._form = null;
    this._schema = [
      {name: 'entity', selector: {entity: {domain: 'media_player'}}},
      {name: 'layout', selector: {select: {mode: 'dropdown', options: [
        {label:'Focus — scrolling lyrics', value:'focus'}, {label:'Karaoke — scrolling lyrics', value:'karaoke'},
        {label:'Compact — active line only', value:'compact'}, {label:'Two line — active and next', value:'two_line'},
        {label:'Minimal — active line only', value:'minimal'}]}}},
      {name: 'alignment', selector: {select: {mode:'dropdown', options: [
        {label:'Left',value:'left'}, {label:'Centre',value:'center'}, {label:'Right',value:'right'}]}}},
      {name: 'font_family', selector: {select: {mode:'dropdown', custom_value:true, options: [
        {label:'System UI',value:'system-ui'}, {label:'Roboto',value:'Roboto, sans-serif'}, {label:'Inter',value:'Inter, sans-serif'},
        {label:'Montserrat',value:'Montserrat, sans-serif'}, {label:'Poppins',value:'Poppins, sans-serif'}, {label:'Serif',value:'serif'}, {label:'Monospace',value:'monospace'}]}}},
      {name: 'font_size', selector: {number: {min:12, max:120, step:1, mode:'box'}}},
      {name: 'font_weight', selector: {number: {min:100, max:900, step:100, mode:'box'}}},
      {name: 'card_height', selector: {text: {}}},
      {name: 'inactive_opacity', selector: {number: {min:0, max:1, step:0.05, mode:'box'}}},
      {name: 'active_scale', selector: {number: {min:1, max:2, step:0.01, mode:'box'}}},
      {name: 'background_opacity', selector: {number: {min:0, max:1, step:0.01, mode:'box'}}},
      {name: 'background_mode', selector: {select: {mode:'dropdown', options: [{label:'Home Assistant theme',value:'theme'}, {label:'Album artwork',value:'artwork'}]}}},
      {name: 'artwork_blur', selector: {number: {min:0, max:40, step:1, mode:'box', unit_of_measurement:'px'}}},
      {name: 'artwork_opacity', selector: {number: {min:0, max:1, step:0.01, mode:'box'}}},
      {name: 'artwork_overlay_opacity', selector: {number: {min:0, max:0.9, step:0.01, mode:'box'}}},
      {name: 'text_color_mode', selector: {select: {mode:'dropdown', options: [{label:'Auto contrast from artwork',value:'auto'}, {label:'Home Assistant theme',value:'theme'}, {label:'Always light',value:'light'}, {label:'Always dark',value:'dark'}]}}},
      {name: 'contrast_mode', selector: {select: {mode:'dropdown', options: [{label:'Adaptive contrast (recommended)',value:'adaptive'}, {label:'Off',value:'off'}]}}},
      {name: 'backdrop_blur', selector: {number: {min:0, max:30, step:1, mode:'box', unit_of_measurement:'px'}}},
      {name: 'backdrop_opacity', selector: {number: {min:0, max:0.8, step:0.01, mode:'box'}}},
      {name: 'text_shadow', selector: {boolean: {}}},
      {name: 'text_shadow_strength', selector: {number: {min:0, max:1, step:0.05, mode:'box'}}},
      {name: 'sync_offset', selector: {number: {min:-10, max:10, step:0.01, mode:'box', unit_of_measurement:'s'}}},
      {name: 'show_track_info', selector: {boolean: {}}},
      {name: 'show_previous', selector: {boolean: {}}},
      {name: 'show_upcoming', selector: {boolean: {}}},
    ];
  }
  setConfig(config) { this._config = {...SyncedLyricsCard.getStubConfig(), ...config}; this._ensureForm(); this._sync(); }
  set hass(hass) { this._hass = hass; this._ensureForm(); this._sync(); }
  _ensureForm() {
    if (this._form) return;
    this._form = document.createElement('ha-form');
    this._form.style.display = 'block'; this._form.style.padding = '8px 4px';
    this._form.computeLabel = (schema) => ({
      entity: 'Media player', layout: 'Layout', alignment: 'Text alignment', font_family: 'Font family',
      font_size: 'Font size (px)', font_weight: 'Font weight', card_height: 'Card height (e.g. 560px)',
      inactive_opacity: 'Inactive lyric opacity', active_scale: 'Active lyric scale', background_opacity: 'Background opacity', background_mode: 'Background source', artwork_blur: 'Album artwork blur', artwork_opacity: 'Album artwork opacity', artwork_overlay_opacity: 'Album artwork dark overlay', text_color_mode: 'Lyric colour', contrast_mode: 'Contrast mode', backdrop_blur: 'Background blur', backdrop_opacity: 'Contrast overlay opacity', text_shadow: 'Text drop shadows', text_shadow_strength: 'Text shadow strength', sync_offset: 'Sync offset (seconds; + advances lyrics, - delays)',
      show_track_info: 'Show track title and artist', show_previous: 'Show previous lyrics', show_upcoming: 'Show upcoming lyrics'
    })[schema.name] || schema.name;
    this._form.addEventListener('value-changed', (ev) => {
      ev.stopPropagation();
      const config = {...this._config, ...(ev.detail?.value || {})};
      this._config = config;
      this.dispatchEvent(new CustomEvent('config-changed', {detail:{config}, bubbles:true, composed:true}));
    });
    this.appendChild(this._form);
  }
  _sync() {
    if (!this._form) return;
    this._form.hass = this._hass;
    this._form.schema = this._schema;
    this._form.data = this._config || {};
  }
}
customElements.define('synced-lyrics-card', SyncedLyricsCard);
customElements.define('synced-lyrics-card-editor', SyncedLyricsCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({type:'synced-lyrics-card', name:'Synced Lyrics Card', description:'Synchronized LRCLIB lyrics for a media player.', preview:true, documentationURL:'https://lrclib.net/docs'});
