import {
    Alert,
    Anchor,
    Button,
    Code,
    Group,
    List,
    Loader,
    Stack,
    Text,
    ThemeIcon,
    Title,
} from "@mantine/core";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { describeLoadFailure, errorMessage } from "../lib/errors";

// Inline banner for a failed query, with an optional retry.
export function ErrorBanner({
    title,
    error,
    onRetry,
}: {
    title: string;
    error?: unknown;
    onRetry?: () => void;
}) {
    return (
        <Alert
            color="red"
            title={title}
            icon={<AlertTriangle size={16} />}
            mb="sm"
        >
            <Group justify="space-between" gap="sm">
                {error !== undefined && (
                    <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                        {errorMessage(error)}
                    </Text>
                )}
                {onRetry && (
                    <Button variant="default" type="button" onClick={onRetry}>
                        Retry
                    </Button>
                )}
            </Group>
        </Alert>
    );
}

// Full-page state for a load failure that leaves the page with nothing to show.
export function LoadErrorPage({
    what,
    error,
    onRetry,
    showActivityLink = true,
}: {
    what: string;
    error: unknown;
    onRetry: () => void;
    showActivityLink?: boolean;
}) {
    const f = describeLoadFailure(error, what);
    return (
        <Stack role="alert" maw={576} mx="auto" py={48} gap="md">
            <Group wrap="nowrap">
                <ThemeIcon size={44} variant="light" color="red">
                    <AlertTriangle size={22} />
                </ThemeIcon>
                <Title order={1} size="h3">
                    {f.headline}
                </Title>
            </Group>
            <Text size="sm">{f.reason}</Text>
            <div>
                <Text size="sm" fw={500} mb={4}>
                    Things to try
                </Text>
                <List size="sm" c="dimmed" spacing={4}>
                    {f.steps.map((s) => (
                        <List.Item key={s}>{s}</List.Item>
                    ))}
                </List>
            </div>
            <Code block>{f.technical}</Code>
            <Group gap="sm">
                <Button
                    variant="filled"
                    type="button"
                    onClick={onRetry}
                    leftSection={<RefreshCw size={14} />}
                >
                    Retry
                </Button>
                {showActivityLink && (
                    <Anchor
                        renderRoot={(props) => (
                            <Link to="/activity" {...props} />
                        )}
                        size="sm"
                    >
                        Open activity log
                    </Anchor>
                )}
            </Group>
        </Stack>
    );
}

// Shown while a slow route loader runs.
export function PendingPage() {
    return (
        <Stack role="status" aria-busy="true" align="center" gap="sm" py={128}>
            <Loader size={40} aria-hidden />
            <Text size="sm" c="dimmed">
                Loading…
            </Text>
        </Stack>
    );
}

// Router-level fallback for render and loader errors.
export function RouteError({
    error,
    reset,
}: {
    error: unknown;
    reset: () => void;
}) {
    return (
        <LoadErrorPage
            what="this page"
            error={error}
            onRetry={reset}
            showActivityLink={false}
        />
    );
}
