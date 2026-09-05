# Gridsong

A browser matrix sequencer inspired by the Yamaha TENORI-ON, built by reading its owner's manual and recreating the behaviour it describes.
No build step and no dependencies: open `index.html`, or visit the GitHub Pages deployment.

Gridsong is an independent project. It is not affiliated with, endorsed by, or supported by Yamaha Corporation. TENORI-ON is a trademark of Yamaha Corporation, used here only to identify the instrument that inspired this one. No Yamaha code, samples, artwork or documentation is included.

## What it does

- **16 x 16 LED matrix**, 16 layers, 16 blocks. Layers 1-7 Score, 8-11 Random, 12-13 Draw, 14 Bounce, 15 Push, 16 Solo, exactly as the hardware assigns them.
- **The six performance modes of the original**, including loop points, the travelling light and rotation of Random mode, Draw-mode gesture looping, Bounce balls, Push-mode evolving tones with latch-on-hold, and Solo repeats with the vertical axis as repeat interval (quantized to the score clock when Quantize is on).
- **Function buttons L1-L5 and R1-R5** with LED-matrix setting displays: instrument crosshair, sound length, octave, loop point / rotation, loop speed, layer, tempo, transpose, per-layer volume bars, and block select with the dim / medium / bright copy-layer / copy-block gesture.
- **LCD and jog dial menus**: Play, Layer, Edit (with UNDO), Preference, File, Effect, Interior, System and Recording menus with the manual's parameter ranges and defaults.
- **Nine master scales** (Ionian through Locrian, Chromatic, Okinawa) with the manual's note assignments; transpose -7..+8; octave -5..+5; master tuning.
- **256 voice slots** following the original voice list, synthesized with Web Audio. Layer 7 voices are 16-piece drum kits, one instrument per row. Layer 15 voices evolve over time for Push mode. User1-3 load a WAV/AIFF/MP3 from your computer.
- **Reverb** (HALL, ROOM, STAGE, PLATE) and **chorus / flanger** sends, 32-note polyphony with voice stealing.
- **Light animations** per layer: Simple, Circle, Square, Diamond, Cross, Plus, expand or shrink, with the manual's per-layer defaults.
- **Interior mode**: clock on the matrix with the seconds dot running around the outer LEDs and the once-per-second expanding square, demo song playback, saver timer, power save, hourly time signal and alarm.
- **Song recording and playback**: real-time recording of your button operations, saved as songs and replayed.
- **Files**: browser storage stands in for the SD card (Song, All Blocks, Current Block, Current Layer, All Settings, Samplings). JSON export / import replaces the card reader. Save As Default and Factory Reset behave as described.

## Controls

| Hardware | Here |
| --- | --- |
| LED buttons | Click, tap or drag on the matrix. Multi-touch works for Push and Solo. Short press auditions, holding past Push Sensitivity enters a note. |
| L1-L5 / R1-R5 | Click to latch (click again or CANCEL to release), or hold `Q W E R T` / `Y U I O P`. |
| Jog dial | An up/down scroller: drag it, use the scroll wheel, or the arrow keys. Move it on the status display to open the menu; it also fine-adjusts a held function button. |
| OK / CANCEL / CLEAR | Buttons, or `Enter`/`Space`, `Esc`, `Backspace` (hold to clear all blocks). |
| Mode labels | Jump to the next layer of that mode. |
| Labels | Pulled-out labels with leader lines around the chassis, in the manner of the hardware overview drawing. Shown on screens wider than 1180px; the switch under the device hides them. |
| Light / Dark | Follows the system preference, or `?theme=light` / `?theme=dark` in the URL. The switch under the device stores the choice. |
| Help | Quick guide. |

## Appearance

The chassis follows the original's arrangement: CLEAR at the top, five round function buttons down each side, the jog scroller, display and OK / CANCEL along the bottom. Non-functional hardware (speakers, card slot, connectors) is left off. It is drawn in the Commonplace house style: iA Writer Quattro (self-hosted in `fonts/`, SIL Open Font License), flat black-on-white (or white-on-black) line drawing with no grey fills, and a true light/dark inversion. Blue is the one highlight, for lit LEDs, latched buttons and the label leaders.

The six mode buttons under L1-L5 are not on the hardware; they are shortcuts that jump to the next layer of that mode.

When the page runs inside an iframe (or with `?embed` in the URL) the chassis scales to fit the frame, so an embed of any size shows the whole instrument. `js/panel.js` handles the scaling, the labels and the theme switch.

## Deviations from the original instrument

- Sounds are original Web Audio patches, not samples. Names follow the voice list; timbres are impressions.
- Solo mode repeat intervals double every two rows (with dotted values between) from half a step at the top to 64 steps near the bottom. The manual describes doubling every row, which would leave most of the column silent at usable tempos.
- Random-mode single notes repeat every four steps; with two or more notes the light travels one LED per step, so timing depends on distance as the manual describes.
- MIDI in / out, Master/Slave sync and the SD card are not available in a browser. Import / Export JSON files instead.
- Clock Adjust uses the browser's clock.

## Development

Plain HTML, CSS and JavaScript in `index.html`, `css/` and `js/`. Serve the folder with any static server, for example:

```bash
python3 -m http.server 8080
```

`js/voices.js` holds the voice list, defaults, scales and patch generation. `js/audio.js` is the Web Audio tone generator. `js/engine.js` is the state model, transport and the six modes. `js/menu.js` is the LCD menu and the LED setting displays. `js/ui.js` renders and handles input. `js/panel.js` fits the chassis to the viewport, draws the labels and runs the theme switch.

The GitHub Actions workflow in `.github/workflows/pages.yml` syntax-checks the scripts and deploys the repository root to GitHub Pages on every push to `main`.
