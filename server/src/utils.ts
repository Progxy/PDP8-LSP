
export function isAValidKeyword(str: string): boolean {
	const keywords = ["ORG", "END", "DEC", "HEX", "AND", "ADD", "LDA", "STA", "BUN", "BSA", "ISZ", "CLA", "CLE", "CMA", "CME", "CIR", "CIL", "INC", "SPA", "SNA", "SZA", "SZE", "HLT", "INP", "OUT", "SKI", "SKO", "ION", "IOF"];
	
	for (let i = 0; i < keywords.length; i++) {
		if (str === keywords[i]) {
			return true;
		}
	}

	return false;
}

export function isAValidDecimalValue(str: string): boolean {
	str = str.replace("DEC", "").trim();
	const value = parseInt(str, 10);
	return (value <= 32767 && value >= -32768);
}

export function isAValidHexadecimalValue(str: string): boolean {
	str = str.replace("HEX", "").trim();
	for (let i = 0; i < str.length; i++) {
		if (isNaN(parseInt(str[i], 16))) {
			return false;
		}	
	}
	const value = parseInt(str, 16);
	return (value <= 32767 && value >= -32768);
}

export function isAValidMRIInstruction(keyword: string): boolean {
	const keywords = ["AND", "ADD", "LDA", "STA", "BUN", "BSA", "ISZ"];
	
	for (let i = 0; i < keywords.length; i++) {
		if (keyword === keywords[i]) {
			return true;
		}
	}

	return false;
}

export function isAValidRRIInstruction(instruction: string): boolean {
	const keywords = ["CLA", "CLE", "CMA", "CME", "CIR", "CIL", "INC", "SPA", "SNA", "SZA", "SZE", "HLT"];

	for (let i = 0; i < keywords.length; i++) {
		if (instruction === keywords[i]) {
			return true;
		}
	}

	return false;
}

export function isAValidIOInstruction(instruction: string): boolean {
	const keywords = ["INP", "OUT", "SKI", "SKO", "ION", "IOF"];

	for (let i = 0; i < keywords.length; i++) {
		if (instruction === keywords[i]) {
			return true;
		}
	}

	return false;
}

export function isARRIInstuction(instruction: string): boolean {
	const keywords = ["CLA", "CLE", "CMA", "CME", "CIR", "CIL", "INC", "SPA", "SNA", "SZA", "SZE", "HLT"];

	for (let i = 0; i < keywords.length; i++) {
		if (instruction.includes(keywords[i])) {
			return true;
		}
	}

	return false;
}

export function isAIOInstuction(instruction: string): boolean {
	const keywords = ["INP", "OUT", "SKI", "SKO", "ION", "IOF"];

	for (let i = 0; i < keywords.length; i++) {
		if (instruction.includes(keywords[i])) {
			return true;
		}
	}
	
	return false;
}

export function isAValidAddressValue(address: string): boolean { 
	for (let i = 0; i < address.length; i++) {
		if (isNaN(parseInt(address[i], 16))) {
			return false;
		}	
	}
	const addressHex = parseInt(address, 16);
	return ((addressHex < 4096) && (addressHex >= 0));
}

/// Return false if is a in/valid label or if is a invalid memory address, return false if is a valid memory address
export function isAValidAddress(address: string, lcValue: string | undefined): boolean {
	if (lcValue !== undefined) {
		return true;
	} else if ((lcValue === undefined) && (isAValidAddressValue(address))) {
		return false;
	}
	return true;
}

export function removeInlineComments(string: string): string[] {
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

export function getLabels(strings: string[]): string[] {
	const labels: string[] = [];

	for (let i = 0; i < strings.length; i++) {
		if (strings[i].trim().includes(",")) {
			labels.push(strings[i].trim().split(",")[0].replace(",", ""));
		}
	}

	return labels;
}