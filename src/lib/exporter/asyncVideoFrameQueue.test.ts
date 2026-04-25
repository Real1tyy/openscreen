import { describe, expect, it, vi } from "vitest";
import { AsyncVideoFrameQueue } from "./asyncVideoFrameQueue";

function mockFrame(): VideoFrame {
	return { close: vi.fn() } as unknown as VideoFrame;
}

describe("AsyncVideoFrameQueue", () => {
	it("starts with length 0", () => {
		const queue = new AsyncVideoFrameQueue();
		expect(queue.length).toBe(0);
	});

	it("enqueue increases length", () => {
		const queue = new AsyncVideoFrameQueue();
		queue.enqueue(mockFrame());
		expect(queue.length).toBe(1);
		queue.enqueue(mockFrame());
		expect(queue.length).toBe(2);
	});

	it("dequeue returns frames in FIFO order", async () => {
		const queue = new AsyncVideoFrameQueue();
		const f1 = mockFrame();
		const f2 = mockFrame();
		queue.enqueue(f1);
		queue.enqueue(f2);

		expect(await queue.dequeue()).toBe(f1);
		expect(await queue.dequeue()).toBe(f2);
		expect(queue.length).toBe(0);
	});

	it("dequeue resolves immediately when frames are buffered", async () => {
		const queue = new AsyncVideoFrameQueue();
		queue.enqueue(mockFrame());
		const frame = await queue.dequeue();
		expect(frame).not.toBeNull();
	});

	it("dequeue waits for enqueue when buffer is empty", async () => {
		const queue = new AsyncVideoFrameQueue();
		const pending = queue.dequeue();
		const f = mockFrame();

		queue.enqueue(f);
		const result = await pending;
		expect(result).toBe(f);
		expect(queue.length).toBe(0);
	});

	it("close resolves waiting consumers with null", async () => {
		const queue = new AsyncVideoFrameQueue();
		const pending = queue.dequeue();
		queue.close();
		expect(await pending).toBeNull();
	});

	it("dequeue returns null after close with empty buffer", async () => {
		const queue = new AsyncVideoFrameQueue();
		queue.close();
		expect(await queue.dequeue()).toBeNull();
	});

	it("enqueue after close closes the frame immediately", () => {
		const queue = new AsyncVideoFrameQueue();
		queue.close();
		const f = mockFrame();
		queue.enqueue(f);
		expect(f.close).toHaveBeenCalled();
		expect(queue.length).toBe(0);
	});

	it("fail rejects waiting consumers", async () => {
		const queue = new AsyncVideoFrameQueue();
		const pending = queue.dequeue();
		queue.fail(new Error("decode error"));
		await expect(pending).rejects.toThrow("decode error");
	});

	it("fail closes buffered frames", () => {
		const queue = new AsyncVideoFrameQueue();
		const f1 = mockFrame();
		const f2 = mockFrame();
		queue.enqueue(f1);
		queue.enqueue(f2);
		queue.fail(new Error("error"));
		expect(f1.close).toHaveBeenCalled();
		expect(f2.close).toHaveBeenCalled();
		expect(queue.length).toBe(0);
	});

	it("dequeue throws after fail", async () => {
		const queue = new AsyncVideoFrameQueue();
		queue.fail(new Error("fatal"));
		await expect(queue.dequeue()).rejects.toThrow("fatal");
	});

	it("destroy closes buffered frames and resolves waiting consumers with null", async () => {
		const queue = new AsyncVideoFrameQueue();
		const f1 = mockFrame();
		const f2 = mockFrame();
		queue.enqueue(f1);
		queue.enqueue(f2);

		const waitingConsumer = queue.dequeue();
		await waitingConsumer;
		const anotherWaiting = queue.dequeue();
		await anotherWaiting;

		const pendingAfterDrain = queue.dequeue();
		queue.destroy();

		expect(await pendingAfterDrain).toBeNull();
		expect(queue.length).toBe(0);
	});

	it("enqueue directly hands off to waiting consumer (no buffering)", async () => {
		const queue = new AsyncVideoFrameQueue();
		const pending = queue.dequeue();
		const f = mockFrame();
		queue.enqueue(f);
		expect(queue.length).toBe(0);
		expect(await pending).toBe(f);
	});
});
