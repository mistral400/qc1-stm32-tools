# Changelog

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
