/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { CONTEXT_MODELS_EDITOR, CONTEXT_MODELS_SEARCH_FOCUS, MANAGE_CHAT_COMMAND_ID } from '../../common/constants.js';
import { CHAT_CATEGORY } from '../actions/chatActions.js';
import { ModelsManagementEditor } from './chatManagementEditor.js';
import { ModelsManagementEditorInput } from './chatManagementEditorInput.js';
import { openLanguageModelSettings } from './languageModelSettingsNavigation.js';
import { ProviderSetupEditor } from './providerSetupEditor.js';
import { ProviderSetupEditorInput } from './providerSetupEditorInput.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ModelsManagementEditor,
		ModelsManagementEditor.ID,
		localize('modelsManagementEditor', "Models Management Editor")
	),
	[
		new SyncDescriptor(ModelsManagementEditorInput)
	]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ProviderSetupEditor,
		ProviderSetupEditor.ID,
		localize('providerSetupEditor', "Language Models")
	),
	[
		new SyncDescriptor(ProviderSetupEditorInput)
	]
);

class ModelsManagementEditorInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(input: ModelsManagementEditorInput): string {
		return '';
	}

	deserialize(instantiationService: IInstantiationService): ModelsManagementEditorInput {
		return instantiationService.createInstance(ModelsManagementEditorInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ModelsManagementEditorInput.ID, ModelsManagementEditorInputSerializer);

class ProviderSetupEditorInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(input: ProviderSetupEditorInput): string {
		return '';
	}

	deserialize(instantiationService: IInstantiationService): ProviderSetupEditorInput {
		return instantiationService.createInstance(ProviderSetupEditorInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ProviderSetupEditorInput.ID, ProviderSetupEditorInputSerializer);

class ChatManagementActionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatManagementActions';

	constructor() {
		super();
		this.registerChatManagementActions();
	}

	private registerChatManagementActions() {
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: MANAGE_CHAT_COMMAND_ID,
					title: localize2('openAiManagement', "Manage Language Models"),
					category: CHAT_CATEGORY,
					f1: false,
				});
			}
			async run(accessor: ServicesAccessor) {
				return openLanguageModelSettings(accessor.get(IPreferencesService));
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'chat.models.action.clearSearchResults',
					precondition: CONTEXT_MODELS_EDITOR,
					keybinding: {
						primary: KeyCode.Escape,
						weight: KeybindingWeight.EditorContrib,
						when: CONTEXT_MODELS_SEARCH_FOCUS
					},
					title: localize2('models.clearResults', "Clear Models Search Results")
				});
			}

			run(accessor: ServicesAccessor) {
				const activeEditorPane = accessor.get(IEditorService).activeEditorPane;
				if (activeEditorPane instanceof ModelsManagementEditor) {
					activeEditorPane.clearSearch();
				}
				return null;
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openLanguageModelsJson',
					title: localize2('openLanguageModelsSettings', "Manage Language Models"),
					category: CHAT_CATEGORY,
					f1: false,
				});
			}

			async run(accessor: ServicesAccessor) {
				return openLanguageModelSettings(accessor.get(IPreferencesService));
			}
		}));
	}

}

registerWorkbenchContribution2(ChatManagementActionsContribution.ID, ChatManagementActionsContribution, WorkbenchPhase.AfterRestored);
