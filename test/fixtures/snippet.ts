// A code snippet rendered with syntax highlighting
export function edgeMidpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

interface Point {
	x: number;
	y: number;
}
