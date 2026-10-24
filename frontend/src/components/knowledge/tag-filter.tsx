"use client";

import { useDebouncedValue } from "@mantine/hooks";
import { Check, Tag } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTags } from "@/lib/knowledge/use-knowledge";

type TagFilterProps = { selected: string[]; onChange: (tags: string[]) => void };

/** Tag combobox over GET /v1/tags (AND filter). */
export function TagFilter({ selected, onChange }: TagFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 200);
  const tags = useTags(debounced.trim(), open);

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Filter by tags">
          <Tag />
          Tags
          {selected.length > 0 && <span className="text-data">{selected.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search tags" value={search} onValueChange={setSearch} />
          <CommandList>
            {tags.isSuccess && tags.data.length === 0 && <CommandEmpty>No tags</CommandEmpty>}
            <CommandGroup>
              {tags.data?.map((tag) => (
                <CommandItem key={tag.name} value={tag.name} onSelect={() => toggle(tag.name)}>
                  <Check className={selected.includes(tag.name) ? "size-4" : "size-4 opacity-0"} />
                  <span className="font-mono text-xs">{tag.name}</span>
                  <span className="ml-auto text-data">{tag.knowledge_count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
