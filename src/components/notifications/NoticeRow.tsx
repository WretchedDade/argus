import {
    Box,
    Button,
    Group,
    Text,
    type ButtonProps,
    type ElementProps,
} from "@mantine/core";
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Notice } from "../../lib/api";
import { pushToast } from "../../lib/toast";
import { IconBadge } from "./IconBadge";

type NoticeButtonProps = ButtonProps &
    ElementProps<"button", keyof ButtonProps>;

export function PrimaryButton(props: NoticeButtonProps) {
    return (
        <Button
            size="xs"
            flex="0 0 auto"
            variant="filled"
            type="button"
            {...props}
        />
    );
}

export function SecondaryButton(props: NoticeButtonProps) {
    return (
        <Button
            size="xs"
            flex="0 0 auto"
            variant="default"
            type="button"
            {...props}
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
        <Group align="flex-start" wrap="nowrap" gap="sm" px="sm" py="sm">
            <IconBadge tone="teal">{icon}</IconBadge>
            <Box miw={0} flex={1}>
                <Text size="sm" fw={500}>
                    {notice.title}
                </Text>
                <Text
                    c="dimmed"
                    mt={4}
                    size="xs"
                    style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}
                >
                    {notice.detail}
                </Text>
                <Group mt="sm" gap="xs">
                    {children}
                    <SecondaryButton
                        onClick={() => dismiss.mutate()}
                        disabled={dismiss.isPending}
                        loading={dismiss.isPending}
                    >
                        Dismiss
                    </SecondaryButton>
                </Group>
            </Box>
        </Group>
    );
}
