// If you can read this, you are too close

import * as vscode from 'vscode';
import AlignmentGroup from './AlignmentGroup';
import DecorationSet from './DecorationSet';
import DecorationTypeStore from './DecorationTypeStore';
import LineData from './LineData';
import { getLineMatch } from './operatorGroups';

// Hi, If you're reading this, you're probably interested to know how this
// extension works.

/*
	When an editor is decorated, the document is parsed line by line.

	Each line is split in to parts, each part contains some text, followed by an
	"operator".

	For certain types of operators (eg. 'binary' operators), it may only be
	considered if it is immediately followed by a space. This is to ignore
	operators like '+' and '-' which can appear as both binary, and unary
	operators. This helps to handle negative numbers "-5" to be treated the same
	as positive numbers "5".

	```typescript
	foo = -foo + 1
	foobar = foobar + 2
	if (foo === bar)
		foo = bar
	bar = bar
	bar.foo = foo
	bar.foobar = baz
	```

	In this case, the lines are split as follows. Note that the '-' in '-foo' is
	not considered as it doesn't have a following space.

	['foo =', ' -foo +']
	['foobar =', ' foobar +']
	['if (foo ===']
	['foo =']
	['bar =']
	['bar.foo =']
	['bar.foobar =']

	Then lines are grouped by their signature, which consists of the

	-	indentation
	-	operator group
	-	prefix

	The indentation is just simply any whitespace characters before the first
	non-whitespace character.

	Operators are grouped in to the following types. These groups are mostly
	arbitrary, and just what I've found that work.

	-	assignment
	-	binary
	-	comparison
	-	comma

	The prefix is a little bit more complicated as its goal is to group similar
	object assignments. In most languages that I use, objects are indexed by the
	'.' or the '->' operators. The prefix of a line is set if the first part of
	the line

	-	is an assignment operator
	-	includes one of these indexing operators
	-	contains only word characters after the last indexing operator

	The prefix is taken as everything upto and including the last index
	operator.

	The line signatures from above then become

	{indent: '', prefix: '', operatorTypes: ['assignment', 'binary']}
	{indent: '', prefix: '', operatorTypes: ['assignment', 'binary']}
	{indent: '', prefix: '', operatorTypes: ['comparison']}
	{indent: '\t', prefix: '', operatorTypes: ['assignment']}
	{indent: '', prefix: '', operatorTypes: ['assignment']}
	{indent: '', prefix: 'bar.', operatorTypes: ['assignment']}
	{indent: '', prefix: 'bar.', operatorTypes: ['assignment']}

	Adjacent lines with equal signatures are then grouped.

	For each group, the maximum width of each nth part is calculated, then
	decorators are applied to the character just before the operator. The
	decorator applies the `letter-spacing' css property so that the part appears
	as wide as the maximum width. It is assumed that users have a fixed-width
	font.

	When calculating the width, it is also assumed that a tab is 4 characters
	wide.
*/

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "align-spaces" is now active!');

	const eventHandler = (
		event: vscode.TextDocumentChangeEvent | vscode.TextDocument
	) => {
		const doc = 'document' in event ? event.document : event;

		const openEditor = vscode.window.visibleTextEditors.filter(
			(editor) => editor.document.uri === doc.uri
		)[0];

		try {
			if (openEditor) {
				decorate(openEditor);
			}
		} catch (e: unknown) {
			console.error(e);
		}
	};
	vscode.workspace.onDidChangeTextDocument(eventHandler);
	// vscode.workspace.onDidOpenTextDocument(eventHandler);

	const editorEventHandler = (editor: vscode.TextEditor | undefined) => {
		if (editor) {
			try {
				decorate(editor);
			} catch (e: unknown) {
				console.error(e);
			}
		}
	};
	vscode.window.onDidChangeActiveTextEditor(editorEventHandler);

	// Decorate the currently visible editors
	vscode.window.visibleTextEditors.forEach(editorEventHandler);
}

export const decorationTypes = new DecorationTypeStore();

export function getPhysicalWidth(line: string) {
	return line
		.split('')
		.map((ch, i) => (ch === '\t' ? 4 - ((i + 1) % 4) + 3 : 1))
		.reduce((a, b) => a + b, 0);
}

class ThingBuilder<T> {
	public current: T | null = null;

	private _all: T[] = [];

	get all() {
		return this._all;
	}

	push(next?: T) {
		if (this.current !== null) {
			this._all.push(this.current);
		}

		this.current = next === undefined ? null : next;
	}
}

function decorate(editor: vscode.TextEditor) {
	decorationTypes.reset();

	let sourceCode = editor.document.getText();

	const sourceCodeArr = sourceCode.split('\n');

	const groupBuilder = new ThingBuilder<AlignmentGroup>();

	for (let line = 0; line < sourceCodeArr.length; line++) {
		const lineMatch = getLineMatch();

		if (!lineMatch.test(sourceCodeArr[line])) {
			groupBuilder.push();
			continue;
		}

		const stuff = LineData.fromString(sourceCodeArr[line]);

		if (
			groupBuilder.current &&
			!groupBuilder.current.isLineStuffCompatible(stuff)
		) {
			groupBuilder.push();
		}

		if (groupBuilder.current === null) {
			groupBuilder.current = new AlignmentGroup(line, [stuff]);
			continue;
		}

		groupBuilder.current.lines.push(stuff);
	}
	groupBuilder.push();

	const groups = groupBuilder.all;

	const decorators = groups
		.map((group) => group.resolveAlignment())
		.reduce((all, curr) => all.combine(curr), new DecorationSet());

	decorators.apply(editor);
}

export function deactivate() {
	decorationTypes.reset();
	console.log('Extension "align-spaces" deactivated.');
}
