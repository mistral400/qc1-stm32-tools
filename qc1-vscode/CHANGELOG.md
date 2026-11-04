# Changelog

## 0.5.0 - 2026-11-04

- Add read-only ELF section inspection from `arm-none-eabi-objdump -h`, with Flash load estimates, static RAM estimates, `.text`/`.data`/`.bss` details and linker-declared region utilization.
- Keep STM32F1 and each H7 CM7/CM4 image separate; report linker-detected overflow, possible overlaps, map/script differences and unknown capacities without inferring device sizes.
- Remove build-log size heuristics from dashboard build state. Runtime heap/stack usage is not claimed; explicit linker reservations are listed separately.
- Ignore linker maps that differ from the ELF timestamp by more than ten minutes, avoid using linker-script fallback when the script is newer than the ELF, and label the artifact timestamp as provenance evidence only.
- Add bounded, trust-gated, shell-free `objdump` inspection with timeout, output cap, cache, and unavailable/partial states.
- Add parser, mocked-process and dashboard regression tests; document measurement definitions, provenance and physical-proof limits.
- No hardware read, flash, reset, activation smoke, cross-OS run, or visual inspection is part of this change.

## 0.4.7 - 2026-11-04

- Add a Tools-page UART monitor with port discovery, framing controls, ASCII/HEX TX and RX, optional CRLF and timestamps, cancellable connection, bounded display, and explicit log saving.
- Add an opt-in JSON Lines plot protocol, a 1,000-sample ring, pause/resume, clear and CSV export; free-form serial text is never interpreted as chart data.
- Persist up to 200 sanitized operation summaries locally and add manual, curated diagnostic guidance for known conditions.
- Load SerialPort 13 lazily so unsupported native bindings cannot block extension activation; keep project paths, probe serial numbers and UART traffic out of operation history.
- Add mocked serial transport, protocol, cancellation, bounds, timeline and UI regression coverage. Production dependency audit reports no advisories.
- No physical STM32/UART test or cross-OS visual validation was run.

## 0.4.6 - 2026-11-04

- Add a native QC1 Explorer TreeView for the active/recent/detected projects, artifacts, prioritized diagnostics, essential tools, ST-Link and known sessions.
- Add **Ouvrir QC1 Dashboard** to open the complete shared dashboard in an editor tab; route links from the Explorer open the relevant page.
- Reuse the same host-owned DashboardState, Webview renderer, validated message router and bounded terminal buffer across sidebar and editor surfaces.
- Revalidate TreeView project selections against current candidates/recent projects and retain all existing command IDs.
- Add tests for the read-only tree projection, diagnostics ordering, dashboard deep links, manifest contributions and provider refresh behavior.
- Extension Host smoke opened and reopened the editor dashboard. No hardware commands or physical tests were run; visual rendering was not inspected.

## 0.4.5 - 2026-11-04

- Compact the five dashboard routes through 600 px and add labelled, keyboard-operable tab navigation.
- Apply VS Code theme variables, clearer cards and action hierarchy, reduced-motion support, and forced-colors styling.
- Keep build, artifact validation, programming, verification and reset results visible as separate, status-colored rows.
- Group maintenance and dual-core per-core commands under advanced actions; keep single-core flash/debug actions visible and preserve all command IDs.
- Add dashboard UI regression tests for navigation, F1/H7 actions, independent operation states and theme breakpoints.
- Visual checks at multiple widths and on Windows/Linux remain unperformed; no hardware operations are part of this milestone.

## 0.4.4 - 2026-11-04

- Add per-project OpenOCD reset profiles: backend default, SYSRESETREQ, hardware NRST, and connect-under-reset.
- Expose optional SWD adapter speed, NRST pulse width, and delay with strict bounds and numeric-only command generation.
- Keep `st-flash` on its documented backend reset; refuse OpenOCD-only profiles before planning a flash.
- Apply reset configuration to OpenOCD programming and Cortex-Debug launches; preserve default arguments unless a profile is selected.
- Add tests for profile validation, project-key isolation, backend capability rejection, STM32F1/H7 command order, and Webview input validation.
- No hardware validation; NRST wiring and adapter capability remain board-specific.

## 0.4.3 - 2026-11-04

- Track Cortex-Debug sessions, QC1 OpenOCD terminals, and in-flight programming by ST-Link; block conflicting operations without stopping active sessions.
- Distinguish known session ownership from suspected external OpenOCD occupancy on local ports 3333/4444.
- Show known hardware sessions in the Tools page with masked ST-Link identifiers.
- Add mocked tests for probe ownership, unknown probe identity, session release, and local port detection.
- Reset strategy configuration remains the next milestone because NRST support and reset mechanisms depend on backend and board.

## 0.4.2 - 2026-11-04

- Validate the selected ELF against one executable CMake target, active project/build scope and target core, and record its size and SHA-256 evidence.
- Program only a private ELF snapshot whose size and SHA-256 still match the validated build artifact at copy time.
- Refuse stale build-directory BIN fallback; require a fresh `objcopy` image in a unique temporary directory for `st-flash`.
- Verify `st-flash` writes with an independent read and exact byte comparison, then issue a separate reset command.
- Require artifact validation, programming, verification and an accepted reset command before reporting Flash as fully successful; do not claim physical reset or firmware startup.
- Document the `st-flash` v1.8.0 write-side reset behavior and report that its later explicit reset may be a second reset.
- Add regression tests for ELF ownership/snapshot integrity, staged BIN scope, readback comparison, missing `objcopy`, programmer output errors, and stage order.
- Local tests, typecheck, lint, VS Code 1.144.1 activation smoke and VSIX packaging passed. No hardware or remote CI validation was performed.

## 0.4.1 - 2026-11-04

- Track Build, artifact validation, programming, verification, reset, Debug session and firmware execution as separate results.
- Preserve operation results by project while switching projects during the VS Code session.
- Keep a successful build successful when a later Flash or Debug stage fails; stop later pipeline stages when a process fails.
- Detect common CMake, GCC, linker and explicit programmer errors in process output even when a tool returns exit code zero.
- Show Flash as fully successful only when artifact validation, programming, verification and reset are all confirmed; current artifact provenance remains unconfirmed and is reported honestly.
- Add regression coverage for sequential stages, output error detection, project isolation and Flash evidence requirements.
- Package and activation smoke checks passed on macOS arm64 / VS Code 1.144.1. STM32F103/H7 hardware was not tested.

## 0.4.0 - 2026-10-12

- Import CubeIDE STM32H7 dual-core projects without a root CMakeLists.txt; read per-core `.cproject` MCU, FPU, ABI, includes and defines, and keep CM7/CM4 sources, startups and linker scripts separate.
- Recognize STM32H745, H747, H755 and H757 while keeping the source MCU identity distinct from a connected board; resolve local STM32CubeH7 HAL, CMSIS Core, exact CMSIS Device header and optional Nucleo BSP without automatic downloads.
- Build imported CM7 and CM4 images independently with their own CPU/FPU/ABI flags and linker scripts; write a `build-report.json` with configured targets, then replace it with artifact and linker-memory evidence after a successful QC1 build.
- Use Make as the CubeIDE H7 CMake generator when Ninja is unavailable; keep the integrated STM32F1 engine on Ninja and preserve generators chosen by native CMake projects.
- Flash both H7 images in one OpenOCD session, verify each core image, and reset only after both have been programmed.
- Add real GPIO_Demo discovery coverage and a CubeIDE-shaped H745 integration build in a Unicode/space-containing path.
- Build the local official GPIO_Demo project through QC1 against STM32CubeH7 `v1.13.0`, covering both real core images without modifying its source files.
- Tighten dependency checks so HAL configuration headers do not count as the HAL driver, and require the exact CMSIS Device header before an imported CubeIDE build.
- Inventory multiple ST-Link adapters, select a serial explicitly when needed, and remember verified probe routing separately for each project.
- Pass the selected serial to OpenOCD, `st-flash`, and Cortex-Debug; redact complete serials from QC1 logs, including quoted command arguments, and keep a runtime target-family check before flash/debug.
- Reject malformed persisted probe assignments and stop an operation if the project/configuration changes during probe preflight.
- Bundle Cortex-Debug and Embedded Build Tools without a blocking dependency; remove CMake Tools from the pack while retaining its optional diagnostic path setting.
- Replace stale first-run instructions and broken packaged example links with accurate user/developer guides, a compatibility matrix, and Marketplace readiness notes.
- Fix the process result type so unknown spawn errors remain failures, and repair the existing H755 pipeline test syntax.
- Split the dashboard into five project-manager pages and small render/client modules; preserve navigation, terminal output and unsaved settings during host updates.
- Extract discovery, configuration and recent-project controllers; serialize writes and ignore cancelled/obsolete discovery results and errors.
- Make the one active `qc1.projectPath` window-scoped: Workspace for internal/external projects when a workspace exists, User only in an empty window.
- Show validated recent paths (maximum eight), active-project evidence, contextual F1/H755 actions, normalized tools and centralized diagnostics.
- Add opt-in bounded automatic discovery, portable custom roots, lightweight invalidation and scoped structural watchers without polling.
- Keep ST-Link detection manual and unknown until measured; reveal existing ELF/BIN/HEX/MAP outputs without changing builds.
- Escape project content, use a nonce-authorized static WebView script and validate discriminated bridge messages against known commands/paths.
- Fix legacy H755 status validation rejecting manual native CMake projects without local CubeMX HAL/CMSIS/startup folders; retain static warnings and let CMake verify dependencies.
- Add controller, WebView and mocked VS Code integration coverage. See PROJECT_MANAGER.md for architecture and remaining validation limits.
- Upgrade the development-time VS Code packaging tool to `@vscode/vsce` 4.0.0 and update compatible transitive dependencies; the local npm audit reports zero vulnerabilities.
- Add STM32H755/NUCLEO-H755ZI-Q detection with CM7-only, CM4-only and dual-core architecture models.
- Respect CubeMX CMake presets and distinct CM7/CM4 targets, startups, linker scripts and ELF artifacts.
- Add global/core-specific build and flash plus separate Cortex-Debug CM7/CM4 sessions using the STM32H7 OpenOCD target.
- Diagnose H7 HAL, CMSIS, CMSIS Device, optional BSP usage, per-core compiler settings and tool availability.
- Preserve the STM32F1 build, flash and OpenOCD paths and add a single-core debug command.
- Remove stale generated Liix/AI files from the packaged `out` tree; QC1 contains no assistant IA functionality.
- Add bounded, case-aware project discovery, static CMake analysis and existing File API inspection.
- Recognize custom sources/startups, linker MEMORY and ambiguous MCU evidence without blocking native CMake on CubeMX layout assumptions.
- Add diagnostic schema v2 with OS, extension, toolchain, USB/serial, MCU and structured finding sections; redact before JSON serialization.
- Respect multi-root settings and native CMake generators; harden process timeouts, output limits, Tcl/terminal arguments and build concurrency.
- Add ESLint and portability/integration regression tests. See AUDIT_PORTABILITY.md for validation and platform limitations.

## 0.3.1

### Added

- Add a privacy-aware Markdown diagnostic report containing QC1, project, toolchain, hardware, build, VS Code problem, Git and recent log context.
- Preview reports before saving or copying them, with automatic secret and personal-path redaction.
- Add real-time Ninja progress parsing from streamed `[completed/total]` build output.
- Add a multi-step Liix Code Agent controller with structured read, search, diagnostics, edit, terminal, build, test and Git tools.
- Add LM Studio `/v1/models`, OpenAI-compatible conversation history, native `tool_calls`, structured fallback and real SSE streaming.
- Add cancellable spawned processes, inline permissions, edit checkpoints, Undo and last-diff commands.
- Add Liix command-palette actions for new chat, active-file explanation, diagnostic fixes, terminal, Stop, Undo, diff and model refresh.

### Fixed

- Accept native CMake projects using `Src/` and `Inc/` without requiring `Core/` or `Drivers/`.
- Prefer a firmware's own `CMakeLists.txt`; keep the bundled CMake project as the fallback for projects without native CMake.
- Use the same detected STM32F103 startup and linker script during validation and compilation, excluding stale files under `build/`.
- Make HAL and `Drivers/` optional for bare-metal firmware.
- Run `st-info --probe` for status and ST-Link detection.
- Make serial, ST-Link, project auto-detection and baud-rate settings effective.
- Start OpenOCD with the ST-Link and STM32F1 configuration files.
- Report all project diagnostics without blocking `status` at the first issue.
- Avoid logging an external CMake command when validation stopped before execution.
- Reset the target after the `st-flash` fallback writes the firmware.

### Changed

- Redesign the QC1 dashboard around clearer primary actions, live progress, build, flash, project and diagnostic cards.
- Run configure, clean, build and flash as separate spawned processes so output reaches the Webview while commands are running.
- Redesign Liix AI around the conversation, compact inline tool steps, the circular activity ring, a modern composer, Tasks, Terminal and LM Studio Settings.
- Route legacy slash commands through the same validated tool executor instead of using them as the main agent mechanism.

## 0.3.0

### Changed

- Replaced the Makefile and quick-command build path with CMake and Ninja.
- Added a bundled STM32F103 CMake project and ARM GNU toolchain file.
- Added automatic VS Code dependencies for CMake Tools and portable embedded build tools.
- Build outputs now live under `build/qc1` as `firmware.elf`, `.bin`, `.hex` and `.map`.

### Removed

- Removed workspace `Makefile` discovery.
- Removed external and bundled quick-command scripts.
- Removed the bundled Windows `make.exe` and its license stub.

## 0.1.4

### Fixed
- Fixed OS label display on macOS.
- Replaced generic 504 errors with QC1 internal error codes.
- Improved project diagnostics for missing Makefile, Core and Drivers.
- Separated ST-Link probe detection from st-flash installation.
- Improved Terminal QC1 output with command, CWD, stdout and stderr.

## 0.1.3

### Added
- Added Liix AI settings for API URL and API key.
- Added local AI provider support for Ollama and OpenAI-compatible servers.
