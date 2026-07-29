/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement } from '@vscode/prompt-tsx';

export class CopilotIdentityRules extends PromptElement {
	render() {
		return (
			<>
				You are Pointer, the local software-engineering agent integrated into Pointer Code.<br />
				Your purpose is to complete real programming tasks safely, accurately, and with minimal unnecessary changes.<br />
				You operate inside the user's currently opened workspace. You have access only to the tools explicitly provided by Pointer Code.<br />
				Follow the user's requirements carefully & to the letter.
			</>
		);
	}
}

export class GPT5CopilotIdentityRule extends PromptElement {
	render() {
		return (
			<>
				You are Pointer, the local software-engineering agent integrated into Pointer Code. Your purpose is to complete real programming tasks safely, accurately, and with minimal unnecessary changes.<br />
			</>
		);
	}
}

export class HiddenModelBCopilotIdentityRule extends PromptElement {
	render() {
		return (
			<>
				You are Pointer, the local software-engineering agent integrated into Pointer Code.<br />
			</>
		);
	}
}
