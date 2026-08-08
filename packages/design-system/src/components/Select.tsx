import React from 'react';
import * as RadixSelect from '@radix-ui/react-select';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

export function Select({ label, options, value, onChange }: SelectProps) {
  return (
    <label className="flex flex-col gap-1 font-ui text-sm">
      <span className="text-text-secondary">{label}</span>
      <RadixSelect.Root value={value} onValueChange={onChange}>
        <RadixSelect.Trigger className="rounded-control px-3 py-2 border border-border bg-surface text-text pr-focusable text-left">
          <RadixSelect.Value />
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className="rounded-panel border border-border bg-surface shadow-lg">
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  className="px-3 py-2 text-text cursor-pointer data-[highlighted]:bg-accent data-[highlighted]:text-on-accent outline-none"
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </label>
  );
}
