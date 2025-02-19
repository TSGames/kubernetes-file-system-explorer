'use strict';

import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import { platform } from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { InputBoxOptions } from 'vscode';

const KUBERNETES_FILE_VIEW = 'kubernetes-file-view';
const KUBERNETES_FOLDER_FIND = 'kubernetes-folder-find';
const KUBERNETES_FOLDER_LS_AL = 'kubernetes-folder-ls-al';
const GLOBAL_FAVORITES = '###GLOBAL###';
const FAVORITES_POSTFIX = '_favorites';

let globalContext: vscode.ExtensionContext;

class VolumeNode implements k8s.ClusterExplorerV1.Node {
    private podName: string;
    private namespace: string;
    private volume: any;

    constructor(podName: string, namespace: string, volume: any) {
        this.podName = podName;
        this.namespace = namespace;
        this.volume = volume;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem('Volume: ' + this.volume.name, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = JSON.stringify(this.volume, null, '  ');
        treeItem.contextValue = 'volumenode';
        return treeItem;
    }
}
class VolumeMountNode implements k8s.ClusterExplorerV1.Node {
    private podName: string;
    private namespace: string;
    private volumeMount: any;

    constructor(podName: string, namespace: string, volumeMount: any) {
        this.podName = podName;
        this.namespace = namespace;
        this.volumeMount = volumeMount;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem('Volume mount: ' + this.volumeMount.name, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = JSON.stringify(this.volumeMount, null, '  ');
        treeItem.contextValue = 'volumemountnode';
        return treeItem;
    }
}

class ContainerStatusNode implements k8s.ClusterExplorerV1.Node {
    private podName: string;
    private containerName: string;
    private namespace: string;
    private status: any;

    constructor(podName: string, containerName: string, namespace: string, status: any) {
        this.podName = podName;
        this.containerName = containerName;
        this.namespace = namespace;
        this.status = status;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem('Status: ' + this.status, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = JSON.stringify(this.status, null, '  ');
        treeItem.contextValue = 'containernodestatus';
        return treeItem;
    }
}

class ContainerNode implements k8s.ClusterExplorerV1.Node {
    private kubectl: k8s.KubectlV1;
    podName: string;
    namespace: string;
    name: string;
    private image: string;
    private initContainer: boolean;
    private volumeMounts: any;
    private status: string;

    constructor(kubectl: k8s.KubectlV1, podName: string, namespace: string, name: string, image: string, initContainer: boolean, volumeMounts: any, status: string) {
        this.kubectl = kubectl;
        this.podName = podName;
        this.namespace = namespace;
        this.name = name;
        this.image = image;
        this.initContainer = initContainer;
        this.volumeMounts = volumeMounts;
        this.status = status;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        const statusNode = new ContainerStatusNode(this.podName, this.name, this.namespace, this.status)
        const volumeMountNodes = [];
        if (this.volumeMounts && this.volumeMounts.length > 0) {
            this.volumeMounts.forEach((volumeMount) => {
                volumeMountNodes.push(new VolumeMountNode(this.name, this.namespace, volumeMount));
            })
        }
        return [statusNode, ...volumeMountNodes];
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(`${this.initContainer ? 'Init Container:' : 'Container: '} ${this.name} ( ${this.image} )`,
            (this.volumeMounts && this.volumeMounts.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None));
        treeItem.tooltip = `${this.initContainer ? 'Init Container:' : 'Container: '} ${this.name} ( ${this.image} )`;
        treeItem.contextValue = 'containernode';
        return treeItem;
    }
}
class FavoriteNode implements k8s.ClusterExplorerV1.Node {
    private kubectl: k8s.KubectlV1;
    podName: string;
    namespace: string;
    containerName: string;
    volumeMounts: Array<any>;

    constructor(kubectl: k8s.KubectlV1, podName: string, namespace: string, containerName: string, volumeMounts: Array<any>) {
        this.kubectl = kubectl;
        this.podName = podName;
        this.namespace = namespace;
        this.containerName = containerName;
        this.volumeMounts = volumeMounts;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        return [
            this.namespace + '_' + this.podName + FAVORITES_POSTFIX,
            this.podName + FAVORITES_POSTFIX,
            GLOBAL_FAVORITES + FAVORITES_POSTFIX
        ].map((key) =>
            (globalContext.globalState.get(key) as string[] || []).map(file => {
                const data = file.split('\0');
                const path = data[0].split('/');
                const type = data[1] || 'containerfilenodefavorite';
                let filename = path[path.length - 1];
                delete path[path.length - 1];
                let fn: BaseNode;
                if(type == 'containerfilenodefavorite') {
                    file = path.join('/');
                    fn = new FileNode(this.kubectl, this.podName, this.namespace, file, filename, this.containerName, type, this.volumeMounts);
                } else {
                    let filename = path[path.length - 2];
                    delete path[path.length - 2];
                    file = path.join('/');
                    fn = new FolderNode(this.kubectl, this.podName, this.namespace, file, filename, this.containerName, type, this.volumeMounts);
                }
                fn.favoriteKey = key;
                return fn;
            })
        ).reduce(
            (a, b) => [...a, ...b]
        ).sort(
            (a, b) => a instanceof FileNode && b instanceof FolderNode ? 1 : a instanceof FolderNode && b instanceof FileNode ? -1 : a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        );
    }

    getTreeItem(): vscode.TreeItem {
        let label = 'Favorites';
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
        treeItem.tooltip = label;
        treeItem.iconPath = new vscode.ThemeIcon('star');
        treeItem.contextValue = 'containerfavorite';
        return treeItem;
    }
}

abstract class BaseNode implements k8s.ClusterExplorerV1.Node {
    protected kubectl: k8s.KubectlV1;
    podName: string;
    namespace: string;
    containerName: string;
    path: string;
    name: string;
    volumeMounts: Array<any>;
    protected contextValue: string;
    favoriteKey: string;

    constructor(kubectl: k8s.KubectlV1, podName: string, namespace: string, path: string, name: string, containerName: string, contextValue: string, volumeMounts: Array<any>) {
        this.kubectl = kubectl;
        this.podName = podName;
        this.namespace = namespace;
        this.containerName = containerName;
        this.path = path;
        this.name = name
            .replace(/\@$/, '')
            .replace(/\*$/, '');
        this.contextValue = contextValue;
        this.volumeMounts = volumeMounts;
    }
    getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        throw new Error('Method not implemented.');
    }
    getTreeItem(): vscode.TreeItem {
        throw new Error('Method not implemented.');
    }
    abstract getFavoriteType(): string;
    async addToFavorites() {
        const options = [
            "Explicit Favorites (Namespace & pod name)",
            "Pod Favorites (Pod name)",
            "Global Favorites (All namespaces & pods)",
        ];
        vscode.window.showQuickPick(options, {
            title: "Select favorite scope"
        }).then(async (result) => {
            const idx = options.indexOf(result);
            let key: string;
            if (idx === 0) {
                key = this.namespace + '_' + this.podName
            } else if (idx === 1) {
                key = this.podName;
            } else {
                key = GLOBAL_FAVORITES;
            }
            key += '_favorites';
            const favorites: string[] = await globalContext.globalState.get(key) || [];
            if (favorites.includes(this.path + this.name)) {
                vscode.window.showWarningMessage(`${this.name} is already a favorit`);
                return;
            }
            favorites.push(this.path + this.name + '\0' + this.getFavoriteType());
            await globalContext.globalState.update(key, favorites);
            vscode.window.showInformationMessage(`Added ${this.name} to favorites`);
            vscode.commands.executeCommand('extension.vsKubernetesRefreshExplorer');
        });


    }

}
class FolderNode extends BaseNode {
    getFavoriteType(): string {
        return 'containerfoldernodefavorite'
    }
    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        const lsResult = await this.kubectl.invokeCommand(`exec -it ${this.podName} ${this.containerName ? '-c ' + this.containerName : ''} --namespace ${this.namespace} -- ls -F ${this.path}${this.name}`);

        if (!lsResult || lsResult.code !== 0) {
            vscode.window.showErrorMessage(`Can't get resource usage: ${lsResult ? lsResult.stderr : 'unable to run kubectl'}`);
            return;
        }
        const lsCommandOutput = lsResult.stdout;
        if (lsCommandOutput.trim().length > 0) {
            const fileNames = lsCommandOutput.split('\n')
                .filter((fileName) => fileName && fileName.trim().length > 0)
                .sort((a, b) => !a.endsWith('/') && b.endsWith('/') ? 1 : a.endsWith('/') && !b.endsWith('/') ? -1 : 0);
            return fileNames.map((fileName) => {
                if (fileName.endsWith('/')) {
                    return new FolderNode(this.kubectl, this.podName, this.namespace, this.path + this.name, fileName, this.containerName, 'containerfoldernode', this.volumeMounts);
                } else {
                    return new FileNode(this.kubectl, this.podName, this.namespace, this.path + this.name, fileName, this.containerName, 'containerfilenode', this.volumeMounts);
                }
            });
        }
        return [];
    }



    isFile() {
        return false;
    }

    getTreeItem(): vscode.TreeItem {
        let label = this.name.trim().length > 0 ? this.name : (this.containerName ? this.containerName + ':' : '') + this.path;
        if (this.volumeMounts.indexOf(`${this.path}${this.name.substring(0, this.name.length - 1)}`) !== -1) {
            label += ` [Mounted]`
        }
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
        treeItem.tooltip = label;
        if(this.contextValue == 'containerfolderrootnode') {
            treeItem.iconPath = vscode.ThemeIcon.Folder;
        }
        treeItem.contextValue = 'containerfoldernode';
        return treeItem;
    }

    async findImpl(findArgs) {
        let doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`${KUBERNETES_FOLDER_FIND}:${this.podName}:${this.namespace}:${this.containerName}:${this.path}${this.name}`));
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    find() {
        let findArgs = '';
        this.findImpl(findArgs);
    }

    async lsDashAl() {
        let doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`${KUBERNETES_FOLDER_LS_AL}:${this.podName}:${this.namespace}:${this.containerName}:${this.path}${this.name}`));
        await vscode.window.showTextDocument(doc, { preview: false });
    }
}

class FileNode extends BaseNode {
    getFavoriteType(): string {
        return 'containerfilenodefavorite';
    }

    podName: string;
    namespace: string;
    containerName: string;
    path: string;
    name: string;
    volumeMounts: Array<any>;

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        let label = this.name;
        if (this.volumeMounts.indexOf(`${this.path}${this.name}`) !== -1) {
            label += ` [Mounted]`
        }
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = this.path + label;
        treeItem.iconPath = vscode.ThemeIcon.File;
        treeItem.resourceUri = vscode.Uri.parse(this.name);
        treeItem.contextValue = this.contextValue;
        return treeItem;
    }

    isFile() {
        return true;
    }

    async viewFile() {
        let doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`kubernetes-file-view:${this.podName}:${this.namespace}:${this.containerName}:${this.path}${this.name}`));
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    async removeFromFavorites() {
        let favorites: string[] = await globalContext.globalState.get(this.favoriteKey) || [];
        favorites = favorites.filter(f => f !== (this.path + this.name));
        await globalContext.globalState.update(this.favoriteKey, favorites);
        vscode.window.showInformationMessage(`Removed ${this.name} from favorites`);
        vscode.commands.executeCommand('extension.vsKubernetesRefreshExplorer');
    }

    async editFile() {
        const localFile = await FileSystemHelper.copyFromKubectl(
            this.namespace,
            this.podName,
            this.containerName,
            this.path + this.name
        );
        const doc = await vscode.workspace.openTextDocument(localFile);
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    tailDashFFile() {
        const terminal = vscode.window.activeTerminal || vscode.window.createTerminal();
        terminal.show();
        terminal.sendText(`kubectl exec -it --namespace ${this.namespace} -c ${this.containerName} ${this.podName} -- tail -f ${this.path}${this.name}`);
    }
}

class FileSystemNodeContributor {
    private kubectl: k8s.KubectlV1;

    constructor(kubectl: k8s.KubectlV1) {
        this.kubectl = kubectl;
    }

    contributesChildren(parent: k8s.ClusterExplorerV1.ClusterExplorerNode | undefined): boolean {
        return parent && parent.nodeType === 'resource' && parent.resourceKind.manifestKind === 'Pod';
    }

    async getChildren(parent: k8s.ClusterExplorerV1.ClusterExplorerNode | undefined): Promise<k8s.ClusterExplorerV1.Node[]> {
        if (parent && parent.nodeType === 'resource' && parent.resourceKind.manifestKind === 'Pod') {
            const explorer = await k8s.extension.clusterExplorer.v1;
            if (explorer.available) {
                const kubectl = await k8s.extension.kubectl.v1;
                if (kubectl.available) {
                    const podDetails = await kubectl.api.invokeCommand(`get pods ${parent.name} -o json`);
                    if (podDetails && podDetails.stdout) {
                        const podDetailsAsJson = JSON.parse(podDetails.stdout);
                        const initContainerStatuses = {};
                        const initContainerStatusesDetails = await kubectl.api.invokeCommand(`get pods ${parent.name} -o jsonpath='{.status.initContainerStatuses}'`)
                        if (initContainerStatusesDetails && initContainerStatusesDetails.stdout) {
                            try {
                                const initContainerStatusesJson = JSON.parse(initContainerStatusesDetails.stdout.replace(/^'/, '').replace(/'$/, ''));
                                initContainerStatusesJson.forEach((initContainerStatus) => {
                                    initContainerStatuses[initContainerStatus.name] = initContainerStatus;
                                });
                            } catch (er) {
                                // ignore
                            }
                        }

                        const containerStatuses = {};
                        const containerStatusesDetails = await kubectl.api.invokeCommand(`get pods ${parent.name} -o jsonpath='{.status.containerStatuses}'`)
                        if (containerStatusesDetails && containerStatusesDetails.stdout) {
                            try {
                                const containerStatusesJson = JSON.parse(containerStatusesDetails.stdout.replace(/^'/, '').replace(/'$/, ''));
                                containerStatusesJson.forEach((containerStatus) => {
                                    containerStatuses[containerStatus.name] = containerStatus;
                                });
                            } catch (ex) {
                                // ignore
                            }
                        }

                        const volumes = [];
                        podDetailsAsJson.spec.volumes.forEach((volume) => {
                            volumes.push(new VolumeNode(parent.name, parent.namespace, volume));
                        });
                        const containers = [];
                        if (podDetailsAsJson.spec.initContainers) {
                            podDetailsAsJson.spec.initContainers.forEach((container) => {
                                let status = '';
                                if (initContainerStatuses[container.name]?.state.running) {
                                    status = `Running (Started at: ${initContainerStatuses[container.name]?.state.running.startedAt})`;
                                } else if (initContainerStatuses[container.name]?.state.terminated) {
                                    status = initContainerStatuses[container.name]?.state.terminated?.reason;
                                }
                                // const containerStatus = await kubectl.api.invokeCommand(`get pods ${parent.name} -o json`)
                                containers.push(new ContainerNode(this.kubectl, parent.name, parent.namespace, container.name, container.image, true, container.volumeMounts, status));
                            });
                        }
                        podDetailsAsJson.spec.containers.forEach((container) => {
                            let status = '';
                            if (containerStatuses[container.name]?.state.running) {
                                status = `Running (Started at: ${containerStatuses[container.name]?.state.running.startedAt})`;
                            } else if (containerStatuses[container.name]?.state.terminated) {
                                status = containerStatuses[container.name]?.state.terminated?.reason;
                            }
                            containers.push(new ContainerNode(this.kubectl, parent.name, parent.namespace, container.name, container.image, false, container.volumeMounts, status));
                        });
                        const containerFilesystems = [];
                        podDetailsAsJson.spec.containers.forEach((container) => {
                            const volumeMounts: Array<any> = [];
                            if (container.volumeMounts && container.volumeMounts.length > 0) {
                                container.volumeMounts.forEach((volumeMount) => {
                                    volumeMounts.push(volumeMount.mountPath);
                                });
                            }
                            containerFilesystems.push(new FolderNode(this.kubectl, parent.name, parent.namespace, '/', '', container.name, 'containerfolderrootnode', volumeMounts));
                            containerFilesystems.push(new FavoriteNode(this.kubectl, parent.name, parent.namespace, container.name, volumeMounts));
                        });
                        return [...volumes, ...containers, ...containerFilesystems];
                    }
                }
            }
        }
        return [];
    }
}

interface FileInfo {
    namespace: string;
    pod: string;
    containerName: string;
    file: string;
}
class FileSystemHelper {
    private static kubectl: k8s.KubectlV1;
    // list to hold currently copied/open files
    private static UUID_LIST: { [key: string]: FileInfo } = {};
    public static init(kubectl: k8s.KubectlV1) {
        FileSystemHelper.kubectl = kubectl;
        vscode.workspace.onDidSaveTextDocument(async (e) => {
            const pathSplitted = e.fileName.split(path.sep);
            const file = pathSplitted[pathSplitted.length - 1];
            const uuid = pathSplitted[pathSplitted.length - 2];
            const info = FileSystemHelper.UUID_LIST[uuid];
            if (info) {
                const kubePath = info.namespace + '/' + info.pod + ':' + info.file;
                const result = await FileSystemHelper.kubectl.invokeCommand(`cp ${e.fileName} ${kubePath} -c ${info.containerName}`);
                if (!result || result.code !== 0) {
                    vscode.window.showErrorMessage(`kubectl cp ${e.fileName} ${kubePath} -c ${info.containerName} failed: ${result.stderr}`);
                    return null;
                } else {
                    vscode.window.showInformationMessage(`Saved file ${file} to pod ${info.pod}`);
                }
            }
        });
    }

    private static getTempLocation() {
        if (vscode.workspace.workspaceFolders !== undefined) {
            return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
        vscode.window.showErrorMessage('No workspace root path found. Please open any workspace to determine a temporary storage location');
        return null;
    }
    private static getTempFile(uuid: string, file: string) {
        return path.resolve(FileSystemHelper.getTempLocation(), '.kubectl.tmp', uuid, file);
    }
    public static async copyFromKubectl(namespace: string, pod: string, containerName: string, file: string) {
        const kubePath = `${namespace}/${pod}:${file}`;
        const pathSplitted = file.split('/');
        let uuid = randomUUID();
        const existingUuid = Object.keys(FileSystemHelper.UUID_LIST).filter(
            uuid => {
                const info = FileSystemHelper.UUID_LIST[uuid];
                return info.namespace === namespace && info.pod === pod && info.file === file;
            }
        );
        if (existingUuid.length === 1) {
            uuid = existingUuid[0];
        }

        const tmpFile = FileSystemHelper.getTempFile(
            uuid, pathSplitted[pathSplitted.length - 1]
        );
        const result = await FileSystemHelper.kubectl.invokeCommand(`cp ${kubePath} ${tmpFile} -c ${containerName}`);
        if (!result || result.code !== 0) {
            vscode.window.showErrorMessage(`kubectl cp ${kubePath} ${tmpFile} -c ${containerName} failed: ${result.stderr}`);
            return null;
        }
        FileSystemHelper.UUID_LIST[uuid] = {
            namespace,
            pod,
            containerName,
            file
        }
        return tmpFile;
    }
}

class KubernetesContainerFileDocumentProvider implements vscode.TextDocumentContentProvider {
    private kubectl: k8s.KubectlV1;

    constructor(kubectl: k8s.KubectlV1) {
        this.kubectl = kubectl;
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const parts = uri.path.split(':');

        let command;
        if (uri.scheme === KUBERNETES_FILE_VIEW) {
            command = 'cat';
        } else if (uri.scheme === KUBERNETES_FOLDER_FIND) {
            command = 'find';
        } else if (uri.scheme === KUBERNETES_FOLDER_LS_AL) {
            command = 'ls -al';
        }
        if (command) {
            const result = await this.kubectl.invokeCommand(`exec -it ${parts[0]}  -c ${parts[2]} --namespace ${parts[1]} -- ${command} ${parts[3]}`);
            if (!result || result.code !== 0) {
                vscode.window.showErrorMessage(`Can't get data: ${result ? result.stderr : 'unable to run cat command on file ${this.path}${this.name}'}`);
                return `${command} ${uri.path}\n ${result.stderr}`;
            }
            let output = (uri.scheme === KUBERNETES_FILE_VIEW) ? '' : `${command} ${parts[3]}\n\n`;
            output += result.stdout;
            if (output) {
                return output;
            }
        }
        return uri.toString();
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const explorer = await k8s.extension.clusterExplorer.v1;
    if (!explorer.available) {
        vscode.window.showErrorMessage(`ClusterExplorer not available.`);
        return;
    }

    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available.`);
        return;
    }
    FileSystemHelper.init(kubectl.api)
    globalContext = context;

    explorer.api.registerNodeContributor(new FileSystemNodeContributor(kubectl.api));
    let disposable = vscode.commands.registerCommand('k8s.node.terminal', nodeTerminal);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.favorite', addToFavorites);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.favoriteRemove', removeFromFavorites);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.terminal', terminal);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.folder.find', find);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.folder.ls-al', lsDashAl);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.folder.terminal', terminal);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.folder.cp-from', folderCpFrom);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.folder.cp-to-from-folder', folderCpToFromFolder);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.folder.cp-to-from-file', folderCpToFromFile);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.file.view', viewFile);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.file.edit', editFile);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.file.tail-f', tailDashFFile);
    context.subscriptions.push(disposable);
    disposable = vscode.commands.registerCommand('k8s.pod.container.file.cp-from', fileCpFrom);
    context.subscriptions.push(disposable);

    const kubernetesContainerFileDocumentProvider = new KubernetesContainerFileDocumentProvider(kubectl.api);
    disposable = vscode.workspace.registerTextDocumentContentProvider(KUBERNETES_FILE_VIEW, kubernetesContainerFileDocumentProvider);
    context.subscriptions.push(disposable);
    disposable = vscode.workspace.registerTextDocumentContentProvider(KUBERNETES_FOLDER_FIND, kubernetesContainerFileDocumentProvider);
    context.subscriptions.push(disposable);
    disposable = vscode.workspace.registerTextDocumentContentProvider(KUBERNETES_FOLDER_LS_AL, kubernetesContainerFileDocumentProvider);
    context.subscriptions.push(disposable);
}

function nodeTerminalImpl(terminal: vscode.Terminal, nodeName: string, hostName: string, nsenterImage: string) {
    terminal.sendText(`cls`);
    if (process.platform === 'win32') {
        terminal.sendText(`function prompt {"> "}`);
        terminal.sendText(`$hostName = '${hostName}'`);
        terminal.sendText(`$nodeName = '${nodeName}'`);
        terminal.sendText(`$overrides = '{"spec":{"hostPID":true,"hostNetwork":true,"nodeSelector":{"kubernetes.io/hostname":"' + $hostName + '"},"tolerations":[{"operator":"Exists"}],"containers":[{"name":"nsenter","image":"${nsenterImage}","command":["/nsenter","--all","--target=1","--","su","-"],"stdin":true,"tty":true,"securityContext":{"privileged":true}}]}}' | ConvertTo-Json`);
        terminal.sendText(`cls`);
        terminal.sendText(`kubectl run nsenter-${nodeName} --restart=Never -it --rm --image=overriden --overrides=$overrides --attach $nodeName`);
    } else {
        terminal.sendText(`kubectl run nsenter-${nodeName} --restart=Never -it --rm --image=overriden --overrides='{"spec":{"hostPID":true,"hostNetwork":true,"nodeSelector":{"kubernetes.io/hostname":"${hostName}"},"tolerations":[{"operator":"Exists"}],"containers":[{"name":"nsenter","image":"${nsenterImage}","command":["/nsenter","--all","--target=1","--","su","-"],"stdin":true,"tty":true,"securityContext":{"privileged":true}}]}}' --attach ${nodeName}`);
    }
    terminal.show();
    setTimeout(() => {
        vscode.commands.executeCommand('extension.vsKubernetesRefreshExplorer');
        terminal.sendText(`\n`);
        setTimeout(() => {
            vscode.commands.executeCommand('extension.vsKubernetesRefreshExplorer');
        }, 5000);
    }, 5000);
}

async function nodeTerminal(target?: any) {
    const explorer = await k8s.extension.clusterExplorer.v1;
    if (!explorer.available) {
        return;
    }
    const commandTarget = explorer.api.resolveCommandTarget(target);
    if (commandTarget) {
        if (commandTarget.nodeType === 'resource') {
            if (commandTarget.resourceKind.manifestKind === 'Node') {
                const nsenterImage = vscode.workspace.getConfiguration().get<string>('kubernetes-file-system-explorer.nsenter-image');
                if (!nsenterImage) {
                    vscode.window.showErrorMessage(`Must set nsenter image in config: 'kubernetes-file-system-explorer.nsenter-image'`);
                    return;
                }
                const shell = vscode.workspace.getConfiguration().get<string>('terminal.integrated.shell.windows');
                if (process.platform === 'win32' && shell.indexOf('powershell') === -1) {
                    vscode.window.showErrorMessage(`Only works when 'terminal.integrated.shell.windows' is set to Powershell.`);
                } else {
                    const nodeName = commandTarget.name;
                    const kubectl = await k8s.extension.kubectl.v1;
                    if (!kubectl.available) {
                        return;
                    }
                    const podDetails = await kubectl.api.invokeCommand(`get nodes ${nodeName} -o json`);
                    if (podDetails && podDetails.stdout) {
                        const nodeDetailsAsJson = JSON.parse(podDetails.stdout);
                        if (nodeDetailsAsJson.metadata.labels['kubernetes.io/hostname']) {
                            nodeTerminalImpl(vscode.window.createTerminal({ name: `nsenter-${nodeName}` }),
                                nodeName,
                                nodeDetailsAsJson.metadata.labels['kubernetes.io/hostname'],
                                nsenterImage);
                        }
                    }
                }
                return;
            }
        }
    }
}

async function terminal(target?: any) {
    if (target && target.nodeType === 'extension' && vscode.window.activeTerminal) {
        if (target.impl instanceof ContainerNode) {
                const container = target.impl as ContainerNode;
                vscode.window.activeTerminal.sendText(`kubectl exec -it ${container.podName} -c ${container.name} --namespace ${container.namespace} -- sh`);
                return;
        }
        if (target.impl instanceof FolderNode) {
            const folder = target.impl as FolderNode;
            vscode.window.activeTerminal.sendText(`kubectl exec -it ${folder.podName} -c ${folder.name} --namespace ${folder.namespace} -- sh`);
            vscode.window.activeTerminal.sendText(`cd ${folder.path}/${folder.name}`);
            return;
        }
    }
}

async function find(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FolderNode) {
            (target.impl as FolderNode).find();
            return;
        }
    }
}

async function lsDashAl(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FolderNode) {
            (target.impl as FolderNode).lsDashAl();
            return;
        }
    }
}

function folderCpFrom(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FolderNode) {
            const folderNode = target.impl as FolderNode;
            const openDialogOptions: vscode.OpenDialogOptions = {
                openLabel: 'Select the folder to cp to',
                canSelectFiles: false,
                canSelectFolders: true
            };
            vscode.window.showOpenDialog(openDialogOptions).then((selected) => {
                if (selected) {
                    const terminal = vscode.window.activeTerminal || vscode.window.createTerminal();
                    terminal.show();
                    const fsPath = selected[0].fsPath;
                    if (process.platform === 'win32') {
                        terminal.sendText(`cd /D ${fsPath}`);
                    } else {
                        terminal.sendText(`cd ${fsPath}`);
                    }
                    terminal.sendText(`kubectl cp ${folderNode.namespace}/${folderNode.podName}:${folderNode.path}${folderNode.name} ${folderNode.name} -c ${folderNode.containerName}`);
                }
            });
            return;
        }
    }
}

function folderCpToFromFolder(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FolderNode) {
            const folderNode = target.impl as FolderNode;
            const openDialogOptions: vscode.OpenDialogOptions = {
                openLabel: 'Select the folder to cp',
                canSelectFiles: false,
                canSelectFolders: true
            };
            vscode.window.showOpenDialog(openDialogOptions).then((selected) => {
                if (selected) {
                    const terminal = vscode.window.activeTerminal || vscode.window.createTerminal();
                    terminal.show();
                    const fsPath = selected[0].fsPath;
                    const dirname = path.dirname(fsPath);
                    const basename = path.basename(fsPath);
                    if (process.platform === 'win32') {
                        terminal.sendText(`cd /D ${dirname}`);
                    } else {
                        terminal.sendText(`cd ${dirname}`);
                    }
                    terminal.sendText(`kubectl cp ${basename} ${folderNode.namespace}/${folderNode.podName}:${folderNode.path}${folderNode.name}${basename} -c ${folderNode.containerName}`);
                }
            });
            return;
        }
    }
}

function folderCpToFromFile(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FolderNode) {
            const folderNode = target.impl as FolderNode;
            const openDialogOptions: vscode.OpenDialogOptions = {
                openLabel: 'Select the file to cp',
                canSelectFiles: true,
                canSelectFolders: false
            };
            vscode.window.showOpenDialog(openDialogOptions).then((selected) => {
                if (selected) {
                    const terminal = vscode.window.activeTerminal || vscode.window.createTerminal();
                    terminal.show();
                    const fsPath = selected[0].fsPath;
                    const dirname = path.dirname(fsPath);
                    const basename = path.basename(fsPath);
                    if (process.platform === 'win32') {
                        terminal.sendText(`cd /D ${dirname}`);
                    } else {
                        terminal.sendText(`cd ${dirname}`);
                    }
                    terminal.sendText(`kubectl cp ${basename} ${folderNode.namespace}/${folderNode.podName}:${folderNode.path}${folderNode.name}${basename} -c ${folderNode.containerName}`);
                }
            });
            return;
        }
    }
}

async function viewFile(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FileNode) {
            if ((target.impl as FileNode).isFile()) {
                (target.impl as FileNode).viewFile();
                return;
            }
        }
    }
}
async function addToFavorites(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof BaseNode) {
            (target.impl as BaseNode).addToFavorites();
            return;

        }
    }
}
async function removeFromFavorites(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof BaseNode) {
            (target.impl as FileNode).removeFromFavorites();
            return;
        }
    }
}
async function editFile(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FileNode) {
            if ((target.impl as FileNode).isFile()) {
                (target.impl as FileNode).editFile();
                return;
            }
        }
    }
}


async function tailDashFFile(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FileNode) {
            if ((target.impl as FileNode).isFile()) {
                (target.impl as FileNode).tailDashFFile();
                return;
            }
        }
    }
}

function fileCpFrom(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof FileNode) {
            const fileNode = target.impl as FileNode;
            const openDialogOptions: vscode.OpenDialogOptions = {
                openLabel: 'Select the folder to cp to',
                canSelectFiles: false,
                canSelectFolders: true
            };
            vscode.window.showOpenDialog(openDialogOptions).then((selected) => {
                if (selected) {
                    const terminal = vscode.window.activeTerminal || vscode.window.createTerminal();
                    terminal.show();
                    const fsPath = selected[0].fsPath;
                    if (process.platform === 'win32') {
                        terminal.sendText(`cd /D ${fsPath}`);
                    } else {
                        terminal.sendText(`cd ${fsPath}`);
                    }
                    terminal.sendText(`kubectl cp ${fileNode.namespace}/${fileNode.podName}:${fileNode.path}${fileNode.name} ${fileNode.name} -c ${fileNode.containerName}`);
                }
            });
            return;
        }
    }
}


export function deactivate() {
}
