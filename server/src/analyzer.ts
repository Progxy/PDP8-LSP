/// This file contains the classes that are used for code analysis and code completion.

import {
	Diagnostic,
	DiagnosticSeverity,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	Range,
	Position,
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import { 
	getLabels, 
	isAIOInstuction, 
	isARRIInstuction,
	isAValidAddress,
	isAValidAddressValue, 
	isAValidDecimalValue, 
	isAValidHexadecimalValue, 
	isAValidIOInstruction, 
	isAValidKeyword, 
	isAValidLabel, 
	isAValidMRIInstruction, 
	isAValidRRIInstruction, 
	removeInlineComments
} from './utils';

export interface LSPSettings {
	maxNumberOfProblems: number;
}

export class Analyzer {
	problemsCount: number;
	problemsCountLimit: number;
	ram: string[];
	addressToLine: Map<number, number>;
	duplicatesLabels: Map<string, string[]>;
	unusedLabels: Map<string, number>;
	invalidLabels: Map<string, number>;

	constructor(problemsCountLimit: number) {
		this.ram = [];
		this.problemsCount = 0;
		this.problemsCountLimit = problemsCountLimit; 
		this.addressToLine = new Map<number, number>();
		this.duplicatesLabels = new Map<string, string[]>();
		this.unusedLabels = new Map<string, number>();
		this.invalidLabels = new Map<string, number>();

		// Initialize the ram content to 4096 bytes of space
		for (let i = 0; i < 4096; i++) {
			this.ram.push("");
		}
	}	

	resolveSymbols(strings: string[]): void {
		const lcTable = new Map<string, string>();
		let lc = 0;
		
		// Initialize the ram content to 4096 bytes of space
		for (let i = 0; i < 4096; i++) {
			this.ram.push("");
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
			} else if (isAValidLabel(str) && (strings[i].includes(","))) {
				const previousLabel = lcTable.get(str.replace(",", ""));
				if (previousLabel !== undefined) {
					this.duplicatesLabels.set(lc.toString(), [str.replace(",", ""), previousLabel]);
				}
				lcTable.set(str.replace(",", ""), lc.toString());
				this.unusedLabels.set(str.replace(",", ""), i);
			} else if (!isAValidLabel(str) && (strings[i].includes(","))) {
				this.invalidLabels.set(str.replace(",", ""), i);
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
			const instruction = temp[str.includes(",") ? 1 : 0].trim();
			const address = (temp[str.includes(",") ? 2 : 1] ?? "").trim();

			if (instruction === "ORG") {
				lc = isNaN(parseInt(address, 16)) ? lc : parseInt(address, 16);
				continue;
			} else if (instruction === "END") {
				break;
			} else if (isAValidMRIInstruction(instruction)) {
				this.ram[lc] = isAValidAddress(address, lcTable.get(address)) ? (instruction + " " + address.replace(address, lcTable.get(address) ?? `UNK-${address}|${i + 1}`) + (temp.includes("I") ? " I" : "")) : (instruction + " " + address.replace(address, parseInt(address, 16).toString()) + (temp.includes("I") ? " I" : ""));
				this.addressToLine.set(lc, i + 1);
				lc++;
				this.unusedLabels.delete(address);
				continue;
			}

			this.ram[lc] = str;
			this.addressToLine.set(lc, i + 1);
			lc++;
		}

		return;
	}

	spellChecking(strings: string[]): Diagnostic[] {
		const internalDiagnostics: Diagnostic[] = [];
		for (let i = 0; (i < strings.length) && (this.problemsCount < (this.problemsCountLimit - 1)); i++) {	
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
			this.problemsCount++;

		}

		return internalDiagnostics;
	}

	syntaxChecking(strings: string[]): Diagnostic[] {
		const internalDiagnostics: Diagnostic[] = [];
		let containsEND = false;
		let containsHLT = false;
		
		// First control type: missing address in ORG pseudo-instruction and invalid values with DEC and HEX pseudo-instructions
		for (let i = 0; (i < strings.length) && (this.problemsCount < (this.problemsCountLimit - 1)); i++) {	
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
					this.problemsCount++;

				} else if ((!isAValidAddressValue(str.split(" ")[1])) || (str.split(" ").length > 2)) {
					internalDiagnostics.push(Diagnostic.create(range, "Invalid origin address.", DiagnosticSeverity.Error));
					
					// Increment the problem counter
					this.problemsCount++;
				}

			} else if ((str.startsWith("DEC")) && !isAValidDecimalValue(str)) {
				internalDiagnostics.push(Diagnostic.create(range, "Invalid decimal value.", DiagnosticSeverity.Warning));

				// Increment the problem counter
				this.problemsCount++;

			} else if ((str.startsWith("HEX")) && !isAValidHexadecimalValue(str)) {
				internalDiagnostics.push(Diagnostic.create(range, "Invalid hexadecimal value.", DiagnosticSeverity.Warning));

				// Increment the problem counter
				this.problemsCount++;

			} else if (str.startsWith("END")) {
				containsEND = true;
				// Check instructions under the END pseudo-instruction
				for (let j = i + 1; j < strings.length; j++) {
					const evaluatedString = strings[j].trim();
					if ((evaluatedString !== "") && !(evaluatedString.startsWith("/") || evaluatedString.startsWith(";") || evaluatedString.startsWith("#"))) {
						const newRange = Range.create(
							Position.create(j, 0),
							Position.create(j, Number.MAX_VALUE)
						);
						internalDiagnostics.push(Diagnostic.create(newRange, "Instructions under END pseudo-instructions will be ignored by the assembler, you should comment or remove it.", DiagnosticSeverity.Information));
						
						// Increment the problem counter
						this.problemsCount++;

					}
				}

				break;

			} else if (str.startsWith("HLT")) {
				containsHLT = true;
			} else if (isAValidMRIInstruction(str.split(" ")[0])) {
				if ((str.split(" ")[2] !== "I") && (str.split(" ")[2] !== undefined)) {
					internalDiagnostics.push(Diagnostic.create(range, "Invalid IMA keyword.", DiagnosticSeverity.Warning));

					// Increment the problem counter
					this.problemsCount++;
				}
			}
		}

		if ((!containsEND) && (this.problemsCount < (this.problemsCountLimit - 1))) {
			const newRange = Range.create(
				Position.create(strings.length - 1, 0),
				Position.create(strings.length - 1, Number.MAX_VALUE)
			);

			internalDiagnostics.push(Diagnostic.create(newRange, "Missing END instruction.", DiagnosticSeverity.Error));

			this.problemsCount++;

		} 

		if ((!containsHLT) && (this.problemsCount < (this.problemsCountLimit - 1))) {
			const newRange = Range.create(
				Position.create(strings.length - 1, 0),
				Position.create(strings.length - 1, Number.MAX_VALUE)
			);

			internalDiagnostics.push(Diagnostic.create(newRange, "Missing HLT instruction will generate an infinite-loop.", DiagnosticSeverity.Error));

			this.problemsCount++;
		}

		// Second control: unresolved symbols, invalid RRI and IO instructions
		for (let i = 0; (i < 4096) && !(this.ram[i].includes("END")); i++) {
			if (this.ram[i].includes("ORG")) {
				i = parseInt(this.ram[i].substring(this.ram[i].indexOf("ORG") + 1, 16).trim());
				continue;
			} else if (this.ram[i].includes("UNK")) {
				let line = parseInt(this.ram[i].split("|")[1].replace("|", "").trim());
				line = isNaN(line) ? 0 : line - 1;
				const range = Range.create(
					Position.create(line, 0),
					Position.create(line, Number.MAX_VALUE) 
				);
				
				internalDiagnostics.push(Diagnostic.create(range, `Unresolved label ${this.ram[i].substring(this.ram[i].indexOf("-") + 1, this.ram[i].indexOf("|"))}.`, DiagnosticSeverity.Warning));

				// Increment the problems counter
				this.problemsCount++;

			} else if (!isAValidRRIInstruction(this.ram[i]) && isARRIInstuction(this.ram[i])) {
				let line = this.addressToLine.get(i) ?? i;
				line = line === undefined ? 0 : line - 1;
				const range = Range.create(
					Position.create(line, 0),
					Position.create(line, Number.MAX_VALUE)
				);

				internalDiagnostics.push(Diagnostic.create(range, "Invalid RRI instruction syntax.", DiagnosticSeverity.Error));

				// Increment the problems counter
				this.problemsCount++;

			} else if (!isAValidIOInstruction(this.ram[i]) && isAIOInstuction(this.ram[i])) {
				let line = this.addressToLine.get(i) ?? i;
				line = line === undefined ? 0 : line - 1;
				const range = Range.create(
					Position.create(line, 0),
					Position.create(line, Number.MAX_VALUE)
				);

				internalDiagnostics.push(Diagnostic.create(range, "Invalid IO instruction syntax.", DiagnosticSeverity.Error));

				// Increment the problems counter
				this.problemsCount++;

			}
		}

		return internalDiagnostics;
	}

	logicChecking(strings: string[]): Diagnostic[] {
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
						this.problemsCount++;
						break;
					}
				}

				previousOrg.set(evaluatedOrgAddress, i + 1);
			
			} 
		}

		for (let i = 0; (i < 4096) && !(this.ram[i].trim().includes("END")) && (this.problemsCount < (this.problemsCountLimit - 1)); i++) {
			const instruction = this.ram[i].split(" ")[0].trim();
			const label = (this.ram[i].trim().split(" ")[2] ?? "").trim() === "I";

			let line = this.addressToLine.get(i);
			line = line === undefined ? 0 : line - 1;
			const range = Range.create(
				Position.create(line, 0),
				Position.create(line, Number.MAX_VALUE)
			);

			// Ignore empty instructions
			if (instruction === "") {
				continue;
			}
			
			if (isAValidMRIInstruction(instruction) && !this.getMemoryAddressContent(this.ram[parseInt(this.ram[i].split(" ")[1].trim())], label)) {
				internalDiagnostics.push(Diagnostic.create(range, "The instruction address is pointing to an invalid memory address.", DiagnosticSeverity.Warning));
				
				// Increment problems counter
				this.problemsCount++;

			} else if (instruction.includes("HLT")) {
				if (this.ram[i - 1] === undefined || this.ram[i - 2] === undefined) {
					continue;
				}

				// Check if the current HLT pseudo-instruction can be reached
				if ((this.ram[i - 1].includes("BSA") || this.ram[i - 1].includes("BUN")) && !(this.ram[i - 2].includes("ISZ") || this.ram[i - 2].includes("SPA") || this.ram[i - 2].includes("SNA") || this.ram[i - 2].includes("SZA") || this.ram[i - 2].includes("SZE"))) {
					internalDiagnostics.push(Diagnostic.create(range, "The HLT instruction can't be reached, make sure that the previous jump instruction could be skipped.", DiagnosticSeverity.Warning));

					// Increment problems counter
					this.problemsCount++;
				}
			}
		}

		// Check for duplicate labels
		for (const label of this.duplicatesLabels) {
			const range: Range = Range.create(
				Position.create((this.addressToLine.get(parseInt(label[0])) ?? Number.MAX_VALUE) - 1, 0),
				Position.create((this.addressToLine.get(parseInt(label[0])) ?? Number.MAX_VALUE) - 1, Number.MAX_VALUE)
			);
			const diagnostic: Diagnostic = Diagnostic.create(range, `Duplicate label: "${label[1][0]}" at previous line ${this.addressToLine.get(parseInt(label[1][1]))}`, DiagnosticSeverity.Warning);
			internalDiagnostics.push(diagnostic);
		}		
		
		// Check for unused labels
		for (const label of this.unusedLabels) {
			const range: Range = Range.create(
				Position.create(label[1], 0),
				Position.create(label[1], Number.MAX_VALUE)
			);
			const diagnostic: Diagnostic = Diagnostic.create(range, `Unused label: "${label[0]}", is better to remove it to prevent bad usage of the RAM`, DiagnosticSeverity.Information);
			internalDiagnostics.push(diagnostic);
		}		
		
		// Check for invalids labels
		for (const label of this.invalidLabels) {
			const range: Range = Range.create(
				Position.create(label[1], 0),
				Position.create(label[1], Number.MAX_VALUE)
			);
			const diagnostic: Diagnostic = Diagnostic.create(range, `Invalid label: "${label[0]}"`, DiagnosticSeverity.Error);
			internalDiagnostics.push(diagnostic);
		}

		return internalDiagnostics;
	}

	getMemoryAddressContent(address: string, isIMA: boolean): boolean {
		// Get the address if the given instuction address is using IMA
		if (isIMA) {
			address = address.indexOf("DEC") == -1 ? address.indexOf("HEX") == -1 ? "#" : address.split("HEX")[1].trim() : address.split("DEC")[1].trim();
			if (address === "#") {
				return false;
			}
			address = isAValidDecimalValue(address) ? this.ram[parseInt(address)] : isAValidHexadecimalValue(address) ? this.ram[parseInt(address, 16)] : ""; 
		}

	if (address === "") {
			return false;
		}

		return (isAValidDecimalValue(address.slice(address.indexOf("DEC"))) || isAValidHexadecimalValue(address.slice(address.indexOf("HEX"))));
	}

	analyzeCode(text: string): Diagnostic[] {
		// Reset the variables
		let diagnostics: Diagnostic[] = [];
		this.problemsCount = 0;

		if (text === "") {
			return [];
		}

		// Subdivide the string in keywords
		const strings = removeInlineComments(text);
		
		// Resolve the symbols to verify memory usage
		this.resolveSymbols(strings);

		diagnostics = diagnostics.concat(this.spellChecking(strings));
		diagnostics = diagnostics.concat(this.syntaxChecking(strings));
		diagnostics = diagnostics.concat(this.logicChecking(strings));

		return diagnostics;
	}

}

export class Suggestions {
	fileText: TextDocument;

	constructor(fileText: TextDocument | undefined) {
		this.fileText = fileText ?? TextDocument.create("", "PDP8 Assembly", 1, "");
	}

	setFileText(fileText: TextDocument) {
		this.fileText = fileText;
	}

	suggestCodeCompletion(text: TextDocumentPositionParams): CompletionItem[] {
		if (this.fileText.uri === "") {
			return [];
		}
		const str = this.fileText.getText().split("\n")[text.position.line].split(" ")[1];
		const labels: string[] = getLabels(this.fileText.getText().split("\n"));
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
		let string = this.fileText.getText().split("\n")[text.position.line].substring(0, text.position.character);
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

}