import { useState, useCallback } from "react";
import { Folder, File, ChevronRight, ChevronDown, Plus, Trash2, FolderPlus } from "lucide-react";

interface FileSystemNode {
	name: string;
	type: "file" | "directory";
	path: string;
	children?: FileSystemNode[];
}

interface FileBrowserProps {
	onSelectFile?: (path: string) => void;
	onCreateFile?: (path: string) => void;
	onCreateDirectory?: (path: string) => void;
	onDeletePath?: (path: string) => void;
	files: FileSystemNode[];
    selectedFile?: string;
}

export const FileExplorer: React.FC<FileBrowserProps> = ({ onSelectFile, onCreateFile, onCreateDirectory, onDeletePath, files,selectedFile }) => {
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(["/"]));
	const [contextMenuState, setContextMenuState] = useState<{
		x: number;
		y: number;
		path: string;
		type: "file" | "directory" | null;
	} | null>(null);

	const toggleDir = useCallback((path: string) => {
		setExpandedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const handleContextMenu = useCallback((e: React.MouseEvent, path: string, type: "file" | "directory") => {
		e.preventDefault();
		setContextMenuState({
			x: e.clientX,
			y: e.clientY,
			path,
			type,
		});
	}, []);

	const closeContextMenu = useCallback(() => {
		setContextMenuState(null);
	}, []);

	const handleCreateFile = useCallback(
		async (parentPath: string) => {
			const name = prompt("Enter file name:");
			if (name && onCreateFile) {
				onCreateFile(`${parentPath}${name}`);
			}
			closeContextMenu();
		},
		[onCreateFile, closeContextMenu]
	);

	const handleCreateDirectory = useCallback(
		async (parentPath: string) => {
			const name = prompt("Enter directory name:");
			if (name && onCreateDirectory) {
				onCreateDirectory(`${parentPath}/${name}`);
			}
			closeContextMenu();
		},
		[onCreateDirectory, closeContextMenu]
	);

	const handleDelete = useCallback(
		async (path: string) => {
			if (confirm(`Are you sure you want to delete ${path}?`) && onDeletePath) {
				onDeletePath(path);
			}
			closeContextMenu();
		},
		[onDeletePath, closeContextMenu]
	);

	const renderNode = (node: FileSystemNode, level: number = 0): JSX.Element => {
		const isExpanded = expandedDirs.has(node.path);
		const indent = `${level * 1.5}rem`;

		return (
			<div key={node.path}>
				<div
					className="flex items-center py-1 px-2 hover:bg-gray-700 cursor-pointer group"
					style={{ paddingLeft: indent }}
					onClick={() => {
						if (node.type === "directory") {
							toggleDir(node.path);
						} else {
							onSelectFile?.(node.path);
						}
					}}
					onContextMenu={(e) => handleContextMenu(e, node.path, node.type)}
				>
					<div className="w-5">{node.type === "directory" && (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}</div>
					<div className="w-5 mr-1">{node.type === "directory" ? <Folder size={16} className="text-blue-400" /> : <File size={16} className="text-gray-400" />}</div>
					<span className="flex-1">{node.name}</span>

					{/* Actions */}
					<div className="hidden group-hover:flex gap-2">
						{node.type === "directory" && (
							<>
								<button
									onClick={(e) => {
										e.stopPropagation();
										handleCreateFile(node.path);
									}}
									className="p-1 hover:bg-gray-600 rounded"
								>
									<Plus size={14} />
								</button>
								<button
									onClick={(e) => {
										e.stopPropagation();
										handleCreateDirectory(node.path);
									}}
									className="p-1 hover:bg-gray-600 rounded"
								>
									<FolderPlus size={14} />
								</button>
							</>
						)}
						<button
							onClick={(e) => {
								e.stopPropagation();
								handleDelete(node.path);
							}}
							className="p-1 hover:bg-gray-600 rounded text-red-400"
						>
							<Trash2 size={14} />
						</button>
					</div>
				</div>

				{node.type === "directory" && node.children && isExpanded && <div>{node.children.map((child) => renderNode(child, level + 1))}</div>}
			</div>
		);
	};

	return (
		<div className="h-full bg-gray-800 text-gray-100 text-sm overflow-auto relative" onClick={closeContextMenu}>
			{files.map((node) => renderNode(node))}

			{/* Context Menu */}
			{contextMenuState && (
				<div className="fixed bg-gray-800 border border-gray-600 rounded shadow-lg py-1 z-50" style={{ top: contextMenuState.y, left: contextMenuState.x }}>
					{contextMenuState.type === "directory" && (
						<>
							<button className="w-full px-4 py-1 text-left hover:bg-gray-700 flex items-center gap-2" onClick={() => handleCreateFile(contextMenuState.path)}>
								<Plus size={14} />
								New File
							</button>
							<button className="w-full px-4 py-1 text-left hover:bg-gray-700 flex items-center gap-2" onClick={() => handleCreateDirectory(contextMenuState.path)}>
								<FolderPlus size={14} />
								New Directory
							</button>
							<div className="border-t border-gray-600 my-1" />
						</>
					)}
					<button className="w-full px-4 py-1 text-left hover:bg-gray-700 flex items-center gap-2 text-red-400" onClick={() => handleDelete(contextMenuState.path)}>
						<Trash2 size={14} />
						Delete
					</button>
				</div>
			)}
		</div>
	);
};
