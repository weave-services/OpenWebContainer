import React, { useEffect, useRef, useState, useCallback } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import { configureSingle, fs } from "@zenfs/core";
import { WebStorage } from "@zenfs/dom";
import "@xterm/xterm/css/xterm.css";

import { JshCommand } from "./mock/jsh";
import { Session } from "./mock/session";
import { createTextStreamPair, OutputChunk } from "./mock/utils";

interface TerminalProps {
	readonly?: boolean;
	onTerminalReady?: (terminal: XTerm) => void;
	onTerminalResize?: (cols: number, rows: number) => void;
	initialPath?: string;
	theme?: {
		background?: string;
		foreground?: string;
		cursor?: string;
		selection?: string;
	};
}

const Terminal: React.FC<TerminalProps> = ({ readonly = false, onTerminalReady, onTerminalResize, initialPath = "/", theme = {} }) => {
	const terminalRef = useRef<HTMLDivElement>(null);
	const terminalInstance = useRef<XTerm | null>(null);
	const [isFileSystemReady, setIsFileSystemReady] = useState(false);
	const sessionRef = useRef<Session>(new Session(initialPath));
	const inputWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
	const currentLineRef = useRef<string>("");

	// Process shell output in a separate function
	const processShellOutput = async (output: ReadableStream<OutputChunk>, term: XTerm): Promise<void> => {
		output.pipeTo(
			new WritableStream({
				write(chunk) {
					switch (chunk.type) {
						case "error":
							term.write(`\x1b[31m${chunk.content}\x1b[0m`);
							break;
						case "warning":
							term.write(`\x1b[33m${chunk.content}\x1b[0m`);
							break;
						case "success":
							term.write(`\x1b[32m${chunk.content}\x1b[0m`);
							break;
						case "prompt":
							term.write(chunk.content);
							break;
						default:
							term.write(chunk.content);
					}
				},
			})
		);
	};

	// Start shell execution in a separate callback
	const startShell = useCallback(async (term: XTerm, session: Session, inputReader: ReadableStreamDefaultReader<string>) => {
		try {
			const shell = new JshCommand(session, inputReader);
			const executionPrms = shell.execute([]);
			await processShellOutput(shell.process.output, term);
			await executionPrms;
		} catch (error) {
			console.error("Shell execution error:", error);
			term.write("\r\nShell terminated unexpectedly. Press any key to restart.\r\n");

			// Setup restart handler
			const cleanup = term.onData(() => {
				cleanup.dispose();
				startShell(term, session, inputReader);
			});
		}
	}, []);

	// Initialize file system
	useEffect(() => {
		const initFS = async () => {
			try {
				await configureSingle({ backend: WebStorage, storage: sessionStorage });

				if (!fs.existsSync("/")) {
					fs.mkdirSync("/", { recursive: true });
				}

				const welcomePath = "/welcome.txt";
				if (!fs.existsSync(welcomePath)) {
					fs.writeFileSync(welcomePath, "Welcome to JSH - JavaScript Shell!\n");
				}

				setIsFileSystemReady(true);
			} catch (error) {
				console.error("Failed to initialize file system:", error);
			}
		};

		initFS();
	}, []);

	// Initialize terminal
	useEffect(() => {
		if (!terminalRef.current || terminalInstance.current || !isFileSystemReady) return;

		const term = new XTerm({
			cursorBlink: true,
			fontSize: 14,
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			disableStdin: readonly,
			scrollback: 1000,
			convertEol: true,
			theme: {
				background: theme.background ?? "#1a1b26",
				foreground: theme.foreground ?? "#a9b1d6",
				cursor: theme.cursor ?? "#c0caf5",
				selectionBackground: theme.selection ?? "#364A82",
				black: "#32344a",
				blue: "#7aa2f7",
				cyan: "#449dab",
				green: "#9ece6a",
				magenta: "#ad8ee6",
				red: "#f7768e",
				white: "#787c99",
				yellow: "#e0af68",
			},
		});

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.loadAddon(new WebLinksAddon());

		terminalInstance.current = term;
		term.open(terminalRef.current);

		// Create input/output streams
		const [inputReadable, inputWritable] = createTextStreamPair();
		const writer = inputWritable.getWriter();
		inputWriterRef.current = writer;

		// Handle terminal input
		term.onData((data) => {
			// term.write(data);
			writer.write(data);
		});

		// Start the shell
		startShell(term, sessionRef.current, inputReadable.getReader());

		// Handle terminal resize
		const resizeObserver = new ResizeObserver(() => {
			fitAddon.fit();
			onTerminalResize?.(term.cols, term.rows);
		});

		resizeObserver.observe(terminalRef.current);

		// Initial fit and focus
		requestAnimationFrame(() => {
			fitAddon.fit();
			term.focus();
		});

		onTerminalReady?.(term);

		return () => {
			resizeObserver.disconnect();
			term.dispose();
			writer.close();
		};
	}, [isFileSystemReady, readonly, theme, onTerminalReady, onTerminalResize, startShell]);

	if (!isFileSystemReady) {
		return (
			<div className="w-full h-full min-h-[400px] bg-[#1a1b26] rounded-lg overflow-hidden shadow-xl border border-gray-800 flex items-center justify-center">
				<span className="text-gray-400">Initializing JSH...</span>
			</div>
		);
	}

	return (
		<div className="w-full h-full min-h-[400px] bg-[#1a1b26] rounded-lg overflow-hidden shadow-xl border border-gray-800">
			<div className="flex items-center px-4 py-2 bg-gray-900 border-b border-gray-800">
				<div className="flex space-x-2">
					<div className="w-3 h-3 rounded-full bg-red-500"></div>
					<div className="w-3 h-3 rounded-full bg-yellow-500"></div>
					<div className="w-3 h-3 rounded-full bg-green-500"></div>
				</div>
				<span className="ml-4 text-sm text-gray-400">JSH Terminal</span>
			</div>
			<div ref={terminalRef} className="w-full h-[calc(100%-2.5rem)]" />
		</div>
	);
};

export default Terminal;
