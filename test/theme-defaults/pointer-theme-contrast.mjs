/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const themeDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'extensions', 'theme-defaults', 'themes');

const specifications = [
	{
		file: 'pointer-dark.json',
		palette: {
			canvas: '#0D1117',
			sidebar: '#161B22',
			panel: '#0D1117',
			elevated: '#21262D',
			border: '#30363D',
			text: '#E6EDF3',
			muted: '#9DA7B5',
			accent: '#58A6FF',
			focus: '#58A6FF',
			success: '#56D364',
			warning: '#E3B341',
			error: '#FF7B72',
			info: '#58A6FF'
		},
		contrastPairs: [
			['foreground', 'editor.background'],
			['descriptionForeground', 'editor.background'],
			['input.foreground', 'input.background'],
			['input.placeholderForeground', 'input.background'],
			['button.foreground', 'button.background'],
			['badge.foreground', 'badge.background'],
			['quickInputList.focusForeground', 'quickInputList.focusBackground']
		]
	},
	{
		file: 'pointer-light.json',
		palette: {
			canvas: '#FFFFFF',
			sidebar: '#F6F8FA',
			panel: '#FFFFFF',
			elevated: '#F8F8F8',
			border: '#D0D7DE',
			text: '#18212F',
			muted: '#526174',
			accent: '#0969DA',
			focus: '#0969DA',
			success: '#1A7F37',
			warning: '#9A6700',
			error: '#CF222E',
			info: '#0969DA'
		},
		contrastPairs: [
			['foreground', 'editor.background'],
			['descriptionForeground', 'editor.background'],
			['input.foreground', 'input.background'],
			['input.placeholderForeground', 'input.background'],
			['button.foreground', 'button.background'],
			['badge.foreground', 'badge.background'],
			['quickInputList.focusForeground', 'quickInputList.focusBackground']
		]
	}
];

const semanticMappings = {
	canvas: ['editor.background', 'agents.background'],
	sidebar: ['activityBar.background', 'sideBar.background'],
	panel: ['panel.background'],
	elevated: ['editorWidget.background'],
	border: ['editorWidget.border', 'panel.border'],
	text: ['foreground', 'editor.foreground'],
	muted: ['descriptionForeground', 'input.placeholderForeground'],
	accent: ['textLink.foreground', 'list.highlightForeground'],
	focus: ['focusBorder', 'list.focusOutline'],
	success: ['editorGutter.addedBackground', 'gitDecoration.addedResourceForeground'],
	warning: ['list.warningForeground', 'editorGutter.modifiedBackground'],
	error: ['errorForeground', 'list.errorForeground'],
	info: ['notificationsInfoIcon.foreground']
};

const gitMappings = {
	success: ['gitDecoration.addedResourceForeground', 'gitDecoration.untrackedResourceForeground'],
	warning: ['gitDecoration.modifiedResourceForeground', 'gitDecoration.stageModifiedResourceForeground'],
	error: ['gitDecoration.deletedResourceForeground', 'gitDecoration.stageDeletedResourceForeground']
};

for (const specification of specifications) {
	const theme = JSON.parse(await readFile(join(themeDirectory, specification.file), 'utf8'));
	let minimumRatio = Number.POSITIVE_INFINITY;

	for (const [semanticName, colorIds] of Object.entries(semanticMappings)) {
		for (const colorId of colorIds) {
			assert.equal(theme.colors[colorId], specification.palette[semanticName], `${specification.file}: ${colorId} must use ${semanticName}`);
		}
	}

	for (const [semanticName, colorIds] of Object.entries(gitMappings)) {
		for (const colorId of colorIds) {
			assert.equal(theme.colors[colorId], specification.palette[semanticName], `${specification.file}: ${colorId} must preserve Git semantic parity`);
		}
	}

	for (const [foregroundId, backgroundId] of specification.contrastPairs) {
		minimumRatio = Math.min(minimumRatio, assertContrast(specification.file, foregroundId, theme.colors[foregroundId], backgroundId, theme.colors[backgroundId]));
	}

	for (const semanticName of ['success', 'warning', 'error', 'info']) {
		minimumRatio = Math.min(minimumRatio, assertContrast(specification.file, semanticName, specification.palette[semanticName], 'sidebar', specification.palette.sidebar));
	}

	console.log(`${specification.file}: minimum checked contrast ${minimumRatio.toFixed(2)}:1`);
}

console.log('Pointer theme semantic mapping and WCAG contrast checks passed.');

function assertContrast(file, foregroundName, foreground, backgroundName, background) {
	const ratio = contrastRatio(foreground, background);
	assert.ok(ratio >= 4.5, `${file}: ${foregroundName} on ${backgroundName} is ${ratio.toFixed(2)}:1; expected at least 4.5:1`);
	return ratio;
}

function contrastRatio(foreground, background) {
	const lighter = Math.max(luminance(foreground), luminance(background));
	const darker = Math.min(luminance(foreground), luminance(background));
	return (lighter + 0.05) / (darker + 0.05);
}

function luminance(color) {
	const channels = color.slice(1, 7).match(/.{2}/g).map(channel => Number.parseInt(channel, 16) / 255);
	const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
