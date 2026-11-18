// One event per recorded review, including repeat verdicts.
export type RhythmItem = {
    at: string;
    repo: string;
    team: string | null;
    number: number;
    title: string;
};
