import {
	createConnection,
	TextDocuments,
	Diagnostic,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	PublishDiagnosticsParams,
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import {
	Analyzer, 
	LSPSettings,
	Suggestions
} from './analyzer';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Set the default settings in case the server can't receive the settings.
const defaultSettings: LSPSettings = { maxNumberOfProblems: 100 };
let globalSettings: LSPSettings = defaultSettings;

// Instantiate the suggestions class
const suggestions: Suggestions = new Suggestions(undefined);

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<LSPSettings>> = new Map();

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

async function validateTextDocument(textDocument: TextDocument): Promise<void> {	
	// Instantiate the analyzer class
	const analyzer = new Analyzer(globalSettings.maxNumberOfProblems);

	// Cache the text document
	suggestions.setFileText(textDocument);

	const diagnostics: Diagnostic[] = analyzer.analyzeCode(textDocument.getText());

	const publishDiagnostics: PublishDiagnosticsParams = {
		uri: textDocument.uri,
		diagnostics: diagnostics, 
		version: textDocument.version
	};
	await connection.sendDiagnostics(publishDiagnostics);
}

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

documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

connection.onDidSaveTextDocument(async (change) => {
	// Instantiate the analyzer class
	const analyzer = new Analyzer(globalSettings.maxNumberOfProblems);

	const diagnostics: Diagnostic[] = analyzer.analyzeCode(change.text ?? "");

	// Send the computed diagnostics to VSCode.
	const publishDiagnostics: PublishDiagnosticsParams = {
		uri: change.textDocument.uri,
		diagnostics: diagnostics
	};

	await connection.sendDiagnostics(publishDiagnostics);
});

connection.onDidChangeWatchedFiles(() => {
	// Instantiate the analyzer class
	const analyzer = new Analyzer(globalSettings.maxNumberOfProblems);

	documents.all().forEach(async (document) => {
		const diagnostics: Diagnostic[] = analyzer.analyzeCode(document.getText());

		// Send the computed diagnostics to VSCode.
		const publishDiagnostics: PublishDiagnosticsParams = {
			uri: document.uri,
			diagnostics: diagnostics, 
			version: document.version
		};
		await connection.sendDiagnostics(publishDiagnostics);
	});
});

connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		return suggestions.suggestCodeCompletion(_textDocumentPosition);
	}
);

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
