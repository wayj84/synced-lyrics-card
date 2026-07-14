# Synced Lyrics Card

A lightweight Home Assistant Lovelace card that displays synchronised lyrics from [LRCLIB](https://lrclib.net/) for any `media_player` entity.

The card automatically reads the currently playing track’s title, artist, album, duration, and playback position. It fetches synced LRC lyrics, keeps the active line aligned with playback, caches songs locally for faster repeat loading, and lets you correct timing when lyrics are slightly ahead or behind.

> This is a frontend-only custom card. It does not require Music Assistant, a Home Assistant integration, an API key, or any backend configuration.

---

## Features

- Displays synchronised LRCLIB lyrics for any Home Assistant media player
- Works well with the native Spotify integration
- Uses `media_position` and `media_position_updated_at` for smooth playback tracking between Home Assistant updates
- LRCLIB exact-track lookup with search fallback
- Local browser cache for previously loaded lyrics
- Configurable sync offset in seconds, adjustable in 0.01-second increments
- Five display layouts: focus, karaoke, compact, two-line, and minimal
- Configurable font, font size, font weight, text alignment, lyric opacity, and active-line scale
- Optional track title and artist header
- Falls back to plain, scrollable lyrics if synchronised lyrics are unavailable
- Native Home Assistant visual configuration editor
- No API key required

---

## Screenshots

```text
(https://github.com/wayj84/synced-lyrics-card/blob/main/Screenshot1.png)
```

---

## Installation

### HACS

1. Open **HACS** in Home Assistant.
2. Select **Frontend**.
3. Select the three-dot menu in the top-right corner.
4. Choose **Custom repositories**.
5. Add this repository URL.
6. Select **Dashboard** as the category.
7. Install **Synced Lyrics Card**.
8. Reload your Home Assistant dashboard.

After installation, add the card through the dashboard card picker or use the YAML examples below.

### Manual installation

1. Download `synced-lyrics-card.js` from the [latest release](../../releases/latest).
2. Copy the file to:

   ```text
   /config/www/synced-lyrics-card.js
   ```

3. In Home Assistant, go to:

   ```text
   Settings → Dashboards → ⋮ → Resources
   ```

4. Add a resource:

   ```text
   URL: /local/synced-lyrics-card.js
   Type: JavaScript Module
   ```

5. Hard-refresh your browser:

   ```text
   Ctrl + Shift + R
   ```

---

## Basic configuration

```yaml
type: custom:synced-lyrics-card
entity: media_player.spotify_w
```

Replace `media_player.spotify_w` with the media-player entity you use for playback.

The selected player needs to expose track metadata such as `media_title` and `media_artist`. For reliable synced lyrics, `media_duration`, `media_position`, and `media_position_updated_at` should also be available.

---

## Full configuration example

```yaml
type: custom:synced-lyrics-card
entity: media_player.spotify_w

layout: focus
alignment: center

font_family: Montserrat, sans-serif
font_size: 42
font_weight: 700

card_height: 560px

show_track_info: true
show_previous: true
show_upcoming: true

inactive_opacity: 0.32
active_scale: 1.16

sync_offset: 0.00
```

---

## Configuration options

| Option | Type | Default | Description |
|---|---:|---:|---|
| `entity` | string | Required | The `media_player` entity used for current playback metadata and position |
| `layout` | string | `focus` | Lyric display layout |
| `alignment` | string | `center` | Text alignment: `left`, `center`, or `right` |
| `font_family` | string | `system-ui` | CSS font family or font stack |
| `font_size` | number | `42` | Lyric font size in pixels |
| `font_weight` | number | `700` | Font weight, normally 100 to 900 |
| `card_height` | string | `560px` | CSS height for the card, for example `420px`, `65vh`, or `100%` |
| `show_track_info` | boolean | `true` | Show the current track title and artist above the lyrics |
| `show_previous` | boolean | `true` | Reserved display preference for previous lyric lines |
| `show_upcoming` | boolean | `true` | Reserved display preference for upcoming lyric lines |
| `inactive_opacity` | number | `0.32` | Opacity of inactive lyric lines, from `0` to `1` |
| `active_scale` | number | `1.16` | Scale multiplier for the active lyric line |
| `sync_offset` | number | `0.00` | Playback adjustment in seconds; use positive values to advance lyrics and negative values to delay them |

---

## Layouts

### `focus`

The default layout. Previous and upcoming lyrics scroll around a prominent active line.

```yaml
layout: focus
```

### `karaoke`

A more spacious scrolling lyric-sheet layout.

```yaml
layout: karaoke
```

### `compact`

Shows only the active lyric line. Ideal for small cards or overlays.

```yaml
layout: compact
```

### `two_line`

Shows the active lyric line and the next line.

```yaml
layout: two_line
```

### `minimal`

Shows only the current active line, with minimal visual distraction.

```yaml
layout: minimal
show_track_info: false
```

---

## Sync adjustment

Lyric timing can vary between releases, albums, remasters, and LRCLIB submissions. Use `sync_offset` to correct a song that appears slightly early or late.

```yaml
sync_offset: 0.00
```

Examples:

```yaml
# Lyrics are late and need to appear earlier
sync_offset: 0.50
```

```yaml
# Lyrics are early and need to appear later
sync_offset: -0.25
```

| Value | Result |
|---:|---|
| `0.25` | Advance lyrics by 0.25 seconds |
| `0.50` | Advance lyrics by 0.50 seconds |
| `-0.25` | Delay lyrics by 0.25 seconds |
| `-0.50` | Delay lyrics by 0.50 seconds |

The visual editor exposes this setting as a number input with 0.01-second precision.

---

## Spotify example

```yaml
type: custom:synced-lyrics-card
entity: media_player.spotify_w

layout: focus
alignment: center

font_family: Inter, sans-serif
font_size: 38
font_weight: 700

card_height: 500px
show_track_info: false

inactive_opacity: 0.25
active_scale: 1.12

sync_offset: 0.00
```

The Home Assistant Spotify media player generally provides all relevant metadata:

```yaml
media_title:
media_artist:
media_album_name:
media_duration:
media_position:
media_position_updated_at:
media_content_id:
```

---

## Lyrics loading and caching

The card looks up lyrics from LRCLIB using:

- Track title
- Artist
- Album
- Duration

It first tries an exact match, then uses a broader LRCLIB search if necessary.

Successful results are saved in your browser’s local storage for 30 days. When you play a previously loaded track again on the same browser/device, lyrics should appear immediately from the local cache.

LRCLIB does not require an account or API key. Its standard lookup expects accurate track metadata, and duration matching is important for finding the correct song version.

---

## Troubleshooting

### The card says “Select a track to display lyrics”

Make sure the selected media player is actively playing a track and exposes both:

```yaml
media_title:
media_artist:
```

### Lyrics do not load

- Check that the media player has accurate title and artist metadata.
- Some tracks may not exist in LRCLIB.
- Some tracks have only plain lyrics and no synced timestamps.
- Check your browser console for network or CORS errors.
- Try playing another song to confirm the card can retrieve lyrics generally.

### Lyrics are out of sync

Adjust `sync_offset`:

```yaml
sync_offset: 0.25
```

Use a positive value when lyrics are behind the music, or a negative value when they are ahead.

### Lyrics load slowly

The first lookup for a new track depends on LRCLIB and your network connection. Once loaded successfully, the card caches that track in your browser for 30 days.

### The card does not update after installing a new version

Home Assistant and browsers can cache JavaScript resources heavily.

- Confirm the updated JS file is in `/config/www/`
- Reload the dashboard resource
- Hard-refresh the browser with `Ctrl + Shift + R`
- If needed, append a version query string to the resource URL:

```text
/local/synced-lyrics-card.js?v=1.0.0
```

---

## Privacy

This card sends current track metadata—title, artist, album, and duration—to LRCLIB to find lyrics.

Lyrics are cached locally in the browser using local storage. No playback data or lyrics are sent to a separate server by this card.

---

## Attribution

Lyrics are provided by [LRCLIB](https://lrclib.net/).

LRCLIB provides a public API with synchronised LRC lyrics and plain lyrics. Its API does not require an API key or registration. [page:1]

This project is not affiliated with Home Assistant, Spotify, or LRCLIB.

---

## Support

If you find a bug or have a feature request, please open a GitHub issue.

When reporting a problem, include:

- Home Assistant version
- Browser and device
- Card configuration
- Media-player entity attributes, with sensitive tokens removed
- Browser-console errors, if present
- Track title and artist where relevant

---

## License

MIT License.

See [LICENSE](LICENSE) for details.
