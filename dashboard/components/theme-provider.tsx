"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  // Initialize theme from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme") as Theme | null;
      if (stored && ["light", "dark", "system"].includes(stored)) {
        setThemeState(stored);
      } else {
        setThemeState("system");
      }
    } catch {
      // localStorage might not be available
      setThemeState("system");
    }
    setMounted(true);
  }, []);

  // Update resolved theme based on preference and system
  useEffect(() => {
    if (!mounted) return;

    let finalTheme: "light" | "dark" = "dark";

    if (theme === "system") {
      // Check system preference
      if (window.matchMedia("(prefers-color-scheme: light)").matches) {
        finalTheme = "light";
      } else {
        finalTheme = "dark";
      }
    } else {
      finalTheme = theme;
    }

    setResolvedTheme(finalTheme);

    // Update DOM
    const html = document.documentElement;
    if (finalTheme === "dark") {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }, [theme, mounted]);

  // Listen for system theme changes
  useEffect(() => {
    if (!mounted || theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    const handleChange = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? "light" : "dark");
      const html = document.documentElement;
      if (e.matches) {
        html.classList.remove("dark");
      } else {
        html.classList.add("dark");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("theme", newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

// For use in client components that might not have ThemeProvider available
export function useThemeWithFallback() {
  try {
    return useTheme();
  } catch {
    return {
      theme: "system" as Theme,
      setTheme: () => {},
      resolvedTheme: "dark" as const,
    };
  }
}
