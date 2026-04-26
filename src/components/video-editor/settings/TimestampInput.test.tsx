import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TimestampInput } from "./TimestampInput";

describe("TimestampInput", () => {
	it("displays formatted milliseconds when not focused", () => {
		render(<TimestampInput label="Start" valueMs={5500} onChange={() => {}} />);
		const input = screen.getByDisplayValue("5.5");
		expect(input).toBeTruthy();
	});

	it("displays minutes:seconds for values >= 60s", () => {
		render(<TimestampInput label="End" valueMs={90000} onChange={() => {}} />);
		const input = screen.getByDisplayValue("1:30.0");
		expect(input).toBeTruthy();
	});

	it("shows label text", () => {
		render(<TimestampInput label="Start" valueMs={1000} onChange={() => {}} />);
		expect(screen.getByText("Start")).toBeTruthy();
	});

	it("calls onChange with parsed ms on blur", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="Start" valueMs={1000} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "3.5" } });
		fireEvent.blur(input);

		expect(onChange).toHaveBeenCalledWith(3500);
	});

	it("parses minutes:seconds format", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="Start" valueMs={0} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "1:30" } });
		fireEvent.blur(input);

		expect(onChange).toHaveBeenCalledWith(90000);
	});

	it("parses minutes:seconds.decimal format", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="End" valueMs={0} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "2:15.5" } });
		fireEvent.blur(input);

		expect(onChange).toHaveBeenCalledWith(135500);
	});

	it("clamps to minMs", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="Start" valueMs={5000} minMs={2000} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "0.5" } });
		fireEvent.blur(input);

		expect(onChange).toHaveBeenCalledWith(2000);
	});

	it("clamps to maxMs", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="End" valueMs={5000} maxMs={10000} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "15" } });
		fireEvent.blur(input);

		expect(onChange).toHaveBeenCalledWith(10000);
	});

	it("does not call onChange for invalid input", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="Start" valueMs={1000} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "abc" } });
		fireEvent.blur(input);

		expect(onChange).not.toHaveBeenCalled();
	});

	it("commits on Enter key", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="Start" valueMs={1000} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "5" } });
		fireEvent.keyDown(input, { key: "Enter" });

		expect(onChange).toHaveBeenCalledWith(5000);
	});

	it("reverts on Escape key without calling onChange", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="Start" valueMs={1000} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "99" } });
		fireEvent.keyDown(input, { key: "Escape" });

		expect(onChange).not.toHaveBeenCalled();
	});

	it("handles zero value", () => {
		render(<TimestampInput label="Start" valueMs={0} onChange={() => {}} />);
		const input = screen.getByDisplayValue("0.0");
		expect(input).toBeTruthy();
	});

	it("is disabled when disabled prop is true", () => {
		render(<TimestampInput label="Start" valueMs={1000} onChange={() => {}} disabled />);
		const input = screen.getByRole("textbox");
		expect((input as HTMLInputElement).disabled).toBe(true);
	});

	it("strips trailing 's' suffix from input", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="Start" valueMs={0} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "5.5s" } });
		fireEvent.blur(input);

		expect(onChange).toHaveBeenCalledWith(5500);
	});

	it("handles empty input without calling onChange", () => {
		const onChange = vi.fn();
		render(<TimestampInput label="Start" valueMs={1000} onChange={onChange} />);
		const input = screen.getByRole("textbox");

		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.blur(input);

		expect(onChange).not.toHaveBeenCalled();
	});
});
