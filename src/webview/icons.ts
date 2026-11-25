/** Tiny inline SVG icons (stroke = currentColor) so we don't need an icon font. */
const svg = (body: string): string =>
	`<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
	note: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h3.5"/>'),
	file: svg('<path d="M4 1.8h5l3.2 3.2v9.2H4z"/><path d="M9 1.8V5h3.2"/>'),
	link: svg('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8"/>'),
	group: svg('<rect x="1.8" y="3.5" width="12.4" height="10" rx="1.5" stroke-dasharray="2 1.6"/><path d="M1.8 3.5V2.2h5"/>'),
	color: svg('<circle cx="8" cy="8" r="5.8"/><path d="M8 2.2v11.6" /><path d="M8 2.2a5.8 5.8 0 0 1 0 11.6z" fill="currentColor"/>'),
	trash: svg('<path d="M2.8 4.3h10.4M6.2 4.3V2.6h3.6v1.7M4.2 4.3l.7 9.1h6.2l.7-9.1"/>'),
	minus: svg('<path d="M3.5 8h9"/>'),
	plus: svg('<path d="M3.5 8h9M8 3.5v9"/>'),
	fit: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
	open: svg('<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v4H2.5V4h4"/>'),
};
