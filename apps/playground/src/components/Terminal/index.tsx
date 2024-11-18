import { useEffect, useRef } from "react";
import { Terminal as XTerm} from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
	onCommand: (command: string) => Promise<void>;
	output: string[];
}

export default function Terminal({ onCommand, output }: TerminalProps) {
	const terminalRef = useRef<HTMLDivElement>(null);
	const xtermRef = useRef<XTerm>();

	useEffect(() => {
		if (!terminalRef.current) return;

		const term = new XTerm({
			cursorBlink: true,
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 14,
			theme: {
				background: "#1e1e1e",
			},
		});

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		term.open(terminalRef.current);
		fitAddon.fit();

		let currentLine = "";

		term.onKey(({ key, domEvent }) => {
			const char = key;

			if (domEvent.keyCode === 13) {
				// Enter
				term.write("\r\n");
				onCommand(currentLine);
				currentLine = "";
			} else if (domEvent.keyCode === 8) {
				// Backspace
				if (currentLine.length > 0) {
					currentLine = currentLine.slice(0, -1);
					term.write("\b \b");
				}
			} else {
				currentLine += char;
				term.write(char);
			}
		});

		xtermRef.current = term;

		return () => {
			term.dispose();
		};
	}, [terminalRef, terminalRef.current]);

	useEffect(() => {
		if (!xtermRef.current) return;

		output.forEach((line) => {
			xtermRef.current?.writeln(line);
		});
	}, [output]);

	return (
		<div className="h-full w-full bg-[#1e1e1e]">
			<div ref={terminalRef} className="h-full" />
		</div>
	);
}
