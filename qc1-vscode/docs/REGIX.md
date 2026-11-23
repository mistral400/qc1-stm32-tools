# REGIX v0.1.0

REGIX (Register Engineering & Generation Engine) is an offline TypeScript engine integrated into QC1. Its engine has its own version (`0.1.0`), separate from the QC1 extension version. Register calculations, explanations and generated C do not call an AI service.

## Architecture

- `src/regix/bitMath.ts`, `access.ts` and `catalog.ts` are the VS Code independent engine: unsigned 32-bit arithmetic, fields and masks, conversions, addresses and access checks.
- `src/regix/database/stm32f103.json` is the versioned STM32F103 register/device dataset. Its JSON Schema is `regix-database.schema.json` (`schemaVersion` `1.0.0`). The board-profile catalog and schema are separate; v0.1.0 has no confirmed board profile.
- `src/regix/recipes/gpio-output.json` and `gpioConfiguration.ts` define the supported GPIO configuration recipe. The recipe has its own version and schema.
- `src/regix/generator.ts` emits bare-metal pointer code or CMSIS code, optionally as a snippet or `.h/.c` pair.
- `src/regix/ui/regixView.ts`, the QC1 dashboard WebView bridge and `extension.ts` integrate REGIX into VS Code. WebView messages contain validated catalog IDs and values; the extension resolves catalog entries and regenerates code itself.

No dynamic data download is used. No course project is scanned to infer a REGIX model or a physical board.

## Target models and provenance

The default software selection is **STM32F103CBT6**, matching the course notes. The nearby **STM32F103C8T6** remains a distinct model. Their reference memory sizes differ (128 KiB and 64 KiB Flash respectively), while both use Cortex-M3 and the CMSIS device class `STM32F103xB`. The user can select either model; this is not physical detection. The TEP kit name does not identify an exact MCU or board pinout.

Register facts are transcribed from ST RM0008 revision 21. Device and package facts come from ST DS5319 revision 20. CMSIS naming is checked against ST `cmsis-device-f1` v4.3.3. Each source record in the JSON keeps a direct URL, document revision and license/provenance note. REGIX does not bundle CMSIS headers or ST PDFs. The ST reference documents retain their own terms; the database does not claim a broad redistribution license for them.

The included LQFP48 pin map is based on DS5319. PC13 maps to physical package pin 2. PC13, PC14 and PC15 share the datasheet limits of 2 MHz output speed and 30 pF maximum load. Their power switch can sink only 3 mA; these pins must not be used as a current source (for example, to drive an LED). This does not identify a board LED or wiring. Pins whose default function is JTAG/SWD are refused by the v0.1 GPIO generator because it does not change AFIO_MAPR. PD0/PD1 are also refused because their GPIO use requires `AFIO_MAPR.PD01_REMAP`, which REGIX does not configure. Oscillator-function pins show a warning that depends on board use.

## Implemented in v0.1.0

- RCC `APB2ENR`, including GPIOA through GPIOE clock-enable fields.
- GPIOA–GPIOE register templates for `CRL`, `CRH`, `IDR`, `ODR`, `BSRR` and `BRR`, with access and side-effect metadata.
- Field offsets, widths and masks; address plus offset calculations; binary, decimal and hexadecimal parsing/formatting; AND, OR, XOR, NOT and bit extraction.
- Register access validation distinguishes RO, RW and WO, blocks writes to RO registers, blocks reads from WO registers, and rejects read-modify-write for side-effecting or non-normal registers.
- GPIO pin setup for the package pins present in the STM32F103x8/xB LQFP48 data, using CRL or CRH. Recipes cover analog/floating/pull input and basic push-pull/open-drain output modes. PC13 output rates above 2 MHz are rejected.
- Deterministic C generation in bare-metal and CMSIS modes. Generated code enables the GPIO clock, performs the APB2ENR readback before GPIO access, prepares ODR when selecting an input pull-up/down, and changes only the selected CRL/CRH nibble.
- Comment level/language, numeric display, explanation, prefixes, `#define`/typed constants, output format, simple/expert display and preview settings are stored under `qc1.regix.*`.

## Opening and using it

1. Run **QC1 STM32: REGIX: Ouvrir l’explorateur de registres** from the Command Palette, or select the **REGIX / Registres** tab in the QC1 dashboard.
2. Select a register to inspect its address, offset, access type, fields and masks.
3. Choose a package pin and GPIO mode. The default example is PC13 push-pull at 2 MHz.
4. Choose generation preferences and press **Prévisualiser le code**. The generated values and C are shown before an open/copy action.
5. Open an excerpt or the `.h/.c` pair in unsaved C editor tabs, or copy the selected preview. REGIX does not write generated files into the active workspace. Saving an unsaved editor tab is a separate user action.
6. Enable **Mode expert** for the generic bit calculator.

CMSIS output includes `stm32f1xx.h` and expects a compatible CMSIS Device F1 package in the consumer project's include path. The project must define `STM32F103xB` (for example with the compiler option `-DSTM32F103xB`); generated CMSIS files fail compilation if this define is absent or another CMSIS device class conflicts. Bare-metal output uses typed `volatile uint32_t` register pointers. Generated C is an educational starting point; verify the selected chip, board routing, alternate functions, electrical limits and project toolchain before use.

## Boundaries

This version does not configure complete RCC clock trees or peripherals beyond the GPIO clock-enable bit. AFIO, EXTI, timers, SysTick, ADC, I2C, USART and SPI are extension points, not completed generators. It does not access live registers, probe a board, detect the fitted package, infer a board profile, flash firmware or modify an existing source file. A laboratory's submission rules take precedence: generated output is kept in a separate preview or unsaved editor tab.

## Validation

The automated tests cover catalog values and invariants, masks, GPIOC PC13 configuration, PC13-PC15 limits, PD0/PD1 remap blocking, RCC enable and readback order, number conversions, register access rules, both C generation modes, multi-header compilation and CMSIS target conflict detection. C compilation is skipped only when no local compiler is available. WebView bridge validation and dashboard integration are also covered. Run `npm run typecheck`, `npm run lint` and `npm test` from the extension repository.
