import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";
import { MantineProvider } from "@mantine/core";
import { argusTheme } from "../theme";
import {
    APPEARANCE_KEY,
    DEFAULT_APPEARANCE,
    backgroundScheme,
    parseAppearance,
    resolveColorScheme,
    type Appearance,
    type ColorScheme,
} from "../lib/appearance";

const AppearanceContext = createContext<{
    appearance: Appearance;
    updateAppearance: (value: Appearance) => void;
    error: string | null;
} | null>(null);

function readSavedAppearance() {
    try {
        return {
            appearance: parseAppearance(localStorage.getItem(APPEARANCE_KEY)),
            error: null,
        };
    } catch (error) {
        return {
            appearance: DEFAULT_APPEARANCE,
            error: `Could not read appearance settings: ${String(error)}`,
        };
    }
}

function readHostScheme(): ColorScheme | null {
    const probe = document.createElement("span");
    probe.style.cssText =
        "position:fixed;visibility:hidden;background:var(--background-color-default,transparent)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return null;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return alpha === 255 ? backgroundScheme(red, green, blue) : null;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
    const [saved, setSaved] = useState(readSavedAppearance);
    const [environment, setEnvironment] = useState(() => ({
        host: readHostScheme(),
        systemDark: matchMedia("(prefers-color-scheme: dark)").matches,
    }));

    useEffect(() => {
        const media = matchMedia("(prefers-color-scheme: dark)");
        const update = () => {
            const host = readHostScheme();
            setEnvironment((previous) =>
                previous.host === host && previous.systemDark === media.matches
                    ? previous
                    : { host, systemDark: media.matches },
            );
        };
        const observer = new MutationObserver(update);
        observer.observe(document.head, {
            childList: true,
            characterData: true,
            subtree: true,
        });
        for (const element of [document.documentElement, document.body]) {
            observer.observe(element, {
                attributes: true,
                attributeFilter: [
                    "style",
                    "class",
                    "data-theme",
                    "data-color-mode",
                    "data-color-scheme",
                ],
            });
        }
        const onStorage = (event: StorageEvent) => {
            if (event.key === APPEARANCE_KEY || event.key === null)
                setSaved(readSavedAppearance());
        };
        media.addEventListener("change", update);
        window.addEventListener("storage", onStorage);
        update();
        return () => {
            observer.disconnect();
            media.removeEventListener("change", update);
            window.removeEventListener("storage", onStorage);
        };
    }, []);

    const updateAppearance = (appearance: Appearance) => {
        try {
            localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
            setSaved({ appearance, error: null });
        } catch (error) {
            setSaved({
                appearance,
                error: `Appearance changed for this session but could not be saved: ${String(error)}`,
            });
        }
    };

    return (
        <AppearanceContext.Provider value={{ ...saved, updateAppearance }}>
            <MantineProvider
                cssVariablesResolver={(theme) => ({
                    variables: {
                        "--argus-load-backlog":
                            theme.colors[
                                theme.primaryColor === "orange"
                                    ? "violet"
                                    : "orange"
                            ][6],
                    },
                    light: {},
                    dark: {},
                })}
                forceColorScheme={resolveColorScheme(
                    saved.appearance.mode,
                    environment.host,
                    environment.systemDark,
                )}
                theme={{
                    ...argusTheme,
                    primaryColor: saved.appearance.accent,
                }}
            >
                {children}
            </MantineProvider>
        </AppearanceContext.Provider>
    );
}

export function useAppearance() {
    const context = useContext(AppearanceContext);
    if (!context) throw new Error("AppearanceProvider is missing");
    return context;
}
