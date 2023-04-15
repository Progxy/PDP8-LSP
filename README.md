# PDP-8 LSP

This Language Server works for pdp8 assembly file (.s/.asm/.pdp8 files).

## Requirements
To work the extensions requires another extension (Pdp8-Linter) to check if the file currently edited uses the Pdp8 Assembly Language.

Pdp8-Linter github repo: [https://github.com/Progxy/pdp8Linter]

## Completions Features
- Keywords;
- Labels (based on the ones that are found inside the file).
## Diagnostics Features
- Spell Checking:
	* Currently supports only spell checking for keywords.
- Syntax Checking: 
	* Missing or invalid address inside ORG pseudo-instruction; 
	* Invalid decimal/hexadecimal value inside DEC/HEX instruction;
	* Unreachables instructions after END pseudo-instruction;
	* Invalid IMA (Indirect Memory Addressing) inside MRI (Memory Reference Instruction) instructions;
	* Missing END pseudo-instruction or HLT instruction;
	* Unresolved labels inside MRI instructions;
	* Invalid RRI (Register Reference Instruction) instructions and IO instructions.
- Logic Checking:
	* Duplicate ORG pseudo-instruction;
	* Duplicate labels;
	* Valid address used inside MRI instructions (also if IMA is used);
	* Check if any HLT instructions can be reached.

## Note
The keywords and the logic checking used is based on the PDP-8 version used for teaching at the University of Perugia.