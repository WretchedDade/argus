import { useState } from "react";
import {
    Combobox,
    ComboboxButton,
    ComboboxInput,
    ComboboxLabel,
    ComboboxOption,
    ComboboxOptions,
    Popover,
    PopoverButton,
    PopoverPanel,
} from "@headlessui/react";
import { ChevronDown, ListFilter } from "lucide-react";
import type { Pr } from "../lib/api";
import {
    queueFilterOptions,
    type QueueFilters as Filters,
} from "../lib/queue-filters";

const fields = [
    { key: "group", label: "Required Approver Group", all: "All groups" },
    { key: "creator", label: "PR Creator", all: "All creators" },
    { key: "repository", label: "Repository", all: "All repositories" },
] as const;

function SearchableFilter({
    name,
    label,
    all,
    options,
    value,
    display,
    onChange,
}: {
    name: string;
    label: string;
    all: string;
    options: string[];
    value?: string;
    display: (option: string) => string;
    onChange: (value: string | undefined) => void;
}) {
    const [query, setQuery] = useState("");
    const search = query.trim().toLocaleLowerCase();
    const choices = ["", ...options].filter(
        (option) =>
            !search ||
            (option ? `${display(option)} ${option}` : all)
                .toLocaleLowerCase()
                .includes(search),
    );

    return (
        <Combobox
            value={value ?? ""}
            onChange={(option: string | null) => onChange(option || undefined)}
            onClose={() => setQuery("")}
        >
            <div className="relative min-w-0">
                <ComboboxLabel
                    passive
                    className="text-muted mb-1.5 block text-xs font-medium"
                >
                    {label}
                </ComboboxLabel>
                <div className="relative">
                    <ComboboxInput
                        name={name}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={all}
                        displayValue={(option: string) =>
                            option ? display(option) : ""
                        }
                        onChange={(event) => setQuery(event.target.value)}
                        className="border-line bg-canvas text-fg hover:border-accent w-full min-w-0 touch-manipulation truncate rounded-md border py-2 pl-2 pr-8 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    />
                    <ComboboxButton
                        aria-label={`Show ${label} options`}
                        className="text-muted absolute inset-y-0 right-0 flex items-center rounded-r-md px-2 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                        <ChevronDown size={14} aria-hidden="true" />
                    </ComboboxButton>
                </div>
                <ComboboxOptions
                    anchor="bottom start"
                    modal={false}
                    className="border-line bg-canvas z-50 w-[var(--input-width)] overscroll-contain rounded-md border p-1 shadow-lg [--anchor-gap:0.25rem] [--anchor-max-height:15rem] [--anchor-padding:0.5rem] empty:invisible"
                >
                    {choices.map((option) => (
                        <ComboboxOption
                            key={option}
                            value={option}
                            className={({ focus }) =>
                                `text-fg block w-full cursor-default touch-manipulation break-words rounded px-2 py-2 text-left text-sm data-selected:font-medium ${focus ? "lane-review" : ""}`
                            }
                        >
                            {option ? display(option) : all}
                        </ComboboxOption>
                    ))}
                    {choices.length === 0 && (
                        <p
                            role="status"
                            className="text-muted px-2 py-2 text-sm"
                        >
                            No matches.
                        </p>
                    )}
                </ComboboxOptions>
            </div>
        </Combobox>
    );
}

function FilterDraft({
    prs,
    value,
    labels,
    onApply,
}: {
    prs: Pr[];
    value: Filters;
    labels: Record<string, string>;
    onApply: (filters: Filters) => void;
}) {
    const [draft, setDraft] = useState<Filters>(value);
    const options = queueFilterOptions(prs);

    return (
        <>
            {fields.map(({ key, label, all }) => {
                const selected = draft[key];
                const choices =
                    selected && !options[key].includes(selected)
                        ? [selected, ...options[key]]
                        : options[key];
                return (
                    <SearchableFilter
                        key={key}
                        name={key}
                        label={label}
                        all={all}
                        options={choices}
                        value={selected}
                        display={(option) =>
                            key === "group" ? labels[option] || option : option
                        }
                        onChange={(option) =>
                            setDraft((current) => ({
                                ...current,
                                [key]: option,
                            }))
                        }
                    />
                );
            })}
            <div className="flex items-center justify-between gap-2 pt-1">
                <button
                    type="button"
                    onClick={() => setDraft({})}
                    className="text-muted hover:text-fg rounded px-1 py-1 text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                    Reset
                </button>
                <button
                    type="button"
                    onClick={() => onApply(draft)}
                    className="lane-review text-fg rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                    Apply
                </button>
            </div>
        </>
    );
}

export function QueueFilters({
    prs,
    value,
    labels,
    onChange,
}: {
    prs: Pr[];
    value: Filters;
    labels: Record<string, string>;
    onChange: (filters: Filters) => void;
}) {
    const activeCount = fields.filter(({ key }) => !!value[key]).length;

    return (
        <section
            aria-label="Filter review queue"
            className="ml-auto flex shrink-0 items-center gap-2"
        >
            <Popover className="relative w-fit">
                <PopoverButton className="border-line bg-canvas text-fg hover:border-accent flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <ListFilter size={14} aria-hidden="true" />
                    Filters
                    {activeCount > 0 && (
                        <span className="lane-review rounded-full px-1.5 text-xs font-medium">
                            {activeCount}
                        </span>
                    )}
                </PopoverButton>
                <PopoverPanel
                    anchor="bottom end"
                    focus
                    role="dialog"
                    aria-label="Filters"
                    className="border-line bg-canvas z-40 grid w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-lg border p-3 shadow-lg [--anchor-gap:0.25rem]"
                >
                    {({ close }) => (
                        <FilterDraft
                            prs={prs}
                            value={value}
                            labels={labels}
                            onApply={(filters) => {
                                onChange(filters);
                                close();
                            }}
                        />
                    )}
                </PopoverPanel>
            </Popover>
            {activeCount > 0 && (
                <button
                    type="button"
                    onClick={() => onChange({})}
                    className="text-muted hover:text-fg touch-manipulation rounded px-1 py-1 text-xs underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                    Clear Filters
                </button>
            )}
        </section>
    );
}
