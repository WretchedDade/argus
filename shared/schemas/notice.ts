// Notification bell rows as the browser sees them. Import from here only.

import { z } from "zod";

export const NoticeKindSchema = z.enum([
    "app-update",
    "skill-update",
    "storage",
]);
export type NoticeKind = z.infer<typeof NoticeKindSchema>;

export const NoticeSchema = z.object({
    // Dismissal key; changes when there is something new to say.
    id: z.string(),
    kind: NoticeKindSchema,
    title: z.string(),
    detail: z.string(),
    href: z.string().optional(),
    // Button that sends the server-side prompt to the chat.
    actionLabel: z.string().optional(),
    // Button that replaces the installed skill (skill-update only).
    secondaryActionLabel: z.string().optional(),
});
export type Notice = z.infer<typeof NoticeSchema>;

export const NoticesResponseSchema = z.object({
    notices: z.array(NoticeSchema),
});
