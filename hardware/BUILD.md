# JARVIS Glasses: Prototype v1 build guide

Low-budget DIY smart glasses that use your Jarvis server as the brain.
The glasses are only **eyes (camera), ears (mic) and a small screen**; your PC does the thinking.

```
 [ Glasses ]  ── Wi-Fi ──►  [ Jarvis server on your PC ]  ──►  Claude (answers, inspect)
  camera                       /api/glass/...                  Groq Whisper (speech → text)
  mic          ◄── text ───
  button
  OLED + mirror → your eye
```

## How it will work

1. Hold the button and talk. Release the button and the glasses send your voice to Jarvis.
2. Jarvis turns the speech into text (Groq Whisper, free), asks Claude, and sends back a short answer.
3. The answer scrolls on the tiny screen, which you see reflected in front of your eye.
4. Double-click the button: the camera takes a photo and the screen shows a short **inspection** summary.
   The full report (with markers) is saved in Jarvis → Reports.

Prototype v1 has **no speaker**. Answers are text in your eye (and Jarvis can also speak them on your phone or PC).
A speaker is an upgrade in step 7.

---

## Step 1: Buy the parts (about $35–45)

| # | Part | What to search for | Approx. price |
|---|---|---|---|
| 1 | **Seeed Studio XIAO ESP32S3 Sense** (camera + mic + Wi-Fi in one tiny board) | "XIAO ESP32S3 Sense" (Seeed store, Amazon, DigiKey, Mouser) | $14–20 |
| 2 | **0.96" OLED display, SSD1306, I2C, 4-pin**, white or blue | "0.96 OLED SSD1306 I2C 128x64" (often 2–5 per pack) | $3–8 |
| 3 | **Push button** (6 mm tactile) | "6x6mm tactile push button" (pack) | $1–3 |
| 4 | **LiPo battery 3.7 V, 300–500 mAh** (small, flat) | "3.7V 400mAh lipo battery" | $5–8 |
| 5 | **Clear acrylic sheet, 1–2 mm** (the "half mirror" reflector) | "clear acrylic sheet 2mm small", or use a clean CD case or glass microscope slide | $0–5 |
| 6 | **Small magnifier lens, about 25–45 mm focal length** (so your eye can focus on a screen that close) | a $2 jeweler's loupe, or a lens from a Google Cardboard-style VR viewer | $2–6 |
| 7 | **Jumper wires** (female–female) + mini breadboard | "dupont jumper wires female female" | $3–6 |
| 8 | **Cheap glasses frame** (sunglasses with the lenses popped out are fine) | dollar store / old pair | $0–5 |
| 9 | **USB-C data cable** (must carry data, not just charge) | | have? |

Tools: hot glue gun, tape or zip ties, and (only for the battery) a cheap soldering iron.
No 3D printer is needed for v1: cardboard, foam board and hot glue work.

> Tip: buy 2 OLEDs. They're cheap and easy to break while you experiment.

---

## Step 2: While parts ship (software, done by Claude)

- Jarvis server: `/api/glass/talk` (audio → Whisper → Claude → short reply) and `/api/glass/look` (photo → inspection summary).
- Firmware for the XIAO (Arduino), compiled and checked before you get the board.
- A test page that pretends to be the glasses, so the server side is proven first.

## Step 3: First power-on (no wiring)

1. Install **Arduino IDE 2**. Add the ESP32 boards (Espressif `esp32` package).
2. Plug the XIAO into USB-C. Select board **XIAO_ESP32S3** and set **PSRAM → "OPI PSRAM"** (the camera needs it).
3. Flash the test firmware: it connects to your Wi-Fi and sends one camera photo to Jarvis.
   Success = the photo shows up on your PC.

## Step 4: Wire the screen and button (4 + 2 wires)

| OLED pin | XIAO pin |
|---|---|
| VCC | **3V3** |
| GND | **GND** |
| SDA | **D4** |
| SCL | **D5** |

| Button leg | XIAO pin |
|---|---|
| one leg | **D1** |
| other leg | **GND** |

Flash the main firmware. The screen should show `J.A.R.V.I.S. ONLINE`.
Hold the button and say "what time is it?". The answer appears on the screen.

## Step 5: The optics (the "Iron Man HUD" trick)

```
        OLED (screen facing DOWN)
        ┌───────────┐
        └───────────┘
             │  light goes down
          (lens)      ← magnifier, between the screen and the acrylic
             │
  world ───► ╲ ───► eye   clear acrylic at 45°: reflects the text into your eye,
                          and you still see the real world straight through it
```

- Mount the OLED **above** the right lens area, screen facing down.
- Put the magnifier lens **just under the screen** (between the screen and the acrylic), so only the
  Jarvis text is magnified and your view of the world stays sharp. Move it up or down until the text is in focus.
- Glue a small piece of clear acrylic below it at **45°**. It reflects the screen into your eye
  while still letting you see through it.
- Reflections are mirror-images, so turn on **mirror mode** in the firmware (one setting).
- Works best with white text on black, and indoors or in shade.

## Step 6: Battery and mount

- Solder the LiPo to the **BAT+ / BAT−** pads on the back of the XIAO (it charges through USB-C).
  Get the polarity right: red = +, black = −. **Never short a LiPo.**
- Put the XIAO + battery on the right arm of the frame (hot glue or zip ties). Point the camera forward.

## Step 7 (upgrade): Speaker

Add a **MAX98357A I2S amplifier + small 8 Ω speaker** (~$5) so Jarvis talks in your ear.
(The ESP32-S3 can't stream audio to Bluetooth earbuds; it only has Bluetooth Low Energy.)

---

## Safety

- Don't use the display while driving or crossing streets.
- LiPo batteries: don't puncture, bend, or charge them unattended. Unplug if one gets hot or puffy.
- Inspection answers are AI estimates from one photo, not a licensed inspection.
