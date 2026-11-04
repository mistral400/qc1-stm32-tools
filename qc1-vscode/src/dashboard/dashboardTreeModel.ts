import type { DashboardState } from "./dashboardState";
import type { DashboardPanelId } from "./dashboardHtml";

export interface DashboardTreeCommand {
  command: string;
  title: string;
  arguments?: unknown[];
}

export interface DashboardTreeNode {
  id: string;
  label: string;
  kind: "group" | "project" | "recent-project" | "candidate" | "artifact" | "diagnostic" | "hardware" | "session" | "info";
  icon: string;
  description?: string;
  tooltip?: string;
  expanded?: boolean;
  command?: DashboardTreeCommand;
  children?: DashboardTreeNode[];
}

const dashboardCommand = (page: DashboardPanelId): DashboardTreeCommand => ({
  command: "qc1.openDashboardPage",
  title: "Ouvrir le tableau de bord QC1",
  arguments: [page],
});

function info(id: string, label: string): DashboardTreeNode {
  return { id, label, kind: "info", icon: "info" };
}

function diagnosticIcon(level: string): string {
  return level === "error" ? "error" : level === "warning" ? "warning" : "info";
}

const diagnosticPriority: Record<string, number> = { error: 0, warning: 1, info: 2 };

export function buildDashboardTree(state: DashboardState): DashboardTreeNode[] {
  const discovery = state.projectDiscovery;
  const activePath = discovery.selectedPath || (state.project.workspacePath !== "--" ? state.project.workspacePath : "");
  const activeDescription = [
    discovery.activeCandidate?.family || state.project.targetFamily,
    discovery.activeCandidate?.mcu || state.project.targetDevice,
    state.project.projectStatus,
  ].filter((value) => value && value !== "unknown").join(" · ") || "Configuration à analyser";
  const recentProjects: DashboardTreeNode[] = state.recentProjects.map((recent) => ({
    id: `recent:${recent.path}`,
    label: recent.name,
    kind: "recent-project",
    icon: "history",
    description: [recent.mcu || recent.family, recent.available === false ? "indisponible" : ""].filter(Boolean).join(" · "),
    tooltip: recent.path,
    command: recent.available === false ? undefined : {
      command: "qc1.selectProjectFromTree",
      title: "Sélectionner ce projet",
      arguments: [recent.path],
    },
  }));
  const detectedProjects: DashboardTreeNode[] = discovery.candidates.map(({ candidate }) => ({
    id: `candidate:${candidate.path}`,
    label: candidate.name,
    kind: "candidate",
    icon: candidate.path === discovery.selectedPath ? "folder-opened" : "folder",
    description: [candidate.mcu || candidate.family, `${candidate.confidence}%`].filter(Boolean).join(" · "),
    tooltip: `${candidate.path}\n${candidate.buildSystem} · ${candidate.architecture}`,
    command: candidate.path === discovery.selectedPath ? undefined : {
      command: "qc1.selectProjectFromTree",
      title: "Sélectionner ce projet détecté",
      arguments: [candidate.path],
    },
  }));
  const projectChildren: DashboardTreeNode[] = [
    {
      id: "project:active",
      label: activePath ? state.projectName : "Aucun projet actif",
      kind: "project",
      icon: activePath ? "folder-opened" : "folder",
      description: activeDescription,
      tooltip: activePath || "Choisissez un dossier ou détectez les projets STM32.",
      command: dashboardCommand("projectPanel"),
    },
    {
      id: "project:recent",
      label: `Projets récents (${recentProjects.length})`,
      kind: "group",
      icon: "history",
      children: recentProjects.length ? recentProjects : [info("recent:none", "Aucun projet récent")],
    },
    {
      id: "project:detected",
      label: `Projets détectés (${detectedProjects.length})`,
      kind: "group",
      icon: "search",
      children: detectedProjects.length ? detectedProjects : [info("detected:none", "Aucun candidat détecté")],
    },
  ];

  const artifacts = state.artifacts.map((artifact) => ({
    id: `artifact:${artifact.id}`,
    label: [artifact.core, artifact.kind].filter(Boolean).join(" "),
    kind: "artifact" as const,
    icon: artifact.kind === "ELF" ? "file-binary" : "file",
    description: `${(artifact.sizeBytes / 1024).toFixed(1)} KB · ${artifact.path.split(/[\\/]/).at(-1) || artifact.path}`,
    tooltip: artifact.path,
    command: { command: "revealFileInOS", title: "Afficher l'artefact", arguments: [artifact.path] },
  }));

  const diagnostics = [state.diagnostic, ...state.diagnostics]
    .filter((item) => item.level !== "idle")
    .filter((item, index, all) => all.findIndex((other) => other.code === item.code && other.checkedPath === item.checkedPath) === index)
    .sort((first, second) => (diagnosticPriority[first.level] ?? 3) - (diagnosticPriority[second.level] ?? 3))
    .map((item, index) => ({
      id: `diagnostic:${item.code}:${index}`,
      label: item.title,
      kind: "diagnostic" as const,
      icon: diagnosticIcon(item.level),
      description: `${item.code} · ${item.level}`,
      tooltip: [item.message, item.cause, item.checkedPath].filter((value) => value && value !== "--").join("\n\n"),
      command: dashboardCommand("diagnosticsPanel"),
    }));
  const diagnosticGroups: DashboardTreeNode[] = ([
    { level: "error", label: "Erreurs bloquantes", icon: "error" },
    { level: "warning", label: "Avertissements", icon: "warning" },
    { level: "info", label: "Informations", icon: "info" },
  ] as const).flatMap(({ level, label, icon }) => {
    const children = diagnostics.filter((item) => level === "info"
      ? item.description?.endsWith(" · info") || item.description?.endsWith(" · success")
      : item.description?.endsWith(` · ${level}`));
    return children.length ? [{
      id: `diagnostics:${level}`,
      label: `${label} (${children.length})`,
      kind: "group" as const,
      icon,
      children,
    }] : [];
  });

  const probe = state.environment.stlinkProbeStatus === "OK" ? "Connectée"
    : state.environment.stlinkProbeStatus === "non détecté" ? "Non détectée" : "Inconnue / non testée";
  const toolNodes: DashboardTreeNode[] = state.tools.slice(0, 12).map((tool, index) => ({
    id: `hardware:tool:${index}`,
    label: tool.name,
    kind: "hardware",
    icon: tool.status === "OK" ? "pass" : tool.status === "Erreur" ? "error" : "warning",
    description: [tool.status, tool.version].filter(Boolean).join(" · "),
    tooltip: [tool.path, tool.source].filter(Boolean).join("\n"),
  }));
  if (state.tools.length > 12) toolNodes.push(info("hardware:tools:truncated", `${state.tools.length - 12} autre(s) outil(s) dans le dashboard`));
  const hardware: DashboardTreeNode[] = [
    { id: "hardware:probe", label: "ST-Link", kind: "hardware", icon: "plug", description: probe, tooltip: `Sonde sélectionnée : ${state.environment.stlinkSelectedProbe || "aucune"}` },
    { id: "hardware:model", label: "Modèle", kind: "hardware", icon: "circuit-board", description: state.environment.stlinkModel || "Inconnu" },
    {
      id: "hardware:tools",
      label: `Outils détectés (${state.tools.length})`,
      kind: "group",
      icon: "tools",
      children: toolNodes.length ? toolNodes : [info("hardware:tools:none", "Aucun outil détecté")],
    },
    {
      id: "hardware:sessions",
      label: `Sessions connues (${state.hardwareSessions.length})`,
      kind: "group",
      icon: "debug",
      children: state.hardwareSessions.length ? state.hardwareSessions.map((session, index) => ({
        id: `hardware:session:${index}`,
        label: session.owner,
        kind: "session" as const,
        icon: "radio-tower",
        description: `${session.probe} · ${session.project}`,
        tooltip: `${session.kind} · ${session.project}`,
      })) : [info("hardware:no-sessions", "Aucune session QC1 connue")],
    },
  ];

  return [
    { id: "qc1:projects", label: "Projets", kind: "group", icon: "folder-library", expanded: true, command: dashboardCommand("projectPanel"), children: projectChildren },
    { id: "qc1:artifacts", label: "Artefacts", kind: "group", icon: "files", description: String(artifacts.length), command: dashboardCommand("buildPanel"), children: artifacts.length ? artifacts : [info("artifact:none", "Aucun artefact connu")] },
    { id: "qc1:diagnostics", label: "Diagnostics", kind: "group", icon: diagnostics.some((item) => item.icon === "error") ? "error" : "warning", description: String(diagnostics.length), command: dashboardCommand("diagnosticsPanel"), children: diagnosticGroups.length ? diagnosticGroups : [info("diagnostic:none", "Aucun problème signalé")] },
    { id: "qc1:hardware", label: "Matériel et outils", kind: "group", icon: "circuit-board", description: probe, command: dashboardCommand("toolsPanel"), children: hardware },
  ];
}
