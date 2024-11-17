import React from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import Terminal from "./components/Terminal";

function App() {
	return (
		<div className="min-h-screen bg-gray-900 text-white p-8">
			<div className="max-w-6xl mx-auto">
				<div className="flex items-center mb-8">
					<TerminalIcon className="w-8 h-8 mr-3 text-blue-400" />
					<h1 className="text-2xl font-bold">Open Webcontainer</h1>
				</div>

				<div className="bg-gray-800 rounded-lg p-6 mb-8">
					<h2 className="text-lg font-semibold mb-4">Available Commands</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<code className="text-green-400">ls</code> <span className="text-gray-300">List directory contents</span>
						</div>
						<div>
							<code className="text-green-400">cd [dir]</code> <span className="text-gray-300">Change directory</span>
						</div>
						<div>
							<code className="text-green-400">pwd</code> <span className="text-gray-300">Print working directory</span>
						</div>
						<div>
							<code className="text-green-400">clear</code> <span className="text-gray-300">Clear the terminal</span>
						</div>
						<div>
							<code className="text-green-400">help</code> <span className="text-gray-300">Show available commands</span>
						</div>
					</div>
				</div>

				<div className="h-[600px]">
					<Terminal />
				</div>
			</div>
		</div>
	);
}

export default App;
