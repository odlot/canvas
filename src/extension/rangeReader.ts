import { open } from 'node:fs/promises';

/** Random access to the bytes of a file. */
export interface RangeReader {
	readonly length: number;
	/** Bytes `[begin, end)`, clamped to the file. */
	read(begin: number, end: number): Promise<Uint8Array>;
	close(): Promise<void>;
}

/** Clamp a requested byte range to a file of `length` bytes. */
export function clampRange(begin: number, end: number, length: number): [number, number] {
	const b = Math.min(Math.max(0, Math.floor(begin)), length);
	const e = Math.min(Math.max(b, Math.floor(end)), length);
	return [b, e];
}

/** Reads ranges straight from disk, so a large file is never held in memory. */
export async function openFileReader(path: string): Promise<RangeReader> {
	const handle = await open(path, 'r');
	try {
		const { size } = await handle.stat();
		return {
			length: size,
			async read(begin, end) {
				const [b, e] = clampRange(begin, end, size);
				const out = new Uint8Array(e - b);
				let done = 0;
				while (done < out.length) {
					const { bytesRead } = await handle.read(out, done, out.length - done, b + done);
					if (bytesRead === 0) {
						// The file shrank under us; return what exists.
						return out.subarray(0, done);
					}
					done += bytesRead;
				}
				return out;
			},
			close: () => handle.close(),
		};
	} catch (err) {
		await handle.close();
		throw err;
	}
}

/** Serves ranges of bytes already in memory (for file systems without random access). */
export function memoryReader(bytes: Uint8Array): RangeReader {
	return {
		length: bytes.length,
		read(begin, end) {
			const [b, e] = clampRange(begin, end, bytes.length);
			return Promise.resolve(bytes.slice(b, e));
		},
		close: () => Promise.resolve(),
	};
}
