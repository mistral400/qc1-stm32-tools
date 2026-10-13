/** Static client script: no project values are inserted into JavaScript. */
export const dashboardClient = `
const vscode = acquireVsCodeApi();
const routes = ['projectPanel','buildPanel','toolsPanel','diagnosticsPanel','settingsPanel'];
let settingsDirty = false;
function text(id, value) { const node=document.getElementById(id); if(node) node.textContent=String(value ?? '—'); }
function route(id) {
  if(!routes.includes(id)) return;
  document.querySelectorAll('.panel').forEach(node=>node.classList.toggle('active',node.id===id));
  document.querySelectorAll('[data-panel]').forEach(node=>node.setAttribute('aria-selected',String(node.dataset.panel===id)));
  vscode.setState({...vscode.getState(),activePanel:id});
}
route(vscode.getState()?.activePanel || 'projectPanel');
document.addEventListener('input',event=>{if(event.target.closest('#projectSettingsForm')) settingsDirty=true;});
document.addEventListener('click',event=>{
  const button=event.target.closest('button'); if(!button || button.disabled) return;
  if(button.dataset.panel) { route(button.dataset.panel); return; }
  const type=button.dataset.action; if(!type) return;
  if(type==='refreshSettings') settingsDirty=false;
  const message={type};
  if(button.dataset.command) message.command=button.dataset.command;
  if(button.dataset.path) message.projectPath=button.dataset.path;
  if(button.dataset.id) message.id=button.dataset.id;
  if(button.dataset.index !== undefined) message.index=Number(button.dataset.index);
  vscode.postMessage(message);
});
document.getElementById('projectSettingsForm').addEventListener('submit',event=>{
  event.preventDefault(); const value=id=>document.getElementById(id).value;
  settingsDirty=false;
  vscode.postMessage({type:'updateProjectSettings',projectPath:value('projectPathInput'),buildType:value('buildTypeInput'),cmakePreset:value('cmakePresetInput'),
    buildDirectory:value('buildDirectoryInput'),serialPort:value('serialPortInput'),baudRate:Number(value('baudRateInput')),
    autoDiscoverProjects:document.getElementById('autoDiscoverProjectsInput').checked,
    discoveryRoots:value('discoveryRootsInput').split(/\\r?\\n/).map(root=>root.trim()).filter(Boolean)});
});
function renderViews(views) {
  if(!views || typeof views!=='object') return;
  // Only host-rendered, escaped markup is accepted, in fixed non-script containers.
  for(const id of ['projectContent','buildContent','toolsContent','diagnosticsContent']) {
    const node=document.getElementById(id); if(node && typeof views[id]==='string') node.innerHTML=views[id];
  }
}
function progress(p) {
  const percent=Math.min(100,Math.max(0,Number(p.progressPercent)||0));
  const fill=document.getElementById('progressFill'); if(fill) fill.style.width=percent+'%';
  const track=document.querySelector('[role=progressbar]'); if(track) track.setAttribute('aria-valuenow',String(percent));
  text('progressPercent',percent+'%');text('progressCounter',p.measured ? p.completedSteps+' / '+p.totalSteps : 'Étape non mesurée');
  text('progressPhase',p.phase);text('progressTask',p.taskName||'Prêt');text('progressRuntime',p.runtimeSeconds+' s');text('progressStep',p.currentStep);
  document.querySelectorAll('[data-task-command]').forEach(node=>node.disabled=Boolean(p.active));
}
function settings(config) {
  text('configurationScope',config.configurationScope+' · qc1.projectPath est l’unique source de vérité.');
  if(settingsDirty) return;
  for(const key of ['projectPath','buildType','cmakePreset','buildDirectory','serialPort','baudRate']) {
    const node=document.getElementById(key+'Input'); if(node && document.activeElement!==node) node.value=String(config[key]??'');
  }
  document.getElementById('autoDiscoverProjectsInput').checked=Boolean(config.autoDiscoverProjects);
  document.getElementById('discoveryRootsInput').value=(config.discoveryRoots||[]).join('\\n');
}
window.addEventListener('message',event=>{
  const msg=event.data;if(!msg || typeof msg!=='object') return;
  if(msg.type==='dashboardState') {renderViews(msg.views);text('heroProject',msg.state.projectName);text('heroLastCommand',msg.state.lastCommand);}
  if(msg.type==='projectDiscovery') renderViews(msg.views);
  if(msg.type==='progress') progress(msg.progress);
  if(msg.type==='settings') settings(msg.settings);
  if(msg.type==='status') text('heroStatus',msg.text);
  if(msg.type==='clearOutput') text('output','QC1 prêt.');
  if(msg.type==='output') {
    const output=document.getElementById('output');
    output.textContent=(output.textContent+'\\n'+(msg.lines||[]).join('\\n')).split('\\n').slice(-5000).join('\\n');output.scrollTop=output.scrollHeight;
  }
  if(msg.type==='terminalMeta') {text('terminalProject',msg.meta.projectName);text('terminalLastCommand',msg.meta.lastCommand);}
  if(msg.type==='analysis') {
    text('analysisErrors',msg.analysis.errors);text('analysisWarnings',msg.analysis.warnings);text('analysisExplanation',msg.analysis.explanation);
    const list=document.getElementById('analysisList');list.textContent='';
    (msg.analysis.diagnostics||[]).slice(0,12).forEach(entry=>{const div=document.createElement('div');div.className='analysis-entry';div.textContent=entry.raw||entry.message;list.appendChild(div);});
  }
});
vscode.postMessage({type:'refreshSettings'});
`;
