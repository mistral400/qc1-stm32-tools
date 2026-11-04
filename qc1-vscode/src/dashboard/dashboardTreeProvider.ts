import * as vscode from "vscode";
import type { DashboardState } from "./dashboardState";
import { buildDashboardTree, DashboardTreeNode } from "./dashboardTreeModel";

export class QC1DashboardTreeProvider implements vscode.TreeDataProvider<DashboardTreeNode>, vscode.Disposable {
  public static readonly viewId = "qc1.explorer";
  private readonly changes = new vscode.EventEmitter<DashboardTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.changes.event;

  constructor(private readonly getState: () => DashboardState) {}

  refresh(): void {
    this.changes.fire(undefined);
  }

  getTreeItem(node: DashboardTreeNode): vscode.TreeItem {
    const collapsible = node.children?.length
      ? node.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsible);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.contextValue = node.kind;
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.command = node.command;
    item.accessibilityInformation = { label: [node.label, node.description].filter(Boolean).join(", "), role: "treeitem" };
    return item;
  }

  getChildren(element?: DashboardTreeNode): DashboardTreeNode[] {
    return element ? element.children || [] : buildDashboardTree(this.getState());
  }

  dispose(): void {
    this.changes.dispose();
  }
}
