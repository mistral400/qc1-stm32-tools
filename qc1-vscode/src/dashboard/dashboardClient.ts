/** Static client script: no project values are inserted into JavaScript. */
export const dashboardClient = `
const vscode = acquireVsCodeApi();
const routes = ['projectPanel','buildPanel','toolsPanel','diagnosticsPanel','settingsPanel','regixPanel'];
let settingsDirty = false;
function text(id, value) { const node=document.getElementById(id); if(node) node.textContent=String(value ?? '—'); }
function route(id) {
  if(!routes.includes(id)) return;
  document.querySelectorAll('.panel').forEach(node=>{
    const selected=node.id===id;
    node.hidden=!selected;node.setAttribute('aria-hidden',String(!selected));node.classList.toggle('active',selected);
  });
  document.querySelectorAll('[role=tab][data-panel]').forEach(node=>{
    const selected=node.dataset.panel===id;
    node.setAttribute('aria-selected',String(selected));node.tabIndex=selected?0:-1;
  });
  vscode.setState({...vscode.getState(),activePanel:id});
}
route(vscode.getState()?.activePanel || document.body.dataset.initialPanel || 'projectPanel');
document.querySelector('[role=tablist]').addEventListener('keydown',event=>{
  const tabs=[...document.querySelectorAll('[role=tab][data-panel]')];
  const current=tabs.indexOf(document.activeElement);if(current<0) return;
  let next=current;
  if(event.key==='ArrowRight') next=(current+1)%tabs.length;
  else if(event.key==='ArrowLeft') next=(current+tabs.length-1)%tabs.length;
  else if(event.key==='Home') next=0;
  else if(event.key==='End') next=tabs.length-1;
  else return;
  event.preventDefault();tabs[next].focus();route(tabs[next].dataset.panel);
});
document.addEventListener('input',event=>{if(event.target.closest('#projectSettingsForm')) settingsDirty=true;});
function regixPreferencesFromForm() {
  const preferences={};
  document.querySelectorAll('[data-regix-preference]').forEach(node=>{
    const key=node.dataset.regixPreference;
    preferences[key]=node.type==='checkbox'?node.checked:node.value;
  });
  return preferences;
}
function setRegixPreviewTargets(outputKind) {
  const target=document.getElementById('regixPreviewTarget');if(!target)return;
  target.replaceChildren();
  const options=outputKind==='files'?[['header','Fichier .h'],['source','Fichier .c']]:[['snippet','Extrait C']];
  options.forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;target.appendChild(option);});
}
function applyRegixPreferences(preferences) {
  if(!preferences||typeof preferences!=='object')return;
  document.querySelectorAll('[data-regix-preference]').forEach(node=>{
    const key=node.dataset.regixPreference;if(!(key in preferences))return;
    if(node.type==='checkbox')node.checked=Boolean(preferences[key]);
    else if(document.activeElement!==node)node.value=String(preferences[key]);
  });
  const expert=document.getElementById('regixExpertSection');if(expert)expert.hidden=!Boolean(preferences.expertMode);
  const opened=document.querySelectorAll('[data-action="regixOpenPreview"],[data-action="regixCopyPreview"]');
  opened.forEach(button=>button.disabled=Boolean(preferences.previewRequired));
  const all=document.querySelector('[data-action="regixOpenPreview"][data-target="all"]');if(all)all.disabled=Boolean(preferences.previewRequired)||preferences.outputKind!=='files';
  if(!window.regixPreviewFiles)setRegixPreviewTargets(preferences.outputKind);
  updateRegixPinWarning();
}
function invalidateRegixPreview() {
  window.regixPreviewFiles=undefined;
  const required=Boolean(document.querySelector('[data-regix-preference="previewRequired"]')?.checked);
  const files=document.getElementById('regixOutputKind')?.value==='files';
  document.querySelectorAll('[data-action="regixOpenPreview"],[data-action="regixCopyPreview"]').forEach(button=>button.disabled=required);
  const all=document.querySelector('[data-action="regixOpenPreview"][data-target="all"]');if(all)all.disabled=required||!files;
  setRegixPreviewTargets(files?'files':'snippet');
  text('regixPreviewCode','Aperçu invalide. Prévisualisez de nouveau avant utilisation.');
  document.getElementById('regixExplanations')?.replaceChildren();
  const values=document.getElementById('regixGeneratedValues');if(values){values.replaceChildren();values.hidden=true;}
  text('regixPreviewStatus',required?'Les choix ou préférences ont changé. Prévisualisez de nouveau avant ouverture.':'Aucun aperçu courant; l’ouverture recalculera le code.');
}
function updateRegixPinWarning() {
  const pin=document.getElementById('regixPinSelect');const mode=document.getElementById('regixGpioMode');const warning=document.getElementById('regixPinWarning');
  if(!pin||!mode||!warning)return;
  const selectedPin=pin.options[pin.selectedIndex];const maximum=Number(selectedPin?.dataset.maxSpeed||50);
  const name=selectedPin?.value||'GPIO';const defaultFunction=selectedPin?.dataset.defaultFunction||'';const electricalNote=selectedPin?.dataset.electricalNote||'';const remapRequired=selectedPin?.dataset.remapRequired||'';const debugUnavailable=/(SWDIO|SWCLK|JTDI|JTDO|NJTRST)/.test(defaultFunction);
  const unavailable=debugUnavailable||Boolean(remapRequired);
  let selectedAllowed=true;
  [...mode.options].forEach(option=>{const modeUnavailable=unavailable||(option.dataset.output==='true'&&Number(option.dataset.speed||0)>maximum);option.disabled=modeUnavailable;if(option.selected&&modeUnavailable)selectedAllowed=false;});
  if(!selectedAllowed){const safe=[...mode.options].find(option=>!option.disabled);if(safe)mode.value=safe.value;}
  const notes=[];
  if(remapRequired)notes.push(name+' nécessite '+remapRequired+'; REGIX v0.1 ne configure pas ce remappage.');
  else if(debugUnavailable)notes.push('REGIX v0.1 ne modifie pas AFIO_MAPR pour libérer les broches de débogage. Choisissez une autre broche.');
  if(electricalNote)notes.push(electricalNote);
  else if(defaultFunction)notes.push('Fonction par défaut signalée par la fiche technique : '+defaultFunction+'. Vérifiez le montage visé.');
  warning.hidden=notes.length===0;
  warning.textContent=notes.join(' ');
  const generate=document.querySelector('[data-action="regixGenerate"]');if(generate)generate.disabled=unavailable;
}
function updateBitOperationControls() {
  const operation=document.getElementById('regixBitOperation')?.value;
  const extraction=operation==='readBits';
  ['regixBitOffset','regixBitWidth'].forEach(id=>{const node=document.getElementById(id);if(node)node.disabled=!extraction;});
  const operandB=document.getElementById('regixBitOperandB');if(operandB)operandB.disabled=operation==='not'||extraction;
}
document.getElementById('regixPreferencesForm').addEventListener('change',event=>{
  const changed=event.target.closest('[data-regix-preference]');if(!changed)return;
  const preferences=regixPreferencesFromForm();applyRegixPreferences(preferences);invalidateRegixPreview();
  const key=changed.dataset.regixPreference;
  vscode.postMessage({type:'regixSavePreferences',preferences:{[key]:preferences[key]}});
});
document.getElementById('regixPinSelect').addEventListener('change',()=>{updateRegixPinWarning();invalidateRegixPreview();});
document.getElementById('regixGpioMode').addEventListener('change',invalidateRegixPreview);
document.getElementById('regixRegisterSelect').addEventListener('change',event=>vscode.postMessage({type:'regixSelectRegister',registerId:event.target.value}));
document.getElementById('regixBitOperation').addEventListener('change',updateBitOperationControls);
updateBitOperationControls();
function renderRegixRegister(register) {
  const container=document.getElementById('regixRegisterDetail');if(!container||!register)return;
  container.replaceChildren();
  const summary=document.createElement('div');summary.className='regix-register-summary';
  for(const [label,value] of [['Adresse',register.address],['Offset',register.offset],['Largeur / accès',register.width+' bits · '+register.accessLabel]]){
    const row=document.createElement('div');row.className='row';const key=document.createElement('span');key.className='muted';key.textContent=label;const data=document.createElement('span');data.className='value';data.textContent=value;row.append(key,data);summary.appendChild(row);
  }
  const table=document.createElement('table');const head=document.createElement('thead');const heading=document.createElement('tr');
  ['Champ','Bits','Largeur','Masque','Accès'].forEach(value=>{const cell=document.createElement('th');cell.textContent=value;heading.appendChild(cell);});head.appendChild(heading);table.appendChild(head);
  const body=document.createElement('tbody');(Array.isArray(register.fields)?register.fields:[]).forEach(field=>{
    const row=document.createElement('tr');for(const value of [field.name,field.range,field.width,field.mask,field.accessLabel]){const cell=document.createElement('td');cell.textContent=String(value??'');row.appendChild(cell);}body.appendChild(row);
  });table.appendChild(body);const wrapper=document.createElement('div');wrapper.className='terminal-output regix-field-list';wrapper.appendChild(table);container.append(summary,wrapper);
  const note=document.createElement('p');note.className='muted';note.textContent='Lecture avec effet : '+(register.readSideEffects?'oui':'non')+' · Écriture avec effet : '+(register.writeSideEffects?'oui':'non')+' · '+register.writeSemantics;container.appendChild(note);
}
function renderRegixPreview(preview) {
  if(!preview||typeof preview!=='object')return;
  window.regixPreviewFiles=preview;
  const target=document.getElementById('regixPreviewTarget');target.textContent='';
  (preview.targets||[]).forEach(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label;target.appendChild(option);});
  const targetId=target.value||preview.targets?.[0]?.id;
  target.value=targetId;
  const code=preview.code?.[targetId]||'';document.getElementById('regixPreviewCode').textContent=code||'Aucun code pour ce format.';
  const explanations=document.getElementById('regixExplanations');explanations.replaceChildren();
  (preview.explanations||[]).forEach(line=>{const item=document.createElement('p');item.textContent=line;explanations.appendChild(item);});
  const warnings=document.getElementById('regixPreviewStatus');warnings.textContent=(preview.warnings||[]).join(' ')+(preview.previewRequired?' Aperçu vérifié; ouverture disponible.':' Aperçu calculé.');
  const values=document.getElementById('regixGeneratedValues');values.hidden=false;values.replaceChildren();
  Object.entries(preview.values||{}).forEach(([name,value])=>{const item=document.createElement('p');item.textContent=name+': '+value;values.appendChild(item);});
  document.querySelectorAll('[data-action="regixOpenPreview"],[data-action="regixCopyPreview"]').forEach(button=>button.disabled=false);
  const all=document.querySelector('[data-action="regixOpenPreview"][data-target="all"]');if(all)all.disabled=preview.outputKind!=='files';
}
document.getElementById('regixPreviewTarget').addEventListener('change',event=>{
  const preview=window.regixPreviewFiles;if(!preview)return;const code=preview.code?.[event.target.value]||'';document.getElementById('regixPreviewCode').textContent=code;
});
window.regixPreviewFiles=undefined;
document.addEventListener('click',event=>{
  const button=event.target.closest('button'); if(!button || button.disabled) return;
  if(button.dataset.panel) { route(button.dataset.panel); return; }
  const type=button.dataset.action; if(!type) return;
  if(type==='regixGenerate') {
    vscode.postMessage({type:'regixGenerate',deviceId:document.getElementById('regixDeviceSelect').value,pinId:document.getElementById('regixPinSelect').value,modeId:document.getElementById('regixGpioMode').value});return;
  }
  if(type==='regixCalculate') {
    vscode.postMessage({type:'regixCalculate',operation:document.getElementById('regixBitOperation').value,left:document.getElementById('regixBitOperandA').value,right:document.getElementById('regixBitOperandB').value,offset:Number(document.getElementById('regixBitOffset').value),width:Number(document.getElementById('regixBitWidth').value)});return;
  }
  if(type==='regixOpenPreview'||type==='regixCopyPreview') {
    const previewTarget=button.dataset.target==='all'?'all':document.getElementById('regixPreviewTarget').value;
    vscode.postMessage({type:type==='regixOpenPreview'?'regixOpenPreview':'regixCopyPreview',target:previewTarget,deviceId:document.getElementById('regixDeviceSelect').value,pinId:document.getElementById('regixPinSelect').value,modeId:document.getElementById('regixGpioMode').value});return;
  }
  if(type==='refreshSettings') settingsDirty=false;
  const message={type};
  if(type==='serialGraphControl') message.action=button.dataset.graphAction;
  if(button.dataset.command) message.command=button.dataset.command;
  if(button.dataset.path) message.projectPath=button.dataset.path;
  if(button.dataset.id) message.id=button.dataset.id;
  if(button.dataset.index !== undefined) message.index=Number(button.dataset.index);
  vscode.postMessage(message);
});
document.getElementById('projectSettingsForm').addEventListener('submit',event=>{
  event.preventDefault(); const value=id=>document.getElementById(id).value;
  const resetProfile={mode:value('resetModeInput')};
  for(const [id,key] of [['adapterSpeedKHzInput','adapterSpeedKHz'],['srstPulseWidthMsInput','srstPulseWidthMs'],['srstDelayMsInput','srstDelayMs']]) {
    const raw=value(id); if(raw!=='') resetProfile[key]=Number(raw);
  }
  settingsDirty=false;
  vscode.postMessage({type:'updateProjectSettings',projectPath:value('projectPathInput'),buildType:value('buildTypeInput'),cmakePreset:value('cmakePresetInput'),
    buildDirectory:value('buildDirectoryInput'),serialPort:value('serialPortInput'),baudRate:Number(value('baudRateInput')),
    autoDiscoverProjects:document.getElementById('autoDiscoverProjectsInput').checked,
    discoveryRoots:value('discoveryRootsInput').split(/\\r?\\n/).map(root=>root.trim()).filter(Boolean),resetProfile});
});
function renderViews(views) {
  if(!views || typeof views!=='object') return;
  // Only host-rendered, escaped markup is accepted, in fixed non-script containers.
  for(const id of ['projectContent','buildContent','toolsContent','diagnosticsContent']) {
    const node=document.getElementById(id); if(node && typeof views[id]==='string') {
      node.innerHTML=views[id];
      if(id==='toolsContent'&&serialUiState) {serialState(serialUiState);renderSerialOutput();}
    }
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
  const reset=config.resetProfile||{};document.getElementById('resetModeInput').value=reset.mode||'backend-default';
  for(const [key,id] of [['adapterSpeedKHz','adapterSpeedKHzInput'],['srstPulseWidthMs','srstPulseWidthMsInput'],['srstDelayMs','srstDelayMsInput']]) {
    const node=document.getElementById(id);if(node && document.activeElement!==node)node.value=reset[key]??'';
  }
  document.getElementById('autoDiscoverProjectsInput').checked=Boolean(config.autoDiscoverProjects);
  document.getElementById('discoveryRootsInput').value=(config.discoveryRoots||[]).join('\\n');
}
let serialUiLines=[];
let serialUiState;
const serialPalette=['var(--vscode-charts-blue, #3794ff)','var(--vscode-charts-green, #89d185)','var(--vscode-charts-orange, #d18616)','var(--vscode-charts-purple, #b180d7)','var(--vscode-charts-red, #f14c4c)','var(--vscode-charts-yellow, #cca700)','var(--vscode-charts-foreground, #cccccc)','var(--vscode-focusBorder, #007fd4)'];
function renderSerialOutput() {
  const node=document.getElementById('serialOutput');if(!node)return;
  const mode=document.getElementById('serialDisplayMode')?.value||'ascii';
  const timestamps=Boolean(document.getElementById('serialTimestamps')?.checked);
  node.textContent=serialUiLines.map(line=>(timestamps?'['+line.time+'] ':'')+line.direction+' '+(mode==='hex'?line.hex:line.ascii)).join('\\n')||'En attente de données UART.';
  node.scrollTop=node.scrollHeight;
}
function renderSerialGraph(graph,paused) {
  const svg=document.getElementById('serialGraph');const legend=document.getElementById('serialGraphLegend');if(!svg||!legend)return;
  svg.replaceChildren();legend.replaceChildren();
  const samples=Array.isArray(graph?.samples)?graph.samples.slice(-500):[];
  const series=Array.isArray(graph?.series)?graph.series.slice(0,8):[];
  const ns='http://www.w3.org/2000/svg';
  series.forEach((name,seriesIndex)=>{
    const points=samples.map((sample,index)=>({index,timeMs:sample?.timeMs,value:sample?.values?.[name]})).filter(point=>Number.isFinite(point.value)&&Number.isFinite(point.timeMs));
    if(!points.length)return;
    const values=points.map(point=>point.value);const minimum=Math.min(...values);const maximum=Math.max(...values);const range=maximum-minimum||1;
    const minimumTime=Math.min(...points.map(point=>point.timeMs));const maximumTime=Math.max(...points.map(point=>point.timeMs));const timeRange=maximumTime-minimumTime;
    const polyline=document.createElementNS(ns,'polyline');polyline.setAttribute('fill','none');polyline.setAttribute('stroke',serialPalette[seriesIndex]);polyline.setAttribute('stroke-width','2');
    polyline.setAttribute('points',points.map(point=>{const x=24+((timeRange>0?(point.timeMs-minimumTime)/timeRange:point.index/Math.max(1,points.length-1)))*566;const y=164-((point.value-minimum)/range)*144;return x.toFixed(1)+','+y.toFixed(1);}).join(' '));
    svg.appendChild(polyline);
    const item=document.createElement('span');item.className='serial-legend-item';
    const swatch=document.createElement('span');swatch.className='serial-legend-swatch';swatch.style.setProperty('--series-color',serialPalette[seriesIndex]);
    const label=document.createElement('span');label.textContent=name+' ('+minimum.toPrecision(4)+'…'+maximum.toPrecision(4)+')';
    item.append(swatch,label);legend.appendChild(item);
  });
  text('serialGraphStatus',samples.length+' échantillons · '+series.length+' variables'+(paused?' · pause':''));
}
function serialState(state) {
  if(!state||typeof state!=='object')return;
  serialUiState=state;
  const select=document.getElementById('serialPortSelect');
  if(select&&Array.isArray(state.ports)) {
    const previous=select.value;select.textContent='';
    state.ports.forEach(port=>{if(!port||typeof port.path!=='string')return;const option=document.createElement('option');option.value=port.path;option.textContent=port.path+(port.manufacturer?' · '+port.manufacturer:'');select.appendChild(option);});
    const selected=state.selectedPort||previous;
    if(selected&&!state.ports.some(port=>port.path===selected)){const option=document.createElement('option');option.value=selected;option.textContent=selected+' · configuré';select.appendChild(option);}
    if(selected)select.value=selected;
  }
  for(const [key,id] of [['baudRate','serialBaudRate'],['dataBits','serialDataBits'],['parity','serialParity'],['stopBits','serialStopBits']]) {
    const node=document.getElementById(id);if(node&&state[key]!==undefined&&document.activeElement!==node)node.value=String(state[key]);
  }
  const rtscts=document.getElementById('serialRtsCts');if(rtscts&&document.activeElement!==rtscts)rtscts.checked=Boolean(state.rtscts);
  const mode=document.getElementById('serialDisplayMode');if(mode)mode.value=state.displayMode||'ascii';
  const timestamps=document.getElementById('serialTimestamps');if(timestamps)timestamps.checked=Boolean(state.timestamps);
  text('serialStatus',state.status==='connected'?'Connecté à '+(state.selectedPort||'port série'):state.status==='connecting'?'Connexion en cours…':state.status==='error'?'Erreur UART':'Déconnecté · '+(state.rxBytes||0)+' octets reçus');
  const error=document.getElementById('serialError');
  if(error){
    error.textContent='';error.hidden=!state.error;
    if(state.error){const message=document.createElement('span');message.textContent=state.error;error.appendChild(message);}
    (state.guidance||[]).forEach(item=>{
      const details=document.createElement('details');details.className='guided-solution';
      const summary=document.createElement('summary');summary.textContent=item.title;details.appendChild(summary);
      const list=document.createElement('ol');(item.steps||[]).forEach(step=>{const entry=document.createElement('li');entry.textContent=step;list.appendChild(entry);});
      details.appendChild(list);error.appendChild(details);
    });
  }
  text('serialCounters','RX '+(state.rxBytes||0)+' octets · TX '+(state.txBytes||0)+' octets'+(state.droppedLines?' · '+state.droppedLines+' fragments UART omis':''));
  const connected=Boolean(state.connected);const connecting=state.status==='connecting';
  const connect=document.getElementById('serialConnectButton');if(connect)connect.disabled=connected||connecting;
  const disconnect=document.getElementById('serialDisconnectButton');if(disconnect){disconnect.disabled=!connected&&!connecting;disconnect.textContent=connecting?'Annuler la connexion':'Déconnecter';}
  const send=document.getElementById('serialSendButton');if(send)send.disabled=!connected;
  document.querySelectorAll('[data-graph-action="pause"]').forEach(node=>node.disabled=!connected||Boolean(state.graphPaused));
  document.querySelectorAll('[data-graph-action="resume"]').forEach(node=>node.disabled=!connected||!state.graphPaused);
  document.querySelectorAll('[data-graph-action="clear"],[data-graph-action="exportCsv"]').forEach(node=>node.disabled=!Array.isArray(state.graph?.samples)||state.graph.samples.length===0);
  if(Array.isArray(state.lines)){serialUiLines=state.lines.slice(-500);renderSerialOutput();}
  if(state.graph)renderSerialGraph(state.graph,state.graphPaused);
}
function appendSerialLines(lines) {
  if(!Array.isArray(lines))return;
  serialUiLines.push(...lines.filter(line=>line&&typeof line.ascii==='string'&&typeof line.hex==='string').slice(-500));
  if(serialUiLines.length>500)serialUiLines.splice(0,serialUiLines.length-500);
  renderSerialOutput();
}
window.addEventListener('message',event=>{
  const msg=event.data;if(!msg || typeof msg!=='object') return;
  if(msg.type==='navigate' && routes.includes(msg.panel)) {route(msg.panel);return;}
  if(msg.type==='regixSettings') applyRegixPreferences(msg.preferences);
  if(msg.type==='regixPreviewInvalidated') invalidateRegixPreview();
  if(msg.type==='regixRegister') renderRegixRegister(msg.register);
  if(msg.type==='regixPreview') renderRegixPreview(msg.preview);
  if(msg.type==='regixCalculation') text('regixBitResult',msg.result);
  if(msg.type==='regixActionStatus') text('regixPreviewStatus',msg.text);
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
  if(msg.type==='outputSnapshot') {
    const output=document.getElementById('output');
    if(output) {output.textContent=(msg.lines||[]).join('\\n')||'QC1 prêt.';output.scrollTop=output.scrollHeight;}
  }
  if(msg.type==='terminalMeta') {text('terminalProject',msg.meta.projectName);text('terminalLastCommand',msg.meta.lastCommand);}
  if(msg.type==='analysis') {
    text('analysisErrors',msg.analysis.errors);text('analysisWarnings',msg.analysis.warnings);text('analysisExplanation',msg.analysis.explanation);
    const list=document.getElementById('analysisList');list.textContent='';
    (msg.analysis.diagnostics||[]).slice(0,12).forEach(entry=>{const div=document.createElement('div');div.className='analysis-entry';div.textContent=entry.raw||entry.message;list.appendChild(div);});
  }
  if(msg.type==='serialState') serialState(msg.state);
  if(msg.type==='serialSnapshot') {serialUiLines=Array.isArray(msg.lines)?msg.lines.slice(-500):[];renderSerialOutput();serialState(msg.state);}
  if(msg.type==='serialData') appendSerialLines(msg.lines);
  if(msg.type==='serialGraph') {
    if(serialUiState){serialUiState.graph=msg.graph;serialUiState.graphPaused=Boolean(msg.paused);}
    renderSerialGraph(msg.graph,msg.paused);
  }
});
document.addEventListener('submit',event=>{
  if(event.target.id==='serialConnectForm') {
    event.preventDefault();
    vscode.postMessage({type:'serialConnect',options:{path:document.getElementById('serialPortSelect').value,
      baudRate:Number(document.getElementById('serialBaudRate').value),dataBits:Number(document.getElementById('serialDataBits').value),
      parity:document.getElementById('serialParity').value,stopBits:Number(document.getElementById('serialStopBits').value),
      rtscts:document.getElementById('serialRtsCts').checked}});
  } else if(event.target.id==='serialSendForm') {
    event.preventDefault();
    vscode.postMessage({type:'serialSend',text:document.getElementById('serialTx').value,mode:document.getElementById('serialTxMode').value,
      appendNewline:document.getElementById('serialAppendNewline').checked});
  }
});
document.addEventListener('change',event=>{
  if(event.target.id==='serialDisplayMode'||event.target.id==='serialTimestamps') {
    vscode.postMessage({type:'serialDisplay',mode:document.getElementById('serialDisplayMode').value,timestamps:document.getElementById('serialTimestamps').checked});
    renderSerialOutput();
  }
});
vscode.postMessage({type:'refreshSettings'});
`;
