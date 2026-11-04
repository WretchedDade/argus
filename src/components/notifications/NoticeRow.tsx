import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Notice } from "../../lib/api";
import { pushToast } from "../../lib/toast";
import { IconBadge } from "./IconBadge";

export function PrimaryButton({
    className = "",
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            {...props}
            className={`rounded-md px-2.5 py-1 font-semibold text-white disabled:opacity-60 ${className}`}
            style={{ background: "var(--peacock-teal)" }}
        />
    );
}

export function SecondaryButton(
    props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
    return (
        <button
            type="button"
            {...props}
            className="border-line text-muted hover:text-fg rounded-md border px-2.5 py-1 font-medium disabled:opacity-60"
        />
    );
}

// Shared shell for a notice: icon, text, the kind's own actions, and Dismiss.
export function NoticeRow({
    notice,
    icon,
    children,
}: {
    notice: Notice;
    icon: ReactNode;
    children: ReactNode;
}) {
    const qc = useQueryClient();
    const dismiss = useMutation({
        mutationFn: () => api.dismissNotice(notice.id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["notices"] }),
        onError: () => pushToast("Couldn't dismiss the notice", "error"),
    });

    return (
        <div className="flex items-start gap-3 px-3.5 py-2.5">
            <IconBadge tone="teal">{icon}</IconBadge>
            <div className="min-w-0 flex-1">
                <div className="text-fg text-sm font-medium">
                    {notice.title}
                </div>
                <div className="text-muted mt-1 whitespace-pre-line break-words text-xs leading-relaxed">
                    {notice.detail}
                </div>
                <div className="mt-2.5 flex gap-2 text-xs">
                    {children}
                    <SecondaryButton
                        onClick={() => dismiss.mutate()}
                        disabled={dismiss.isPending}
                    >
                        Dismiss
                    </SecondaryButton>
                </div>
            </div>
        </div>
    );
}
