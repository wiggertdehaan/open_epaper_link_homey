# OpenEPaperLink for Homey Pro

Show content on e-paper price tags from Homey flows, and use the tags' sensors, LEDs and buttons in Homey.

The app talks to an [OpenEPaperLink](https://github.com/OpenEPaperLink/OpenEPaperLink) access point (AP) on your local network. The AP manages the tags; the app tells it what to show and reads back what the tags report.

## Requirements

- A Homey Pro with firmware 12.4.0 or later.
- An OpenEPaperLink access point on the same network as Homey, with your tags already registered to it.

## Getting started

1. Install the app and open its settings.
2. Enter the IP address of your AP, or press **Search my network for the AP** to find it. Press **Save changes**.
3. Add devices:
   - **OpenEPaperLink Tag** lists every tag the AP knows, with its model, battery and when it was last seen. Pick the ones you want.
   - **OpenEPaperLink Access Point** is optional and adds the AP itself as a device.

Tags check in on their own schedule and sleep in between. What you send to a tag appears at its next check-in, which can take a while depending on how the AP is configured.

## Devices

### Tags

Each tag shows:

- its temperature, battery voltage and a low battery alarm;
- a preview of what it is currently showing, on the device tile.

Tag settings:

| Setting | What it does |
|---|---|
| Temperature offset | Added to the reported temperature. The sensor sits behind the panel, so tags next to each other can read several degrees apart. |
| Render the tag image in Homey | Turn off if you don't need the preview. Decoding the image costs CPU on every update. |
| MAC address, Last seen | Read-only. Last seen is refreshed at most every 10 minutes. |

Tags with an LED or buttons get the matching flow cards automatically.

The older per-model drivers (Solum 1.54", 2.9" and 4.2", Newton M3 2.9", M2 2.9" UC8151, M2 7.4") are deprecated. Devices added with them keep working, but new tags are added with **OpenEPaperLink Tag**, which supports every tag type the AP knows.

### Access point

Shows the AP's Wi-Fi signal, the number of tags it knows, its uptime (hours) and free memory (kB). Firmware, board, protocol version and Wi-Fi network are in the device settings. Values update about once a minute, and straight away when the tag count changes or the AP restarts.

## Flow cards

### Actions

Most of these switch a tag to one of the AP's built-in [content cards](https://github.com/OpenEPaperLink/OpenEPaperLink/wiki/Content-cards). Not every content card suits every tag: small tags have no room for a five-day forecast, for example.

| Card | What it shows |
|---|---|
| Display current date | Today's date. |
| Display days counter / Display hours counter | A counter starting at the number you give. It turns red above the threshold. |
| Display current weather | Current weather for a city, in metric or imperial units. Data by Open-Meteo. |
| Display weather forecast | The forecast for the next five days. |
| Display rain prediction (Buienradar) | Rain for the next two hours. Netherlands and Belgium only. |
| Display an image | An image from a URL, fetched again every 3 to 180 minutes as you choose. The image should be a non-progressive JPEG at the tag's exact resolution. |
| Display QR code | A full-screen QR code with a title. |
| Display 3 lines of text | A title plus three label and value pairs, laid out for 2.9" tags. |
| (Advanced) Display JSON template | Your own drawing commands, in the AP's [JSON template](https://github.com/OpenEPaperLink/OpenEPaperLink/wiki/Json-template) format. |
| (Advanced) Display your remote JSON template | The same, fetched from a URL you host (up to 2 MB). |
| Flash the LED | Flashes the tag's LED in a colour, a number of times per interval, for a number of minutes. A duration of 0 switches it off. See [LED control](https://github.com/OpenEPaperLink/OpenEPaperLink/wiki/Led-control). |

**Display an RSS Feed** is switched off for now, because many RSS feeds made the AP unstable. The card is still listed, but running it fails.

If a card can't do its job, it fails with a message saying why, so you can handle that in the flow. For example: the AP is unreachable, it doesn't know the tag, or a JSON template is invalid.

### Triggers

| Card | When it fires | Token |
|---|---|---|
| A button on the tag was pressed | A tag with buttons woke up because a button was pressed. | Button number (1–3) |
| A tag stopped checking in | The AP hasn't heard from a tag well past its expected check-in. It waits at least 15 minutes, or half the tag's own interval if that is longer, and fires once per silence. | Minutes overdue |

## Troubleshooting

- **Nothing updates.** Check the address in the app settings. If the AP goes away, the app reconnects on its own, waiting up to 5 minutes between attempts.
- **Homey feels busy.** Turn off **Render the tag image in Homey** on the tags whose preview you don't need.
- **Leftover images.** The **Storage** section of the app settings shows the stored tag images and can remove ones that no device uses any more. This also happens automatically once a day.

## Development

```sh
npm ci
npm run lint
npm test          # every check in scripts/ that runs without an AP
homey app run     # run the app on your Homey, with its log in the terminal
```

`npm test` runs `scripts/check-app-json.js` and every `scripts/verify-*.js`, except `verify-decoder.js`, which needs a live AP. A few scripts also take an address to run against real hardware; see the header of each script. GitHub Actions runs lint and tests on every push.

`app.json` is generated from `.homeycompose/` and the drivers' `*.compose.json` files. Edit those, then run `homey app build`. `npm test` fails if the two disagree.

## Credits

Built on the [OpenEPaperLink](https://github.com/OpenEPaperLink/OpenEPaperLink) project. App by Wiggert de Haan, licensed under the GPL-3.0; see [LICENSE](LICENSE).
