/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	Range,
	PublishDiagnosticsParams,
	Position,
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);

	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);


	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			}
		}
	};

	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}

	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}

	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface LSPSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: LSPSettings = { maxNumberOfProblems: 100 };
let globalSettings: LSPSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<LSPSettings>> = new Map();

connection.onDidChangeConfiguration(async (change) => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <LSPSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

let fileText: TextDocument;
let problemsCount: number;
let problemsCountLimit: number;
let ram: string[];
let addressToLine: Map<number, number>;

function isAValidKeyword(str: string): boolean {
	const keywords = ["ORG", "END", "DEC", "HEX", "AND", "ADD", "LDA", "STA", "BUN", "BSA", "ISZ", "CLA", "CLE", "CMA", "CME", "CIR", "CIL", "INC", "SPA", "SNA", "SZA", "SZE", "HLT", "INP", "OUT", "SKI", "SKO", "ION", "IOF"];
	
	for (let i = 0; i < keywords.length; i++) {
		if (str === keywords[i]) {
			return true;
		}
	}

	return false;
}

function isAValidDecimalValue(str: string): boolean {
	str = str.replace("DEC", "").trim();
	const value = parseInt(str, 10);
	return (value <= 32767 && value >= -32768);
}

function isAValidHexadecimalValue(str: string): boolean {
	str = str.replace("HEX", "").trim();
	for (let i = 0; i < str.length; i++) {
		if (isNaN(parseInt(str[i], 16))) {
			return false;
		}	
	}
	const value = parseInt(str, 16);
	return (value <= 32767 && value >= -32768);
}

function isAValidMRIInstruction(keyword: string): boolean {
	const keywords = ["AND", "ADD", "LDA", "STA", "BUN", "BSA", "ISZ"];
	
	for (let i = 0; i < keywords.length; i++) {
		if (keyword === keywords[i]) {
			return true;
		}
	}

	return false;
}

function isAValidRRIInstruction(instruction: string): boolean {
	const keywords = ["CLA", "CLE", "CMA", "CME", "CIR", "CIL", "INC", "SPA", "SNA", "SZA", "SZE", "HLT"];

	for (let i = 0; i < keywords.length; i++) {
		if (instruction === keywords[i]) {
			return true;
		}
	}

	return false;
}

function isAValidIOInstruction(instruction: string): boolean {
	const keywords = ["INP", "OUT", "SKI", "SKO", "ION", "IOF"];

	for (let i = 0; i < keywords.length; i++) {
		if (instruction === keywords[i]) {
			return true;
		}
	}

	return false;
}

function isARRIInstuction(instruction: string): boolean {
	const keywords = ["CLA", "CLE", "CMA", "CME", "CIR", "CIL", "INC", "SPA", "SNA", "SZA", "SZE", "HLT"];

	for (let i = 0; i < keywords.length; i++) {
		if (instruction.includes(keywords[i])) {
			return true;
		}
	}

	return false;
}

function isAIOInstuction(instruction: string): boolean {
	const keywords = ["INP", "OUT", "SKI", "SKO", "ION", "IOF"];

	for (let i = 0; i < keywords.length; i++) {
		if (instruction.includes(keywords[i])) {
			return true;
		}
	}
	
	return false;
}

function isAValidAddressValue(address: string): boolean { 
	for (let i = 0; i < address.length; i++) {
		if (isNaN(parseInt(address[i], 16))) {
			return false;
		}	
	}
	const addressHex = parseInt(address, 16);
	return ((addressHex < 4096) && (addressHex >= 0));
}

/// Return false if is a in/valid label or if is a invalid memory address, return false if is a valid memory address
function isAValidAddress(address: string, lcValue: string | undefined): boolean {
	if (lcValue !== undefined) {
		return true;
	} else if ((lcValue === undefined) && (isAValidAddressValue(address))) {
		return false;
	}
	return true;
}

function resolveSymbols(strings: string[]): void {
	const lcTable = new Map<string, string>();
	let lc = 0;
	ram = [];
	addressToLine = new Map<number, number>();
	
	// Initialize the ram content to 4096 bytes of space
	for (let i = 0; i < 4096; i++) {
		ram.push("");
	}

	// Generate the lc table
	for (let i = 0; i < strings.length; i++) {
		const string = strings[i].trim();

		// Ignore comments and empty strings
		if (string.startsWith("/") || string.startsWith(";") || string.startsWith("#") || (string === "")) {
			continue;
		}

		const str = string.split(",")[0].split(" ")[0].trim();
		
		if (str === "ORG") {
			const temp = isAValidAddressValue((string.split(" ")[1] ?? "").trim()) ? parseInt(string.split(" ")[1], 16) : NaN;
			lc = isNaN(temp) ? lc : temp;
			continue;
		} else if (str === "END") {
			break;
		} else if ((str !== "") && (strings[i].includes(","))) {
			lcTable.set(str.replace(",", ""), lc.toString());
		} else if (str === "") {
			continue;
		}

		lc++;
	}

	// Reset the lc 
	lc = 0;

	// Load the content into the ram using the lcTable
	for (let i = 0; i < strings.length; i++) {
		const str = strings[i].trim().replace("\r", "");

		// Ignore comments and empty strings
		if (str.startsWith("/") || str.startsWith(";") || str.startsWith("#") || (str === "")) {
			continue;
		}
		
		const temp = str.split(" ");
		const instruction = temp[temp.length > 2 ? 1 : 0].trim();
		const address = temp[(temp.length > 3) ? temp.length - 2 : temp.length - 1].trim();

		if (instruction === "ORG") {
			lc = isNaN(parseInt(address, 16)) ? lc : parseInt(address, 16);
			continue;
		} else if (instruction === "END") {
			break;
		} else if (isAValidMRIInstruction(instruction)) {
			ram[lc] = isAValidAddress(address, lcTable.get(address)) ? str.replace(address, lcTable.get(address) ?? `UNK-${address}|${i + 1}`) : str.replace(address, parseInt(address, 16).toString());
			addressToLine.set(lc, i + 1);
			lc++;
			continue;
		}

		ram[lc] = str;
		addressToLine.set(lc, i + 1);
		lc++;
	}

	return;
}

function spellChecking(strings: string[]): Diagnostic[] {
	const internalDiagnostics: Diagnostic[] = [];
	for (let i = 0; (i < strings.length) && (problemsCount < (problemsCountLimit - 1)); i++) {	
		let str = strings[i].trim();
		
		// Ignore comments and empty strings
		if (str.startsWith("/") || str.startsWith(";") || str.startsWith("#") || (str === "")) {
			continue;
		}

		// Remove the label if there's any and also the address if is an MRI instruction
		const temp = str.split(",");
		str = temp[temp.length - 1].trim().split(" ")[0].trim();

		const line = i;

		// Check if the evaluated string is a valid keyword
		if (isAValidKeyword(str)) {
			if (str.includes("END")) {
				return internalDiagnostics;
			}
			continue;
		}
		
		const range = Range.create(
			Position.create(line, strings[i].indexOf(str)), 
			Position.create(line, strings[i].length)
		);

		internalDiagnostics.push(Diagnostic.create(range, `Invalid keyword: ${str}`, DiagnosticSeverity.Warning));

		// Increment the problem counter
		problemsCount++;

	}

	return internalDiagnostics;
}

function syntaxChecking(strings: string[]): Diagnostic[] {
	const internalDiagnostics: Diagnostic[] = [];
	let containsEND = false;
	let containsHLT = false;
	
	// First control type: missing address in ORG pseudo-instruction and invalid values with DEC and HEX pseudo-instructions
	for (let i = 0; (i < strings.length) && (problemsCount < (problemsCountLimit - 1)); i++) {	
		let str = strings[i].trim();
		
		// Ignore comments and empty strings
		if (str.startsWith("/") || str.startsWith(";") || str.startsWith("#") || (str === "")) {
			continue;
		}
		
		// Remove the label if there's any
		const temp = str.split(",");
		str = temp[temp.length - 1].trim();
		const range = Range.create( 
			Position.create(i, strings[i].indexOf(str)),
			Position.create(i, strings[i].length)
			);

		// Check if is an ORG pseudo instruction
		if ((str.startsWith("ORG"))) {
			if (str.replace("ORG", "").trim() === "") {
				internalDiagnostics.push(Diagnostic.create(range, "Missing origin address.", DiagnosticSeverity.Error));
				
				// Increment the problem counter
				problemsCount++;

			} else if ((!isAValidAddressValue(str.split(" ")[1])) || (str.split(" ").length > 2)) {
				internalDiagnostics.push(Diagnostic.create(range, "Invalid origin address.", DiagnosticSeverity.Error));
				
				// Increment the problem counter
				problemsCount++;
			}

		} else if ((str.startsWith("DEC")) && !isAValidDecimalValue(str)) {
			internalDiagnostics.push(Diagnostic.create(range, "Invalid decimal value.", DiagnosticSeverity.Warning));

			// Increment the problem counter
			problemsCount++;

		} else if ((str.startsWith("HEX")) && !isAValidHexadecimalValue(str)) {
			internalDiagnostics.push(Diagnostic.create(range, "Invalid hexadecimal value.", DiagnosticSeverity.Warning));

			// Increment the problem counter
			problemsCount++;

		} else if (str.startsWith("END")) {
			containsEND = true;
			// Check instructions under the END pseudo-instruction
			for (let j = i + 1; j < strings.length; j++) {
				if (strings[j].trim() !== "") {
					const newRange = Range.create(
						Position.create(j, 0),
						Position.create(j, Number.MAX_VALUE)
					);
					internalDiagnostics.push(Diagnostic.create(newRange, "Instructions under END pseudo-instructions will be ignored by the assembler, you should comment or remove it.", DiagnosticSeverity.Information));
					
					// Increment the problem counter
					problemsCount++;

				}
			}

			break;

		} else if (str.startsWith("HLT")) {
			containsHLT = true;
		} else if (isAValidMRIInstruction(str.split(" ")[0])) {
			if ((str.split(" ")[2] !== "I") && (str.split(" ")[2] !== undefined)) {
				internalDiagnostics.push(Diagnostic.create(range, "Invalid IMA keyword.", DiagnosticSeverity.Warning));

				// Increment the problem counter
				problemsCount++;
			}
		}
	}

	if ((!containsEND) && (problemsCount < (problemsCountLimit - 1))) {
		const newRange = Range.create(
			Position.create(strings.length - 1, 0),
			Position.create(strings.length - 1, Number.MAX_VALUE)
		);

		internalDiagnostics.push(Diagnostic.create(newRange, "Missing END instruction.", DiagnosticSeverity.Error));

		problemsCount++;

	} 

	if ((!containsHLT) && (problemsCount < (problemsCountLimit - 1))) {
		const newRange = Range.create(
			Position.create(strings.length - 1, 0),
			Position.create(strings.length - 1, Number.MAX_VALUE)
		);

		internalDiagnostics.push(Diagnostic.create(newRange, "Missing HLT instruction will generate an infinite-loop.", DiagnosticSeverity.Error));

		problemsCount++;
	}

	// Second control: unresolved symbols, invalid RRI and IO instructions
	for (let i = 0; (i < 4096) && !(ram[i].includes("END")); i++) {
		if (ram[i].includes("ORG")) {
			i = parseInt(ram[i].substring(ram[i].indexOf("ORG") + 1, 16).trim());
			continue;
		} else if (ram[i].includes("UNK")) {
			let line = parseInt(ram[i].split("|")[1].replace("|", "").trim());
			line = isNaN(line) ? 0 : line - 1;
			const range = Range.create(
				Position.create(line, 0),
				Position.create(line, Number.MAX_VALUE) 
			);
			
			internalDiagnostics.push(Diagnostic.create(range, `Unresolved label ${ram[i].substring(ram[i].indexOf("-") + 1, ram[i].indexOf("|"))}.`, DiagnosticSeverity.Warning));

			// Increment the problems counter
			problemsCount++;

		} else if (!isAValidRRIInstruction(ram[i]) && isARRIInstuction(ram[i])) {
			let line = addressToLine.get(i) ?? i;
			line = line === undefined ? 0 : line - 1;
			const range = Range.create(
				Position.create(line, 0),
				Position.create(line, Number.MAX_VALUE)
			);

			internalDiagnostics.push(Diagnostic.create(range, "Invalid RRI instruction syntax.", DiagnosticSeverity.Error));

			// Increment the problems counter
			problemsCount++;

		} else if (!isAValidIOInstruction(ram[i]) && isAIOInstuction(ram[i])) {
			let line = addressToLine.get(i) ?? i;
			line = line === undefined ? 0 : line - 1;
			const range = Range.create(
				Position.create(line, 0),
				Position.create(line, Number.MAX_VALUE)
			);

			internalDiagnostics.push(Diagnostic.create(range, "Invalid IO instruction syntax.", DiagnosticSeverity.Error));

			// Increment the problems counter
			problemsCount++;

		}
	}

	return internalDiagnostics;
}

function getMemoryAddressContent(address: string, isIMA: boolean): boolean {
	// Get the address if the given instuction address is using IMA
	if (isIMA) {
		address = isAValidDecimalValue(address) ? ram[parseInt(address.split(" ")[1].trim())] : isAValidHexadecimalValue(address) ? ram[parseInt(address.split(" ")[1].trim(), 16)] : ""; 
	}

	return (isAValidDecimalValue(address.slice(address.indexOf("DEC"))) || isAValidHexadecimalValue(address.slice(address.indexOf("HEX"))));
}

function logicChecking(strings: string[]): Diagnostic[] {
	const internalDiagnostics: Diagnostic[] = [];
	const previousOrg: Map<number, number> = new Map<number, number>();

	for (let i = 0; i < strings.length; i++) {
		const instruction = strings[i].trim();
		const range = Range.create(
			Position.create(i, 0),
			Position.create(i, Number.MAX_VALUE)
		);

		// Find ORG instructions with duplicate address
		if (instruction.includes("ORG")) {
			const evaluatedOrgAddress = parseInt(instruction.split("ORG")[1].trim(), 16);

			for (const previousOrgAddress of previousOrg) {
				if ((previousOrgAddress[0] )=== evaluatedOrgAddress) {
					internalDiagnostics.push(Diagnostic.create(range, `ORG Instructions duplicate at line ${previousOrg.get(previousOrgAddress[0])}, causing an overwrite of the previous instructions.`, DiagnosticSeverity.Error));
					// Increment problems counter
					problemsCount++;
					break;
				}
			}

			previousOrg.set(evaluatedOrgAddress, i + 1);
		
		} 
	}

	for (let i = 0; (i < 4096) && !(ram[i].trim().includes("END")) && (problemsCount < (problemsCountLimit - 1)); i++) {
		const instruction = ram[i].split(" ")[0].trim();
		let line = addressToLine.get(i);
		line = line === undefined ? 0 : line - 1;
		const range = Range.create(
			Position.create(line, 0),
			Position.create(line, Number.MAX_VALUE)
		);

		// Ignore empty instructions
		if (instruction === "") {
			continue;
		}

		if (isAValidMRIInstruction(instruction) && !getMemoryAddressContent(ram[parseInt(ram[i].split(" ")[1].trim())], instruction.includes("I"))) {
			internalDiagnostics.push(Diagnostic.create(range, "The instruction address is pointing to an invalid memory address.", DiagnosticSeverity.Warning));
			
			// Increment problems counter
			problemsCount++;

		} else if (instruction.includes("HLT")) {
			if (ram[i - 1] === undefined || ram[i - 2] === undefined) {
				continue;
			}

			// Check if the current HLT pseudo-instruction can be reached
			if ((ram[i - 1].includes("BSA") || ram[i - 1].includes("BUN")) && !(ram[i - 2].includes("ISZ") || ram[i - 2].includes("SPA") || ram[i - 2].includes("SNA") || ram[i - 2].includes("SZA") || ram[i - 2].includes("SZE"))) {
				internalDiagnostics.push(Diagnostic.create(range, "The HLT instruction can't be reached, make sure that the previous jump instruction could be skipped.", DiagnosticSeverity.Warning));

				// Increment problems counter
				problemsCount++;
			}
		}
	}

	return internalDiagnostics;
}

function removeInlineComments(string: string): string[] {
	const strings = string.split("\n");

	for (let i = 0; i < strings.length; i++) {
		const str = strings[i].trim();

		// Ignore comments and empty strings
		if (str.startsWith("/") || str.startsWith(";") || str.startsWith("#") || (str === "")) {
			continue;
		} else if (str.includes("/")) {
			strings[i] = str.substring(0, str.indexOf("/"));
			continue;
		} else if (str.includes(";")) {
			strings[i] = str.substring(0, str.indexOf(";"));
			continue;
		} else if (str.includes("#")) {
			strings[i] = str.substring(0, str.indexOf("#"));
			continue;
		}
	}

	return strings; 
}

function analyzeCode(text: string): Diagnostic[] {
	// Reset the variables
	let diagnostics: Diagnostic[] = [];
	problemsCount = 0;

	if (text === "") {
		return [];
	}

	// Subdivide the string in keywords
	const strings = removeInlineComments(text);
	
	// Resolve the symbols to verify memory usage
	resolveSymbols(strings);

	diagnostics = diagnostics.concat(spellChecking(strings));
	diagnostics = diagnostics.concat(syntaxChecking(strings));
	diagnostics = diagnostics.concat(logicChecking(strings));

	return diagnostics;
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {	
	// Cache the content of the file
	fileText = textDocument;

	problemsCountLimit = globalSettings.maxNumberOfProblems;

	const diagnostics: Diagnostic[] = analyzeCode(textDocument.getText());

	const publishDiagnostics: PublishDiagnosticsParams = {
		uri: textDocument.uri,
		diagnostics: diagnostics, 
		version: textDocument.version
	};
	await connection.sendDiagnostics(publishDiagnostics);
}

function getLabels(strings: string[]): string[] {
	const labels: string[] = [];

	for (let i = 0; i < strings.length; i++) {
		if (strings[i].trim().includes(",")) {
			labels.push(strings[i].trim().split(",")[0].replace(",", ""));
		}
	}

	return labels;
}

function suggestCodeCompletion(text: TextDocumentPositionParams): CompletionItem[] {
	const str = fileText.getText().split("\n")[text.position.line].split(" ")[1];
	const labels: string[] = getLabels(fileText.getText().split("\n"));
	const suggestions: CompletionItem[] = [];

	if ((str !== undefined) && (labels.length)) {
		for (let i = 0; i < labels.length; i++) {
			if (labels[i].includes(str.trim())) {
				suggestions.push({
					label: labels[i],
					kind: CompletionItemKind.Value,
					detail: "Label in this file",
					documentation: "Label in this file"
				});
			}
		}
	}

	const completionDetailMap = new Map<string, string>([
			["ORG", "Change the address origin for the following instructions."],
			["END", "Point the assembler to stop looking for instructions below this point."],
			["DEC", "Point the assembler that the next value is using decimal notation."],
			["HEX", "Point the assembler that the next value is using hexadecimal notation."],
			["AND", "AND Operation between the Accumulator and the value specified at the given address."],
			["ADD", "ADD Operation between the Accumulator and the value specified at the given address."],
			["LDA", "Load the value specified at the given address into the Accumulator."],
			["STA", "Store the value contained in the Accumulator into the given address."],
			["BUN", "Jump to the given address."],
			["BSA", "Jump to the address next the given address, and store the current value of the PC into the given address."],
			["ISZ", "Increment the value specified at the given address, and if the value is 0 skip the next instruction."],
			["CLA", "Clear the Accumulator."],
			["CLE", "Clear the Extension Register."],
			["CMA", "Complement the Accumulator."],
			["CME", "Complement the Extension Register."],
			["CIR", "Shift to the right all the bits contained in the Accumulator, considering the Extension Register as the 17th bit of the Accumulator."],
			["CIL", "Shift to the left all the bits contained in the Accumulator, considering the Extension Register as the 17th bit of the Accumulator."],
			["INC", "Increment the Accumulator."],
			["SPA", "Skip the next instruction if the Accumulator contains a positive value."],
			["SNA", "Skip the next instruction if the Accumulator contains a negative value."],
			["SZA", "Skip the next instruction if the Accumulator is 0."],
			["SZE", "Skip the next instruction if the Extension Register is 0."],
			["HLT", "Stop the machine."],
			["INP", "Read the 16-bits word input from the keyboard as an ASCII value."],
			["OUT", "Print on the terminal the value of the Accumulator as an ASCII value."],
			["SKI", "Skip the next instruction if the Interrupt flag is true."],
			["SKO", "Skip the next instruction if the Interrupt flag is false."],
			["ION", "Enable the Interrupt mode."],
			["IOF", "Disable the Interrupt mode."],
			["I", "Point the assembler to read the instruction using the indirect memory address cycle."]
	]);
	let string = fileText.getText().split("\n")[text.position.line].substring(0, text.position.character);
	string = string.slice(string.indexOf(" ")).trim();

	const keywords = ["ORG", "END", "DEC", "HEX", "AND", "ADD", "LDA", "STA", "BUN", "BSA", "ISZ", "CLA", "CLE", "CMA", "CME", "CIR", "CIL", "INC", "SPA", "SNA", "SZA", "SZE", "HLT", "INP", "OUT", "SKI", "SKO", "ION", "IOF", "I"];

	for (let j = 0; j < keywords.length; j++) {
		if (keywords[j].includes(string)) {
			suggestions.push({
				label: keywords[j],
				kind: CompletionItemKind.Keyword,
				detail: completionDetailMap.get(keywords[j]),
				documentation: completionDetailMap.get(keywords[j])
			});
		}
	}
	return suggestions;
}

connection.onDidSaveTextDocument(async (change) => {
	problemsCountLimit = globalSettings.maxNumberOfProblems;

	const diagnostics: Diagnostic[] = analyzeCode(change.text ?? "");

	// Send the computed diagnostics to VSCode.
	const publishDiagnostics: PublishDiagnosticsParams = {
		uri: change.textDocument.uri,
		diagnostics: diagnostics
	};

	await connection.sendDiagnostics(publishDiagnostics);
});

connection.onDidChangeWatchedFiles(() => {
	problemsCountLimit = globalSettings.maxNumberOfProblems;

	documents.all().forEach(async (document) => {
		const diagnostics: Diagnostic[] = analyzeCode(document.getText());

		// Send the computed diagnostics to VSCode.
		const publishDiagnostics: PublishDiagnosticsParams = {
			uri: document.uri,
			diagnostics: diagnostics, 
			version: document.version
		};
		await connection.sendDiagnostics(publishDiagnostics);
	});
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		return suggestCodeCompletion(_textDocumentPosition);
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		return item;
	}
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
