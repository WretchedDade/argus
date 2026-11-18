export function validateIntegerSetting(
    value: string,
    min: number,
    max?: number,
): string | undefined {
    if (!value.trim() || !Number.isSafeInteger(Number(value)))
        return "Enter a whole number.";
    if (Number(value) < min || (max !== undefined && Number(value) > max))
        return max === undefined
            ? `Enter ${min} or more.`
            : `Enter a value from ${min} to ${max}.`;
    return undefined;
}
