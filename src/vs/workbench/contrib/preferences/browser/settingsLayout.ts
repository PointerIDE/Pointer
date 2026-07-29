/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { ISetting, ISettingsGroup } from '../../../services/preferences/common/preferences.js';
import { AI_MODELS_SETTINGS_CATEGORY_ID } from '../common/preferences.js';

export interface ITOCFilter {
	include?: {
		keyPatterns?: string[];
		tags?: string[];
	};
	exclude?: {
		keyPatterns?: string[];
		tags?: string[];
	};
}

export interface ITOCEntry<T> {
	id: string;
	label: string;
	order?: number;
	children?: ITOCEntry<T>[];
	settings?: Array<T>;
	hide?: boolean;
}

const COMMONLY_USED_SETTINGS: readonly string[] = [
	'editor.fontSize',
	'editor.formatOnSave',
	'files.autoSave',
	'chat.fontSize',
	'editor.defaultFormatter',
	'editor.fontFamily',
	'editor.wordWrap',
	'chat.agent.maxRequests',
	'files.exclude',
	'workbench.colorTheme',
	'editor.tabSize',
	'editor.mouseWheelZoom',
	'editor.formatOnPaste'
];

export function getCommonlyUsedData(settingGroups: ISettingsGroup[]): ITOCEntry<ISetting> {
	const allSettings = new Map<string, ISetting>();
	for (const group of settingGroups) {
		for (const section of group.sections) {
			for (const s of section.settings) {
				allSettings.set(s.key, s);
			}
		}
	}
	const settings: ISetting[] = [];
	for (const id of COMMONLY_USED_SETTINGS) {
		const setting = allSettings.get(id);
		if (setting) {
			settings.push(setting);
		}
	}
	return {
		id: 'commonlyUsed',
		label: localize('commonlyUsed', "Commonly Used"),
		settings
	};
}

export const tocData: ITOCEntry<string> = {
	id: 'root',
	label: 'root',
	children: [
		{
			// Keep the `features` id for @feature filters in settingsTreeModels.ts.
			id: 'features',
			label: localize('general', "General"),
			children: [
				{
					id: 'workbench/settings',
					label: localize('settings', "Settings Editor"),
					settings: ['workbench.settings.*']
				},
				{
					id: 'workbench/browser',
					label: localize('browser', "Browser"),
					settings: ['workbench.browser.*']
				},
				{
					id: 'window',
					label: localize('window', "Window"),
					settings: ['window.*'],
					children: [
						{
							id: 'window/newWindow',
							label: localize('newWindow', "New Window"),
							settings: ['window.*newwindow*']
						}
					]
				},
				{
					id: 'application/keyboard',
					label: localize('keyboard', "Keyboard"),
					settings: ['keyboard.*']
				},
				{
					id: 'application/update',
					label: localize('update', "Update"),
					settings: ['update.*']
				},
				{
					id: 'application/settingsSync',
					label: localize('settingsSync', "Settings Sync"),
					settings: ['settingsSync.*']
				},
				{
					id: 'features/debug',
					label: localize('debug', "Debug"),
					settings: ['debug.*', 'launch']
				},
				{
					id: 'features/testing',
					label: localize('testing', "Testing"),
					settings: ['testing.*']
				},
				{
					id: 'features/task',
					label: localize('task', "Task"),
					settings: ['task.*']
				},
				{
					id: 'features/problems',
					label: localize('problems', "Problems"),
					settings: ['problems.*']
				},
				{
					id: 'features/output',
					label: localize('output', "Output"),
					settings: ['output.*']
				},
				{
					id: 'features/comments',
					label: localize('comments', "Comments"),
					settings: ['comments.*']
				},
				{
					id: 'features/remote',
					label: localize('remote', "Remote"),
					settings: ['remote.*']
				},
				{
					id: 'features/timeline',
					label: localize('timeline', "Timeline"),
					settings: ['timeline.*']
				},
				{
					id: 'features/notebook',
					label: localize('notebook', "Notebook"),
					settings: ['notebook.*', 'interactiveWindow.*']
				},
				{
					id: 'features/issueReporter',
					label: localize('issueReporter', "Issue Reporter"),
					settings: ['issueReporter.*'],
					hide: !isWeb
				},
				// These hidden entries preserve @feature filters after their visible groups moved.
				{ id: 'features/accessibilitySignals', label: localize('accessibility.signals', "Accessibility Signals"), settings: ['accessibility.signal*'], hide: true },
				{ id: 'features/accessibility', label: localize('accessibility', "Accessibility"), settings: ['accessibility.*'], hide: true },
				{ id: 'features/explorer', label: localize('fileExplorer', "Explorer"), settings: ['explorer.*', 'outline.*'], hide: true },
				{ id: 'features/search', label: localize('search', "Search"), settings: ['search.*'], hide: true },
				{ id: 'features/scm', label: localize('scm', "Source Control"), settings: ['scm.*'], hide: true },
				{ id: 'features/extensions', label: localize('extensions', "Extensions"), settings: ['extensions.*'], hide: true },
				{ id: 'features/terminal', label: localize('terminal', "Terminal"), settings: ['terminal.*'], hide: true },
				{ id: 'features/mergeEditor', label: localize('mergeEditor', "Merge Editor"), settings: ['mergeEditor.*'], hide: true }
			]
		},
		{
			id: 'editor',
			label: localize('editor', "Editor"),
			children: [
				{
					id: 'editor/cursor',
					label: localize('cursor', "Cursor"),
					settings: ['editor.cursor*']
				},
				{
					id: 'editor/find',
					label: localize('find', "Find"),
					settings: ['editor.find.*']
				},
				{
					id: 'editor/font',
					label: localize('font', "Font"),
					settings: ['editor.font*']
				},
				{
					id: 'editor/format',
					label: localize('formatting', "Formatting"),
					settings: ['editor.format*']
				},
				{
					id: 'editor/diffEditor',
					label: localize('diffEditor', "Diff Editor"),
					settings: ['diffEditor.*']
				},
				{
					id: 'editor/multiDiffEditor',
					label: localize('multiDiffEditor', "Multi-File Diff Editor"),
					settings: ['multiDiffEditor.*']
				},
				{
					id: 'editor/minimap',
					label: localize('minimap', "Minimap"),
					settings: ['editor.minimap.*']
				},
				{
					id: 'editor/suggestions',
					label: localize('suggestions', "Suggestions"),
					settings: ['editor.*suggest*']
				},
				{
					id: 'workbench/editor',
					label: localize('editorManagement', "Editor Management"),
					settings: ['workbench.editor.*']
				}
			]
		},
		{
			id: 'appearance',
			label: localize('appearance', "Appearance"),
			children: [
				{
					id: 'appearance/workbench',
					label: localize('appearance', "Appearance"),
					settings: ['workbench.activityBar.*', 'workbench.*color*', 'workbench.fontAliasing', 'workbench.iconTheme', 'workbench.sidebar.location', 'workbench.*.visible', 'workbench.tips.enabled', 'workbench.tree.*', 'workbench.view.*']
				},
				{
					id: 'workbench/breadcrumbs',
					label: localize('breadcrumbs', "Breadcrumbs"),
					settings: ['breadcrumbs.*']
				},
				{
					id: 'workbench/zenmode',
					label: localize('zenMode', "Zen Mode"),
					settings: ['zenmode.*']
				},
				{
					id: 'workbench/screencastmode',
					label: localize('screencastMode', "Screencast Mode"),
					settings: ['screencastMode.*']
				}
			]
		},
		{
			id: AI_MODELS_SETTINGS_CATEGORY_ID,
			label: localize('aiAndModels', "AI & Models"),
			children: [
				{
					id: 'chat/agent',
					label: localize('chatAgent', "Agent"),
					settings: [
						'chat.agent.*',
						'chat.checkpoints.*',
						'chat.editRequests',
						'chat.requestQueuing.*',
						'chat.undoRequests.*',
						'chat.customAgentInSubagent.*',
						'chat.editing.autoAcceptDelay',
						'chat.editing.confirmEditRequest*',
						'chat.planAgent.defaultModel',
						'github.copilot.chat.agent.terminal.*'
					]
				},
				{
					id: 'chat/appearance',
					label: localize('chatAppearance', "Appearance"),
					settings: [
						'chat.editor.*',
						'chat.fontFamily',
						'chat.fontSize',
						'chat.math.*',
						'chat.agentsControl.*',
						'chat.alternativeToolAction.*',
						'chat.codeBlock.*',
						'chat.editing.explainChanges.enabled',
						'chat.editMode.hidden',
						'chat.editorAssociations',
						'chat.extensionUnification.*',
						'chat.inlineReferences.*',
						'chat.notifyWindow*',
						'chat.statusWidget.*',
						'chat.tips.*',
						'chat.unifiedAgentsBar.*',
						'accessibility.signals.chatUserActionRequired',
						'accessibility.signals.chatResponseReceived'
					]
				},
				{
					id: 'chat/sessions',
					label: localize('chatSessions', "Sessions"),
					settings: [
						'chat.agentSessionProjection.*',
						'chat.sessions.*',
						'chat.viewProgressBadge.*',
						'chat.viewSessions.*',
						'chat.restoreLastPanelSession',
						'chat.exitAfterDelegation',
						'chat.repoInfo.*'
					]
				},
				{
					id: 'chat/tools',
					label: localize('chatTools', "Tools"),
					settings: [
						'chat.tools.*',
						'chat.extensionTools.*'
					]
				},
				{
					id: 'chat/mcp',
					label: localize('chatMcp', "MCP"),
					settings: ['mcp', 'chat.mcp.*', 'mcp.*']
				},
				{
					id: 'chat/context',
					label: localize('chatContext', "Context"),
					settings: [
						'chat.detectParticipant.*',
						'chat.experimental.detectParticipant.*',
						'chat.implicitContext.*',
						'chat.promptFilesLocations',
						'chat.instructionsFilesLocations',
						'chat.modeFilesLocations',
						'chat.agentFilesLocations',
						'chat.agentSkillsLocations',
						'chat.hookFilesLocations',
						'chat.promptFilesRecommendations',
						'chat.useAgentsMdFile',
						'chat.useNestedAgentsMdFiles',
						'chat.useAgentSkills',
						'chat.experimental.useSkillAdherencePrompt',
						'chat.useHooks',
						'chat.includeApplyingInstructions',
						'chat.includeReferencedInstructions',
						'chat.sendElementsToChat.*',
						'chat.useClaudeMdFile'
					]
				},
				{
					id: 'chat/inlineChat',
					label: localize('chatInlineChat', "Inline Chat"),
					settings: ['inlineChat.*']
				},
				{
					id: 'chat/miscellaneous',
					label: localize('chatMiscellaneous', "Miscellaneous"),
					settings: [
						'chat.disableAIFeatures',
						'chat.allowAnonymousAccess'
					]
				}
			]
		},
		{
			id: 'files',
			label: localize('files', "Files"),
			children: [
				{
					id: 'files/handling',
					label: localize('fileHandling', "File Handling"),
					settings: ['files.*']
				},
				{
					id: 'files/explorer',
					label: localize('fileExplorer', "Explorer"),
					settings: ['explorer.*', 'outline.*']
				},
				{
					id: 'files/search',
					label: localize('search', "Search"),
					settings: ['search.*']
				}
			]
		},
		{
			id: 'terminal',
			label: localize('terminal', "Terminal"),
			children: [
				{
					id: 'terminal/integrated',
					label: localize('integratedTerminal', "Integrated Terminal"),
					settings: ['terminal.*']
				}
			]
		},
		{
			id: 'sourceControl',
			label: localize('gitAndSourceControl', "Git & Source Control"),
			children: [
				{
					id: 'sourceControl/scm',
					label: localize('scm', "Source Control"),
					settings: ['scm.*']
				},
				{
					id: 'sourceControl/mergeEditor',
					label: localize('mergeEditor', "Merge Editor"),
					settings: ['mergeEditor.*']
				}
			]
		},
		{
			id: 'extensions',
			label: localize('extensions', "Extensions"),
			children: [
				{
					id: 'extensions/management',
					label: localize('extensionManagement', "Extension Management"),
					settings: ['extensions.*']
				}
			]
		},
		{
			id: 'privacyAndNetwork',
			label: localize('privacyAndNetwork', "Privacy & Network"),
			children: [
				{
					id: 'application/http',
					label: localize('proxy', "Proxy"),
					settings: ['http.*']
				},
				{
					id: 'application/network',
					label: localize('network', "Network"),
					settings: ['network.*']
				},
				{
					id: 'application/telemetry',
					label: localize('telemetry', "Telemetry"),
					settings: ['telemetry.*']
				},
				{
					id: 'security',
					label: localize('security', "Security"),
					settings: ['security.*'],
					children: [
						{
							id: 'security/workspace',
							label: localize('workspace', "Workspace"),
							settings: ['security.workspace.*']
						}
					]
				}
			]
		},
		{
			id: 'accessibility',
			label: localize('accessibility', "Accessibility"),
			children: [
				{
					id: 'accessibility/signals',
					label: localize('accessibility.signals', "Accessibility Signals"),
					settings: ['accessibility.signal*']
				},
				{
					id: 'accessibility/general',
					label: localize('accessibility', "Accessibility"),
					settings: ['accessibility.*']
				}
			]
		},
		{
			id: 'advanced',
			label: localize('advanced', "Advanced"),
			children: [
				{
					id: 'advanced/experimental',
					label: localize('experimental', "Experimental"),
					settings: ['application.experimental.*', '@tag:experimental', '@tag:preview']
				},
				{
					id: 'advanced/tagged',
					label: localize('advancedSettings', "Advanced Settings"),
					settings: ['@tag:advanced']
				},
				{
					id: 'advanced/editor',
					label: localize('otherEditorSettings', "Other Editor Settings"),
					settings: ['editor.*']
				},
				{
					id: 'advanced/workbench',
					label: localize('otherWorkbenchSettings', "Other Workbench Settings"),
					settings: ['workbench.*']
				},
				{
					id: 'advanced/chat',
					label: localize('otherAiSettings', "Other AI & Model Settings"),
					settings: ['chat.*']
				},
				{
					id: 'application/other',
					label: localize('otherApplicationSettings', "Other Application Settings"),
					settings: ['application.*']
				}
			]
		}
	]
};
