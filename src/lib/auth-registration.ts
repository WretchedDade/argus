export type RegistrationValues = { clientId: string; tenantId: string };
export type RegistrationErrors = Partial<
    Record<keyof RegistrationValues, string>
>;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateRegistration(value: unknown): RegistrationErrors {
    const reg = value as Partial<RegistrationValues> | null;
    const errors: RegistrationErrors = {};
    for (const [key, label] of [
        ["clientId", "Application (client) ID"],
        ["tenantId", "Directory (tenant) ID"],
    ] as const) {
        const id = reg?.[key];
        if (typeof id !== "string" || !id.trim())
            errors[key] = `${label} is required.`;
        else if (!GUID.test(id.trim()))
            errors[key] = `${label} must be a GUID.`;
    }
    return errors;
}
