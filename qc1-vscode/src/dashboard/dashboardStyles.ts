/** Theme-aware styles sized for the VS Code sidebar as well as the editor dashboard. */
export const dashboardStyles = `
:root {
  --qc1-bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
  --qc1-card: var(--vscode-editor-background, var(--qc1-bg));
  --qc1-fg: var(--vscode-foreground, #cccccc);
  --qc1-muted: var(--vscode-descriptionForeground, #9d9d9d);
  --qc1-border: var(--vscode-contrastBorder, var(--vscode-panel-border, #454545));
  --qc1-focus: var(--vscode-focusBorder, #007fd4);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 12px;
  background: var(--qc1-bg);
  color: var(--qc1-fg);
  font: var(--vscode-font-size, 13px)/1.5 var(--vscode-font-family, system-ui, sans-serif);
}
button, input, select, textarea { font: inherit; }
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  margin-bottom: 10px;
}
.header-copy { min-width: 0; }
.app-header h1 { margin: 0; font-size: 17px; line-height: 1.3; }
.header-context { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.version { color: var(--qc1-muted); font-size: 11px; font-weight: normal; }
.status-pill, .badge {
  flex: 0 0 auto;
  max-width: 45%;
  padding: 2px 8px;
  border: 1px solid var(--qc1-border);
  border-radius: 999px;
  font-size: 11px;
  overflow-wrap: anywhere;
}

.route-nav {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  padding: 6px 0 8px;
  border-bottom: 1px solid var(--qc1-border);
  background: var(--qc1-bg);
}
button {
  min-width: 0;
  min-height: 32px;
  padding: 6px 9px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-button-background, #285b99);
  cursor: pointer;
}
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, #356aa8); }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible,
summary:focus-visible, [role="tabpanel"]:focus-visible {
  outline: 2px solid var(--qc1-focus);
  outline-offset: 2px;
}
.route-nav button {
  padding: 5px 3px;
  border-color: var(--qc1-border);
  color: var(--qc1-fg);
  background: transparent;
  font-size: 11px;
  text-align: center;
  overflow-wrap: anywhere;
}
.route-nav button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground, transparent)); }
.route-nav button[aria-selected="true"] {
  border-color: var(--qc1-focus);
  color: var(--vscode-button-foreground, #fff);
  background: var(--vscode-button-background, #285b99);
  font-weight: 600;
}
.tab-label-compact { display: none; }
.panel[hidden] { display: none !important; }
.panel { padding-top: 1px; }

.card {
  margin: 12px 0;
  padding: 13px;
  border: 1px solid var(--qc1-border);
  border-radius: 6px;
  background: var(--qc1-card);
}
h2 { margin: 0 0 10px; font-size: 15px; line-height: 1.35; }
h3 { margin: 8px 0; font-size: 13px; line-height: 1.4; }
.muted { color: var(--qc1-muted); }
.section-heading, .candidate-head, .progress-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.row {
  display: grid;
  grid-template-columns: minmax(82px, .8fr) minmax(0, 1.2fr);
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--qc1-border) 55%, transparent);
}
.row:last-child { border-bottom: 0; }
.value { min-width: 0; text-align: right; overflow-wrap: anywhere; }
.operation-state { font-weight: 500; }
.path { font: 12px/1.55 var(--vscode-editor-font-family, monospace); overflow-wrap: anywhere; white-space: normal; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.actions button { min-height: 30px; }
button.action-primary { font-weight: 600; }
button.action-secondary {
  border-color: var(--vscode-button-border, var(--qc1-border));
  color: var(--vscode-button-secondaryForeground, var(--qc1-fg));
  background: var(--vscode-button-secondaryBackground, transparent);
}
button.action-secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground, transparent)); }
button.action-quiet {
  border-color: var(--qc1-border);
  color: var(--qc1-fg);
  background: transparent;
}
button.action-quiet:hover:not(:disabled) { background: var(--vscode-list-hoverBackground, transparent); }
.action-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; }
.action-group { min-width: 0; }
.eyebrow { color: var(--qc1-muted); font-size: 11px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; }
.advanced-actions, .operation-details { margin-top: 8px; border-top: 1px solid var(--qc1-border); }
.memory-image { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--qc1-border); }
.memory-image h3 { margin: 6px 0; font-size: 13px; }
.memory-region { margin-top: 6px; overflow-wrap: anywhere; }
.memory-region .progress-track { margin: 4px 0 8px; }
.memory-region .progress-track > div { height: 100%; background: var(--vscode-progressBar-background, var(--qc1-focus)); }
.memory-warnings { color: var(--vscode-editorWarning-foreground, #eab568); }
.memory-details { margin-top: 8px; border-top: 1px solid var(--qc1-border); }
summary { min-height: 28px; padding: 5px 0; color: var(--vscode-textLink-foreground, var(--qc1-fg)); cursor: pointer; }
.candidate, .recent, .tool, .diagnostic, .artifact { padding: 10px 0; border-top: 1px solid var(--qc1-border); }
.scan-status.busy::before { content: "◌ "; color: var(--vscode-progressBar-background, var(--qc1-focus)); }
li { margin: 5px 0; overflow-wrap: anywhere; }
ul { padding-left: 20px; }
.warning { color: var(--vscode-editorWarning-foreground, #eab568); }
.error { color: var(--vscode-editorError-foreground, #ed7777); }
.success { color: var(--vscode-testing-iconPassed, #65c787); }
.progress-track { height: 7px; margin: 10px 0; overflow: hidden; border-radius: 8px; background: var(--vscode-input-background, #333); }
#progressFill { height: 100%; background: var(--vscode-progressBar-background, var(--qc1-focus)); transition: width .15s ease-out; }
.terminal-output {
  min-height: 90px;
  max-height: 440px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--qc1-border);
  background: var(--vscode-terminal-background, var(--vscode-editor-background, #1e1e1e));
  font: 12px/1.55 var(--vscode-editor-font-family, monospace);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
label { display: block; margin: 11px 0 4px; }
input:not([type="checkbox"]), select, textarea {
  display: block;
  width: 100%;
  min-height: 32px;
  padding: 6px 8px;
  border: 1px solid var(--vscode-input-border, var(--qc1-border));
  border-radius: 3px;
  color: var(--vscode-input-foreground, var(--qc1-fg));
  background: var(--vscode-input-background, var(--qc1-bg));
}
select {
  border-color: var(--vscode-dropdown-border, var(--qc1-border));
  color: var(--vscode-dropdown-foreground, var(--qc1-fg));
  background: var(--vscode-dropdown-background, var(--vscode-input-background, var(--qc1-bg)));
}
option { color: var(--vscode-dropdown-foreground, var(--qc1-fg)); background: var(--vscode-dropdown-background, var(--qc1-bg)); }
textarea { resize: vertical; }
fieldset { min-width: 0; margin: 14px 0; padding: 10px; border: 1px solid var(--qc1-border); }
legend { padding: 0 4px; }
.checkbox { display: flex; align-items: center; gap: 8px; }
.checkbox input { accent-color: var(--vscode-checkbox-selectBackground, var(--qc1-focus)); }
form > button { margin-top: 10px; }
.analysis-entry { margin: 8px 0; padding-left: 8px; border-left: 2px solid var(--qc1-border); overflow-wrap: anywhere; }
.guided-solution { margin: 6px 0; padding: 5px 8px; border: 1px solid var(--qc1-border); border-radius: 4px; }
.guided-solution summary { min-height: 24px; }
.operation-history-item { padding: 8px 0; border-top: 1px solid var(--qc1-border); }
.operation-history-item p { margin: 5px 0; overflow-wrap: anywhere; }
.serial-grid { display: grid; grid-template-columns: minmax(72px, .7fr) minmax(0, 1.3fr); align-items: center; gap: 2px 8px; }
.serial-grid > label { margin: 6px 0; }
.serial-actions { grid-column: 1 / -1; }
.serial-display-options { display: grid; grid-template-columns: auto minmax(90px, 1fr) auto minmax(0, 1fr); align-items: center; gap: 6px 8px; }
.serial-display-options > label { margin: 6px 0; }
.serial-output { min-height: 100px; max-height: 260px; margin: 8px 0; overflow: auto; padding: 8px; border: 1px solid var(--qc1-border); background: var(--vscode-terminal-background, var(--vscode-editor-background, #1e1e1e)); font: 11px/1.5 var(--vscode-editor-font-family, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }
.serial-graph-header { display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; }
.serial-graph { display: block; width: 100%; height: auto; min-height: 110px; border: 1px solid var(--qc1-border); background: var(--vscode-editor-background, var(--qc1-bg)); }
.serial-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 5px 0; font-size: 11px; }
.serial-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.serial-legend-swatch { width: 10px; height: 10px; border-radius: 50%; background: var(--series-color); }
.status-line { padding: 5px 0; font-weight: 600; }
@media (max-width: 400px) {
  .serial-display-options { grid-template-columns: auto minmax(0, 1fr); }
  .serial-grid { grid-template-columns: minmax(65px, .55fr) minmax(0, 1.45fr); }
}

@media (max-width: 480px) {
  body { padding: 9px; }
  .card { margin: 9px 0; padding: 11px; }
  .action-groups { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}
@media (max-width: 600px) {
  .tab-label-full { display: none; }
  .tab-label-compact { display: inline; }
}
@media (max-width: 400px) {
  body { padding: 7px; }
  .app-header h1 { font-size: 15px; }
  .route-nav { gap: 3px; }
  .route-nav button { padding-inline: 1px; font-size: 10px; }
  .card { padding: 9px; }
  .row { grid-template-columns: minmax(70px, .75fr) minmax(0, 1.25fr); gap: 5px; }
}
@media (min-width: 601px) {
  .tab-label-compact { display: none; }
  .tab-label-full { display: inline; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
@media (forced-colors: active) {
  button, .card, .badge, .status-pill, .terminal-output, input, select, textarea, fieldset { border: 1px solid CanvasText; }
  .route-nav button[aria-selected="true"] { outline: 1px solid Highlight; }
}
`;
