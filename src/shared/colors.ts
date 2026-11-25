import type { CanvasColor } from './types';

/**
 * The six preset colors from the spec. The spec intentionally leaves their exact
 * values undefined so apps can theme them; these are the defaults we render with.
 */
export const PRESET_COLORS: Readonly<Record<string, { name: string; hex: string }>> = {
	'1': { name: 'red', hex: '#e5484d' },
	'2': { name: 'orange', hex: '#f76b15' },
	'3': { name: 'yellow', hex: '#e2b714' },
	'4': { name: 'green', hex: '#30a46c' },
	'5': { name: 'cyan', hex: '#00a2c7' },
	'6': { name: 'purple', hex: '#8e4ec6' },
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isPresetColor(value: string): boolean {
	return Object.prototype.hasOwnProperty.call(PRESET_COLORS, value);
}

export function isHexColor(value: string): boolean {
	return HEX_RE.test(value);
}

export function isValidColor(value: unknown): value is CanvasColor {
	return typeof value === 'string' && (isPresetColor(value) || isHexColor(value));
}

/** Resolve a canvas color to a CSS color string, or `undefined` if unset/invalid. */
export function resolveColor(color: CanvasColor | undefined): string | undefined {
	if (color === undefined) {
		return undefined;
	}
	if (isPresetColor(color)) {
		return PRESET_COLORS[color].hex;
	}
	return isHexColor(color) ? color : undefined;
}
