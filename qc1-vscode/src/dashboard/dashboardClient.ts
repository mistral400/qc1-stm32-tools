/** Static client script: no project values are inserted into JavaScript. */
export const dashboardClient = `
const vscode = acquireVsCodeApi();
const routes = ['projectPanel','buildPanel','toolsPanel','diagnosticsPanel','settingsPanel'];
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
document.addEventListener('click',event=>{
  const button=event.target.closest('button'); if(!button || button.disabled) return;
  if(button.dataset.panel) { route(button.dataset.panel); return; }
  const type=button.dataset.action; if(!type) return;
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
