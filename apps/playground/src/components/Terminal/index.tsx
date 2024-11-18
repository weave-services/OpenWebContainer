import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
	onCommand: (input: string) => Promise<void>;
	output: string[];
}

export default function Terminal({ onCommand, output }: TerminalProps) {
	const terminalRef = useRef<HTMLDivElement>(null);
	const xtermRef = useRef<XTerm>();
	const lastOutputLengthRef = useRef(0);

	useEffect(() => {
		if (!terminalRef.current) return;

		const term = new XTerm({
			cursorBlink: true,
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 14,
			theme: {
				background: "#1e1e1e",
			},
			convertEol: true,
			allowTransparency: true,
		});

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		term.open(terminalRef.current);
		fitAddon.fit();

		term.onKey(({ key, domEvent }) => {
			// Pass raw input to the process
			switch (domEvent.keyCode) {
				case 38: // Up arrow
					onCommand("\x1b[A");
					break;
				case 40: // Down arrow
					onCommand("\x1b[B");
					break;
				case 13: // Enter
					onCommand("\r");
					break;
				case 8: // Backspace
					onCommand("\b");
					break;
				default:
					if (!domEvent.ctrlKey && !domEvent.altKey && key.length === 1) {
						onCommand(key);
					}
					break;
			}
		});

		xtermRef.current = term;

		const handleResize = () => {
			fitAddon.fit();
		};
		window.addEventListener("resize", handleResize);

		return () => {
			window.removeEventListener("resize", handleResize);
			term.dispose();
		};
	}, [terminalRef.current]);

	useEffect(() => {
		if (!xtermRef.current) return;

		const newOutput = output.slice(lastOutputLengthRef.current);
		lastOutputLengthRef.current = output.length;

		newOutput.forEach((line) => {
			if (line.length > 0) {
				xtermRef.current?.write(line);
			}
		});
	}, [output]);

	return (
		<div className="h-full w-full bg-[#1e1e1e]">
			<div ref={terminalRef} className="h-full" />
		</div>
	);
}
