# Avinor Flight Card

A custom Lovelace card for Home Assistant that displays flight information from the Avinor Flight Data integration.

[![GitHub Release][releases-shield]][releases]
[![GitHub Activity][commits-shield]][commits]
[![License][license-shield]](LICENSE)
[![hacs][hacsbadge]][hacs]

![Project Maintenance][maintenance-shield]
[![BuyMeCoffee][buymecoffeebadge]][buymecoffee]

[![Community Forum][forum-shield]][forum]

## Features

- Display flight information in a clean table format
- Real-time data from Avinor flight sensors
- Customizable title and entity selection
- Responsive design for mobile and desktop

## Installation

### HACS (Recommended)

1. Make sure you have [HACS](https://hacs.xyz/) installed
2. Go to HACS -> Frontend
3. Click the "+" button and search for "Avinor Flight Card"
4. Click Install
5. Restart Home Assistant

### Manual Installation

1. Download the `dist/avinor-flight-card.js` file from the [latest release][releases]
  - The file inside the release ZIP has the version string embedded and is recommended
2. Copy it to your `config/www` folder (you may keep it inside a `custom-lovelace` or similar subfolder)
3. Add the following to your `configuration.yaml` (cache-busting with version is recommended):

```yaml
lovelace:
  resources:
    - url: /local/avinor-flight-card.js?v=1.0.0
      type: module
```

4. Restart Home Assistant
5. If you upgrade the card, update the `?v=` query to the new version or clear the browser cache

### Development

If you want to work on the card locally:

```bash
npm install
npm run build
```

The bundled file is written to `dist/avinor-flight-card.js`, which is the artifact consumed by HACS.

## Configuration

Add the card to your Lovelace dashboard:

```yaml
type: custom:avinor-flight-card
entity: sensor.avinor_flight_data
title: "Flight Information"
```

### Configuration Options

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `entity` | string | **Required** | The entity ID of your Avinor flight sensor |
| `title` | string | `"Avinor Flight Data"` | Title displayed on the card |

## Requirements

- Home Assistant 0.115.0 or newer
- [Avinor Flight Data integration](https://github.com/WickedGhost/avinor_flight_data)

## Support

If you encounter any issues or have feature requests, please [open an issue][issues].

---

[avinor-flight-card]: https://github.com/WickedGhost/avinor-flight-card
[buymecoffee]: https://www.buymeacoffee.com/wickedghost
[buymecoffeebadge]: https://img.shields.io/badge/buy%20me%20a%20coffee-donate-yellow.svg?style=for-the-badge
[commits-shield]: https://img.shields.io/github/commit-activity/y/WickedGhost/avinor-flight-card.svg?style=for-the-badge
[commits]: https://github.com/WickedGhost/avinor-flight-card/commits/main
[hacs]: https://github.com/hacs/integration
[hacsbadge]: https://img.shields.io/badge/HACS-Custom-orange.svg?style=for-the-badge
[forum-shield]: https://img.shields.io/badge/community-forum-brightgreen.svg?style=for-the-badge
[forum]: https://community.home-assistant.io/
[license-shield]: https://img.shields.io/github/license/WickedGhost/avinor-flight-card.svg?style=for-the-badge
[maintenance-shield]: https://img.shields.io/badge/maintainer-WickedGhost-blue.svg?style=for-the-badge
[releases-shield]: https://img.shields.io/github/release/WickedGhost/avinor-flight-card.svg?style=for-the-badge
[releases]: https://github.com/WickedGhost/avinor-flight-card/releases
[issues]: https://github.com/WickedGhost/avinor-flight-card/issues
