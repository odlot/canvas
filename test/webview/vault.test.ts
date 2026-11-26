import { describe, expect, it } from 'vitest';
import { posted, useHarness } from './harness';

// The harness host reports the vault "fixtures" and, on `selectVault`, pretends
// the user picked "/elsewhere/Picked Vault".

const harness = useHarness();

describe('vault indicator', () => {
	it('shows the current vault name, with its path in the tooltip', async () => {
		const page = await harness.open();
		const button = page.locator('.toolbar [data-action="vault"]');
		await expect.poll(() => button.innerText()).toBe('fixtures');
		expect(await button.getAttribute('title')).toContain('/workspace/test/fixtures');
	});

	it('asks the host to pick a vault when clicked and shows the new one', async () => {
		const page = await harness.open();
		const button = page.locator('.toolbar [data-action="vault"]');
		await expect.poll(() => button.innerText()).toBe('fixtures');

		await button.click();

		expect((await posted(page)).filter((m) => m.type === 'selectVault')).toHaveLength(1);
		await expect.poll(() => button.innerText()).toBe('Picked Vault');
		expect(await button.getAttribute('title')).toContain('/elsewhere/Picked Vault');
	});
});
